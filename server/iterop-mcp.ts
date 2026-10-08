import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { definitions } from './iterop/chain';
import { registerDirectTools } from './iterop/direct';
import { createLiveEngine, labLiveStatus, loadLabLiveConfig } from './iterop/lab-live';
import { SyntheticEngine } from './iterop/simulator';

/**
 * claude-iterop-orchestrator: a single stdio MCP server that lets a Claude client (Desktop or
 * Code, signed in with the user's own account) drive ITEROP directly. No NOVA web server, no UI.
 *
 *   ITEROP_MCP_ENGINE=simulated (default) — in-process simulated engine, no platform request.
 *   ITEROP_MCP_ENGINE=live — the sandbox tenant through the API Gateway, using the NOVA_LAB_*
 *   settings and the reviewed lab contract in .env. Credentials never reach Claude.
 */
process.chdir(fileURLToPath(new URL('..', import.meta.url)));
if (existsSync('.env')) process.loadEnvFile('.env');

const server = new McpServer({ name: 'claude-iterop-orchestrator', version: '0.1.0' });
if (process.env.ITEROP_MCP_ENGINE === 'live') {
  const config = loadLabLiveConfig();
  const status = labLiveStatus(config);
  const engine = createLiveEngine(config);
  registerDirectTools(server, {
    // Without a configuration every tool answers with the blockers; nothing is sent.
    engine: engine ?? new SyntheticEngine(),
    processes: status.settings.processes,
    play: status.play?.instance,
    blockers: engine ? [] : config.blockers,
  });
} else {
  registerDirectTools(server, {
    engine: new SyntheticEngine(),
    processes: definitions.map((d) => d.key),
  });
}
await server.connect(new StdioServerTransport());
