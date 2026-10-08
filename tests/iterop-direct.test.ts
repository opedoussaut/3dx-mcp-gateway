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
  const calc = await call('cooling_calculate', {
    itLoadKw: 1200,
    facilityWaterC: 32,
    rackCount: 16,
    redundancy: 'N+1',
  });
  assert.equal(calc.illustrative, true);
  let next = started.nextTask;
  for (const name of [
    'Select coolant',
    'Size coolant distribution units',
    'Configure secondary loop',
    'Check system limits',
  ]) {
    const done = await call('iterop_complete_task', {
      taskId: next.taskId,
      values: calc.tasks[name],
    });
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
    'cooling_calculate',
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
