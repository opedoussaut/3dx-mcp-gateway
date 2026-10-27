/**
 * Read-only first live test of the orchestration lab sandbox. Makes no write.
 *
 *   npm run lab:probe
 *
 * Reads .env (NOVA_LAB_*). Prints PASS / PARTIAL / DENIED / FAIL and each check. No response body,
 * credential or tenant URL is printed.
 */
import { existsSync } from 'node:fs';
import { createLiveEngine, loadLabLiveConfig, probeLive } from '../server/iterop/lab-live';

if (existsSync('.env')) process.loadEnvFile('.env');
const config = loadLabLiveConfig();
const engine = createLiveEngine(config);
if (!engine) {
  process.stdout.write(`NOT CONFIGURED — no request was made.\n- ${config.blockers.join('\n- ')}\n`);
  process.exit(2);
}
const result = await probeLive(engine);
process.stdout.write(`${result.outcome} (${result.checkedAt})\n`);
for (const c of result.checks) process.stdout.write(`${c.ok ? '✔' : '✖'} ${c.name} — ${c.detail}\n`);
process.exit(result.outcome === 'PASS' ? 0 : 1);
