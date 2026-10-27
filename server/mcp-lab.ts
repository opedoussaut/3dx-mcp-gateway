import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { OrchestrationRun } from '../shared/types';
import { commands, type CoolingInputs } from './iterop/commands';

/**
 * Process orchestration lab for Claude clients (Claude Desktop, Claude Code, any MCP client signed
 * in with the user's own Claude account). Claude understands the request and calls these tools;
 * the tools call the local NOVA server, which owns the engines, the allow-list and the approval
 * gates. The engine is fixed by the operator (NOVA_LAB_MCP_ENGINE), never chosen by the model.
 *
 * Sandbox writes are approved by a person in the NOVA page unless the operator set
 * NOVA_LAB_MCP_APPROVAL=client on the server. Signing is never exposed.
 */
type LabState = {
  runs: OrchestrationRun[];
  live: {
    ready: boolean;
    blockers: string[];
    claudeApproval: 'portal' | 'client';
    settings: { gateway: string | null; processes: string[] };
    play: { instance: Record<string, string>; home: string } | null;
  };
};
type Reply = { run?: OrchestrationRun; state: LabState; error?: string; approveIn?: string };

export function labBaseUrl(raw = process.env.NOVA_LAB_URL || 'http://127.0.0.1:3000') {
  const u = new URL(raw);
  if (u.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname))
    throw new Error('NOVA_LAB_URL must be the local NOVA server (http://127.0.0.1:<port>).');
  return u.origin;
}

export function registerLabTools(
  server: McpServer,
  options: { base: string; engine: 'synthetic' | 'live'; request?: typeof fetch },
) {
  const { base, engine } = options;
  const request = options.request ?? fetch;
  const live = engine === 'live';
  let cookie = '';
  const call = async (path: string, body?: unknown): Promise<Reply> => {
    let res: Response;
    try {
      res = await request(`${base}/api${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        redirect: 'error',
        headers: {
          Origin: base,
          'X-Nova-Client': 'mcp',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...(cookie ? { Cookie: cookie } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(120_000),
      });
    } catch {
      throw new Error(`The NOVA server is not reachable at ${base}. Start it with npm run dev.`);
    }
    const set = res.headers.get('set-cookie')?.match(/nova-session=[^;]+/)?.[0];
    if (set) cookie = set;
    const json = (await res.json().catch(() => ({}))) as Reply;
    if (!res.ok)
      throw Object.assign(new Error(json.error ?? `NOVA returned ${res.status}.`), {
        approveIn: json.approveIn,
      });
    return json;
  };
  const novaLink = (run: OrchestrationRun) =>
    `${base}/lab?source=${run.source}&run=${encodeURIComponent(run.id)}`;
  const iteropLink = (state: LabState, run: OrchestrationRun) => {
    const template = run.processKey ? state.live.play?.instance[run.processKey] : undefined;
    return run.source === 'live' &&
      template &&
      run.instanceId &&
      /^[A-Za-z0-9_.:-]+$/.test(run.instanceId)
      ? template.replace('{instanceId}', encodeURIComponent(run.instanceId))
      : undefined;
  };
  const view = (reply: Reply) => {
    const run = reply.run!;
    const pending = run.steps.find((s) => s.status === 'awaiting_approval');
    const approveHere = !live || reply.state.live.claudeApproval === 'client';
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({
            engine: run.source === 'live' ? 'SANDBOX (live process engine)' : 'SIMULATED',
            runId: run.id,
            identificator: run.identificator,
            process: run.processName,
            status: run.status,
            summary: run.summary,
            missing: run.missing,
            findings: run.findings,
            stages: Object.fromEntries(
              run.stages.map((s) => [
                s.label,
                `${run.stageState[s.id]}${run.stageNotes[s.id] ? ` · ${run.stageNotes[s.id]}` : ''}`,
              ]),
            ),
            pendingWrite: pending && {
              stepId: pending.id,
              operationId: pending.operationId,
              request: pending.request,
              note: approveHere
                ? 'PREPARED — NOT SUBMITTED. Show it to the user; call lab_approve_write only after they explicitly approve.'
                : `PREPARED — NOT SUBMITTED. The user approves it in NOVA: ${novaLink(run)}. Then call lab_get_run to follow the run.`,
            },
            outputs: run.outputs,
            changes: run.changes.filter((c) => c.changed),
            trace: run.steps.map(
              (s) =>
                `${s.kind.toUpperCase()} ${s.operationId ?? s.title} — ${s.outcome ?? s.status}`,
            ),
            openInNova: novaLink(run),
            openInIterop: iteropLink(reply.state, run),
            signOff:
              run.status === 'awaiting_signoff'
                ? 'A person signs off in the process application. Claude and NOVA cannot sign.'
                : undefined,
          }),
        },
      ],
    };
  };
  const guard = async (fn: () => Promise<Reply>) => {
    try {
      return view(await fn());
    } catch (error) {
      const e = error as Error & { approveIn?: string };
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              error: e.message,
              approveIn: e.approveIn ? `${base}${e.approveIn}` : undefined,
            }),
          },
        ],
        isError: true,
      };
    }
  };
  const run = (prompt: string) =>
    guard(() => call('/lab/runs', { prompt, approval: 'each', source: engine }));

  const note = live
    ? 'SANDBOX process engine through the NOVA server (synthetic test processes only).'
    : 'SIMULATED process engine — no platform request.';
  const read = {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: live,
  };
  const prepare = {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: live,
  };
  const prepares =
    'Reads and engineering tools run at once; every write (startProcess, completeTask) stops as a prepared request for the user to approve.';
  const cooling = {
    itLoadKw: z.number().min(50).max(20000).describe('IT heat load in kW (1.2 MW = 1200).'),
    facilityWaterC: z.number().min(10).max(45).describe('Facility water supply in °C.'),
    rackCount: z.number().int().min(1).max(500).describe('Racks on the secondary loop.'),
    redundancy: z.enum(['N', 'N+1', '2N']).optional().describe('CDU redundancy; N+1 if omitted.'),
    coolant: z.enum(['auto', 'water', 'PG25']).optional().describe('Coolant preference.'),
  };

  server.registerTool(
    'lab_connection',
    {
      description: `${note} Show which process engine Claude drives, whether the sandbox is configured (presence only, never secrets) and where writes are approved.`,
      annotations: { ...read, openWorldHint: false },
    },
    async () => {
      try {
        const s = (await call(`/lab?source=${engine}`)) as unknown as LabState;
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                engine: live ? 'SANDBOX (live)' : 'SIMULATED',
                sandboxReady: s.live.ready,
                blockers: s.live.blockers,
                gateway: s.live.settings.gateway,
                processes: s.live.settings.processes,
                writesApprovedIn:
                  !live || s.live.claudeApproval === 'client'
                    ? 'this Claude client (tool permission prompt)'
                    : `the NOVA page (${base}/lab?source=live)`,
                openNova: `${base}/lab?source=${engine}`,
              }),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            { type: 'text' as const, text: JSON.stringify({ error: (error as Error).message }) },
          ],
          isError: true,
        };
      }
    },
  );
  server.registerTool(
    'lab_list_processes',
    { description: `${note} List the processes NOVA's account may start.`, annotations: read },
    async () => run(commands.processes()),
  );
  server.registerTool(
    'lab_list_my_tasks',
    {
      description: `${note} List the open tasks assigned to NOVA's account (the operator), with their process run reference.`,
      annotations: read,
    },
    async () => run(commands.tasks()),
  );
  server.registerTool(
    'lab_run_status',
    { description: `${note} Status of the latest process runs.`, annotations: read },
    async () => run(commands.status()),
  );
  server.registerTool(
    'lab_configure_cooling_chain',
    {
      description: `${note} Start the liquid cooling configuration chain for a rack group: coolant, coolant distribution units, secondary loop, limit check, then hand-off to an engineer for sign-off. ${prepares} Tool values are illustrative, not engineering values.`,
      inputSchema: cooling,
      annotations: prepare,
    },
    async (i: CoolingInputs) => run(commands.configure(i)),
  );
  server.registerTool(
    'lab_change_inputs',
    {
      description: `${note} What-if: re-run the latest cooling chain with changed inputs and report which stages are affected. ${prepares}`,
      inputSchema: {
        itLoadKw: cooling.itLoadKw.optional(),
        facilityWaterC: cooling.facilityWaterC.optional(),
        rackCount: cooling.rackCount.optional(),
        redundancy: cooling.redundancy,
        coolant: cooling.coolant,
      },
      annotations: prepare,
    },
    async (i: Partial<CoolingInputs>) => run(commands.recalculate(i)),
  );
  server.registerTool(
    'lab_continue_run',
    {
      description: `${note} Continue a cooling-chain run waiting at one of NOVA's tasks (for example COOL-251008-1412). Pass the start values when the user gave them; NOVA cannot always read them back. ${prepares}`,
      inputSchema: {
        identificator: z
          .string()
          .regex(/^COOL-\d+(?:-\d+)*$/i)
          .describe('Run reference, e.g. COOL-001 or COOL-251008-1412.'),
        itLoadKw: cooling.itLoadKw.optional(),
        facilityWaterC: cooling.facilityWaterC.optional(),
        rackCount: cooling.rackCount.optional(),
        redundancy: cooling.redundancy,
        coolant: cooling.coolant,
      },
      annotations: prepare,
    },
    async ({ identificator, ...i }: { identificator: string } & Partial<CoolingInputs>) =>
      run(commands.resume(identificator, i)),
  );
  server.registerTool(
    'lab_handle_inbox',
    {
      description: `${note} Check NOVA's inbox; if an engineer rejected a configuration, read the comment, apply the rework and re-run the chain. ${prepares}`,
      annotations: prepare,
    },
    async () => run(commands.inbox()),
  );
  server.registerTool(
    'lab_register_requirement',
    {
      description: `${note} Register a candidate engineering requirement with its public source for human review. ${prepares}`,
      inputSchema: {
        statement: z.string().min(10).max(900),
        source: z.string().min(3).max(200).describe('Public source, e.g. "guideline section 4.2".'),
      },
      annotations: prepare,
    },
    async ({ statement, source }) => run(commands.requirement(statement, source)),
  );
  server.registerTool(
    'lab_run_command',
    {
      description: `${note} Fallback: pass a plain-English lab command when no specific tool fits. ${prepares}`,
      inputSchema: { command: z.string().min(3).max(1000) },
      annotations: prepare,
    },
    async ({ command }) => run(command),
  );
  server.registerTool(
    'lab_get_run',
    {
      description: `${note} Read the current state of a run, for example after the user approved a write in NOVA.`,
      inputSchema: { runId: z.uuid() },
      annotations: { ...read, openWorldHint: false },
    },
    async ({ runId }) => guard(() => call(`/lab/runs/${runId}`)),
  );
  server.registerTool(
    'lab_approve_write',
    {
      description: live
        ? `${note} Send one prepared write the user explicitly approved. Accepted only when the operator allows approval from Claude; otherwise NOVA answers with the page where the user approves.`
        : `${note} Send one prepared write to the simulated engine and continue the run. Call only after the user approved the shown request.`,
      inputSchema: { runId: z.uuid(), stepId: z.uuid(), all: z.boolean().default(false) },
      annotations: { ...prepare, destructiveHint: live },
    },
    async ({ runId, stepId, all }) =>
      guard(() => call(`/lab/runs/${runId}/approve`, { stepId, all })),
  );
  server.registerTool(
    'lab_cancel_run',
    {
      description: `${note} Cancel a run that is waiting for approval. Nothing further is sent.`,
      inputSchema: { runId: z.uuid() },
      annotations: { ...prepare, idempotentHint: true, openWorldHint: false },
    },
    async ({ runId }) => guard(() => call(`/lab/runs/${runId}/cancel`, {})),
  );
}
