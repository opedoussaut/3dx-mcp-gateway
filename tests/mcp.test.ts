import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

test('MCP stdio exposes bounded read tools and returns labelled synthetic evidence', async () => {
  const client = new Client({ name: 'nova-integration-test', version: '1.0.0' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['--import', 'tsx', 'server/mcp.ts'],
    env: {
      ...Object.fromEntries(
        Object.entries(process.env).filter(
          (entry): entry is [string, string] => entry[1] !== undefined,
        ),
      ),
      NOVA_MCP_SOURCE: 'synthetic',
      NOVA_MODEL_PROVIDER: 'none',
    },
  });
  try {
    await client.connect(transport);
    const tools = await client.listTools();
    assert.equal(tools.tools.length, 14);
    assert.ok(tools.tools.some((t) => t.name === 'iterop_list_my_tasks'));
    assert.ok(tools.tools.some((t) => t.name === 'iterop_get_process_summary'));
    assert.ok(!tools.tools.some((t) => /catalog|start_process/.test(t.name)));
    const lab = tools.tools.filter((t) => t.name.startsWith('lab_'));
    assert.deepEqual(lab.map((t) => t.name).sort(), [
      'lab_approve_write',
      'lab_cancel_run',
      'lab_run_command',
    ]);
    // Only the synthetic lab tools may write; everything else stays read-only.
    assert.ok(
      tools.tools
        .filter((t) => !t.name.startsWith('lab_'))
        .every((t) => t.annotations?.readOnlyHint === true),
    );
    assert.ok(lab.every((t) => /SYNTHETIC PROCESS ENGINE ONLY/.test(t.description ?? '')));
    assert.ok(!tools.tools.some((t) => /sign|submit|delete|commit|execute|request/i.test(t.name)));
    const labRun = await client.callTool({
      name: 'lab_run_command',
      arguments: {
        prompt: 'Configure the cooling chain for 1 MW, 30 °C facility water, 10 racks',
        approval: 'each',
      },
    });
    const prepared = JSON.parse((labRun.content as { type: string; text: string }[])[0].text);
    assert.equal(prepared.status, 'awaiting_approval');
    assert.equal(prepared.pendingWrite.operationId, 'startProcess');
    const approved = await client.callTool({
      name: 'lab_approve_write',
      arguments: { runId: prepared.runId, stepId: prepared.pendingWrite.stepId, all: true },
    });
    const done = JSON.parse((approved.content as { type: string; text: string }[])[0].text);
    assert.equal(done.status, 'awaiting_signoff');
    assert.equal(done.source, 'synthetic');
    const result = await client.callTool({
      name: 'search_engineering_items',
      arguments: { query: 'SYN-COOL-100' },
    });
    const first = (result.content as { type: string; text: string }[])[0];
    const data = JSON.parse(first.text);
    assert.equal(data.source, 'synthetic');
    assert.equal(data.items.length, 2);
    const tasks = await client.callTool({ name: 'iterop_list_my_tasks', arguments: {} });
    const taskData = JSON.parse((tasks.content as { type: string; text: string }[])[0].text);
    assert.equal(taskData.source, 'synthetic');
    assert.equal(taskData.records.length, 3);
    assert.equal(taskData.operationId, 'getTasksByUser');
    const denied = await client.callTool({
      name: 'iterop_get_process_summary',
      arguments: { processKey: 'syn_restricted_audit' },
    });
    assert.equal(denied.isError, true);
    const invalid = await client.callTool({
      name: 'search_engineering_items',
      arguments: { query: '' },
    });
    assert.equal(invalid.isError, true);
  } finally {
    await client.close();
  }
});
