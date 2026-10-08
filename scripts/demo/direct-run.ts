/**
 * Records one full run of the claude-iterop-orchestrator tools for a demo video.
 *
 * Real: the MCP server code, its nine tools, the simulated ITEROP engine, every tool result.
 * Scripted: Claude's chat lines and design values (what Claude would say and propose), and the
 * engineer's sign-off decisions, which in real life happen in ITEROP Play.
 * Output: JSON transcript consumed by scripts/demo/player.html.
 */
import { writeFileSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { definitions } from '../../server/iterop/chain';
import { registerDirectTools } from '../../server/iterop/direct';
import { SyntheticEngine } from '../../server/iterop/simulator';

type Step =
  | { kind: 'user' | 'claude' | 'note' | 'engineer'; text: string }
  | { kind: 'call'; tool: string; args: unknown; result: unknown; error: boolean };
const steps: Step[] = [];
const say = (kind: 'user' | 'claude' | 'note' | 'engineer', text: string) =>
  steps.push({ kind, text });

const engine = new SyntheticEngine();
const server = new McpServer({ name: 'claude-iterop-orchestrator', version: '0.1.0' });
registerDirectTools(server, {
  engine,
  processes: definitions.map((d) => d.key),
  review: 'final',
});
const client = new Client({ name: 'claude', version: '1.0.0' });
const [a, b] = InMemoryTransport.createLinkedPair();
await Promise.all([server.connect(a), client.connect(b)]);
const call = async (tool: string, args: Record<string, unknown> = {}) => {
  const r = await client.callTool({ name: tool, arguments: args });
  const result = JSON.parse((r.content as { text: string }[])[0].text);
  steps.push({ kind: 'call', tool, args, result, error: Boolean(r.isError) });
  if (r.isError && !tool.includes('complete')) throw new Error(JSON.stringify(result));
  return result;
};

const envelope = { itLoadKw: 1200, facilityWaterC: 32, rackCount: 16, redundancy: 'N+1' };
const design = (fluid: 'PG25' | 'water') => {
  const cp = fluid === 'PG25' ? 3.9 : 4.18;
  const rho = fluid === 'PG25' ? 1020 : 997;
  const flow = Math.round((1200 / (rho * cp * 10)) * 60000);
  return {
    coolantSelection_fluid: fluid,
    coolantSelection_cp: cp,
    coolantSelection_density: rho,
    cduSizing_model: 'CDU-500 (500 kW class)',
    cduCapacityKw: 500,
    cduSizing_units: 4,
    cduSizing_dutyUnits: 3,
    cduSizing_utilisation: 80,
    loopConfiguration_supplyC: 35,
    loopConfiguration_returnC: 45,
    loopConfiguration_flowLpm: flow,
    loopConfiguration_rackFlowLpm: Math.round((flow / 16) * 10) / 10,
  };
};
const pick = (p: Record<string, unknown>, prefix: string) =>
  Object.fromEntries(Object.entries(p).filter(([k]) => k.startsWith(prefix)));
async function runAutomated(
  firstTaskId: string,
  p: Record<string, unknown>,
  rationale: string,
  check: { checkTaskValues: Record<string, unknown> },
  showGuardrail = false,
) {
  const stages: [string, Record<string, unknown>][] = [
    ['Select coolant', { ...pick(p, 'coolantSelection_'), coolantSelection_rationale: rationale }],
    ['Size coolant distribution units', pick(p, 'cduSizing_')],
    ['Configure secondary loop', pick(p, 'loopConfiguration_')],
    ['Check system limits', check.checkTaskValues],
  ];
  let taskId = firstTaskId;
  let last: { nextTask?: unknown } = {};
  for (const [name, values] of stages) {
    if (showGuardrail && name === 'Check system limits') {
      say(
        'note',
        'Guardrail demo: Claude tries to write its own “PASS” into Check system limits — the connector refuses.',
      );
      await call('iterop_complete_task', {
        taskId,
        values: { systemCheck_result: 'PASS', systemCheck_findings: 'Looks good to me.' },
      });
    }
    last = await call('iterop_complete_task', { taskId, values });
    const next = last.nextTask as { taskId?: string } | string;
    if (typeof next === 'object' && next?.taskId) taskId = next.taskId;
  }
  return last;
}

say(
  'note',
  'Recording of the real claude-iterop-orchestrator connector (9 MCP tools) on the SIMULATED ITEROP engine. Tool calls and results are real outputs. Claude’s chat lines and design are scripted for this recording; the engineer’s decisions stand in for ITEROP Play.',
);
say('user', 'Check the ITEROP connection.');
const conn = await call('iterop_connection');
say(
  'claude',
  `Connected — engine ${conn.engine}, review mode ${conn.reviewMode}. I can use: ${conn.processes.join(', ')}. Signing, reassigning, stopping, deleting, deploying and rights are not possible through this connector.`,
);
say('user', 'Configure the cooling chain for a 1.2 MW hall, 32 °C facility water, 16 racks, N+1.');
const model = await call('iterop_get_process_model', { processKey: 'syn-cooling-chain' });
const p1 = design('PG25');
say(
  'claude',
  `I read the process model (${model.tasks.length} tasks). My design: PG25 glycol (cp 3.9 kJ/kg·K, 1020 kg/m³) for freeze margin; secondary supply 35 °C (3 K approach on 32 °C water), return 45 °C (ΔT 10 K); flow from Q = ρ·cp·V̇·ΔT → ${p1.loopConfiguration_flowLpm} L/min, ${p1.loopConfiguration_rackFlowLpm} L/min per rack; 3 × 500 kW duty CDUs at 80 % + 1 standby = 4 units for N+1.`,
);
const check1 = await call('cooling_check', { envelope, proposal: p1 });
say(
  'claude',
  `Independent check: ${check1.result} — ${check1.findings.join(' ')} Review mode is FINAL: I start the run and complete the four automated stages; you validate the result at the sign-off.`,
);
const started = await call('iterop_start_process', {
  processKey: 'syn-cooling-chain',
  values: {
    start_itLoadKw: 1200,
    start_facilityWaterC: 32,
    start_rackCount: 16,
    start_redundancy: 'N+1',
    start_coolant: 'auto',
  },
});
say('claude', `Started ${started.runReference}. Next task: ${started.nextTask.task}.`);
const last = await runAutomated(
  started.nextTask.taskId,
  p1,
  'PG25 for freeze protection margin.',
  check1,
  true,
);
say(
  'claude',
  `${started.runReference} is configured and waiting for the engineer’s sign-off in ITEROP. Check: PASS. Nothing is official until it is approved.`,
);
void last;

const signoff = engine.reviewerQueue()[0];
say('engineer', 'Engineer in ITEROP Play: REJECT — “Indoor hall, no freeze risk: use water.”');
engine.signAsReviewer(signoff.id, 'Reject', 'Indoor hall, no freeze risk: use water.');

say('user', 'Check my tasks and handle the rework.');
const tasks = await call('iterop_list_my_tasks');
const rework = tasks.tasks[0];
const reworkTask = await call('iterop_get_task', { taskId: rework.taskId });
void reworkTask;
say(
  'claude',
  'The engineer rejected it: water instead of PG25. I revise: water (cp 4.18, 997 kg/m³) — same temperatures, flow recalculated.',
);
const p2 = design('water');
const check2 = await call('cooling_check', { envelope, proposal: p2 });
say(
  'claude',
  `Independent check of the revised design: ${check2.result} — ${check2.findings.join(' ')}`,
);
const afterRework = await call('iterop_complete_task', {
  taskId: rework.taskId,
  values: {
    configurationRework_coolant: 'water',
    configurationRework_redundancy: 'N+1',
    configurationRework_facilityWaterC: 32,
    configurationRework_note: 'Switched to water per engineer comment; flow recalculated.',
  },
});
await runAutomated(
  (afterRework.nextTask as { taskId: string }).taskId,
  p2,
  'Water: indoor hall, no freeze risk (engineer instruction).',
  check2,
);
say(
  'claude',
  `Reworked configuration sent: water, ${p2.loopConfiguration_flowLpm} L/min. Back with the engineer for sign-off.`,
);
const second = engine.reviewerQueue()[0];
say('engineer', 'Engineer in ITEROP Play: APPROVE.');
engine.signAsReviewer(second.id, 'Approve', 'OK with water.');
await call('iterop_list_my_tasks');
say('claude', `${started.runReference} is approved and complete. No open tasks remain.`);

writeFileSync(process.argv[2] ?? 'direct-run.json', JSON.stringify(steps, null, 2));
console.log(`${steps.length} steps`);
