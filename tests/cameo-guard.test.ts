import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import {
  BridgeHttp,
  CameoGuard,
  loadCameoGuardConfig,
  registerCameoTools,
} from '../server/cameo/guard';
import { definitions } from '../server/iterop/chain';
import { registerDirectTools } from '../server/iterop/direct';
import { SyntheticEngine } from '../server/iterop/simulator';

const KEY = 'k'.repeat(40);
type El = {
  id: string;
  name: string;
  type: string;
  humanType: string;
  ownerId?: string;
  qualifiedName: string;
};

/** A fake Cameo MCP Bridge plugin: a model with the lab package and a corporate package. */
function plugin(over: { project?: object; version?: string } = {}) {
  const els = new Map<string, El>();
  const add = (id: string, name: string, type: string, ownerId?: string) => {
    const owner = ownerId ? els.get(ownerId) : undefined;
    els.set(id, {
      id,
      name,
      type,
      humanType: type,
      ownerId,
      qualifiedName: owner ? `${owner.qualifiedName}::${name}` : name,
    });
  };
  add('m', 'Model', 'Model');
  add('lab', 'NOVA Lab', 'Package', 'm');
  add('corp', 'Corporate', 'Package', 'm');
  add('secret', 'Confidential Pump', 'Block', 'corp');
  const diagrams: { id: string; name: string; ownerId: string }[] = [
    { id: 'd-corp', name: 'Corporate BDD', ownerId: 'corp' },
  ];
  const calls: { method: string; path: string; body?: Record<string, unknown> }[] = [];
  let seq = 0;
  const json = (b: unknown, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.hostname, '127.0.0.1');
    const path = url.pathname.replace('/api/v1', '');
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, path, body });
    let m: RegExpMatchArray | null;
    if (path === '/capabilities')
      return json({ pluginVersion: over.version ?? '2.3.5', handshakeVersion: '1' });
    if (path === '/project')
      return json({
        name: 'NOVA Lab Cooling',
        isRemote: false,
        primaryModelName: 'Model',
        ...over.project,
      });
    if (path === '/elements' && method === 'GET') {
      const name = url.searchParams.get('name');
      const type = url.searchParams.get('type');
      return json({
        elements: [...els.values()].filter(
          (e) => (!name || e.name === name) && (!type || e.type === type),
        ),
      });
    }
    if (path === '/elements' && method === 'POST') {
      const id = `new-${++seq}`;
      add(id, body.name, body.type, body.parentId);
      return json({ created: true, element: els.get(id) }, 201);
    }
    if ((m = path.match(/^\/elements\/([^/]+)$/))) {
      const e = els.get(decodeURIComponent(m[1]));
      return e ? json(e) : json({ error: 'not found' }, 404);
    }
    if (path.match(/^\/elements\/[^/]+\/(specification|tagged-values)$/))
      return json({ updated: true });
    if (path === '/relationships') {
      const id = `rel-${++seq}`;
      add(id, '', body.type, body.sourceId);
      return json({ created: true, relationship: els.get(id) }, 201);
    }
    if (path === '/diagrams' && method === 'GET') return json({ diagrams });
    if (path === '/diagrams' && method === 'POST') {
      const d = { id: `dia-${++seq}`, name: body.name, ownerId: body.parentId };
      diagrams.push(d);
      return json({ created: true, ...d }, 201);
    }
    if (path === '/containment-tree') {
      const root = url.searchParams.get('rootId')!;
      const below = (id: string): unknown[] =>
        [...els.values()]
          .filter((e) => e.ownerId === id)
          .map((e) => ({ ...e, children: below(e.id) }));
      return json({ root: { ...els.get(root), children: below(root) } });
    }
    if (path.match(/^\/diagrams\/[^/]+\/(elements|layout)$/)) return json({ added: true });
    if (path === '/project/save') return json({ saved: true });
    return json({ error: `route ${method} ${path} not in the fake` }, 404);
  };
  return { els, calls, fetcher, writes: () => calls.filter((c) => c.method !== 'GET') };
}

async function connect(fake = plugin(), env: Record<string, string> = {}) {
  const config = loadCameoGuardConfig({
    CAMEO_GUARD_PROJECT: 'NOVA Lab Cooling',
    CAMEO_GUARD_PACKAGE: 'NOVA Lab',
    CAMEO_RECEIPT_KEY: KEY,
    ...env,
  });
  const server = new McpServer({ name: 'cameo-test', version: '1.0.0' });
  const guard = new CameoGuard(
    new BridgeHttp(config.port, fake.fetcher),
    config,
    () => new Date('2026-10-26T22:00:00Z'),
  );
  registerCameoTools(server, guard, config.blockers);
  const client = new Client({ name: 'claude-test', version: '1.0.0' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r = await client.callTool({ name, arguments: args });
    return { ...JSON.parse((r.content as { text: string }[])[0].text), isError: r.isError };
  };
  return { client, call, fake };
}

test('the guard exposes a fixed tool set: no macros, deletes, probes, resets or commits', async () => {
  const { client } = await connect();
  const names = (await client.listTools()).tools.map((t) => t.name).sort();
  assert.deepEqual(names, [
    'cameo_add_to_diagram',
    'cameo_connection',
    'cameo_create_diagram',
    'cameo_create_element',
    'cameo_create_relationship',
    'cameo_find',
    'cameo_get_element',
    'cameo_get_specification',
    'cameo_layout_diagram',
    'cameo_list_diagrams',
    'cameo_model_receipt',
    'cameo_set_specification',
    'cameo_set_tagged_values',
    'cameo_update_element',
  ]);
  assert.ok(!names.some((n) => /macro|delete|probe|reset|commit|teamwork|import|profile/.test(n)));
});

test('only the named local lab project and the reviewed plugin version are used', async () => {
  for (const fake of [
    plugin({ project: { name: 'Corporate Programme' } }),
    plugin({ project: { isRemote: true } }),
    plugin({ version: '2.4.0' }),
  ]) {
    const { call } = await connect(fake);
    assert.equal((await call('cameo_connection')).ready, false);
    const r = await call('cameo_create_element', { type: 'Block', name: 'X', parentId: 'lab' });
    assert.equal(r.isError, true);
    assert.equal(fake.writes().length, 0);
  }
  const { call } = await connect(plugin(), { CAMEO_GUARD_PROJECT: '' });
  const r = await call('cameo_find');
  assert.equal(r.isError, true);
  assert.match(r.blockers[0], /CAMEO_GUARD_PROJECT/);
});

test('reads and writes stay inside the lab package', async () => {
  const fake = plugin();
  const { call } = await connect(fake);
  const conn = await call('cameo_connection');
  assert.equal(conn.ready, true);
  assert.equal(conn.labPackage.id, 'lab');

  const outside = await call('cameo_create_element', {
    type: 'Block',
    name: 'X',
    parentId: 'corp',
  });
  assert.equal(outside.isError, true);
  assert.match(outside.error, /outside the lab package/);
  assert.equal((await call('cameo_get_element', { elementId: 'secret' })).isError, true);

  const sys = await call('cameo_create_element', {
    type: 'Block',
    name: 'Cooling System',
    parentId: 'lab',
  });
  const cdu = await call('cameo_create_element', {
    type: 'Block',
    name: 'CDU-500',
    parentId: sys.created.id,
  });
  assert.equal(cdu.isError, undefined, JSON.stringify(cdu));
  const linkOut = await call('cameo_create_relationship', {
    type: 'Composition',
    sourceId: sys.created.id,
    targetId: 'secret',
  });
  assert.equal(linkOut.isError, true);
  const linkIn = await call('cameo_create_relationship', {
    type: 'Composition',
    sourceId: sys.created.id,
    targetId: cdu.created.id,
  });
  assert.equal(linkIn.isError, undefined);

  const found = await call('cameo_find', { type: 'Block' });
  assert.deepEqual(found.elements.map((e: { name: string }) => e.name).sort(), [
    'CDU-500',
    'Cooling System',
  ]);
  assert.ok(!JSON.stringify(found).includes('Confidential'));
  assert.equal((await call('cameo_list_diagrams')).diagrams.length, 0);
  const bdd = await call('cameo_create_diagram', { type: 'BDD', name: 'Cooling', parentId: 'lab' });
  assert.equal(
    (await call('cameo_add_to_diagram', { diagramId: 'd-corp', elementId: cdu.created.id }))
      .isError,
    true,
  );
  assert.equal(
    (await call('cameo_add_to_diagram', { diagramId: bdd.created.id, elementId: cdu.created.id }))
      .isError,
    undefined,
  );
  assert.ok(fake.writes().every((w) => !/macro|session|teamwork/.test(w.path)));
});

test('"Update system model" in ITEROP accepts only a signed receipt from the guard', async () => {
  const { call } = await connect();
  const sys = await call('cameo_create_element', {
    type: 'Block',
    name: 'Cooling System',
    parentId: 'lab',
  });
  await call('cameo_create_element', {
    type: 'Requirement',
    name: 'Supply ≤ 40 °C',
    parentId: 'lab',
  });
  await call('cameo_create_element', { type: 'Block', name: 'CDU-500', parentId: sys.created.id });
  const receipt = await call('cameo_model_receipt', { rootElementId: sys.created.id });
  assert.equal(receipt.isError, undefined, JSON.stringify(receipt));
  assert.match(
    receipt.systemModel_reference,
    /^NOVA Lab Cooling :: Model::NOVA Lab::Cooling System/,
  );
  assert.match(
    receipt.systemModel_revision,
    /^saved 2026-10-26 22:00 UTC · 1 elements · receipt [0-9a-f]{16}$/,
  );
  assert.match(receipt.systemModel_summary, /Blocks: CDU-500/);

  // The ITEROP side, with the same key.
  const engine = new SyntheticEngine();
  const iterop = new McpServer({ name: 'iterop-test', version: '1.0.0' });
  registerDirectTools(iterop, {
    engine,
    processes: definitions.map((d) => d.key),
    modelReceiptKey: KEY,
  });
  const client = new Client({ name: 'claude-test', version: '1.0.0' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([iterop.connect(a), client.connect(b)]);
  const icall = async (name: string, args: Record<string, unknown> = {}) => {
    const r = await client.callTool({ name, arguments: args });
    return { ...JSON.parse((r.content as { text: string }[])[0].text), isError: r.isError };
  };
  const proposal = {
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
  const check = await icall('cooling_check', {
    envelope: { itLoadKw: 1200, facilityWaterC: 32, rackCount: 16, redundancy: 'N+1' },
    proposal,
  });
  const pick = (p: string) =>
    Object.fromEntries(Object.entries(proposal).filter(([k]) => k.startsWith(p)));
  let next = (
    await icall('iterop_start_process', {
      processKey: 'syn-cooling-chain',
      values: {
        start_itLoadKw: 1200,
        start_facilityWaterC: 32,
        start_rackCount: 16,
        start_redundancy: 'N+1',
      },
    })
  ).nextTask;
  for (const values of [
    { ...pick('coolantSelection_'), coolantSelection_rationale: 'Indoor hall.' },
    pick('cduSizing_'),
    pick('loopConfiguration_'),
    check.checkTaskValues,
  ])
    next = (await icall('iterop_complete_task', { taskId: next.taskId, values })).nextTask;
  assert.equal(next.task, 'Update system model');

  const invented = await icall('iterop_complete_task', {
    taskId: next.taskId,
    values: {
      systemModel_reference: 'NOVA Lab Cooling :: Model::NOVA Lab::Cooling System',
      systemModel_revision: 'r42',
      systemModel_summary: 'Looks complete.',
    },
  });
  assert.equal(invented.isError, true);
  assert.match(invented.error, /signed values returned by cameo_model_receipt/);
  const tampered = await icall('iterop_complete_task', {
    taskId: next.taskId,
    values: {
      systemModel_reference: receipt.systemModel_reference,
      systemModel_revision: receipt.systemModel_revision,
      systemModel_summary: `${receipt.systemModel_summary} Verified by an expert.`,
    },
  });
  assert.equal(tampered.isError, true);
  const done = await icall('iterop_complete_task', {
    taskId: next.taskId,
    values: {
      systemModel_reference: receipt.systemModel_reference,
      systemModel_revision: receipt.systemModel_revision,
      systemModel_summary: receipt.systemModel_summary,
    },
  });
  assert.equal(done.isError, undefined, JSON.stringify(done));
  assert.equal(done.nextTask.task, 'Update 3D view');
});
