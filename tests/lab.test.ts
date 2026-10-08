import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { createApp } from '../server/app';
import { loadConfig } from '../server/config';
import { COOLING_CHAIN, definitions } from '../server/iterop/chain';
import {
  instanceInfoResponse,
  labOperations,
  neverCalled,
  taskInstanceResponse,
} from '../server/iterop/drive';
import { startableProcessesList, tasksByUser, basicProcessInfo } from '../server/iterop/fd04';
import { Orchestrator, parseInputs } from '../server/iterop/orchestrator';
import { EngineError, SyntheticEngine } from '../server/iterop/simulator';
import { loadSpec } from '../scripts/openapi-lib';
import type { OrchestrationRun } from '../shared/types';

const CONFIGURE =
  'Configure the cooling chain for 1.2 MW IT load, 32 °C facility water, 16 racks, N+1';
const lab = () => {
  const engine = new SyntheticEngine();
  return { engine, o: new Orchestrator(engine) };
};
const approveAll = async (o: Orchestrator, run: OrchestrationRun) => {
  while (run.status === 'awaiting_approval')
    run = await o.approve(run.id, run.steps.find((s) => s.status === 'awaiting_approval')!.id);
  return run;
};
const throwsStatus = (fn: () => unknown, status: number, message?: RegExp) =>
  assert.throws(fn, (e: unknown) => {
    assert.ok(e instanceof EngineError);
    assert.equal(e.status, status);
    if (message) assert.match(e.message, message);
    return true;
  });

test('synthetic engine returns FD04-shaped bodies and enforces documented errors', async () => {
  const { engine } = lab();
  assert.ok(startableProcessesList.safeParse(engine.getAllStartableProcesses()).success);
  assert.ok(basicProcessInfo.safeParse(engine.getBasicProcessInfo(COOLING_CHAIN)).success);
  throwsStatus(() => engine.getBasicProcessInfo('unknown'), 404);
  // NOVA never impersonates: a `user` field gets FD04's robot-only 400.
  throwsStatus(
    () => engine.startProcess(COOLING_CHAIN, { user: 'someone', data: {} }),
    400,
    /Only robot/,
  );
  throwsStatus(() => engine.startProcess('unknown', {}), 404);
  throwsStatus(() => engine.startProcess(COOLING_CHAIN, { data: {} }), 400, /required/);
  throwsStatus(
    () =>
      engine.startProcess(COOLING_CHAIN, {
        data: { start_itLoadKw: 5, start_facilityWaterC: 30, start_rackCount: 4 },
      }),
    400,
    /outside/,
  );
  throwsStatus(() => engine.startProcess(COOLING_CHAIN, { extra: true }), 400);
  assert.deepEqual(
    engine.startProcess(COOLING_CHAIN, {
      identificator: 'COOL-T',
      data: { start_itLoadKw: 800, start_facilityWaterC: 30, start_rackCount: 8 },
    }),
    { status: 201 },
  );
  const tasks = engine.getTasksByUser();
  assert.ok(tasksByUser.safeParse(tasks).success);
  const [task] = tasks;
  assert.equal(task.process.identificator, 'COOL-T');
  const info = engine.getTaskInstanceInformations(task.id);
  assert.ok(taskInstanceResponse.safeParse(info).success);
  assert.ok(
    instanceInfoResponse.safeParse(engine.getInstanceInfo(task.process.instanceId)).success,
  );
  throwsStatus(() => engine.completeTask(task.id, { data: { bogus: 1 } }), 400);
  throwsStatus(() => engine.completeTask(task.id, { user: 'x', data: {} }), 400);
  throwsStatus(() => engine.completeTask('missing', {}), 404);
});

test('a signature task cannot be completed through the API (FD04 403)', async () => {
  const { engine, o } = lab();
  await approveAll(o, await o.start(CONFIGURE));
  const [signoff] = engine.reviewerQueue();
  assert.equal(signoff.name, 'Engineering sign-off');
  // Not in the operator's own task list, and refused by completeTask.
  assert.ok(!engine.getTasksByUser().some((t) => t.id === signoff.id));
  throwsStatus(() => engine.completeTask(signoff.id, { data: {} }), 403, /signed/);
});

test('each write stops as a prepared request; nothing reaches the engine until approved', async () => {
  const { engine, o } = lab();
  const run = await o.start(CONFIGURE);
  assert.equal(run.status, 'awaiting_approval');
  const pending = run.steps.find((s) => s.status === 'awaiting_approval')!;
  assert.equal(pending.operationId, 'startProcess');
  assert.deepEqual(pending.request, {
    path: '/runtime/processes/syn-cooling-chain',
    body: {
      identificator: 'COOL-001',
      data: {
        start_itLoadKw: 1200,
        start_facilityWaterC: 32,
        start_rackCount: 16,
        start_redundancy: 'N+1',
        start_coolant: 'auto',
      },
    },
  });
  // Only the two discovery reads ran.
  assert.deepEqual(
    run.steps.filter((s) => s.status === 'done').map((s) => s.operationId),
    ['getAllStartableProcesses', 'getBasicProcessInfo'],
  );
  assert.equal(engine.getTasksByUser().length, 0);
  const cancelled = o.cancel(run.id);
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(engine.getTasksByUser().length, 0);
  assert.ok(cancelled.steps.every((s) => s.status === 'done' || s.status === 'skipped'));
  await assert.rejects(o.approve(run.id, pending.id), (e: unknown) => {
    assert.ok(e instanceof EngineError);
    assert.equal(e.status, 409);
    return true;
  });
});

test('the cooling chain runs end to end, then hands off to the human reviewer', async () => {
  const { engine, o } = lab();
  const first = await o.start(CONFIGURE);
  const run = await o.approve(
    first.id,
    first.steps.find((s) => s.status === 'awaiting_approval')!.id,
    true,
  );
  assert.equal(run.status, 'awaiting_signoff');
  assert.equal(run.approval, 'all');
  const writes = run.steps.filter((s) => s.kind === 'drive');
  assert.deepEqual(
    writes.map((s) => s.operationId),
    ['startProcess', 'completeTask', 'completeTask', 'completeTask', 'completeTask'],
  );
  assert.ok(writes.every((s) => s.status === 'done'));
  assert.equal(run.steps.at(-1)!.kind, 'human');
  assert.equal(run.steps.at(-1)!.status, 'blocked');
  assert.equal(run.stageState.engineeringSignoff, 'human');
  const value = (f: string) => run.outputs.find((x) => x.field === f)?.value;
  assert.equal(value('coolantSelection_fluid'), 'PG25');
  assert.equal(value('cduSizing_model'), 'CDU-800');
  assert.equal(value('cduSizing_units'), '3');
  assert.equal(value('loopConfiguration_supplyC'), '35 °C');
  assert.equal(value('systemCheck_result'), 'PASS');
  // Every value NOVA wrote is in the engine's instance variables.
  const vars = engine.getInstanceInfo(run.instanceId!).variables;
  assert.equal(vars.find((v) => v.id === 'cduSizing_units')?.value, 3);
  // Only lab operations appear in the trace; never-called operations never do.
  const used = new Set(run.steps.map((s) => s.operationId).filter(Boolean));
  for (const id of used) assert.ok(Object.values(labOperations).some((o) => o.operationId === id));
  for (const id of neverCalled) assert.ok(!used.has(id));
});

test('a reviewer rejection comes back to the inbox and NOVA reruns the chain', async () => {
  const { engine, o } = lab();
  await approveAll(o, await o.start(CONFIGURE));
  const empty = await o.start('Check my inbox and handle any rework', 'all');
  assert.equal(empty.status, 'completed');
  assert.match(empty.summary, /none sent back|empty/);
  engine.signAsReviewer(
    engine.reviewerQueue()[0].id,
    'Reject',
    'Use plain water instead of glycol and go 2N',
  );
  const rework = await o.start('Check my inbox and handle any rework', 'all');
  assert.equal(rework.status, 'awaiting_signoff');
  assert.equal(rework.intent, 'recalculate');
  assert.match(rework.findings[0], /coolant auto → water, redundancy N\+1 → 2N/);
  assert.equal(rework.outputs.find((x) => x.field === 'coolantSelection_fluid')?.value, 'water');
  assert.equal(rework.outputs.find((x) => x.field === 'cduSizing_units')?.value, '4');
  assert.equal(engine.reviewerQueue().length, 1);
  // An unusable comment leaves the rework task open for the person.
  engine.signAsReviewer(engine.reviewerQueue()[0].id, 'Reject', 'Not convinced, discuss');
  const unclear = await o.start('Check my inbox', 'all');
  assert.equal(unclear.status, 'needs_input');
  assert.equal(engine.getTasksByUser()[0].name, 'Rework configuration');
  // Approval in the reviewer's hands completes the instance.
  const { engine: e2, o: o2 } = lab();
  const done = await approveAll(o2, await o2.start(CONFIGURE));
  e2.signAsReviewer(e2.reviewerQueue()[0].id, 'Approve');
  throwsStatus(() => e2.getInstanceInfo(done.instanceId!), 404, /completed/);
});

test('a what-if reruns from the previous inputs and reports what changed', async () => {
  const { o } = lab();
  await approveAll(o, await o.start(CONFIGURE));
  const whatIf = await o.start(
    'Facility water is now 38 °C — what needs to be recalculated?',
    'all',
  );
  assert.equal(whatIf.intent, 'recalculate');
  assert.match(whatIf.findings.join(' '), /facility water 32 → 38\. Affected stages: loop, check/);
  const changed = Object.fromEntries(
    whatIf.changes.filter((c) => c.changed).map((c) => [c.field, [c.before, c.after]]),
  );
  assert.deepEqual(changed.loopConfiguration_supplyC, ['35 °C', '41 °C']);
  assert.deepEqual(changed.systemCheck_result, ['PASS', 'FAIL']);
  assert.ok(!('cduSizing_units' in changed));
});

test('refusals, missing inputs and reads plan no write', async () => {
  const { engine, o } = lab();
  for (const prompt of [
    'Reassign the sign-off task to another engineer',
    'Sign off the configuration for me',
    'Delete the process instance COOL-001',
    'Deploy the process model',
    'Show the tasks of Alice',
    'Grant me rights on the process',
    'Stop the process instance',
  ]) {
    const run = await o.start(prompt);
    assert.equal(run.status, 'blocked', prompt);
    assert.equal(run.steps.length, 0, prompt);
  }
  const missing = await o.start('Configure the cooling chain for 900 kW');
  assert.equal(missing.status, 'needs_input');
  assert.equal(missing.missing.length, 2);
  const range = await o.start(
    'Configure the cooling chain for 30 kW, 30 °C facility water, 4 racks',
  );
  assert.equal(range.status, 'needs_input');
  const noSource = await o.start('Register a candidate requirement: supply must stay below 40 °C');
  assert.equal(noSource.status, 'needs_input');
  const tasks = await o.start('What tasks are waiting for me?');
  assert.deepEqual(
    tasks.steps.map((s) => s.kind),
    ['read'],
  );
  const processes = await o.start('Which processes can I start?');
  assert.equal(processes.records.length, definitions.length);
  assert.equal((await o.start('Tell me a joke')).status, 'needs_input');
  assert.equal(engine.getTasksByUser().length, 0);
});

test('a candidate requirement starts the intake and waits for the reviewer', async () => {
  const { engine, o } = lab();
  const run = await o.start(
    'Register a candidate requirement: secondary supply must stay at or below 40 °C, source: public guideline section 4',
    'all',
  );
  assert.equal(run.status, 'awaiting_signoff');
  const start = run.steps.find((s) => s.operationId === 'startProcess')!;
  assert.deepEqual((start.request as { body: unknown }).body, {
    identificator: 'REQ-001',
    data: {
      start_statement: 'secondary supply must stay at or below 40 °C',
      start_sourceReference: 'public guideline section 4',
    },
  });
  assert.equal(engine.reviewerQueue()[0].name, 'Review candidate requirement');
});

test('a process model that does not match the lab definition stops before any write', async () => {
  const engine = new SyntheticEngine();
  const original = engine.getTaskInstanceInformations.bind(engine);
  engine.getTaskInstanceInformations = (id: string) => ({ ...original(id), expectedFields: [] });
  const o = new Orchestrator(engine);
  const run = await o.start(CONFIGURE, 'all');
  assert.equal(run.status, 'failed');
  assert.match(run.summary, /does not declare coolantSelection_fluid/);
  assert.equal(
    run.steps.filter((s) => s.operationId === 'completeTask' && s.status === 'done').length,
    0,
  );
});

test('parseInputs reads units and ignores the rejected alternative', async () => {
  assert.deepEqual(parseInputs('1.2 MW, 32 °C facility water, 16 racks, 2N, PG25'), {
    itLoadKw: 1200,
    facilityWaterC: 32,
    rackCount: 16,
    redundancy: '2N',
    coolant: 'PG25',
  });
  assert.equal(parseInputs('Use plain water instead of glycol').coolant, 'water');
  assert.equal(parseInputs('Switch to PG25 instead of water').coolant, 'PG25');
  assert.equal(parseInputs('850 kW without redundancy').redundancy, 'N');
  assert.equal(parseInputs('800,5 kW').itLoadKw, 801);
});

test('the importable BPMN models match the lab process definitions', async () => {
  for (const def of definitions) {
    const file = `docs/iterop/lab/${def.key === COOLING_CHAIN ? 'nova-lab-cooling-chain' : 'nova-lab-requirement-intake'}.bpmn`;
    const xml = readFileSync(file, 'utf8');
    assert.match(xml, new RegExp(`<bpmn:process id="${def.key}"`));
    const tasks = [...xml.matchAll(/<bpmn:userTask id="([^"]+)" name="([^"]+)"/g)].map((m) => [
      m[1],
      m[2],
    ]);
    const expected = [...def.tasks, ...(def.rework ? [def.rework] : [])].map((t) => [t.id, t.name]);
    assert.deepEqual(tasks.sort(), expected.sort(), file);
    // Each task documents exactly the variables NOVA reads or writes.
    for (const t of [...def.tasks, ...(def.rework ? [def.rework] : [])])
      for (const f of t.expectedFields) assert.ok(xml.includes(f.id), `${file}: ${f.id}`);
    for (const v of def.startVariables) assert.ok(xml.includes(v.id), `${file}: ${v.id}`);
    // Every referenced flow exists, and every shape has a model element.
    const ids = new Set([...xml.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]));
    for (const m of xml.matchAll(/(?:sourceRef|targetRef|bpmnElement|processRef)="([^"]+)"/g))
      assert.ok(ids.has(m[1]), `${file}: dangling reference ${m[1]}`);
  }
});

const SPEC_FILE = '.private/businessprocess_v2.openapi.json';
test(
  'lab operations and engine bodies match the official FD04 specification',
  { skip: !existsSync(SPEC_FILE) && 'private R2026x-FD04 OpenAPI not present (never committed)' },
  async () => {
    const { spec, operation } = loadSpec(readFileSync(SPEC_FILE, 'utf8'));
    for (const op of Object.values(labOperations)) {
      const found = operation(op.operationId);
      assert.ok(found, op.operationId);
      assert.equal(found!.method, op.method, op.operationId);
      assert.equal(found!.path, op.path, op.operationId);
      assert.deepEqual(
        Object.keys(found!.responses).map(Number).sort(),
        [...op.documentedStatus].sort(),
        op.operationId,
      );
    }
    for (const id of neverCalled) assert.ok(operation(id), `${id} exists in FD04`);
    const ajv = new Ajv2020({ strict: false, validateFormats: false });
    const schemas = (spec.components as { schemas: Record<string, object> }).schemas;
    const { engine, o } = lab();
    const run = await approveAll(o, await o.start(CONFIGURE));
    const check = (operationId: string, body: unknown) => {
      const schema = operation(operationId)!.okSchema;
      assert.ok(schema, operationId);
      const validate = ajv.compile(schema!);
      assert.ok(validate(body), `${operationId}: ${ajv.errorsText(validate.errors)}`);
    };
    check('getAllStartableProcesses', engine.getAllStartableProcesses());
    check('getBasicProcessInfo', engine.getBasicProcessInfo(COOLING_CHAIN));
    check('getInstanceInfo', engine.getInstanceInfo(run.instanceId!));
    // Request bodies NOVA prepared validate against StartProcessRequest / CompleteTaskRequest.
    const props = (name: string) =>
      Object.keys((schemas[name] as { properties: object }).properties);
    for (const s of run.steps.filter((x) => x.kind === 'drive')) {
      const body = (s.request as { body: Record<string, unknown> }).body;
      const schemaName =
        s.operationId === 'startProcess' ? 'StartProcessRequest' : 'CompleteTaskRequest';
      for (const key of Object.keys(body))
        assert.ok(props(schemaName).includes(key), `${schemaName}.${key}`);
      assert.ok(!('user' in body), 'NOVA never sends user');
    }
    const engine2 = new SyntheticEngine();
    engine2.startProcess(COOLING_CHAIN, {
      data: { start_itLoadKw: 800, start_facilityWaterC: 30, start_rackCount: 8 },
    });
    check('getTasksByUser', engine2.getTasksByUser());
    check(
      'getTaskInstanceInformations',
      engine2.getTaskInstanceInformations(engine2.getTasksByUser()[0].id),
    );
  },
);

test('HTTP lab API runs synthetic only and refuses live process control', async () => {
  const server = createApp(loadConfig({})).listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  let cookie = '';
  const request = async (path: string, data?: unknown) => {
    const res = await fetch(origin + '/api' + path, {
      method: data === undefined ? 'GET' : 'POST',
      headers: {
        Origin: origin,
        'X-Nova-Client': 'workspace',
        'Content-Type': 'application/json',
        Cookie: cookie,
      },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    });
    cookie ||= res.headers.get('set-cookie')?.split(';')[0] || '';
    return res;
  };
  try {
    const live = await request('/lab/runs', { prompt: CONFIGURE, source: 'live' });
    assert.equal(live.status, 409);
    assert.match((await live.json()).error, /No request was made/);
    const started = await (await request('/lab/runs', { prompt: CONFIGURE })).json();
    assert.equal(started.run.status, 'awaiting_approval');
    assert.equal(started.state.source, 'synthetic');
    const step = started.run.steps.find(
      (s: { status: string }) => s.status === 'awaiting_approval',
    );
    const approved = await (
      await request(`/lab/runs/${started.run.id}/approve`, { stepId: step.id, all: true })
    ).json();
    assert.equal(approved.run.status, 'awaiting_signoff');
    const queue = approved.state.reviewerQueue;
    assert.equal(queue.length, 1);
    const bad = await request('/lab/review', { taskId: queue[0].id, decision: 'Maybe' });
    assert.equal(bad.status, 400);
    const signed = await (
      await request('/lab/review', { taskId: queue[0].id, decision: 'Reject', comment: 'Use 2N' })
    ).json();
    assert.equal(signed.state.reviewerQueue.length, 0);
    const twice = await request(`/lab/runs/${started.run.id}/approve`, { stepId: step.id });
    assert.equal(twice.status, 409);
    const missing = await request('/lab/runs/00000000-0000-4000-8000-000000000000/cancel', {});
    assert.equal(missing.status, 404);
    const state = await (await request('/lab')).json();
    assert.equal(state.runs.length, 1);
    // Sessions are isolated: a new cookie sees an empty lab.
    cookie = '';
    assert.equal((await (await request('/lab')).json()).runs.length, 0);
  } finally {
    server.close();
  }
});

test('a stopped run is continued from the task it waits at, with the values already entered', async () => {
  const { engine, o } = lab();
  let run = await o.start(CONFIGURE);
  // Approve the start and the first completion, then stop before the second.
  run = await o.approve(run.id, run.steps.find((s) => s.status === 'awaiting_approval')!.id);
  run = await o.approve(run.id, run.steps.find((s) => s.status === 'awaiting_approval')!.id);
  o.cancel(run.id);
  assert.equal(engine.getTasksByUser()[0].name, 'Size coolant distribution units');
  const resumed = await o.start('Continue COOL-001', 'all');
  assert.equal(resumed.status, 'awaiting_signoff', resumed.summary);
  assert.equal(resumed.identificator, 'COOL-001');
  assert.equal(resumed.stageNotes.coolantSelection, 'done earlier');
  // The coolant chosen in the first run (PG25 properties) fed the loop calculation.
  assert.equal(
    resumed.outputs.find((x) => x.field === 'loopConfiguration_flowLpm')?.value,
    '1,796 L/min',
  );
  const completes = resumed.steps.filter(
    (s) => s.operationId === 'completeTask' && s.status === 'done',
  );
  assert.equal(completes.length, 3);
  const none = await o.start('Continue COOL-001', 'all');
  assert.equal(none.status, 'completed');
  assert.match(none.summary, /no open task/);
});

test('continuing a run whose values are not readable uses the values given in the command', async () => {
  const { engine, o } = lab();
  let run = await o.start(CONFIGURE);
  run = await o.approve(run.id, run.steps.find((s) => s.status === 'awaiting_approval')!.id);
  o.cancel(run.id);
  // Simulate a run-only account: the task exposes no data and the instance is not readable.
  const original = engine.getTaskInstanceInformations.bind(engine);
  engine.getTaskInstanceInformations = (id: string) => ({ ...original(id), providedData: [] });
  engine.getInstanceInfo = () => {
    throw new EngineError(403, 'User not authorized.');
  };
  // A fresh orchestrator: no earlier run of this session to fall back on.
  const fresh = new Orchestrator(engine);
  const blocked = await fresh.start('Continue COOL-001', 'all');
  assert.equal(blocked.status, 'needs_input');
  assert.match(blocked.missing[0], /Continue COOL-001 with/);
  const resumed = await fresh.start(
    'Continue COOL-001 with 1.2 MW, 32 °C facility water, 16 racks, N+1',
    'all',
  );
  assert.equal(resumed.status, 'awaiting_signoff', resumed.summary);
  assert.match(resumed.findings.join(' '), /taken from your command/);
  // The same orchestrator remembers its own run's inputs.
  const { engine: e2, o: o2 } = lab();
  let r2 = await o2.start(CONFIGURE);
  r2 = await o2.approve(r2.id, r2.steps.find((s) => s.status === 'awaiting_approval')!.id);
  o2.cancel(r2.id);
  const orig2 = e2.getTaskInstanceInformations.bind(e2);
  e2.getTaskInstanceInformations = (id: string) => ({ ...orig2(id), providedData: [] });
  e2.getInstanceInfo = () => {
    throw new EngineError(403, 'no');
  };
  const again = await o2.start('Continue COOL-001', 'all');
  assert.equal(again.status, 'awaiting_signoff', again.summary);
  assert.match(again.findings.join(' '), /taken from run 1 of this session/);
});
