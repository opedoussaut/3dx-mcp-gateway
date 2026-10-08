import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { definition, definitions, sameTask, type ProcessDefinition } from './chain';
import { LIMITS } from './configurators';
import { checkProposal, type Envelope, type Proposal } from './proposal-check';
import { EngineError, type ProcessEngine } from './simulator';

/**
 * Claude ⇄ ITEROP, no NOVA server and no UI. Claude orchestrates; these tools are the only things
 * it can do. Each tool maps to one documented FD04 operation (plus one illustrative calculator),
 * the engine translates field ids and admits only the reviewed lab processes, and the server, not
 * the model, refuses signature tasks. Writes are marked destructive so the Claude client asks the
 * user before each one.
 */
type Task = {
  id?: string | null;
  name?: string | null;
  description?: string | null;
  priority?: number | null;
  startDate?: number | null;
  process?: {
    identificator?: string | null;
    instanceId?: string | null;
    name?: string | null;
  } | null;
};
export type DirectOptions = {
  engine: ProcessEngine;
  /** Lab process key → Play monitoring URL template with {instanceId}; live engine only. */
  play?: Record<string, string>;
  /** Processes admitted by the reviewed contract (lab keys). */
  processes: string[];
  blockers?: string[];
  /**
   * Who reviews the automated steps (operator setting, never the model's):
   * `step` — an expert confirms each stage before it is written (default);
   * `final` — Claude completes the automated stages; a person validates the final result at the
   * sign-off task in ITEROP.
   */
  review?: 'step' | 'final';
  now?: () => Date;
};

const text = (value: unknown, isError = false) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(value) }],
  ...(isError ? { isError: true } : {}),
});

/** The lab process a task belongs to, by run reference prefix or by task name. */
export function processOf(task: Task): ProcessDefinition | undefined {
  const ref = task.process?.identificator ?? '';
  return (
    definitions.find((d) => ref.toUpperCase().startsWith(`${d.identificatorPrefix}-`)) ??
    definitions.find((d) =>
      [...d.tasks, ...(d.rework ? [d.rework] : [])].some((t) => sameTask(t.name, task.name)),
    )
  );
}
const taskDefinition = (d: ProcessDefinition, name?: string | null) =>
  [...d.tasks, ...(d.rework ? [d.rework] : [])].find((t) => sameTask(t.name, name));

const field = (f: ProcessDefinition['startVariables'][number]) => ({
  id: f.id,
  name: f.name,
  type: f.type,
  required: f.required,
  ...(f.values ? { choices: f.values.split('##') } : {}),
  ...(f.defaultValue ? { default: f.defaultValue } : {}),
  ...(f.min ? { min: f.min } : {}),
  ...(f.max ? { max: f.max } : {}),
  ...(f.unit ? { unit: f.unit } : {}),
});

export function registerDirectTools(server: McpServer, o: DirectOptions) {
  const live = o.engine.source === 'live';
  const review = o.review ?? 'step';
  const reviewRule =
    review === 'final'
      ? 'Review mode FINAL: complete the automated stages without asking for each one; the person validates the final result at the sign-off task in ITEROP. Stop and ask if the check stays FAIL or REVIEW.'
      : 'Review mode STEP: before each write, show that stage’s values and reasoning and wait for the expert to confirm or correct them.';
  const engineLabel = live ? 'SANDBOX (live ITEROP)' : 'SIMULATED (no platform request)';
  const note = live
    ? 'Live sandbox ITEROP through the API Gateway; synthetic test processes only.'
    : 'Simulated ITEROP engine; no platform request.';
  const admitted = (key: string) => o.processes.includes(key);
  const link = (key: string | undefined, instanceId?: string | null) =>
    key && instanceId && /^[A-Za-z0-9_.:-]+$/.test(instanceId) && o.play?.[key]
      ? o.play[key].replace('{instanceId}', encodeURIComponent(instanceId))
      : undefined;
  const guard = async (fn: () => Promise<unknown>) => {
    try {
      return text({ engine: engineLabel, ...((await fn()) as object) });
    } catch (e) {
      if (e instanceof EngineError)
        return text({ engine: engineLabel, error: e.message, status: e.status }, true);
      throw e;
    }
  };
  const blocked = () =>
    o.blockers?.length
      ? text(
          { engine: engineLabel, error: 'ITEROP is not configured.', blockers: o.blockers },
          true,
        )
      : undefined;
  const myTasks = async () => {
    const all = ((await o.engine.getTasksByUser()) as Task[]) ?? [];
    const lab = all.filter((t) => {
      const d = processOf(t);
      return d && admitted(d.key);
    });
    return { lab, hidden: all.length - lab.length };
  };
  const read = {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: live,
  };
  const write = {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: live,
  };
  const value = z.union([z.string().max(2000), z.number(), z.boolean()]);

  server.registerTool(
    'iterop_connection',
    {
      description: `${note} Which ITEROP engine this connector drives, whether it is configured (never secrets), and the processes it may use.`,
      annotations: { ...read, openWorldHint: false },
    },
    async () =>
      text({
        engine: engineLabel,
        ready: !o.blockers?.length,
        blockers: o.blockers ?? [],
        processes: o.processes,
        reviewMode: review,
        reviewRule,
        neverPossible: ['sign', 'reassign', 'stop', 'delete', 'deploy', 'change rights'],
      }),
  );

  server.registerTool(
    'iterop_list_startable_processes',
    {
      description: `${note} List the processes this connector may start (getAllStartableProcesses, filtered to the reviewed lab processes).`,
      annotations: read,
    },
    async () =>
      blocked() ??
      guard(async () => {
        const body = (await o.engine.getAllStartableProcesses()) as {
          responses?:
            { key?: string | null; name?: string | null; version?: number | null }[] | null;
        };
        const all = body.responses ?? [];
        const lab = all.filter((p) => p.key && admitted(p.key));
        return { processes: lab, otherProcessesHidden: all.length - lab.length };
      }),
  );

  server.registerTool(
    'iterop_get_process_model',
    {
      description: `${note} The model of a lab process: start form fields (ids, types, ranges, choices) and its tasks in order, with who does each and the fields each task expects. Read this before starting a process or completing a task.`,
      inputSchema: { processKey: z.string().min(1).max(100) },
      annotations: read,
    },
    async ({ processKey }) => {
      const d = definition(processKey);
      if (!d || !admitted(processKey))
        return text({ engine: engineLabel, error: `${processKey} is not a lab process.` }, true);
      return (
        blocked() ??
        guard(async () => ({
          process: await o.engine.getBasicProcessInfo(processKey),
          runReference: `${d.identificatorPrefix}-…`,
          startForm: d.startVariables.map(field),
          tasks: [...d.tasks, ...(d.rework ? [{ ...d.rework, rework: true }] : [])].map((t) => ({
            name: t.name,
            description: t.description,
            doneBy: t.signature
              ? 'a person in ITEROP (signature task — this connector cannot complete it)'
              : 'this connector, after the user approves',
            proposedBy: t.tool
              ? t.tool === 'validator'
                ? 'cooling_check (independent check)'
                : 'you (Claude), then verified with cooling_check'
              : undefined,
            rework: 'rework' in t ? true : undefined,
            fields: t.expectedFields.map(field),
          })),
        }))
      );
    },
  );

  server.registerTool(
    'iterop_list_my_tasks',
    {
      description: `${note} Open tasks assigned to this connector's account in the lab processes (getTasksByUser), with run reference, task id and instance id.`,
      annotations: read,
    },
    async () =>
      blocked() ??
      guard(async () => {
        const { lab, hidden } = await myTasks();
        return {
          tasks: lab.map((t) => {
            const d = processOf(t)!;
            return {
              taskId: t.id,
              task: t.name,
              runReference: t.process?.identificator,
              instanceId: t.process?.instanceId,
              process: d.key,
              signatureTask: Boolean(taskDefinition(d, t.name)?.signature),
              openInIterop: link(d.key, t.process?.instanceId),
            };
          }),
          otherTasksHidden: hidden,
        };
      }),
  );

  server.registerTool(
    'iterop_get_task',
    {
      description: `${note} One task's form: the fields it expects and any data already provided (getTaskInstanceInformations).`,
      inputSchema: { taskId: z.string().min(1).max(200) },
      annotations: read,
    },
    async ({ taskId }) =>
      blocked() ??
      guard(async () => ({ task: await o.engine.getTaskInstanceInformations(taskId) })),
  );

  server.registerTool(
    'iterop_get_instance',
    {
      description: `${note} A process instance's state and variables (getInstanceInfo). A run-only account may get 403: then rely on the values the user gave.`,
      inputSchema: { instanceId: z.string().min(1).max(200) },
      annotations: read,
    },
    async ({ instanceId }) =>
      blocked() ?? guard(async () => ({ instance: await o.engine.getInstanceInfo(instanceId) })),
  );

  // Check results this session issued: only these may be written to "Check system limits".
  const issuedChecks = new Set<string>();
  const num = z.number().finite();
  server.registerTool(
    'cooling_check',
    {
      description:
        'Independent check of a cooling configuration YOU proposed (no platform request): energy balance, declared lab limits, redundancy arithmetic, property plausibility. Returns PASS / REVIEW / FAIL with findings, and the exact values to write to the "Check system limits" task — that task accepts only values produced here. Lab limits are illustrative.',
      inputSchema: {
        envelope: z.object({
          itLoadKw: num.min(50).max(20000),
          facilityWaterC: num.min(10).max(45),
          rackCount: z.number().int().min(1).max(500),
          redundancy: z.enum(['N', 'N+1', '2N']),
        }),
        proposal: z.object({
          coolantSelection_fluid: z.string().min(1).max(100),
          coolantSelection_cp: num.describe('kJ/(kg·K)'),
          coolantSelection_density: num.describe('kg/m³'),
          cduSizing_model: z.string().min(1).max(100),
          cduCapacityKw: num.positive().describe('Rated capacity of one CDU, kW'),
          cduSizing_units: z.number().int().min(1),
          cduSizing_dutyUnits: z.number().int().min(1),
          cduSizing_utilisation: num.describe('% of duty capacity used'),
          loopConfiguration_supplyC: num,
          loopConfiguration_returnC: num,
          loopConfiguration_flowLpm: num.positive(),
          loopConfiguration_rackFlowLpm: num.positive(),
        }),
      },
      annotations: { ...read, openWorldHint: false },
    },
    async ({ envelope, proposal }: { envelope: Envelope; proposal: Proposal }) => {
      const check = checkProposal(envelope, proposal);
      issuedChecks.add(JSON.stringify(check.checkTaskValues));
      return text({ ...check, limits: LIMITS, illustrativeLimits: true });
    },
  );

  server.registerTool(
    'iterop_start_process',
    {
      description: `${note} WRITE — starts a lab process instance in ITEROP (startProcess). Follow the review mode from iterop_connection. Values are keyed by the start-form field ids from iterop_get_process_model. Returns the run reference and the first open task.`,
      inputSchema: {
        processKey: z.string().min(1).max(100),
        values: z.record(z.string().max(100), value),
        runReference: z
          .string()
          .regex(/^[A-Z]+-[0-9-]+$/)
          .optional()
          .describe('Optional; generated from the start time when omitted.'),
      },
      annotations: write,
    },
    async ({ processKey, values, runReference }) => {
      const d = definition(processKey);
      if (!d || !admitted(processKey))
        return text({ engine: engineLabel, error: `${processKey} is not a lab process.` }, true);
      return (
        blocked() ??
        guard(async () => {
          const t = (o.now ?? (() => new Date()))();
          const p2 = (n: number) => String(n).padStart(2, '0');
          const identificator =
            runReference ??
            `${d.identificatorPrefix}-${p2(t.getFullYear() % 100)}${p2(t.getMonth() + 1)}${p2(t.getDate())}-${p2(t.getHours())}${p2(t.getMinutes())}${p2(t.getSeconds())}`;
          await o.engine.startProcess(processKey, { identificator, data: values });
          // startProcess returns no body: find the new instance by its run reference.
          const next = (await myTasks()).lab.find(
            (x) => x.process?.identificator === identificator,
          );
          return {
            started: true,
            runReference: identificator,
            instanceId: next?.process?.instanceId,
            nextTask: next && { taskId: next.id, task: next.name },
            openInIterop: link(processKey, next?.process?.instanceId),
          };
        })
      );
    },
  );

  server.registerTool(
    'iterop_complete_task',
    {
      description: `${note} WRITE — completes one of this connector's tasks in ITEROP (completeTask). Follow the review mode from iterop_connection. Values are keyed by the task's field ids. Signature tasks are refused: a person signs in ITEROP.`,
      inputSchema: {
        taskId: z.string().min(1).max(200),
        values: z.record(z.string().max(100), value),
      },
      annotations: write,
    },
    async ({ taskId, values }) =>
      blocked() ??
      guard(async () => {
        const { lab } = await myTasks();
        const task = lab.find((t) => t.id === taskId);
        if (!task)
          throw new EngineError(404, 'No open lab task with this id is assigned to this account.');
        const d = processOf(task)!;
        if (taskDefinition(d, task.name)?.signature)
          throw new EngineError(
            403,
            `“${task.name}” is a signature task: a person signs it in ITEROP.`,
          );
        // Claude must not grade its own proposal: the check task takes only cooling_check output.
        if (
          taskDefinition(d, task.name)?.id === 'systemCheck' &&
          !issuedChecks.has(
            JSON.stringify({
              systemCheck_result: values.systemCheck_result,
              systemCheck_findings: values.systemCheck_findings,
            }),
          )
        )
          throw new EngineError(
            400,
            '“Check system limits” accepts only the checkTaskValues returned by cooling_check for the proposal you used.',
          );
        await o.engine.completeTask(taskId, { data: values });
        const next = (await myTasks()).lab.find(
          (x) => x.process?.identificator === task.process?.identificator,
        );
        return {
          completed: task.name,
          runReference: task.process?.identificator,
          nextTask: next
            ? {
                taskId: next.id,
                task: next.name,
                signatureTask: Boolean(taskDefinition(d, next.name)?.signature),
              }
            : 'No further task for this account: the run waits for a person (sign-off) or is finished.',
          openInIterop: link(d.key, task.process?.instanceId),
        };
      }),
  );
}
