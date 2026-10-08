import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createApp } from '../server/app';
import { loadConfig } from '../server/config';
import { commands } from '../server/iterop/commands';
import { loadLabLiveConfig, type LabLiveConfig } from '../server/iterop/lab-live';
import { Orchestrator } from '../server/iterop/orchestrator';
import { SyntheticEngine } from '../server/iterop/simulator';
import { labBaseUrl, registerLabTools } from '../server/mcp-lab';
import { config, gatewayDouble } from './helpers/lab-gateway';

test('structured actions become commands the deterministic orchestrator understands', async () => {
  const o = new Orchestrator(new SyntheticEngine());
  const configured = await o.start(
    commands.configure({
      itLoadKw: 1200,
      facilityWaterC: 32,
      rackCount: 16,
      redundancy: '2N',
      coolant: 'PG25',
    }),
    'all',
  );
  assert.equal(configured.intent, 'configure');
  assert.deepEqual(configured.inputs, {
    itLoadKw: 1200,
    facilityWaterC: 32,
    rackCount: 16,
    redundancy: '2N',
    coolant: 'PG25',
  });
  const water = await o.start(
    commands.configure({
      itLoadKw: 800,
      facilityWaterC: 30,
      rackCount: 8,
      redundancy: 'N',
      coolant: 'water',
    }),
  );
  assert.equal(water.inputs?.redundancy, 'N');
  assert.equal(water.inputs?.coolant, 'water');
  const changed = await o.start(commands.recalculate({ facilityWaterC: 38 }));
  assert.equal(changed.intent, 'recalculate');
  assert.equal(changed.inputs?.facilityWaterC, 38);
  assert.equal((await o.start(commands.processes())).intent, 'processes');
  assert.equal((await o.start(commands.tasks())).intent, 'tasks');
  assert.equal((await o.start(commands.status())).intent, 'status');
  const inbox = await o.start(commands.inbox());
  assert.equal(inbox.intent, 'tasks');
  assert.doesNotMatch(inbox.summary, /could not map/);
  assert.equal(
    commands.resume('cool-251008-1412', { rackCount: 16 }),
    'Continue COOL-251008-1412 with 16 racks',
  );
  const req = await o.start(
    commands.requirement('Secondary supply shall stay below 40 °C at full load.', 'guideline 4.2'),
  );
  assert.equal(req.intent, 'requirement');
  assert.notEqual(req.status, 'needs_input', req.summary);
});

test('the lab MCP client only talks to the local NOVA server', () => {
  assert.equal(labBaseUrl('http://127.0.0.1:3000'), 'http://127.0.0.1:3000');
  assert.throws(() => labBaseUrl('https://example.com'));
  assert.throws(() => labBaseUrl('http://10.0.0.5:3000'));
});

async function connect(labLive: LabLiveConfig, fetcher: typeof fetch) {
  const http = createApp(loadConfig({}), undefined, undefined, labLive, fetcher).listen(
    0,
    '127.0.0.1',
  );
  await new Promise<void>((r) => http.once('listening', r));
  const base = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
  const server = new McpServer({ name: 'lab-test', version: '1.0.0' });
  registerLabTools(server, { base, engine: 'live' });
  const client = new Client({ name: 'claude-test', version: '1.0.0' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r = await client.callTool({ name, arguments: args });
    return { ...JSON.parse((r.content as { text: string }[])[0].text), isError: r.isError };
  };
  return {
    http,
    base,
    client,
    call,
    close: async () => {
      await client.close();
      http.close();
    },
  };
}

test('Claude drives the sandbox through NOVA; a person approves writes in the page', async () => {
  const gw = gatewayDouble();
  const { base, call, client, close } = await connect(config(), gw.fetcher);
  try {
    const names = (await client.listTools()).tools.map((t) => t.name);
    assert.ok(names.includes('lab_configure_cooling_chain') && names.includes('lab_continue_run'));
    assert.ok(!names.some((n) => /sign|delete|assign|deploy|stop/.test(n)));
    const conn = await call('lab_connection');
    assert.equal(conn.sandboxReady, true, JSON.stringify(conn));
    assert.match(conn.writesApprovedIn, /NOVA page/);
    const prepared = await call('lab_configure_cooling_chain', {
      itLoadKw: 1200,
      facilityWaterC: 32,
      rackCount: 16,
      redundancy: 'N+1',
    });
    assert.equal(prepared.status, 'awaiting_approval');
    assert.equal(prepared.pendingWrite.operationId, 'startProcess');
    assert.match(prepared.pendingWrite.note, /approves it in NOVA/);
    assert.ok(
      gw.calls.every((c) => c.method === 'GET'),
      'nothing written yet',
    );
    // Claude cannot approve a sandbox write by default.
    const refused = await call('lab_approve_write', {
      runId: prepared.runId,
      stepId: prepared.pendingWrite.stepId,
      all: true,
    });
    assert.equal(refused.isError, true);
    assert.match(refused.approveIn, /\/lab\?source=live&run=/);
    assert.ok(gw.calls.every((c) => c.method === 'GET'));
    // The same run is visible to the NOVA page, marked as issued by Claude, and approved there.
    const page = (path: string, body: unknown) =>
      fetch(`${base}/api${path}`, {
        method: 'POST',
        headers: { Origin: base, 'X-Nova-Client': 'workspace', 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }).then((r) => r.json());
    const state = await (await fetch(`${base}/api/lab?source=live`)).json();
    const shared = state.runs.find((r: { id: string }) => r.id === prepared.runId);
    assert.equal(shared.via, 'claude');
    const approved = await page(`/lab/runs/${prepared.runId}/approve`, {
      stepId: prepared.pendingWrite.stepId,
      all: true,
    });
    assert.equal(approved.run.status, 'awaiting_signoff', approved.run.summary);
    const followed = await call('lab_get_run', { runId: prepared.runId });
    assert.equal(followed.status, 'awaiting_signoff');
    assert.match(followed.signOff, /cannot sign/);
  } finally {
    await close();
  }
});

test('with NOVA_LAB_MCP_APPROVAL=client, Claude may send the approved write itself', async () => {
  const gw = gatewayDouble();
  const { call, close } = await connect({ ...config(), claudeApproval: 'client' }, gw.fetcher);
  try {
    const prepared = await call('lab_run_command', {
      command: 'Configure the cooling chain for 1.2 MW IT load, 32 °C facility water, 16 racks',
    });
    assert.match(prepared.pendingWrite.note, /only after they explicitly approve/);
    const done = await call('lab_approve_write', {
      runId: prepared.runId,
      stepId: prepared.pendingWrite.stepId,
      all: true,
    });
    assert.equal(done.status, 'awaiting_signoff');
    assert.ok(gw.calls.some((c) => c.method === 'POST'));
  } finally {
    await close();
  }
});

test('the operator setting is read from the environment; the default is approval in NOVA', () => {
  assert.equal(loadLabLiveConfig({}).claudeApproval, 'portal');
  assert.equal(loadLabLiveConfig({ NOVA_LAB_MCP_APPROVAL: 'client' }).claudeApproval, 'client');
  assert.equal(loadLabLiveConfig({ NOVA_LAB_MCP_APPROVAL: 'yes' }).claudeApproval, 'portal');
});
