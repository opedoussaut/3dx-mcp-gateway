import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { definition, definitions, sameTask, type ProcessDefinition } from './chain';
import { cdu, coolant, LIMITS, loop, validator, type ChainInputs } from './configurators';
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
        writes:
          'iterop_start_process and iterop_complete_task change ITEROP; ask the user before each.',
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
            calculator: t.tool ? 'cooling_calculate' : undefined,
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

  server.registerTool(
    'cooling_calculate',
    {
      description:
        'Illustrative cooling calculator for the lab chain (no platform request). Returns the field values for Select coolant, Size coolant distribution units, Configure secondary loop and Check system limits, keyed by field id. NOT engineering values.',
      inputSchema: {
        itLoadKw: z.number().min(50).max(20000),
        facilityWaterC: z.number().min(10).max(45),
        rackCount: z.number().int().min(1).max(500),
        redundancy: z.enum(['N', 'N+1', '2N']).default('N+1'),
        coolant: z.enum(['auto', 'water', 'PG25']).default('auto'),
      },
      annotations: { ...read, openWorldHint: false },
    },
    async (input: ChainInputs) => {
      const fluid = coolant(input);
      const unit = cdu(input);
      const loopFields = loop(input, fluid);
      return text({
        illustrative: true,
        limits: LIMITS,
        tasks: {
          'Select coolant': fluid,
          'Size coolant distribution units': unit,
          'Configure secondary loop': loopFields,
          'Check system limits': validator(input, unit, loopFields),
        },
      });
    },
  );

  server.registerTool(
    'iterop_start_process',
    {
      description: `${note} WRITE — starts a lab process instance in ITEROP (startProcess). Ask the user to confirm the process and values first. Values are keyed by the start-form field ids from iterop_get_process_model. Returns the run reference and the first open task.`,
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
      description: `${note} WRITE — completes one of this connector's tasks in ITEROP (completeTask). Ask the user to confirm the values first. Values are keyed by the task's field ids. Signature tasks are refused: a person signs in ITEROP.`,
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
