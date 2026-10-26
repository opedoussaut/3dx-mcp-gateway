import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { BridgeHttp, CameoGuard, loadCameoGuardConfig, registerCameoTools } from './cameo/guard';

/**
 * Guarded CATIA Magic connector: a stdio MCP server between a Claude client and the Cameo MCP
 * Bridge plugin running in CATIA Magic on this computer. Register this server with Claude, never
 * the bridge's own MCP server. Settings in .env: CAMEO_GUARD_PROJECT, CAMEO_GUARD_PACKAGE,
 * CAMEO_RECEIPT_KEY (shared with the ITEROP connector), optionally CAMEO_BRIDGE_PORT.
 */
process.chdir(fileURLToPath(new URL('..', import.meta.url)));
if (existsSync('.env')) process.loadEnvFile('.env');

const config = loadCameoGuardConfig();
const server = new McpServer({ name: 'nova-cameo-guard', version: '0.1.0' });
registerCameoTools(server, new CameoGuard(new BridgeHttp(config.port), config), config.blockers);
await server.connect(new StdioServerTransport());
