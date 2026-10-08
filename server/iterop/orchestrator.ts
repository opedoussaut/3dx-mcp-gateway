import { randomUUID } from 'node:crypto';
import type { OrchestrationRun, OrchestrationStage, OrchestrationStep } from '../../shared/types';
import {
  COOLING_CHAIN,
  REQUIREMENT_INTAKE,
  definition,
  sameTask,
  type ProcessDefinition,
  type TaskDefinition,
} from './chain';
import * as tools from './configurators';
import type { ChainInputs, Fields } from './configurators';
import { labOperations, type LabOperationId } from './drive';
import { EngineError, type ProcessEngine } from './simulator';

/**
 * Deterministic natural-language orchestrator for the process lab.
 *
 * It plans a sequence of FD04 operations and local tool calls, runs reads and computations
 * immediately, and stops before every write (`startProcess`, `completeTask`) until the operator
 * approves it — or approves all writes of that run up front. Model output is never involved:
 * the plan comes from fixed rules, so a prompt cannot add operations, targets or permissions.
 */
type Ctx = {
  def?: ProcessDefinition;
  inputs?: ChainInputs;
  identificator?: string;
  instanceId?: string;
  taskId?: string;
  outputs: Fields;
  reviewerComment?: string;
};
type Planned = {
  step: OrchestrationStep;
  /** Drive steps: build the exact request shown for approval. */
  prepare?: (c: Ctx) => { path: string; body: unknown };
  exec: (c: Ctx, step: OrchestrationStep) => void | Promise<void>;
};
type Task = {
  id: string;
  name: string;
  process?: { identificator?: string; instanceId?: string; name?: string };
};
type Variable = { id: string; name?: string; value?: unknown };

const MAX_RUNS = 30;
const fmt = (n: unknown, unit = '') =>
  `${typeof n === 'number' ? n.toLocaleString('en-US') : String(n)}${unit ? ` ${unit}` : ''}`;
const num = (s: string) => Number(s.replace(',', '.'));

/** Parse the cooling-chain parameters a prompt states. Absent values stay undefined. */
export function parseInputs(prompt: string): Partial<ChainInputs> {
  const out: Partial<ChainInputs> = {};
  const load = prompt.match(/(\d+(?:[.,]\d+)?)\s*(mw|kw)\b/i);
  if (load) out.itLoadKw = Math.round(num(load[1]) * (load[2].toLowerCase() === 'mw' ? 1000 : 1));
  const temp = prompt.match(
    /(\d+(?:[.,]\d+)?)\s*°\s*c\b|(\d+(?:[.,]\d+)?)\s*(?:deg(?:rees)?\s*c|celsius|°c|c\b(?=.*water)|c\s+(?:facility|primary))/i,
  );
  if (temp) out.facilityWaterC = num(temp[1] ?? temp[2]);
  const racks = prompt.match(/(\d+)\s*(?:racks?|baies?)\b/i);
  if (racks) out.rackCount = Number(racks[1]);
  if (/\b2\s*n\b/i.test(prompt)) out.redundancy = '2N';
  else if (/\bn\s*\+\s*1\b/i.test(prompt)) out.redundancy = 'N+1';
  else if (/\bno redundan|\bwithout redundan|\bredundancy\s+n\b|\bN\s+redundancy/i.test(prompt))
    out.redundancy = 'N';
  // "use water instead of glycol": the rejected alternative must not count.
  const wanted = prompt.replace(
    /\b(?:instead of|rather than|not|au lieu d[eu'])\s+(?:plain\s+|pure\s+)?[\w-]+/gi,
    ' ',
  );
  if (
    /\b(?:plain|pure|use|with|switch to|coolant[:\s]+)\s*water\b|\bwater (?:coolant|instead)\b|\beau pure\b/i.test(
      wanted,
    )
  )
    out.coolant = 'water';
  else if (/\bpg\s*-?\s*25\b|glycol/i.test(wanted)) out.coolant = 'PG25';
  return out;
}

const REFUSE: [RegExp, string][] = [
  [
    /\b(re-?assign|assign\s+(?:it|this|the|that)?\s*(?:task\s*)?to|delegate|réassign|attribuer)/i,
    'Changing task assignments (setTaskAssignments / updateTaskAssignments) is outside the lab: NOVA only completes tasks assigned to you.',
  ],
  [
    /\b(deploy|import|delete|remove|purge)\b.*\b(process|model|deployment|instance|task)/i,
    'Deploying, importing or deleting process models and instances is an administration action. NOVA never calls it.',
  ],
  [
    /\b(stop|cancel|abort|kill)\b.*\b(process|instance)\b/i,
    'Stopping a process instance (stopProcessInstance) is not part of the lab. Use the process application.',
  ],
  [
    /\b(grant|rights?|permissions?|droits)\b/i,
    'Process rights are administration actions. NOVA never changes them.',
  ],
  [
    /\b(sign(?:\s+off)?\s+(?:it|this|the|for)|approve\s+the\s+(?:configuration|sign|review|requirement)|signer|valider la signature)/i,
    'Sign-off is a human decision. FD04 documents signed tasks as "only doable via UI", and NOVA never signs on anyone’s behalf.',
  ],
  [
    /\b(someone else|another user|other users?|colleague|everyone'?s|all users)\b|\btasks?\s+(?:of|for)\s+(?!me\b)[A-Z][a-z]+|\btâches de\b/i,
    'NOVA reads and completes only your own tasks. Other people’s tasks need a reviewed authorization model that does not exist.',
  ],
];

const chainStages = (def: ProcessDefinition): OrchestrationStage[] => [
  {
    id: 'start',
    label: def.key === COOLING_CHAIN ? 'Operating envelope' : 'Candidate',
    kind: 'start',
  },
  ...def.tasks.map((t) => ({
    id: t.id,
    label: t.name,
    kind: t.signature ? ('human' as const) : ('automated' as const),
    tool: t.tool,
  })),
];

export class Orchestrator {
  runs: OrchestrationRun[] = [];
  private plans = new Map<string, Planned[]>();
  private running = new Set<string>();
  private ctx = new Map<string, Ctx>();
  private count = 0;
  constructor(public engine: ProcessEngine) {}

  /**
   * Run reference sent as the instance identificator. Simulated runs count from 001. Live
   * instances outlive this process and a sandbox already holds earlier runs, so a live
   * reference carries the start time (COOL-251008-1412) and never repeats one of this session.
   */
  private identificatorFor(prefix: string, run: OrchestrationRun) {
    if (this.engine.source !== 'live') return `${prefix}-${String(run.number).padStart(3, '0')}`;
    const d = new Date(run.createdAt);
    const p2 = (n: number) => String(n).padStart(2, '0');
    const base = `${prefix}-${p2(d.getFullYear() % 100)}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}`;
    const taken = new Set(this.runs.map((r) => r.identificator));
    let id = base;
    for (let i = 2; taken.has(id); i++) id = `${base}-${i}`;
    return id;
  }

  async start(
    prompt: string,
    approval: 'each' | 'all' = 'each',
    via: 'portal' | 'claude' = 'portal',
  ): Promise<OrchestrationRun> {
    const run: OrchestrationRun = {
      id: randomUUID(),
      number: ++this.count,
      prompt,
      via,
      createdAt: new Date().toISOString(),
      source: this.engine.source,
      intent: 'unknown',
      status: 'completed',
      summary: '',
      approval,
      stages: [],
      stageState: {},
      stageNotes: {},
      steps: [],
      outputs: [],
      findings: [],
      missing: [],
      changes: [],
      records: [],
    };
    const ctx: Ctx = { outputs: {} };
    this.ctx.set(run.id, ctx);
    this.runs.unshift(run);
    for (const old of this.runs.splice(MAX_RUNS)) {
      this.plans.delete(old.id);
      this.ctx.delete(old.id);
    }
    const plan = this.plan(run, ctx);
    this.plans.set(run.id, plan);
    run.steps = plan.map((p) => p.step);
    if (run.status !== 'needs_input' && run.status !== 'blocked')
      await this.locked(run, () => this.advance(run));
    return run;
  }

  async approve(runId: string, stepId: string, all = false): Promise<OrchestrationRun> {
    const run = this.find(runId);
    const plan = this.plans.get(runId)!;
    const p = plan.find((x) => x.step.id === stepId);
    if (!p || p.step.status !== 'awaiting_approval' || run.status !== 'awaiting_approval')
      throw new EngineError(409, 'This step is not waiting for approval.');
    if (this.running.has(runId))
      throw new EngineError(409, 'This run is already executing a step.');
    if (all) run.approval = 'all';
    await this.locked(run, async () => {
      await this.execute(run, p);
      if (stepStatus(p) === 'done') await this.advance(run);
    });
    return run;
  }

  cancel(runId: string): OrchestrationRun {
    const run = this.find(runId);
    if (this.running.has(runId))
      throw new EngineError(409, 'This run is already executing a step.');
    if (run.status !== 'awaiting_approval')
      throw new EngineError(409, 'Only a run waiting for approval can be cancelled.');
    for (const s of run.steps)
      if (s.status === 'pending' || s.status === 'awaiting_approval') s.status = 'skipped';
    for (const [k, v] of Object.entries(run.stageState))
      if (v === 'awaiting' || v === 'active') run.stageState[k] = 'pending';
    run.status = 'cancelled';
    run.summary = `Cancelled before ${run.steps.find((s) => s.status === 'skipped' && s.kind === 'drive')?.operationId ?? 'the next write'}. Nothing else was sent to the process engine.`;
    return run;
  }

  find(runId: string) {
    const run = this.runs.find((r) => r.id === runId);
    if (!run) throw new EngineError(404, 'Run not found.');
    return run;
  }

  // ───────────────────────────── planning ─────────────────────────────

  private plan(run: OrchestrationRun, ctx: Ctx): Planned[] {
    const prompt = run.prompt;
    for (const [pattern, reason] of REFUSE)
      if (pattern.test(prompt)) {
        run.intent = 'refused';
        run.status = 'blocked';
        run.summary = reason;
        run.findings = ['No operation was planned or sent.'];
        return [];
      }
    const parsed = parseInputs(prompt);
    const previous = this.runs.find(
      (r) => r !== run && r.inputs && r.processKey === COOLING_CHAIN && r.status !== 'needs_input',
    );
    if (/\b(continue|resume|reprend\w*|finish|pick up where)\b/i.test(prompt))
      return this.planResume(run, ctx, prompt.match(/\b(COOL-\d+(?:-\d+)*)\b/i)?.[1]);
    if (/\b(requirement|exigence)\b/i.test(prompt)) return this.planRequirement(run, ctx);
    if (
      previous &&
      /\b(now|instead|changed?|what if|recalculat\w*|re-?run|désormais|maintenant|passe à)\b/i.test(
        prompt,
      ) &&
      Object.keys(parsed).length
    )
      return this.planChain(
        run,
        ctx,
        { ...(previous.inputs as unknown as ChainInputs), ...parsed },
        previous,
      );
    if (/\b(configur\w*|size|sizing|dimension\w*|cooling|refroidissement|chain)\b/i.test(prompt))
      return this.planChain(run, ctx, parsed);
    if (
      /\b(inbox|rework|pick up|handle|process my tasks|work (?:on|through) my tasks|boîte)\b/i.test(
        prompt,
      )
    )
      return this.planInbox(run, ctx);
    if (/\b(tasks?|tâches?|waiting|assigned|to-?do)\b/i.test(prompt)) return this.planTasks(run);
    if (/\b(status|progress|where is|état|avancement)\b/i.test(prompt))
      return this.planStatus(run, ctx);
    if (/\b(process(?:es)?|startable|start|démarrer)\b/i.test(prompt))
      return this.planProcesses(run);
    run.status = 'needs_input';
    run.summary =
      'NOVA could not map this command to a lab action. Try configuring the cooling chain, changing one of its inputs, registering a candidate requirement, or checking your inbox.';
    return [];
  }

  private planChain(
    run: OrchestrationRun,
    ctx: Ctx,
    given: Partial<ChainInputs>,
    previous?: OrchestrationRun,
  ): Planned[] {
    const def = definition(COOLING_CHAIN)!;
    run.intent = previous ? 'recalculate' : 'configure';
    run.processKey = def.key;
    run.processName = def.name;
    run.stages = chainStages(def);
    for (const s of run.stages) run.stageState[s.id] = 'pending';
    const missing = [
      given.itLoadKw === undefined && 'IT heat load (for example "1.2 MW")',
      given.facilityWaterC === undefined &&
        'facility water supply temperature (for example "32 °C")',
      given.rackCount === undefined && 'rack count (for example "16 racks")',
    ].filter(Boolean) as string[];
    if (missing.length) {
      run.status = 'needs_input';
      run.missing = missing;
      run.summary = `To start ${def.name}, NOVA still needs the ${missing.join(', ')}. Nothing was started.`;
      return [];
    }
    const inputs: ChainInputs = {
      itLoadKw: given.itLoadKw!,
      facilityWaterC: given.facilityWaterC!,
      rackCount: given.rackCount!,
      redundancy: given.redundancy ?? 'N+1',
      coolant: given.coolant ?? 'auto',
    };
    for (const s of def.startVariables) {
      const value = {
        start_itLoadKw: inputs.itLoadKw,
        start_facilityWaterC: inputs.facilityWaterC,
        start_rackCount: inputs.rackCount,
      }[s.id];
      if (
        typeof value === 'number' &&
        ((s.min && value < Number(s.min)) || (s.max && value > Number(s.max)))
      ) {
        run.status = 'needs_input';
        run.missing = [`${s.name} between ${s.min} and ${s.max}${s.unit ? ` ${s.unit}` : ''}`];
        run.summary = `${s.name} ${fmt(value, s.unit)} is outside the process form range (${s.min}–${s.max}). Nothing was started.`;
        return [];
      }
    }
    ctx.def = def;
    ctx.inputs = inputs;
    ctx.identificator = this.identificatorFor(def.identificatorPrefix, run);
    run.identificator = ctx.identificator;
    run.inputs = { ...inputs };
    run.stageNotes.start = `${fmt(inputs.itLoadKw, 'kW')} · ${inputs.facilityWaterC} °C · ${inputs.rackCount} racks · ${inputs.redundancy}`;
    if (!given.redundancy) run.findings.push('Redundancy not stated: N+1 assumed (form default).');
    if (previous) {
      const changed = (Object.keys(inputs) as (keyof ChainInputs)[]).filter(
        (k) => String(inputs[k]) !== String((previous.inputs as Record<string, unknown>)[k]),
      );
      run.findings.push(
        changed.length
          ? `Changed from run ${previous.identificator}: ${changed.map((k) => `${label(k)} ${previous.inputs![k]} → ${inputs[k]}`).join(', ')}. Affected stages: ${affected(changed).join(', ')}.`
          : `Same inputs as run ${previous.identificator}; the chain runs again for traceability.`,
      );
    }
    return [
      ...this.discovery(def),
      this.startStep(def, ctx),
      this.locate(def.tasks[0], 'Find the new instance by its identificator'),
      ...this.automatedTasks(def, ctx),
      ...this.handOff(def, ctx, previous),
    ];
  }

  /**
   * Pick up a cooling-chain run that is waiting at one of NOVA's tasks (for example after a
   * stopped run), read the values already in the process and continue from that task.
   */
  private planResume(run: OrchestrationRun, ctx: Ctx, identificator?: string): Planned[] {
    const def = definition(COOLING_CHAIN)!;
    const auto = def.tasks.filter((t) => t.tool);
    run.intent = 'configure';
    run.processKey = def.key;
    run.processName = def.name;
    run.stages = chainStages(def);
    for (const st of run.stages) run.stageState[st.id] = 'pending';
    ctx.def = def;
    const find = read(
      'getTasksByUser',
      identificator
        ? `Find the open task of ${identificator.toUpperCase()}`
        : 'Find a waiting chain task',
      {},
      async (c, step) => {
        const tasks = (await this.engine.getTasksByUser()) as Task[];
        const open = tasks.filter(
          (t) =>
            auto.some((a) => sameTask(t.name, a.name)) &&
            (!identificator ||
              t.process?.identificator?.toUpperCase() === identificator.toUpperCase()),
        );
        step.response = open;
        if (!open.length) {
          step.outcome = `200 · ${tasks.length} task${tasks.length === 1 ? '' : 's'}, none to continue`;
          run.summary = identificator
            ? `${identificator.toUpperCase()} has no open task assigned to NOVA's account.`
            : 'No cooling-chain run is waiting at one of NOVA’s tasks.';
          throw new Stop();
        }
        const t = open[0];
        const index = auto.findIndex((a) => sameTask(t.name, a.name));
        step.outcome = `200 · ${t.process?.identificator ?? t.id} waiting at “${auto[index].name}”`;
        c.taskId = t.id;
        c.instanceId = t.process?.instanceId;
        c.identificator = t.process?.identificator;
        run.identificator = c.identificator;
        run.instanceId = c.instanceId;
        run.stageState.start = 'done';
        // Tasks before this one are already done in the process: skip their steps.
        for (const done of auto.slice(0, index)) {
          run.stageState[done.id] = 'done';
          run.stageNotes[done.id] = 'done earlier';
        }
        const skip = new Set(auto.slice(0, index).map((a) => a.id));
        for (const s of run.steps)
          if (
            s.status === 'pending' &&
            s.stage &&
            (skip.has(s.stage) ||
              (s.stage === auto[index].id && s.operationId === 'getTasksByUser'))
          )
            s.status = 'skipped';
        if (open.length > 1)
          run.findings.push(
            `${open.length} runs are waiting; continuing ${c.identificator}. Name one (e.g. “continue COOL-002”) to choose.`,
          );
      },
    );
    const inputs = read(
      'getTaskInstanceInformations',
      'Read the values already in the process',
      {},
      async (c, step) => {
        const info = (await this.engine.getTaskInstanceInformations(c.taskId!)) as {
          providedData?: Variable[];
        };
        let values = new Map<string, unknown>(
          (info.providedData ?? []).map((x) => [x.id, x.value] as [string, unknown]),
        );
        let origin = 'the task';
        const num = (id: string) => Number(values.get(id));
        const readable = () =>
          ['start_itLoadKw', 'start_facilityWaterC', 'start_rackCount'].every((id) =>
            Number.isFinite(num(id)),
          );
        if (!readable() && c.instanceId) {
          // The run's own data, when this account may read it (supervisor of its own runs).
          try {
            const inst = (await this.engine.getInstanceInfo(c.instanceId)) as {
              variables?: Variable[];
            };
            values = new Map(
              (inst.variables ?? []).map((x) => [x.id, x.value] as [string, unknown]),
            );
            origin = 'the process instance';
          } catch {
            /* not readable by this account: try the next source */
          }
        }
        let inputs: ChainInputs | undefined;
        if (readable())
          inputs = {
            itLoadKw: num('start_itLoadKw'),
            facilityWaterC: num('start_facilityWaterC'),
            rackCount: num('start_rackCount'),
            redundancy: String(
              values.get('start_redundancy') ?? 'N+1',
            ) as ChainInputs['redundancy'],
            coolant: String(values.get('start_coolant') ?? 'auto') as ChainInputs['coolant'],
          };
        const earlier = this.runs.find(
          (r) => r !== run && r.identificator === c.identificator && r.inputs,
        );
        if (!inputs && earlier) {
          inputs = earlier.inputs as unknown as ChainInputs;
          origin = `run ${earlier.number} of this session`;
        }
        const stated = parseInputs(run.prompt);
        if (
          !inputs &&
          stated.itLoadKw !== undefined &&
          stated.facilityWaterC !== undefined &&
          stated.rackCount !== undefined
        ) {
          inputs = {
            itLoadKw: stated.itLoadKw,
            facilityWaterC: stated.facilityWaterC,
            rackCount: stated.rackCount,
            redundancy: stated.redundancy ?? 'N+1',
            coolant: stated.coolant ?? 'auto',
          };
          origin = 'your command';
        }
        step.response = { providedData: [...values.keys()], source: origin };
        if (!inputs) {
          run.status = 'needs_input';
          run.missing = [
            'the run’s start values, e.g. “Continue COOL-001 with 1.2 MW, 32 °C facility water, 16 racks, N+1”',
          ];
          run.summary = `${c.identificator}: the start values are not readable by NOVA’s account (the task shows no data and the instance is not readable). Repeat the values in the command, or show the start fields under the task’s “Information to display”.`;
          throw new Stop();
        }
        c.inputs = inputs;
        if (origin !== 'the task' && origin !== 'the process instance')
          run.findings.push(
            `Start values taken from ${origin}; they are not readable from the process by NOVA’s account.`,
          );
        // Earlier task outputs feed the later tools (e.g. the loop needs the coolant properties).
        for (const f of auto.flatMap((a) => a.expectedFields)) {
          const value = values.get(f.id);
          if (typeof value === 'string' || typeof value === 'number') c.outputs[f.id] = value;
        }
        // Missing ones are recomputed: the lab tools are deterministic functions of the inputs.
        const current = run.steps.find(
          (st) => st.status === 'pending' && st.kind === 'compute',
        )?.stage;
        const upTo = Math.max(
          0,
          auto.findIndex((x) => x.id === current),
        );
        for (const a of auto.slice(0, upTo))
          if (a.expectedFields.some((f) => c.outputs[f.id] === undefined))
            Object.assign(c.outputs, runTool(a.tool!, c));
        run.inputs = { ...c.inputs };
        run.stageNotes.start = `${fmt(c.inputs.itLoadKw, 'kW')} · ${c.inputs.facilityWaterC} °C · ${c.inputs.rackCount} racks · ${c.inputs.redundancy}`;
        step.outcome = `200 · start values from ${origin}`;
      },
    );
    return [find, inputs, ...this.automatedTasks(def, ctx), ...this.handOff(def, ctx)];
  }

  private planInbox(run: OrchestrationRun, ctx: Ctx): Planned[] {
    run.intent = 'tasks';
    const def = definition(COOLING_CHAIN)!;
    const rework = def.rework!;
    const steps: Planned[] = [
      read('getTasksByUser', 'Check my inbox', {}, async (c, step) => {
        const tasks = (await this.engine.getTasksByUser()) as Task[];
        step.response = tasks;
        step.outcome = `200 · ${tasks.length} task${tasks.length === 1 ? '' : 's'}`;
        run.records = tasks.map((t) => ({
          id: t.id,
          title: t.name,
          detail: `${t.process?.name ?? ''} · ${t.process?.identificator ?? ''}`,
        }));
        const found = tasks.find((t) => sameTask(t.name, rework.name));
        if (!found) {
          run.summary = tasks.length
            ? `${tasks.length} task${tasks.length === 1 ? '' : 's'} in your inbox, none sent back for rework.`
            : 'Your inbox is empty. Nothing was handed back by a process.';
          throw new Stop();
        }
        c.taskId = found.id;
        c.instanceId = found.process?.instanceId;
        c.identificator = found.process?.identificator;
        run.identificator = c.identificator;
        run.instanceId = c.instanceId;
      }),
      read(
        'getTaskInstanceInformations',
        'Read the reviewer’s comment',
        { stage: 'engineeringSignoff' },
        async (c, step) => {
          const info = (await this.engine.getTaskInstanceInformations(c.taskId!)) as {
            providedData?: Variable[];
            expectedFields?: { id: string }[];
          };
          step.response = info;
          step.outcome = '200';
          assertFields(info.expectedFields, rework);
          const v = (id: string) => info.providedData?.find((x) => x.id === id)?.value;
          c.reviewerComment = String(v('engineeringSignoff_comment') ?? '');
          const previousInputs: ChainInputs = {
            itLoadKw: Number(v('start_itLoadKw')),
            facilityWaterC: Number(v('start_facilityWaterC')),
            rackCount: Number(v('start_rackCount')),
            redundancy: String(v('start_redundancy') ?? 'N+1') as ChainInputs['redundancy'],
            coolant: String(v('start_coolant') ?? 'auto') as ChainInputs['coolant'],
          };
          const revision = parseInputs(c.reviewerComment);
          const usable = (['coolant', 'redundancy', 'facilityWaterC'] as const).filter(
            (k) => revision[k] !== undefined,
          );
          if (!usable.length) {
            run.status = 'needs_input';
            run.summary = `The reviewer returned ${c.identificator} with “${c.reviewerComment || 'no comment'}”. NOVA found no coolant, redundancy or facility-water instruction it can apply, so the rework task stays open for you.`;
            throw new Stop();
          }
          c.inputs = {
            ...previousInputs,
            ...Object.fromEntries(usable.map((k) => [k, revision[k]])),
          } as ChainInputs;
          run.inputs = { ...c.inputs };
          run.intent = 'recalculate';
          run.stageNotes.start = `${fmt(c.inputs.itLoadKw, 'kW')} · ${c.inputs.facilityWaterC} °C · ${c.inputs.rackCount} racks · ${c.inputs.redundancy}`;
          run.findings.push(
            `Reviewer: “${c.reviewerComment}”. Applying ${usable.map((k) => `${label(k)} ${previousInputs[k]} → ${c.inputs![k]}`).join(', ')}.`,
          );
        },
      ),
      drive(
        'completeTask',
        'Complete the rework task with the revised inputs',
        { stage: 'start' },
        (c) => ({
          path: labOperations.completeTask.path.replace('{taskId}', c.taskId!),
          body: {
            data: {
              configurationRework_coolant: c.inputs!.coolant,
              configurationRework_redundancy: c.inputs!.redundancy,
              configurationRework_facilityWaterC: c.inputs!.facilityWaterC,
              configurationRework_note: `Applied reviewer comment: ${c.reviewerComment}`.slice(
                0,
                1000,
              ),
            },
          },
        }),
        (c, step) => this.complete(c, step),
      ),
      this.locate(def.tasks[0], 'Find the restarted chain'),
      ...this.automatedTasks(def, ctx),
      ...this.handOff(def, ctx),
    ];
    // The inbox run becomes a chain run once a rework task is found.
    run.stages = chainStages(def);
    for (const s of run.stages) run.stageState[s.id] = 'pending';
    run.processKey = def.key;
    run.processName = def.name;
    ctx.def = def;
    return steps;
  }

  private planRequirement(run: OrchestrationRun, ctx: Ctx): Planned[] {
    const def = definition(REQUIREMENT_INTAKE)!;
    run.intent = 'requirement';
    run.processKey = def.key;
    run.processName = def.name;
    run.stages = chainStages(def);
    for (const s of run.stages) run.stageState[s.id] = 'pending';
    const sourceMatch = run.prompt.match(
      /\b(?:source|from|per|according to|réf(?:érence)?)\s*[:\-]?\s*(.{3,300})$/i,
    );
    const body = run.prompt
      .replace(sourceMatch?.[0] ?? '', '')
      .replace(/^.*?\b(?:requirement|exigence)\b\s*[:\-]?\s*/i, '')
      .replace(/[;,.\s]+$/, '')
      .trim();
    const missing = [
      body.length < 10 && 'the requirement statement after a colon',
      !sourceMatch && 'its public source (for example “source: guideline section 4.2”)',
    ].filter(Boolean) as string[];
    if (missing.length) {
      run.status = 'needs_input';
      run.missing = missing;
      run.summary = `To register a candidate requirement NOVA needs ${missing.join(' and ')}. Nothing was started.`;
      return [];
    }
    ctx.def = def;
    ctx.identificator = this.identificatorFor(def.identificatorPrefix, run);
    run.identificator = ctx.identificator;
    const statement = body.slice(0, 1000);
    const reference = sourceMatch![1].trim().slice(0, 300);
    run.stageNotes.start = statement.length > 60 ? `${statement.slice(0, 57)}…` : statement;
    run.findings.push(
      `Source: ${reference}. The candidate stays a candidate until an engineer accepts it.`,
    );
    return [
      ...this.discovery(def),
      drive(
        'startProcess',
        'Start the requirement intake',
        { stage: 'start' },
        () => ({
          path: labOperations.startProcess.path.replace('{processKey}', def.key),
          body: {
            identificator: ctx.identificator,
            data: { start_statement: statement, start_sourceReference: reference },
          },
        }),
        (c, step) => this.started(run, c, step),
      ),
      ...this.handOff(def, ctx),
    ];
  }

  private planTasks(run: OrchestrationRun): Planned[] {
    run.intent = 'tasks';
    return [
      read('getTasksByUser', 'List my open tasks', {}, async (_c, step) => {
        const tasks = (await this.engine.getTasksByUser()) as Task[];
        step.response = tasks;
        step.outcome = `200 · ${tasks.length}`;
        run.records = tasks.map((t) => ({
          id: t.id,
          title: t.name,
          detail: `${t.process?.name ?? ''} · ${t.process?.identificator ?? ''}`,
        }));
        run.summary = tasks.length
          ? `You have ${tasks.length} open task${tasks.length === 1 ? '' : 's'} in the lab engine.`
          : 'You have no open tasks in the lab engine. Sign-off tasks sit with the reviewer, not with you.';
      }),
    ];
  }

  private planStatus(run: OrchestrationRun, ctx: Ctx): Planned[] {
    run.intent = 'status';
    const last = this.runs.find((r) => r !== run && r.instanceId);
    if (!last) {
      run.status = 'needs_input';
      run.summary = 'No process instance has been started in this session yet.';
      return [];
    }
    ctx.instanceId = last.instanceId;
    run.identificator = last.identificator;
    run.instanceId = last.instanceId;
    return [
      read('getInstanceInfo', `Read instance ${last.identificator}`, {}, async (c, step) => {
        try {
          const info = (await this.engine.getInstanceInfo(c.instanceId!)) as {
            variables?: Variable[];
          };
          step.response = info;
          step.outcome = '200';
          run.records = (info.variables ?? []).map((v) => ({
            id: v.id,
            title: v.name ?? v.id,
            detail: String(v.value),
          }));
          run.summary = `${last.identificator} is still running with ${run.records.length} recorded values.`;
        } catch (e) {
          if (e instanceof EngineError && e.status === 404) {
            step.outcome = '404';
            run.summary = `${last.identificator} is no longer active: FD04 returns 404 for an instance that is completed or unknown.`;
            return;
          }
          throw e;
        }
      }),
    ];
  }

  private planProcesses(run: OrchestrationRun): Planned[] {
    run.intent = 'processes';
    return [
      read('getAllStartableProcesses', 'List processes I can start', {}, async (_c, step) => {
        const list = (await this.engine.getAllStartableProcesses()) as {
          responses?: { key: string; name: string; version: number }[];
        };
        step.response = list;
        const rows = list.responses ?? [];
        step.outcome = `200 · ${rows.length}`;
        run.records = rows.map((p) => ({
          id: p.key,
          title: p.name,
          detail: `version ${p.version}`,
        }));
        run.summary = `${rows.length} process${rows.length === 1 ? '' : 'es'} can be started in the lab engine.`;
      }),
    ];
  }

  // ───────────────────────────── step builders ─────────────────────────────

  private discovery(def: ProcessDefinition): Planned[] {
    return [
      read(
        'getAllStartableProcesses',
        'Confirm the process is startable',
        { stage: 'start' },
        async (_c, step) => {
          const list = (await this.engine.getAllStartableProcesses()) as {
            responses?: { key: string }[];
          };
          step.response = list;
          step.outcome = `200 · ${list.responses?.length ?? 0}`;
          if (!list.responses?.some((p) => p.key === def.key))
            throw new EngineError(403, `${def.name} is not in your startable list.`);
        },
      ),
      read(
        'getBasicProcessInfo',
        'Read the process definition',
        { stage: 'start', path: { processKey: def.key } },
        async (_c, step) => {
          step.response = await this.engine.getBasicProcessInfo(def.key);
          step.outcome = '200';
        },
      ),
    ];
  }

  private startStep(def: ProcessDefinition, ctx: Ctx): Planned {
    const run = this.runs.find((r) => this.ctx.get(r.id) === ctx)!;
    return drive(
      'startProcess',
      `Start ${def.name}`,
      { stage: 'start' },
      (c) => ({
        path: labOperations.startProcess.path.replace('{processKey}', def.key),
        body: {
          identificator: c.identificator,
          data: {
            start_itLoadKw: c.inputs!.itLoadKw,
            start_facilityWaterC: c.inputs!.facilityWaterC,
            start_rackCount: c.inputs!.rackCount,
            start_redundancy: c.inputs!.redundancy,
            start_coolant: c.inputs!.coolant,
          },
        },
      }),
      (c, step) => this.started(run, c, step),
    );
  }

  private async started(run: OrchestrationRun, c: Ctx, step: OrchestrationStep) {
    const { path, body } = step.request as { path: string; body: unknown };
    const key = path.split('/').pop()!;
    await this.engine.startProcess(decodeURIComponent(key), body);
    step.outcome = '201 · no body (FD04)';
    run.stageState.start = 'done';
    void c;
  }

  private async complete(c: Ctx, step: OrchestrationStep) {
    const { body } = step.request as { body: unknown };
    await this.engine.completeTask(c.taskId!, body);
    step.outcome = '200 · task completed';
  }

  /** Find the open task of this instance with the given name (identificator correlates a fresh start). */
  private locate(task: TaskDefinition, title: string): Planned {
    return read('getTasksByUser', title, { stage: task.id }, async (c, step) => {
      const tasks = (await this.engine.getTasksByUser()) as Task[];
      step.response = tasks.filter((t) => t.process?.identificator === c.identificator);
      const found = tasks.find(
        (t) =>
          sameTask(t.name, task.name) &&
          (c.instanceId
            ? t.process?.instanceId === c.instanceId
            : t.process?.identificator === c.identificator),
      );
      if (!found) throw new EngineError(404, `No open “${task.name}” task for ${c.identificator}.`);
      step.outcome = `200 · found ${found.id}`;
      c.taskId = found.id;
      c.instanceId = found.process?.instanceId;
      const run = this.runFor(c);
      run.instanceId = c.instanceId;
    });
  }

  private automatedTasks(def: ProcessDefinition, ctx: Ctx): Planned[] {
    const auto = def.tasks.filter((t) => t.tool);
    return auto.flatMap((task, i) => [
      ...(i === 0 ? [] : [this.locate(task, `Find “${task.name}”`)]),
      read(
        'getTaskInstanceInformations',
        `Read the “${task.name}” form`,
        { stage: task.id },
        async (c, step) => {
          const info = (await this.engine.getTaskInstanceInformations(c.taskId!)) as {
            expectedFields?: { id: string }[];
          };
          step.response = { expectedFields: info.expectedFields };
          step.outcome = `200 · ${info.expectedFields?.length ?? 0} expected fields`;
          assertFields(info.expectedFields, task);
          this.runFor(c).stageState[task.id] = 'active';
        },
      ),
      {
        step: {
          id: randomUUID(),
          kind: 'compute',
          title: toolTitle[task.tool!],
          stage: task.id,
          status: 'pending',
        },
        exec: async (c, step) => {
          const fields = runTool(task.tool!, c);
          Object.assign(c.outputs, fields);
          step.request = { tool: task.tool, inputs: c.inputs };
          step.response = fields;
          step.outcome = 'computed locally · illustrative';
          const run = this.runFor(c);
          run.stageNotes[task.id] = noteFor(task.tool!, fields);
          run.outputs = outputsOf(def, c.outputs);
        },
      },
      drive(
        'completeTask',
        `Complete “${task.name}”`,
        { stage: task.id },
        (c) => ({
          path: labOperations.completeTask.path.replace('{taskId}', c.taskId!),
          body: {
            data: Object.fromEntries(task.expectedFields.map((f) => [f.id, c.outputs[f.id]])),
          },
        }),
        async (c, step) => {
          await this.complete(c, step);
          this.runFor(c).stageState[task.id] = 'done';
        },
      ),
    ]);
  }

  /** The point where the process continues without NOVA. */
  private handOff(def: ProcessDefinition, ctx: Ctx, previous?: OrchestrationRun): Planned[] {
    const human = def.tasks.find((t) => t.signature)!;
    const planned: Planned[] = [];
    if (previous)
      planned.push({
        step: {
          id: randomUUID(),
          kind: 'compute',
          title: `Compare with ${previous.identificator}`,
          status: 'pending',
        },
        exec: async (c, step) => {
          const run = this.runFor(c);
          const before = Object.fromEntries(previous.outputs.map((o) => [o.field, o.value]));
          run.changes = run.outputs.map((o) => ({
            field: o.field,
            label: o.label,
            before: before[o.field] ?? '—',
            after: o.value,
            changed: (before[o.field] ?? '—') !== o.value,
          }));
          const n = run.changes.filter((x) => x.changed).length;
          step.response = { changed: n, of: run.changes.length };
          step.outcome = `${n} of ${run.changes.length} outputs changed`;
        },
      });
    planned.push({
      step: {
        id: randomUUID(),
        kind: 'human',
        title: `${human.name} — engineering reviewer`,
        stage: human.id,
        status: 'pending',
        operationId: 'completeTask',
        method: 'POST',
        path: labOperations.completeTask.path,
      },
      exec: async (c, step) => {
        const run = this.runFor(c);
        step.outcome =
          'Handed to the reviewer · signature only in the process application (FD04 403)';
        run.stageState[human.id] = 'human';
        run.stageNotes[human.id] = 'Waiting for reviewer';
        run.status = 'awaiting_signoff';
        const check = c.outputs.systemCheck_result;
        run.summary =
          def.key === COOLING_CHAIN
            ? `${c.identificator}: ${def.tasks.filter((t) => t.tool).length} automated tasks completed. Lab check ${check}. Waiting for the engineering reviewer to sign in the process application; a rejection comes back to your inbox as a rework task.`
            : `${c.identificator} registered as a candidate requirement and assigned to the engineering reviewer.`;
        throw new Stop(true);
      },
    });
    void ctx;
    return planned;
  }

  // ───────────────────────────── execution ─────────────────────────────

  private runFor(c: Ctx) {
    return this.runs.find((r) => this.ctx.get(r.id) === c)!;
  }

  /** One step at a time per run: a second approval cannot race the first. */
  private async locked(run: OrchestrationRun, fn: () => Promise<void>) {
    this.running.add(run.id);
    try {
      await fn();
    } finally {
      this.running.delete(run.id);
    }
  }

  private async advance(run: OrchestrationRun) {
    const plan = this.plans.get(run.id)!;
    const ctx = this.ctx.get(run.id)!;
    for (const p of plan) {
      if (p.step.status !== 'pending') continue;
      if (p.step.kind === 'drive') {
        const req = p.prepare!(ctx);
        p.step.request = req;
        p.step.path = req.path;
        if (run.approval === 'each') {
          p.step.status = 'awaiting_approval';
          run.status = 'awaiting_approval';
          if (p.step.stage) run.stageState[p.step.stage] = 'awaiting';
          run.summary = `Prepared ${p.step.operationId} — not submitted. Approve to send it to the ${run.source} engine.`;
          return;
        }
      }
      await this.execute(run, p);
      if (stepStatus(p) !== 'done') return;
    }
    if (run.status === 'awaiting_approval') run.status = 'completed';
  }

  private async execute(run: OrchestrationRun, p: Planned) {
    const ctx = this.ctx.get(run.id)!;
    p.step.at = new Date().toISOString();
    try {
      await p.exec(ctx, p.step);
      p.step.status = 'done';
      if (run.status === 'awaiting_approval') run.status = 'completed';
    } catch (e) {
      if (e instanceof Stop) {
        // A Stop ends the plan: a hand-off to a person, or nothing further to do.
        p.step.status = e.handOff ? 'blocked' : 'done';
        if (!e.handOff && run.status !== 'needs_input') run.status = 'completed';
        this.halt(run);
        return;
      }
      p.step.status = 'failed';
      const status = e instanceof EngineError ? e.status : 500;
      p.step.outcome = `${status} · ${e instanceof Error ? e.message : 'Failed'}`;
      if (p.step.stage) run.stageState[p.step.stage] = 'failed';
      run.status = status === 401 || status === 403 ? 'blocked' : 'failed';
      run.summary = `${p.step.operationId ?? p.step.title} returned ${status}: ${e instanceof Error ? e.message : 'failure'} Later steps were not sent.`;
      for (const s of run.steps) if (s.status === 'pending') s.status = 'skipped';
    }
  }

  private halt(run: OrchestrationRun) {
    for (const s of run.steps) if (s.status === 'pending') s.status = 'skipped';
  }
}

/** Read through a function so TypeScript does not narrow a status mutated by execute(). */
const stepStatus = (p: Planned) => p.step.status;

class Stop extends Error {
  constructor(public handOff = false) {
    super('stop');
  }
}

function read(
  id: LabOperationId,
  title: string,
  opts: { stage?: string; path?: Record<string, string> },
  exec: Planned['exec'],
): Planned {
  const op = labOperations[id];
  let path: string = op.path;
  for (const [k, v] of Object.entries(opts.path ?? {}))
    path = path.replace(`{${k}}`, encodeURIComponent(v));
  return {
    step: {
      id: randomUUID(),
      kind: 'read',
      title,
      stage: opts.stage,
      operationId: op.operationId,
      method: op.method,
      path,
      status: 'pending',
    },
    exec,
  };
}
function drive(
  id: LabOperationId,
  title: string,
  opts: { stage?: string },
  prepare: NonNullable<Planned['prepare']>,
  exec: Planned['exec'],
): Planned {
  const op = labOperations[id];
  return {
    step: {
      id: randomUUID(),
      kind: 'drive',
      title,
      stage: opts.stage,
      operationId: op.operationId,
      method: op.method,
      path: op.path,
      status: 'pending',
    },
    prepare,
    exec,
  };
}

/** The engine's task form must carry exactly the fields the lab definition writes. */
function assertFields(expected: { id: string }[] | undefined, task: TaskDefinition) {
  const ids = new Set((expected ?? []).map((f) => f.id));
  const absent = task.expectedFields.filter((f) => f.required && !ids.has(f.id)).map((f) => f.id);
  if (absent.length)
    throw new EngineError(
      400,
      `The “${task.name}” form does not declare ${absent.join(', ')}. The process model does not match the lab definition.`,
    );
}

const toolTitle: Record<string, string> = {
  coolant: 'Run the coolant selector',
  cdu: 'Run the unit sizing tool',
  loop: 'Run the loop calculator',
  validator: 'Run the system limit check',
};
function runTool(tool: string, c: Ctx): Fields {
  const i = c.inputs!;
  if (tool === 'coolant') return tools.coolant(i);
  if (tool === 'cdu') return tools.cdu(i);
  if (tool === 'loop') return tools.loop(i, c.outputs);
  return tools.validator(i, c.outputs, c.outputs);
}
function noteFor(tool: string, f: Fields) {
  if (tool === 'coolant') return String(f.coolantSelection_fluid);
  if (tool === 'cdu')
    return `${f.cduSizing_units} × ${f.cduSizing_model} (${f.cduSizing_dutyUnits} duty)`;
  if (tool === 'loop')
    return `${f.loopConfiguration_supplyC} → ${f.loopConfiguration_returnC} °C · ${f.loopConfiguration_rackFlowLpm} L/min/rack`;
  return String(f.systemCheck_result);
}
function outputsOf(def: ProcessDefinition, out: Fields) {
  return def.tasks
    .flatMap((t) => t.expectedFields)
    .filter((f) => out[f.id] !== undefined)
    .map((f) => ({
      field: f.id,
      label: f.name,
      value: fmt(out[f.id], f.unit === '%' ? '%' : f.unit),
    }));
}
const labels: Record<keyof ChainInputs, string> = {
  itLoadKw: 'IT load',
  facilityWaterC: 'facility water',
  rackCount: 'racks',
  redundancy: 'redundancy',
  coolant: 'coolant',
};
const label = (k: keyof ChainInputs) => labels[k];
const DEPENDS: Record<keyof ChainInputs, string[]> = {
  coolant: ['coolant', 'loop', 'check'],
  itLoadKw: ['units', 'loop', 'check'],
  redundancy: ['units', 'check'],
  facilityWaterC: ['loop', 'check'],
  rackCount: ['loop', 'check'],
};
function affected(changed: (keyof ChainInputs)[]) {
  const all = ['coolant', 'units', 'loop', 'check'];
  const hit = new Set(changed.flatMap((k) => DEPENDS[k]));
  return all.filter((s) => hit.has(s));
}
