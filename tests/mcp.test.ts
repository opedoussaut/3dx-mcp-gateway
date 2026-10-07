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
    assert.equal(tools.tools.length, 8);
    assert.ok(tools.tools.every((t) => t.annotations?.readOnlyHint === true));
    assert.ok(!tools.tools.some((t) => /submit|delete|commit|execute|request/i.test(t.name)));
    const result = await client.callTool({
      name: 'search_engineering_items',
      arguments: { query: 'SYN-COOL-100' },
    });
    const first = (result.content as { type: string; text: string }[])[0];
    const data = JSON.parse(first.text);
    assert.equal(data.source, 'synthetic');
    assert.equal(data.items.length, 2);
    const invalid = await client.callTool({
      name: 'search_engineering_items',
      arguments: { query: '' },
    });
    assert.equal(invalid.isError, true);
  } finally {
    await client.close();
  }
});
