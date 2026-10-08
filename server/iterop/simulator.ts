import type { Source } from '../../shared/types';
import { definition, definitions, type TaskDefinition, type VariableDefinition } from './chain';
import { completeTaskRequest, startProcessRequest } from './drive';

/** An FD04-documented HTTP outcome other than success. */
export class EngineError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * What the orchestrator needs from a process engine. Every method mirrors one FD04 operation and
 * returns its documented response body (or `{ status }` where FD04 documents no body).
 */
type Awaitable<T> = T | Promise<T>;
export interface ProcessEngine {
  readonly source: Source;
  getAllStartableProcesses(): Awaitable<unknown>;
  getBasicProcessInfo(processKey: string): Awaitable<unknown>;
  getTasksByUser(): Awaitable<unknown>;
  getTaskInstanceInformations(taskId: string): Awaitable<unknown>;
  getInstanceInfo(instanceId: string): Awaitable<unknown>;
  startProcess(processKey: string, body: unknown): Awaitable<{ status: 201 }>;
  completeTask(taskId: string, body: unknown): Awaitable<{ status: 200 }>;
}

type Instance = {
  id: string;
  key: string;
  identificator: string;
  variables: Map<string, { def: VariableDefinition; value: unknown }>;
  completed: boolean;
};
type Task = {
  id: string;
  instanceId: string;
  def: TaskDefinition;
  startDate: number;
  open: boolean;
};

const MAX_INSTANCES = 200;

function coerce(def: VariableDefinition, raw: unknown): unknown {
  if (raw === undefined || raw === null || raw === '') {
    if (def.defaultValue !== undefined) return def.defaultValue;
    if (def.required) throw new EngineError(400, `Bad request. ${def.id} is required.`);
    return undefined;
  }
  if (def.type === 'INTEGER' || def.type === 'DECIMAL') {
    const n = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isFinite(n) || (def.type === 'INTEGER' && !Number.isInteger(n)))
      throw new EngineError(400, `Bad request. ${def.id} must be a number.`);
    if ((def.min && n < Number(def.min)) || (def.max && n > Number(def.max)))
      throw new EngineError(400, `Bad request. ${def.id} is outside ${def.min}–${def.max}.`);
    return n;
  }
  const text = String(raw);
  if (def.type === 'SELECT' && def.values && !def.values.split('##').includes(text))
    throw new EngineError(
      400,
      `Bad request. ${def.id} must be one of ${def.values.replaceAll('##', ', ')}.`,
    );
  if (def.max && (def.type === 'TEXT' || def.type === 'TEXT_AREA') && text.length > Number(def.max))
    throw new EngineError(400, `Bad request. ${def.id} is too long.`);
  if (def.min && def.type === 'TEXT_AREA' && text.length < Number(def.min))
    throw new EngineError(400, `Bad request. ${def.id} is too short.`);
  return text.slice(0, 4000);
}
const wire = (def: VariableDefinition) => ({
  id: def.id,
  name: def.name,
  description: def.description,
  type: def.type,
  required: def.required,
  ...(def.values ? { values: def.values } : {}),
  ...(def.defaultValue ? { defaultValue: def.defaultValue } : {}),
  ...(def.min ? { min: def.min } : {}),
  ...(def.max ? { max: def.max } : {}),
});

/**
 * In-memory SYNTHETIC process engine. Nothing leaves the process. One engine per workspace
 * session; it forgets everything when the server restarts.
 */
export class SyntheticEngine implements ProcessEngine {
  readonly source = 'synthetic' as const;
  private instances = new Map<string, Instance>();
  private tasks = new Map<string, Task>();
  private seq = 0;
  private clock: () => number;
  constructor(clock: () => number = Date.now) {
    this.clock = clock;
  }

  getAllStartableProcesses() {
    return { responses: definitions.map(({ key, name, version }) => ({ key, name, version })) };
  }
  getBasicProcessInfo(processKey: string) {
    const d = definition(processKey);
    if (!d) throw new EngineError(404, 'Process unknown. Check the provided process key.');
    const { key, name, description, version, icon } = d;
    return { key, name, description, version, icon };
  }
  getTasksByUser() {
    return [...this.tasks.values()]
      .filter((t) => t.open && t.def.assignee === 'self')
      .map((t) => this.basic(t));
  }
  getTaskInstanceInformations(taskId: string) {
    const t = this.tasks.get(taskId);
    if (!t || !t.open) throw new EngineError(404, 'Task not found or already completed.');
    const i = this.instances.get(t.instanceId)!;
    return {
      ...this.basic(t),
      providedData: [...i.variables.values()].map(({ def, value }) => ({
        id: def.id,
        name: def.name,
        type: def.type,
        value,
      })),
      expectedFields: t.def.expectedFields.map(wire),
    };
  }
  getInstanceInfo(instanceId: string) {
    const i = this.instances.get(instanceId);
    if (!i || i.completed)
      throw new EngineError(404, 'Process instance not found or already completed.');
    return {
      id: i.id,
      identificator: i.identificator,
      variables: [...i.variables.values()].map(({ def, value }) => ({
        id: def.id,
        name: def.name,
        type: def.type,
        value,
      })),
    };
  }
  startProcess(processKey: string, body: unknown) {
    const d = definition(processKey);
    if (!d) throw new EngineError(404, 'Process unknown. Check provided processKey.');
    const parsed = startProcessRequest.safeParse(body);
    if (!parsed.success) throw new EngineError(400, 'Bad request.');
    if (parsed.data.user)
      throw new EngineError(400, 'Only robot can use this API / Invalid email id');
    if (this.instances.size >= MAX_INSTANCES)
      throw new EngineError(400, 'Bad request. The synthetic engine holds too many instances.');
    const variables = new Map<string, { def: VariableDefinition; value: unknown }>();
    for (const def of d.startVariables) {
      const value = coerce(def, parsed.data.data?.[def.id]);
      if (value !== undefined) variables.set(def.id, { def, value });
    }
    const id = String(7_000_000_000_000_000 + ++this.seq);
    const instance: Instance = {
      id,
      key: d.key,
      identificator: (parsed.data.identificator || `${d.identificatorPrefix}-${this.seq}`).slice(
        0,
        200,
      ),
      variables,
      completed: false,
    };
    this.instances.set(id, instance);
    this.open(instance, d.tasks[0]);
    return { status: 201 as const };
  }
  completeTask(taskId: string, body: unknown) {
    const t = this.tasks.get(taskId);
    if (!t || !t.open) throw new EngineError(404, 'Task not found or already completed.');
    if (t.def.signature) throw new EngineError(403, 'Task need to be signed (only doable via ui).');
    if (t.def.assignee !== 'self')
      throw new EngineError(404, 'Task not found or already completed.');
    const parsed = completeTaskRequest.safeParse(body);
    if (!parsed.success || parsed.data.user) throw new EngineError(400, 'Bad request.');
    this.record(t, parsed.data.data ?? {});
    return { status: 200 as const };
  }

  /**
   * SIMULATED human action in the process application (the reviewer signs). Not an FD04 REST
   * operation and never available to the orchestrator: the workspace exposes it separately so the
   * hand-back from the process to NOVA can be demonstrated.
   */
  signAsReviewer(taskId: string, decision: string, comment = '') {
    const t = this.tasks.get(taskId);
    if (!t || !t.open || !t.def.signature)
      throw new EngineError(404, 'Task not found or already completed.');
    const decisionField = t.def.expectedFields[0];
    const data: Record<string, unknown> = { [decisionField.id]: decision };
    const commentField = t.def.expectedFields.find((f) => f.id.endsWith('_comment'));
    if (commentField && comment) data[commentField.id] = comment;
    this.record(t, data);
  }
  /** Open tasks awaiting a reviewer signature (simulated process-app view). */
  reviewerQueue() {
    return [...this.tasks.values()]
      .filter((t) => t.open && t.def.signature)
      .map((t) => ({
        ...this.basic(t),
        decisions: t.def.expectedFields[0].values?.split('##') ?? [],
      }));
  }

  private basic(t: Task) {
    const i = this.instances.get(t.instanceId)!;
    const d = definition(i.key)!;
    return {
      id: t.id,
      name: t.def.name,
      description: t.def.description,
      priority: t.def.priority,
      startDate: t.startDate,
      process: { identificator: i.identificator, instanceId: i.id, name: d.name },
    };
  }
  private open(instance: Instance, def: TaskDefinition) {
    const id = `syn-${instance.id.slice(-4)}-${def.id}-${++this.seq}`;
    this.tasks.set(id, { id, instanceId: instance.id, def, startDate: this.clock(), open: true });
  }
  private record(t: Task, data: Record<string, unknown>) {
    const i = this.instances.get(t.instanceId)!;
    const d = definition(i.key)!;
    const values = new Map<string, unknown>();
    for (const def of t.def.expectedFields) values.set(def.id, coerce(def, data[def.id]));
    for (const key of Object.keys(data))
      if (!t.def.expectedFields.some((f) => f.id === key))
        throw new EngineError(400, `Bad request. ${key} is not a field of this task.`);
    for (const def of t.def.expectedFields) {
      const value = values.get(def.id);
      if (value !== undefined) i.variables.set(def.id, { def, value });
    }
    t.open = false;
    if (t.def.signature) {
      const decision = String(values.get(t.def.expectedFields[0].id));
      if (/^(reject)$/i.test(decision) && d.rework) return this.open(i, d.rework);
      i.completed = true;
      return;
    }
    if (d.rework && t.def.id === d.rework.id) {
      // Revised inputs replace the start values, then the chain runs again from its first task.
      const map: Record<string, string> = {
        configurationRework_coolant: 'start_coolant',
        configurationRework_redundancy: 'start_redundancy',
        configurationRework_facilityWaterC: 'start_facilityWaterC',
      };
      for (const [from, to] of Object.entries(map)) {
        const startDef = d.startVariables.find((s) => s.id === to)!;
        i.variables.set(to, { def: startDef, value: values.get(from) });
      }
      return this.open(i, d.tasks[0]);
    }
    const next = d.tasks[d.tasks.findIndex((x) => x.id === t.def.id) + 1];
    if (next) this.open(i, next);
    else i.completed = true;
  }
}
