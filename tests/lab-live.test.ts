import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { createApp } from '../server/app';
import { loadConfig } from '../server/config';
import { SyntheticEngine } from '../server/iterop/simulator';
import {
  createLiveEngine,
  labContractSchema,
  loadLabLiveConfig,
  probeLive,
  type LabLiveConfig,
} from '../server/iterop/lab-live';
import { Orchestrator } from '../server/iterop/orchestrator';
import { ORIGIN, config, contract, gatewayDouble, json } from './helpers/lab-gateway';

const CONFIGURE = 'Configure the cooling chain for 1.2 MW IT load, 32 °C facility water, 16 racks';

test('live engine drives the lab chain through the gateway with key, agent, then session cookies', async () => {
  const gw = gatewayDouble();
  const engine = createLiveEngine(config(), gw.fetcher)!;
  const o = new Orchestrator(engine);
  const prepared = await o.start(CONFIGURE);
  assert.equal(prepared.source, 'live');
  assert.equal(prepared.status, 'awaiting_approval');
  // Only reads so far.
  assert.ok(gw.calls.every((c) => c.method === 'GET'));
  const step = prepared.steps.find((s) => s.status === 'awaiting_approval')!;
  const run = await o.approve(prepared.id, step.id, true);
  assert.equal(run.status, 'awaiting_signoff', run.summary);
  const first = gw.calls[0];
  assert.equal(first.url.origin, ORIGIN);
  assert.ok(first.url.pathname.startsWith('/api/businessprocess/v2/'));
  assert.equal(first.headers.APIKey, 'test-api-key');
  assert.match(first.headers.Authorization, /^Basic /);
  for (const c of gw.calls.slice(1)) {
    assert.equal(c.headers.APIKey, 'test-api-key');
    assert.equal(c.headers.Authorization, undefined, 'Basic only on the first call');
    assert.equal(c.headers.Cookie, 'GWSESSION=abc');
  }
  const writes = gw.calls.filter((c) => c.method === 'POST');
  assert.equal(writes.length, 5);
  assert.equal(
    writes[0].url.pathname,
    '/api/businessprocess/v2/runtime/processes/tenantCoolingChain',
  );
  for (const w of writes) {
    assert.equal(w.headers['Content-Type'], 'application/json');
    assert.ok(!('user' in (w.body as object)), 'user is never sent');
    assert.ok(!w.url.search, 'no query string on writes');
  }
  for (const c of gw.calls)
    assert.ok(!c.url.searchParams.has('user') && !c.url.searchParams.has('login'));
  // Live references carry the start time, so a restart never reuses one already on the tenant.
  assert.match(run.identificator!, /^COOL-\d{6}-\d{4}$/);
  assert.equal((writes[0].body as { identificator: string }).identificator, run.identificator);
  const again = await o.start(CONFIGURE);
  assert.notEqual(again.identificator, run.identificator);
});

test('live engine refuses what the contract does not admit, before any request', async () => {
  const gw = gatewayDouble();
  const engine = createLiveEngine(
    config({ driveApproval: { ...contract.driveApproval, operations: ['completeTask'] } }),
    gw.fetcher,
  )!;
  await assert.rejects(
    Promise.resolve(engine.startProcess('syn-cooling-chain', { data: {} })),
    /not approved/,
  );
  await assert.rejects(
    Promise.resolve(engine.getBasicProcessInfo('syn-requirement-intake')),
    /not admitted/,
  );
  const full = createLiveEngine(config(), gw.fetcher)!;
  await assert.rejects(
    Promise.resolve(full.startProcess('syn-cooling-chain', { user: 'someone', data: {} })),
    /never sends user/,
  );
  await assert.rejects(
    Promise.resolve(full.startProcess('syn-cooling-chain', { data: { other_var: 1 } })),
    /not a start variable/,
  );
  await assert.rejects(
    Promise.resolve(full.getTaskInstanceInformations('../admin')),
    /Invalid identifier/,
  );
  assert.equal(gw.calls.length, 0);
});

test('task names prefixed with their BPMN lane still match the lab definition', async () => {
  const { sameTask } = await import('../server/iterop/chain');
  assert.ok(sameTask('[Operator (NOVA acts as you)] Select coolant', 'Select coolant'));
  assert.ok(!sameTask('[Operator] Select coolant again', 'Select coolant'));
  assert.ok(!sameTask('', ''));
  let completed = false;
  const engine = createLiveEngine(config(), async (_input, init) => {
    if (init?.method === 'GET')
      return json({
        id: 'T9',
        name: '[Operator (NOVA acts as you)] Select coolant',
        expectedFields: [],
      });
    completed = true;
    return new Response(null, { status: 200 });
  })!;
  await engine.completeTask('T9', { data: {} });
  assert.ok(completed);
});

test('designer-generated variable ids are resolved by name and translated both ways', async () => {
  const { matchesField, resolveVariables } = await import('../server/iterop/lab-live');
  const { definition } = await import('../server/iterop/chain');
  assert.ok(matchesField('operatingEnvelope_startItloadkw', 'start_itLoadKw'));
  assert.ok(matchesField('operatingEnvelope_itloadkw', 'start_itLoadKw'));
  assert.ok(!matchesField('operatingEnvelope_rackcount', 'start_itLoadKw'));
  const d = definition('syn-cooling-chain')!;
  // The tenant ids the designer would generate for fields named exactly like NOVA's ids.
  const gen = (element: string, id: string) => `${element}_${id.replace('_', '').toLowerCase()}`;
  const tasks = [...d.tasks, d.rework!];
  const info = {
    humanTasks: tasks.map((t) => ({
      name: `[Operator] ${t.name}`,
      outputs: t.expectedFields.map((f) => ({ id: gen(t.id + 'Task', f.id) })),
    })),
    variables: Object.fromEntries(
      [...d.startVariables.map((v) => gen('operatingEnvelope', v.id)), 'identificatorInstance'].map(
        (id) => [id, { id }],
      ),
    ),
  };
  const { toTenant, missing } = resolveVariables(d, info);
  assert.deepEqual(missing, []);
  assert.equal(toTenant.get('start_itLoadKw'), 'operatingEnvelope_startitloadkw');
  // Same field name on the rework task and the start form resolves to different ids.
  assert.notEqual(toTenant.get('configurationRework_coolant'), toTenant.get('start_coolant'));
  let started: { data: Record<string, unknown> } | undefined;
  const engine = createLiveEngine(config(), async (input, init) => {
    const path = new URL(String(input)).pathname;
    if (init?.method === 'POST') {
      started = JSON.parse(String(init.body));
      return new Response(null, { status: 201 });
    }
    if (
      path.endsWith('/repository/processes/syn-cooling-chain') ||
      path.endsWith('/tenantCoolingChain')
    )
      return json(info);
    return json({}, 404);
  })!;
  await engine.startProcess('syn-cooling-chain', {
    identificator: 'COOL-001',
    data: {
      start_itLoadKw: 1200,
      start_facilityWaterC: 32,
      start_rackCount: 16,
      start_redundancy: 'N+1',
    },
  });
  assert.deepEqual(started!.data, {
    operatingEnvelope_startitloadkw: 1200,
    operatingEnvelope_startfacilitywaterc: 32,
    operatingEnvelope_startrackcount: 16,
    operatingEnvelope_startredundancy: 'N+1',
  });
});

test('a run-only account (definition 403) still starts, completes and passes the probe', async () => {
  const { derivedVariableId } = await import('../server/iterop/lab-live');
  assert.equal(
    derivedVariableId('Operating envelope', 'start_itLoadKw'),
    'operatingEnvelope_startItloadkw',
  );
  assert.equal(
    derivedVariableId('[Engineering reviewer] Engineering sign-off', 'engineeringSignoff_decision'),
    'engineeringReviewerEnginee_engineeringsignoffDecision',
  );
  const posts: { path: string; body: { data: Record<string, unknown> } }[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const path = new URL(String(input)).pathname.replace('/api/businessprocess/v2', '');
    if (init?.method === 'POST') {
      posts.push({ path, body: JSON.parse(String(init.body)) });
      return new Response(null, { status: path.startsWith('/runtime/processes') ? 201 : 200 });
    }
    if (path === '/repository/processes/startable/list')
      return json({ responses: [{ key: 'tenantCoolingChain', name: 'NOVA lab', version: 1 }] });
    if (path === '/repository/processes/tenantCoolingChain')
      return json({ code: 403, message: 'User not authorized.' }, 403);
    if (path === '/runtime/tasks') return json([]);
    if (path === '/runtime/tasks/T1')
      return json({
        id: 'T1',
        name: '[Operator (NOVA acts as you)] Select coolant',
        expectedFields: ['Fluid', 'Cp', 'Density', 'Rationale'].map((f) => ({
          id: `operatorNovaActsAsYouSelec_coolantselection${f}`,
        })),
      });
    return json({}, 404);
  };
  const engine = createLiveEngine(config(), fetcher)!;
  const probe = await probeLive(engine);
  assert.equal(probe.outcome, 'PASS', JSON.stringify(probe.checks));
  assert.ok(
    probe.checks.some((c) => c.name === 'Process definition' && /run rights only/.test(c.detail)),
  );
  await engine.startProcess('syn-cooling-chain', {
    identificator: 'COOL-001',
    data: {
      start_itLoadKw: 1200,
      start_facilityWaterC: 32,
      start_rackCount: 16,
      start_redundancy: 'N+1',
    },
  });
  assert.deepEqual(Object.keys(posts[0].body.data), [
    'operatingEnvelope_startItloadkw',
    'operatingEnvelope_startFacilitywaterc',
    'operatingEnvelope_startRackcount',
    'operatingEnvelope_startRedundancy',
  ]);
  await engine.completeTask('T1', {
    data: {
      coolantSelection_fluid: 'PG25',
      coolantSelection_cp: 3.93,
      coolantSelection_density: 1020,
      coolantSelection_rationale: 'lab rule',
    },
  });
  assert.deepEqual(posts[1].body.data, {
    operatorNovaActsAsYouSelec_coolantselectionFluid: 'PG25',
    operatorNovaActsAsYouSelec_coolantselectionCp: 3.93,
    operatorNovaActsAsYouSelec_coolantselectionDensity: 1020,
    operatorNovaActsAsYouSelec_coolantselectionRationale: 'lab rule',
  });
  // A form that lacks a field NOVA must write stops before the write.
  const partial = createLiveEngine(config(), async (input, init) => {
    if (init?.method === 'POST') throw new Error('must not write');
    return json({
      id: 'T2',
      name: 'Select coolant',
      expectedFields: [{ id: 'operatorNovaActsAsYouSelec_coolantselectionFluid' }],
    });
  })!;
  await assert.rejects(
    Promise.resolve(
      partial.completeTask('T2', {
        data: { coolantSelection_fluid: 'PG25', coolantSelection_rationale: 'x' },
      }),
    ),
    /no field for coolantSelection_rationale/,
  );
});

test('real task bodies with null form properties are accepted; mismatches name the path', async () => {
  const engine = createLiveEngine(config(), async () =>
    json({
      id: 'T1',
      name: 'Select coolant',
      description: null,
      priority: null,
      startDate: 1791443470000,
      providedData: [
        { id: 'operatingEnvelope_startItloadkw', name: 'IT load', type: 'DECIMAL', value: 1200 },
      ],
      expectedFields: [
        {
          id: 'x_coolantselectionFluid',
          name: 'coolantSelection_fluid',
          type: 'TEXT',
          required: true,
          values: null,
          defaultValue: null,
          min: null,
          max: 255,
          regex: null,
          composedVariableDefinition: null,
        },
      ],
      process: { identificator: 'COOL-001', instanceId: '9206643306167484571', name: 'NOVA lab' },
      assignments: null,
    }),
  )!;
  const info = await engine.getTaskInstanceInformations('T1');
  assert.equal(info.expectedFields?.[0].id, 'coolantSelection_fluid');
  assert.equal(info.providedData?.[0].id, 'start_itLoadKw');
  const bad = createLiveEngine(config(), async () => json({ id: 'T1', expectedFields: 'nope' }))!;
  await assert.rejects(
    Promise.resolve(bad.getTaskInstanceInformations('T1')),
    /getTaskInstanceInformations schema \(R2026x-FD04\) at expectedFields:/,
  );
});

test('a task outside the lab processes cannot be completed', async () => {
  const fetcher: typeof fetch = async (input, init) =>
    init?.method === 'GET'
      ? json({ id: 'T1', name: 'Approve purchase order', expectedFields: [] })
      : new Response(null, { status: 200 });
  const engine = createLiveEngine(config(), fetcher)!;
  await assert.rejects(
    Promise.resolve(engine.completeTask('T1', { data: {} })),
    /does not belong to a lab process/,
  );
});

test('gateway failures stop cleanly: redirect, 401, schema mismatch, oversized body', async () => {
  const redirect = createLiveEngine(
    config(),
    async () =>
      new Response(null, {
        status: 302,
        headers: { Location: 'https://passport.example.test/login' },
      }),
  )!;
  await assert.rejects(Promise.resolve(redirect.getTasksByUser()), /sign-in page/);
  const denied = createLiveEngine(config(), async () =>
    json({ type: 'errors:apigw:invalid_api_key' }, 401),
  )!;
  await assert.rejects(Promise.resolve(denied.getTasksByUser()), /invalid_api_key/);
  const wrong = createLiveEngine(config(), async () => json({ tasks: 'nope' }))!;
  await assert.rejects(
    Promise.resolve(wrong.getTasksByUser()),
    /does not match the getTasksByUser schema/,
  );
  const huge = createLiveEngine(config(), async () => json([{ id: 'x'.repeat(1_100_000) }]))!;
  await assert.rejects(Promise.resolve(huge.getTasksByUser()), /one-megabyte/);
  // Session expiry: one re-authentication with the agent, never a loop.
  let n = 0;
  const seen: Record<string, string>[] = [];
  const expiring = createLiveEngine(config(), async (_i, init) => {
    seen.push(init?.headers as Record<string, string>);
    n += 1;
    if (n === 1) return json([], 200, { 'Set-Cookie': 'S=1' });
    if (n === 2) return json({ message: 'session expired' }, 401);
    return json([]);
  })!;
  await expiring.getTasksByUser();
  await expiring.getTasksByUser();
  assert.equal(n, 3);
  assert.match(seen[2].Authorization, /^Basic /);
  // A failing run reports blocked and sends nothing further.
  const o = new Orchestrator(denied);
  const run = await o.start(CONFIGURE, 'all');
  assert.equal(run.status, 'blocked');
});

test('the read-only probe reports PASS for a matching model and PARTIAL when fields are missing', async () => {
  const good = gatewayDouble();
  const pass = await probeLive(createLiveEngine(config(), good.fetcher)!);
  assert.equal(pass.outcome, 'PASS', JSON.stringify(pass.checks));
  assert.ok(
    good.calls.every((c) => c.method === 'GET'),
    'the probe never writes',
  );
  const bad = gatewayDouble({ expectedFields: false });
  const partial = await probeLive(createLiveEngine(config(), bad.fetcher)!);
  assert.equal(partial.outcome, 'PARTIAL');
  assert.ok(partial.checks.some((c) => /missing: coolantSelection_fluid/.test(c.detail)));
  const denied = await probeLive(createLiveEngine(config(), async () => json({}, 403))!);
  assert.equal(denied.outcome, 'DENIED');
});

test('lab configuration fails closed and the template contract is rejected', () => {
  const none = loadLabLiveConfig({});
  assert.equal(none.blockers.length, 4);
  assert.equal(createLiveEngine(none), undefined);
  const dir = mkdtempSync(join(tmpdir(), 'nova-lab-'));
  try {
    const template = join(dir, 'template.json');
    writeFileSync(template, readFileSync('config/lab-contract.template.json'));
    const env = {
      NOVA_LAB_GATEWAY_ORIGIN: ORIGIN,
      NOVA_LAB_API_KEY: 'k',
      NOVA_LAB_AGENT_ID: 'a',
      NOVA_LAB_AGENT_SECRET: 's',
      NOVA_LAB_CONTRACT_FILE: template,
    };
    assert.match(loadLabLiveConfig(env).blockers.join(' '), /Lab contract rejected/);
    const ok = join(dir, 'ok.json');
    writeFileSync(ok, JSON.stringify(contract));
    assert.deepEqual(loadLabLiveConfig({ ...env, NOVA_LAB_CONTRACT_FILE: ok }).blockers, []);
    for (const bad of [
      { tenantClass: 'PRODUCTION' },
      { dataPolicy: 'ANY' },
      { gatewayBasePath: '/api/other' },
      { processKeys: { 'syn-cooling-chain': 'x', extra: 'y' } },
    ]) {
      writeFileSync(ok, JSON.stringify({ ...contract, ...bad }));
      assert.match(
        loadLabLiveConfig({ ...env, NOVA_LAB_CONTRACT_FILE: ok }).blockers.join(' '),
        /rejected/,
        JSON.stringify(bad),
      );
    }
    assert.match(
      loadLabLiveConfig({
        ...env,
        NOVA_LAB_GATEWAY_ORIGIN: 'http://insecure.example.test',
      }).blockers.join(' '),
      /HTTPS origin/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('HTTP lab API runs live only when configured, and probes read-only', async () => {
  const gw = gatewayDouble();
  const server = createApp(loadConfig({}), undefined, undefined, config(), gw.fetcher).listen(
    0,
    '127.0.0.1',
  );
  const off = createApp(loadConfig({}), undefined, undefined, loadLabLiveConfig({})).listen(
    0,
    '127.0.0.1',
  );
  await Promise.all([server, off].map((s) => new Promise<void>((r) => s.once('listening', r))));
  const post = (s: typeof server, path: string, data: unknown) => {
    const origin = `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
    return fetch(`${origin}/api${path}`, {
      method: 'POST',
      headers: { Origin: origin, 'X-Nova-Client': 'workspace', 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
  };
  try {
    const refused = await post(off, '/lab/runs', { prompt: CONFIGURE, source: 'live' });
    assert.equal(refused.status, 409);
    assert.match((await refused.json()).error, /No request was made/);
    assert.equal((await post(off, '/lab/probe', {})).status, 409);
    const probe = await (await post(server, '/lab/probe', {})).json();
    assert.equal(probe.outcome, 'PASS');
    const started = await (
      await post(server, '/lab/runs', { prompt: CONFIGURE, source: 'live' })
    ).json();
    assert.equal(started.run.source, 'live');
    assert.equal(started.run.status, 'awaiting_approval');
    assert.equal(started.state.live.ready, true);
    assert.ok(gw.calls.every((c) => c.method === 'GET'));
  } finally {
    server.close();
    off.close();
  }
});

test('"Open in ITEROP" links are built from the optional play origin and the tenant key', async () => {
  const { labLiveStatus } = await import('../server/iterop/lab-live');
  const without = labLiveStatus(config());
  assert.equal(without.play, null);
  const status = labLiveStatus({ ...config(), playOrigin: 'https://sandbox-bpa.example.test' });
  assert.equal(
    status.play!.instance['syn-cooling-chain'],
    'https://sandbox-bpa.example.test/play/monitoring/processes/tenantCoolingChain?layer=monitoring-instances/{instanceId}',
  );
  assert.equal(status.play!.home, 'https://sandbox-bpa.example.test/play');
  const env = { NOVA_LAB_PLAY_ORIGIN: 'https://sandbox-bpa.example.test/some/path' };
  assert.equal(loadLabLiveConfig(env).playOrigin, 'https://sandbox-bpa.example.test');
  assert.equal(
    loadLabLiveConfig({ NOVA_LAB_PLAY_ORIGIN: 'http://insecure.test' }).playOrigin,
    undefined,
  );
});
