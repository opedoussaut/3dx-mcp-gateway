import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { definition, definitions, sameTask, type ProcessDefinition } from './chain';
import { LIMITS } from './configurators';
import { checkProposal, type Envelope, type Proposal } from './proposal-check';
import { RunJournal, runContext } from './run-context';
import { verifyReceipt } from '../cameo/receipt';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import {
  coolingUsd,
  designDiff,
  extensionDiff,
  layoutCheck,
  type CoolingDesign,
} from '../twin/cooling-usd';
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
  /** What this connector wrote per run, for the run context of later tasks. In memory by default. */
  journal?: RunJournal;
  /**
   * Shared with the guarded Cameo connector (CAMEO_RECEIPT_KEY). When set, "Update system model"
   * accepts only a model receipt signed by that connector.
   */
  modelReceiptKey?: string;
  /** Where view3d_build writes the OpenUSD files (default .private/twin). */
  twinDir?: string;
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
  const journal = o.journal ?? new RunJournal();
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
                : t.tool === 'model'
                  ? 'the system modelling tool (for example a Cameo bridge MCP): the reference and revision of the model you created or updated. Never invent them; without such a tool, ask the user.'
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
              rework: taskDefinition(d, t.name)?.id === d.rework?.id || undefined,
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
      description: `${note} One of this connector's open lab tasks: the fields it expects, any data already provided (getTaskInstanceInformations) and its runContext — the run's start values, each earlier stage's outputs and, after a rejection, the engineer's decision and comment, each labelled with where it came from, plus any gaps. Read it before completing a task, and always before a rework.`,
      inputSchema: { taskId: z.string().min(1).max(200) },
      annotations: read,
    },
    async ({ taskId }) =>
      blocked() ??
      guard(async () => {
        const mine = (await myTasks()).lab.find((t) => t.id === taskId);
        if (!mine)
          throw new EngineError(404, 'No open lab task with this id is assigned to this account.');
        const d = processOf(mine)!;
        const task = (await o.engine.getTaskInstanceInformations(taskId)) as {
          providedData?: { id?: string | null; value?: unknown }[] | null;
        };
        const gaps: string[] = [];
        let variables: { id?: string | null; value?: unknown }[] | null | undefined;
        const instanceId = mine.process?.instanceId;
        if (instanceId)
          try {
            variables = ((await o.engine.getInstanceInfo(instanceId)) as { variables?: [] })
              .variables;
          } catch (e) {
            if (!(e instanceof EngineError)) throw e;
            gaps.push(
              `The run's variables are not readable by this account (getInstanceInfo ${e.status}): only this task's data and the connector's own record are used.`,
            );
          }
        return {
          task,
          runContext: runContext({
            definition: d,
            runReference: mine.process?.identificator,
            taskId: taskDefinition(d, mine.name)?.id,
            iterop: [task.providedData, variables],
            record: journal.get(mine.process?.identificator),
            gaps,
          }),
        };
      }),
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
          maxRackKw: num
            .positive()
            .max(500)
            .optional()
            .describe(
              'Heat load of the densest rack, kW, when racks differ (for example AI racks next to standard ones). The check then verifies that rack’s own flow, which the average hides.',
            ),
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

  /**
   * The design as written to ITEROP for one run, from this connector's run record (latest pass).
   * Never from the model's own arguments: the 3D view shows what was recorded.
   */
  const recordedDesign = (
    runReference: string,
  ): { design: CoolingDesign; modelRef?: string } | { missing: string[] } => {
    const r = journal.get(runReference);
    const start = r?.start ?? {};
    const stage = (sid: string) => r?.stages[sid]?.values ?? {};
    const coolant = stage('coolantSelection');
    const cdu = stage('cduSizing');
    const loop = stage('loopConfiguration');
    const model = stage('systemModel');
    const need: [string, unknown][] = [
      ['start_itLoadKw', start.start_itLoadKw],
      ['start_rackCount', start.start_rackCount],
      ['start_facilityWaterC', start.start_facilityWaterC],
      ['coolantSelection_fluid', coolant.coolantSelection_fluid],
      ['cduSizing_model', cdu.cduSizing_model],
      ['cduSizing_units', cdu.cduSizing_units],
      ['cduSizing_dutyUnits', cdu.cduSizing_dutyUnits],
      ['loopConfiguration_supplyC', loop.loopConfiguration_supplyC],
      ['loopConfiguration_returnC', loop.loopConfiguration_returnC],
      ['loopConfiguration_flowLpm', loop.loopConfiguration_flowLpm],
      ['loopConfiguration_rackFlowLpm', loop.loopConfiguration_rackFlowLpm],
    ];
    const missing = need.filter(([, val]) => val === undefined).map(([k]) => k);
    if (missing.length) return { missing };
    const num = (val: unknown) => Number(val);
    const modelRef = model.systemModel_reference ? String(model.systemModel_reference) : undefined;
    const sysmlId = modelRef?.match(/\[([A-Za-z0-9_.:-]+)\]\s*$/)?.[1];
    const unitModel = String(cdu.cduSizing_model);
    const capacity = Number(
      unitModel.match(/(\d{2,5})\s*kW/i)?.[1] ?? unitModel.match(/-(\d{2,5})\b/)?.[1],
    );
    return {
      modelRef,
      design: {
        runReference,
        itLoadKw: num(start.start_itLoadKw),
        rackCount: num(start.start_rackCount),
        facilityWaterC: num(start.start_facilityWaterC),
        coolant: String(coolant.coolantSelection_fluid),
        cduModel: unitModel,
        cduUnits: num(cdu.cduSizing_units),
        cduDutyUnits: num(cdu.cduSizing_dutyUnits),
        ...(Number.isFinite(capacity) ? { cduCapacityKw: capacity } : {}),
        supplyC: num(loop.loopConfiguration_supplyC),
        returnC: num(loop.loopConfiguration_returnC),
        flowLpm: num(loop.loopConfiguration_flowLpm),
        rackFlowLpm: num(loop.loopConfiguration_rackFlowLpm),
        ...(sysmlId ? { sysml: { system: sysmlId } } : {}),
      },
    };
  };
  /**
   * The as-built record of a hall: the equipment already installed, kept by the operator as a file
   * in the twin folder (halls/<name>.json). Claude can read it through view3d_build, never write it.
   */
  const asBuiltSchema = z.object({
    runReference: z.string().max(60).optional(),
    itLoadKw: z.number().positive(),
    rackCount: z.number().int().positive(),
    coolant: z.string().min(1).max(60),
    cduModel: z.string().min(1).max(100),
    cduUnits: z.number().int().positive(),
    cduDutyUnits: z.number().int().positive(),
    cduCapacityKw: z.number().positive().optional(),
    supplyC: z.number(),
    returnC: z.number(),
    flowLpm: z.number().positive(),
    rackFlowLpm: z.number().positive(),
    facilityWaterC: z.number(),
  });
  const readAsBuilt = (dir: string, hall: string) => {
    const file = join(dir, 'halls', `${hall}.json`);
    if (!existsSync(file))
      return {
        error: `No as-built record for ${hall}. The operator keeps it in ${file.split(sep).join('/')}; ask them, and never invent the existing equipment.`,
      };
    try {
      const parsed = asBuiltSchema.safeParse(JSON.parse(readFileSync(file, 'utf8')));
      if (!parsed.success) return { error: `The as-built record of ${hall} is incomplete.` };
      return { design: parsed.data as CoolingDesign };
    } catch {
      return { error: `The as-built record of ${hall} is not valid JSON.` };
    }
  };
  const noRecord = (run: string, missing: string[]) =>
    text(
      {
        engine: engineLabel,
        error: `This connector has no record of these values for ${run}: ${missing.join(', ')}. 3D views are built only from values written to ITEROP through this connector.`,
      },
      true,
    );

  // 3D views this session generated: only these may be written to "Update 3D view".
  const issuedViews = new Set<string>();
  server.registerTool(
    'view3d_build',
    {
      description:
        'Generate the OpenUSD 3D view of a cooling run (no platform request) from the values this connector wrote to ITEROP for it (start values, coolant, CDU sizing, loop), linked to the system model when "Update system model" is done. It also runs a space check (do the CDUs fit the CDU gallery?) that the numbers alone cannot show; report a FAIL to the user and never hide it. For a change, pass baselineRun (the approved run it modifies): the scene and the task summary then state what changed, and the viewer can compare both. Writes the .usda files locally and returns the exact values for the "Update 3D view" task, which accepts nothing else. Geometry is schematic and synthetic.',
      inputSchema: {
        runReference: z.string().regex(/^[A-Z]+-[0-9-]+$/),
        baselineRun: z
          .string()
          .regex(/^[A-Z]+-[0-9-]+$/)
          .optional()
          .describe('The approved run this configuration changes.'),
        hall: z
          .string()
          .regex(/^[a-z0-9][a-z0-9-]{0,39}$/)
          .optional()
          .describe(
            'For a new zone added next to existing equipment: the hall whose as-built record the operator keeps (for example hall-b). The scene then shows the existing equipment unchanged plus this run as the new zone, and the space check counts every unit in the shared CDU gallery.',
          ),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ runReference, baselineRun, hall }) => {
      const now = recordedDesign(runReference);
      if ('missing' in now) return noRecord(runReference, now.missing);
      const dir = o.twinDir ?? '.private/twin';
      mkdirSync(dir, { recursive: true });
      let changes: string[] | undefined;
      let baselineFile: string | undefined;
      let asBuilt: { name: string; asBuilt: CoolingDesign } | undefined;
      if (hall && baselineRun)
        return text(
          {
            engine: engineLabel,
            error:
              'Use baselineRun to change an approved run, or hall to add a new zone, not both.',
          },
          true,
        );
      if (hall) {
        const record = readAsBuilt(dir, hall);
        if ('error' in record) return text({ engine: engineLabel, error: record.error }, true);
        asBuilt = { name: hall, asBuilt: record.design };
        changes = extensionDiff(record.design, now.design);
        baselineFile = join(dir, `${hall}-as-built.usda`);
        writeFileSync(baselineFile, coolingUsd(record.design));
      }
      if (baselineRun) {
        if (baselineRun === runReference)
          return text(
            { engine: engineLabel, error: 'The baseline must be another, approved run.' },
            true,
          );
        const base = recordedDesign(baselineRun);
        if ('missing' in base) return noRecord(baselineRun, base.missing);
        changes = designDiff(base.design, now.design);
        baselineFile = join(dir, `${baselineRun}.usda`);
        writeFileSync(baselineFile, coolingUsd(base.design));
      }
      const d = now.design;
      const baselineName = hall ? `${hall} as built` : baselineRun;
      const usda = coolingUsd(
        {
          ...d,
          ...(baselineName ? { baseline: { runReference: baselineName, changes: changes! } } : {}),
        },
        asBuilt,
      );
      const file = join(dir, `${runReference}.usda`);
      writeFileSync(file, usda);
      const sha = createHash('sha256').update(usda).digest('hex').slice(0, 12);
      const at = (o.now ?? (() => new Date()))().toISOString().slice(0, 16).replace('T', ' ');
      const space = layoutCheck(d, asBuilt?.asBuilt);
      const change = hall
        ? ` New zone in ${hall} as built: ${changes!.join('; ')}.`
        : baselineRun
          ? ` Change from baseline ${baselineRun}: ${changes!.length ? changes!.join('; ') : 'no change'}.`
          : '';
      const taskValues = {
        view3d_reference: `twin/${runReference}.usda`,
        view3d_revision: `sha256 ${sha} · generated ${at} UTC`,
        view3d_summary:
          `${d.rackCount} racks, ${d.cduUnits} × ${d.cduModel} (${d.cduDutyUnits} duty, ${d.cduUnits - d.cduDutyUnits} standby), secondary loop ${d.flowLpm} L/min at ${d.supplyC} → ${d.returnC} °C, ${d.coolant}. Space check ${space.result}: ${space.finding}${change} ${now.modelRef ? `Linked to system model ${now.modelRef}.` : 'No system model linked.'} Schematic, synthetic geometry.`.slice(
            0,
            1500,
          ),
      };
      issuedViews.add(JSON.stringify(taskValues));
      const slash = (p: string) => p.split('\\').join('/');
      return text({
        engine: engineLabel,
        taskValues,
        spaceCheck: space,
        ...(changes ? { changes } : {}),
        file,
        view: baselineFile
          ? `npm run twin:view -- ${slash(file)} --baseline ${slash(baselineFile)}`
          : `npm run twin:view -- ${slash(file)}`,
      });
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
          journal.started(identificator, processKey, values);
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
        // The 3D view must be the one view3d_build generated from this run's recorded values.
        if (
          taskDefinition(d, task.name)?.id === 'view3d' &&
          !issuedViews.has(
            JSON.stringify({
              view3d_reference: values.view3d_reference,
              view3d_revision: values.view3d_revision,
              view3d_summary: values.view3d_summary,
            }),
          )
        )
          throw new EngineError(
            400,
            '“Update 3D view” accepts only the taskValues returned by view3d_build for this run, unchanged.',
          );
        // The model reference must come from the modelling connector, not from Claude.
        if (
          o.modelReceiptKey &&
          taskDefinition(d, task.name)?.id === 'systemModel' &&
          !verifyReceipt(o.modelReceiptKey, values)
        )
          throw new EngineError(
            400,
            '“Update system model” accepts only the signed values returned by cameo_model_receipt, unchanged.',
          );
        await o.engine.completeTask(taskId, { data: values });
        journal.completed(
          task.process?.identificator,
          d,
          taskDefinition(d, task.name)?.id ?? taskId,
          values,
        );
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
