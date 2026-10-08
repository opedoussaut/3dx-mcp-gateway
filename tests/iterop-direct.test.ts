import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { definitions } from '../server/iterop/chain';
import { registerDirectTools, type DirectOptions } from '../server/iterop/direct';
import { createLiveEngine, labLiveStatus } from '../server/iterop/lab-live';
import { SyntheticEngine } from '../server/iterop/simulator';
import { config, gatewayDouble } from './helpers/lab-gateway';

async function connect(o: DirectOptions) {
  const server = new McpServer({ name: 'direct-test', version: '1.0.0' });
  registerDirectTools(server, o);
  const client = new Client({ name: 'claude-test', version: '1.0.0' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r = await client.callTool({ name, arguments: args });
    return { ...JSON.parse((r.content as { text: string }[])[0].text), isError: r.isError };
  };
  return { client, call };
}

const START = {
  start_itLoadKw: 1200,
  start_facilityWaterC: 32,
  start_rackCount: 16,
  start_redundancy: 'N+1',
  start_coolant: 'auto',
};

/** What Claude does: read the model, start, calculate, complete each automated task. */
async function driveChain(call: Awaited<ReturnType<typeof connect>>['call']) {
  const model = await call('iterop_get_process_model', { processKey: 'syn-cooling-chain' });
  assert.deepEqual(
    model.startForm.map((f: { id: string }) => f.id),
    Object.keys(START),
  );
  const started = await call('iterop_start_process', {
    processKey: 'syn-cooling-chain',
    values: START,
  });
  assert.equal(started.started, true, JSON.stringify(started));
  assert.match(started.runReference, /^COOL-\d{6}-\d{6}$/);
  assert.equal(started.nextTask.task.replace(/^\[[^\]]*\]\s*/, ''), 'Select coolant');
  // Claude's own engineering proposal for 1.2 MW, 32 °C water, 16 racks, N+1.
  const proposal = {
    coolantSelection_fluid: 'PG25',
    coolantSelection_cp: 3.9,
    coolantSelection_density: 1020,
    cduSizing_model: 'CDU-500',
    cduCapacityKw: 500,
    cduSizing_units: 4,
    cduSizing_dutyUnits: 3,
    cduSizing_utilisation: 80,
    loopConfiguration_supplyC: 35,
    loopConfiguration_returnC: 45,
    loopConfiguration_flowLpm: 1810,
    loopConfiguration_rackFlowLpm: 113.1,
  };
  const check = await call('cooling_check', {
    envelope: { itLoadKw: 1200, facilityWaterC: 32, rackCount: 16, redundancy: 'N+1' },
    proposal,
  });
  assert.equal(check.result, 'PASS', JSON.stringify(check.findings));
  const pick = (prefix: string) =>
    Object.fromEntries(Object.entries(proposal).filter(([k]) => k.startsWith(prefix)));
  const values: Record<string, Record<string, unknown>> = {
    'Select coolant': {
      ...pick('coolantSelection_'),
      coolantSelection_rationale: 'Glycol mix for freeze margin.',
    },
    'Size coolant distribution units': pick('cduSizing_'),
    'Configure secondary loop': pick('loopConfiguration_'),
    'Check system limits': check.checkTaskValues,
  };
  let next = started.nextTask;
  for (const name of Object.keys(values)) {
    if (name === 'Check system limits') {
      // Claude cannot grade its own work: invented check values are refused.
      const selfGraded = await call('iterop_complete_task', {
        taskId: next.taskId,
        values: { systemCheck_result: 'PASS', systemCheck_findings: 'Looks good to me.' },
      });
      assert.equal(selfGraded.isError, true);
      assert.match(selfGraded.error, /only the checkTaskValues returned by cooling_check/);
    }
    const done = await call('iterop_complete_task', { taskId: next.taskId, values: values[name] });
    assert.equal(done.isError, undefined, JSON.stringify(done));
    next = done.nextTask;
  }
  return { started, next };
}

test('the direct connector exposes fixed ITEROP tools; only the two writes are destructive', async () => {
  const { client } = await connect({
    engine: new SyntheticEngine(),
    processes: definitions.map((d) => d.key),
  });
  const tools = (await client.listTools()).tools;
  assert.deepEqual(tools.map((t) => t.name).sort(), [
    'cooling_check',
    'iterop_complete_task',
    'iterop_connection',
    'iterop_get_instance',
    'iterop_get_process_model',
    'iterop_get_task',
    'iterop_list_my_tasks',
    'iterop_list_startable_processes',
    'iterop_start_process',
  ]);
  for (const t of tools)
    assert.equal(
      t.annotations?.destructiveHint,
      ['iterop_start_process', 'iterop_complete_task'].includes(t.name),
      t.name,
    );
  assert.ok(!tools.some((t) => /sign|assign|delete|deploy|stop|url|http/i.test(t.name)));
});

test('Claude can run the cooling chain end to end on the simulated engine; sign-off stays human', async () => {
  const { call } = await connect({
    engine: new SyntheticEngine(),
    processes: definitions.map((d) => d.key),
  });
  const { next } = await driveChain(call);
  // The chain now waits for the engineer, whose task is not this account's.
  assert.match(String(next), /waits for a person/);
  const mine = await call('iterop_list_my_tasks');
  assert.equal(mine.tasks.length, 0);
  const refused = await call('iterop_get_process_model', { processKey: 'not-a-lab-process' });
  assert.equal(refused.isError, true);
});

test('through the API Gateway: foreign tasks and processes hidden, signature refused', async () => {
  const gw = gatewayDouble();
  const foreign = {
    id: 'foreign-1',
    name: 'Approve purchase order',
    process: { identificator: 'PO-77', instanceId: '42', name: 'Purchasing' },
  };
  const fetcher: typeof fetch = async (input, init) => {
    const res = await gw.fetcher(input, init);
    if (
      new URL(String(input)).pathname.endsWith('/runtime/tasks') &&
      (init?.method ?? 'GET') === 'GET'
    )
      return new Response(JSON.stringify([...(await res.json()), foreign]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    return res;
  };
  const cfg = config();
  const status = labLiveStatus({ ...cfg, playOrigin: 'https://play.example.test' });
  const { call } = await connect({
    engine: createLiveEngine(cfg, fetcher)!,
    processes: status.settings.processes,
    play: status.play?.instance,
  });
  const listed = await call('iterop_list_startable_processes');
  assert.ok(
    listed.processes.every((p: { key: string }) => status.settings.processes.includes(p.key)),
  );
  const { started } = await driveChain(call);
  assert.match(started.openInIterop, /^https:\/\/play\.example\.test\/play\/monitoring\//);
  const writes = gw.calls.filter((c) => c.method === 'POST');
  assert.equal(writes.length, 5);
  assert.ok(writes.every((w) => !('user' in (w.body as object))));
  const mine = await call('iterop_list_my_tasks');
  assert.equal(mine.otherTasksHidden, 1);
  assert.ok(!JSON.stringify(mine).includes('Purchasing'));
  const outside = await call('iterop_complete_task', { taskId: 'foreign-1', values: {} });
  assert.equal(outside.isError, true);
  assert.equal(writes.length, gw.calls.filter((c) => c.method === 'POST').length);
});

test('the independent check catches physics and redundancy errors in a proposal', async () => {
  const { checkProposal } = await import('../server/iterop/proposal-check');
  const envelope = {
    itLoadKw: 1200,
    facilityWaterC: 32,
    rackCount: 16,
    redundancy: 'N+1' as const,
  };
  const good = {
    coolantSelection_fluid: 'water',
    coolantSelection_cp: 4.18,
    coolantSelection_density: 997,
    cduSizing_model: 'CDU-500',
    cduCapacityKw: 500,
    cduSizing_units: 4,
    cduSizing_dutyUnits: 3,
    cduSizing_utilisation: 80,
    loopConfiguration_supplyC: 35,
    loopConfiguration_returnC: 45,
    loopConfiguration_flowLpm: 1727,
    loopConfiguration_rackFlowLpm: 107.9,
  };
  assert.equal(checkProposal(envelope, good).result, 'PASS');
  const bad = checkProposal(envelope, {
    ...good,
    cduSizing_units: 3,
    loopConfiguration_flowLpm: 800,
    loopConfiguration_rackFlowLpm: 50,
    loopConfiguration_supplyC: 31,
  });
  assert.equal(bad.result, 'FAIL');
  const text = bad.findings.join(' ');
  assert.match(text, /4 installed units/);
  assert.match(text, /energy balance/);
  assert.match(text, /cannot be below facility water/);
  assert.equal(bad.checkTaskValues.systemCheck_result, 'FAIL');
  const tight = checkProposal(envelope, {
    ...good,
    loopConfiguration_flowLpm: 1450,
    loopConfiguration_rackFlowLpm: 90.6,
  });
  assert.equal(tight.result, 'REVIEW');
});

test('signature tasks are refused by the connector itself', async () => {
  const engine = new SyntheticEngine();
  const { call } = await connect({ engine, processes: definitions.map((d) => d.key) });
  await driveChain(call);
  const signoff = engine.reviewerQueue()[0];
  assert.ok(signoff);
  // Even if a signature task were visible to this account, completing it is refused.
  const res = await call('iterop_complete_task', { taskId: signoff.id, values: {} });
  assert.equal(res.isError, true);
});

test('without configuration every ITEROP tool reports the blockers and sends nothing', async () => {
  const gw = gatewayDouble();
  const { call } = await connect({
    engine: new SyntheticEngine(),
    processes: [],
    blockers: ['Set NOVA_LAB_API_KEY (the API Gateway application key).'],
  });
  const r = await call('iterop_list_my_tasks');
  assert.equal(r.isError, true);
  assert.match(r.blockers[0], /NOVA_LAB_API_KEY/);
  assert.equal(gw.calls.length, 0);
});

test('the stdio server starts on the simulated engine by default', async () => {
  const client = new Client({ name: 'stdio-test', version: '1.0.0' });
  const env = Object.fromEntries(
    Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined),
  );
  delete env.ITEROP_MCP_ENGINE;
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: ['--import', 'tsx', 'server/iterop-mcp.ts'],
      env,
    }),
  );
  try {
    const conn = await client.callTool({ name: 'iterop_connection', arguments: {} });
    const data = JSON.parse((conn.content as { text: string }[])[0].text);
    assert.match(data.engine, /SIMULATED/);
  } finally {
    await client.close();
  }
});

test('the review mode is the operator’s setting and is reported to Claude', async () => {
  const base = { engine: new SyntheticEngine(), processes: definitions.map((d) => d.key) };
  const step = await (await connect(base)).call('iterop_connection');
  assert.equal(step.reviewMode, 'step');
  assert.match(step.reviewRule, /wait for the expert/);
  const final = await (await connect({ ...base, review: 'final' })).call('iterop_connection');
  assert.equal(final.reviewMode, 'final');
  assert.match(final.reviewRule, /validates the final result at the sign-off/);
});
