import { existsSync, readFileSync } from 'node:fs';
import { z } from 'zod';
import {
  COOLING_CHAIN,
  REQUIREMENT_INTAKE,
  definition,
  definitions,
  sameTask,
  taskName,
} from './chain';
import {
  completeTaskRequest,
  instanceInfoResponse,
  labOperations,
  processInfoResponse,
  startProcessRequest,
  taskInstanceResponse,
  type LabOperationId,
} from './drive';
import { basicProcessInfo, startableProcessesList, tasksByUser } from './fd04';
import type { ProcessDefinition } from './chain';
import { SPEC } from './operations';
import { EngineError, type ProcessEngine } from './simulator';

/**
 * LIVE engine for the orchestration lab: the documented R2026x-FD04 route through the cloud
 * API Gateway (`{APIGateway}/api/businessprocess/v2`), authenticated by an application API key
 * plus an Openness Agent (HTTP Basic), then the gateway's session cookies.
 *
 * Admission needs a private sandbox contract. It names the tenant class, the synthetic-only data
 * rule, the reviewed spec and the tenant process keys of the two lab processes. Only the lab
 * operations exist here. Writes are limited to those process keys. `user` and `login` are never
 * sent. The orchestrator still stops before every write for the operator's approval.
 */
const labKeys = definitions.map((d) => d.key) as [string, ...string[]];
const tenantKey = z.string().regex(/^[A-Za-z][A-Za-z0-9_.:-]{0,199}$/);

export const labContractSchema = z
  .object({
    schemaVersion: z.literal(1),
    purpose: z.literal('NOVA_ORCHESTRATION_LAB'),
    tenantClass: z.literal('SANDBOX'),
    dataPolicy: z.literal('SYNTHETIC_ONLY'),
    specRelease: z.literal(SPEC.release),
    specSha256: z.literal(SPEC.sha256),
    apiVersion: z.literal(SPEC.apiVersion),
    /** FD04 server template `{APIGateway}/api/businessprocess/v2`, confirmed on the API card. */
    gatewayBasePath: z.literal('/api/businessprocess/v2'),
    /** Optional lab field id → tenant variable id, for ids the naming rule cannot derive. */
    variableIds: z
      .record(
        z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,99}$/),
        z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,199}$/),
      )
      .default({}),
    /** Lab process key → key the tenant gave the imported model. */
    processKeys: z
      .object({ [COOLING_CHAIN]: tenantKey, [REQUIREMENT_INTAKE]: tenantKey.optional() })
      .strict(),
    driveApproval: z
      .object({
        approvedBy: z.string().min(1),
        approvedOn: z.iso.date(),
        operations: z.array(z.enum(['startProcess', 'completeTask'])).min(1),
      })
      .strict(),
    reviewedBy: z.string().min(1),
    verifiedAt: z.iso.date(),
  })
  .strict();
export type LabContract = z.infer<typeof labContractSchema>;

export type LabLiveConfig = {
  origin?: string;
  apiKey?: string;
  agent?: string;
  contract?: LabContract;
  blockers: string[];
};

export function loadLabLiveConfig(env: NodeJS.ProcessEnv = process.env): LabLiveConfig {
  const v = (name: string) => env[`NOVA_LAB_${name}`] || undefined;
  const blockers: string[] = [];
  let origin: string | undefined;
  if (v('GATEWAY_ORIGIN')) {
    try {
      const u = new URL(v('GATEWAY_ORIGIN')!);
      if (
        u.protocol !== 'https:' ||
        u.username ||
        u.password ||
        u.pathname !== '/' ||
        u.search ||
        u.hash
      )
        throw new Error();
      origin = u.origin;
    } catch {
      blockers.push(
        'The API Gateway origin must be an HTTPS origin without a path or credentials.',
      );
    }
  } else blockers.push('Set NOVA_LAB_GATEWAY_ORIGIN to the sandbox API Gateway origin.');
  const apiKey = v('API_KEY');
  if (!apiKey) blockers.push('Set NOVA_LAB_API_KEY (the API Gateway application key).');
  let agent: string | undefined;
  if (v('AGENT_ID') && v('AGENT_SECRET'))
    agent = Buffer.from(`${v('AGENT_ID')}:${v('AGENT_SECRET')}`).toString('base64');
  else blockers.push('Set NOVA_LAB_AGENT_ID and NOVA_LAB_AGENT_SECRET (the Openness Agent).');
  if ([apiKey, v('AGENT_ID'), v('AGENT_SECRET')].some((x) => x && /[\r\n]/.test(x))) {
    agent = undefined;
    blockers.push('Invalid private header configuration.');
  }
  let contract: LabContract | undefined;
  const file = v('CONTRACT_FILE');
  if (file && existsSync(file)) {
    try {
      contract = labContractSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
      if (new Date(contract.verifiedAt).getTime() > Date.now()) throw new Error();
    } catch {
      contract = undefined;
      blockers.push(
        'Lab contract rejected: check sandbox class, synthetic-only data rule, spec binding, process keys and approval.',
      );
    }
  } else blockers.push('Install the reviewed lab contract (NOVA_LAB_CONTRACT_FILE).');
  return { origin, apiKey, agent, contract, blockers };
}

export const labLiveStatus = (c: LabLiveConfig) => ({
  ready: c.blockers.length === 0,
  blockers: c.blockers,
  drive: c.contract?.driveApproval.operations ?? [],
  /** Presence only — never a key, secret or agent id. */
  settings: {
    gateway: c.origin ? new URL(c.origin).host : null,
    apiKey: Boolean(c.apiKey),
    agent: Boolean(c.agent),
    contract: Boolean(c.contract),
    processes: c.contract
      ? Object.entries(c.contract.processKeys)
          .filter(([, v]) => v)
          .map(([k]) => k)
      : [],
  },
});

const MAX_BYTES = 1_000_000;

/**
 * Bounded JSON transport to one fixed gateway origin. No redirects (a redirect means the session
 * is not accepted), 15-second timeout, 1 MB cap, all gateway cookies echoed back, Basic only until
 * a session exists and once more if the session expires.
 */
export class GatewayHttp {
  private cookies = new Map<string, string>();
  constructor(
    private config: Required<Pick<LabLiveConfig, 'origin' | 'apiKey' | 'agent'>> & {
      basePath: string;
    },
    private request: typeof fetch = fetch,
  ) {}

  async call(
    op: LabOperationId,
    params: Record<string, string>,
    body?: unknown,
    retried = false,
  ): Promise<unknown> {
    const spec = labOperations[op];
    let path: string = spec.path;
    for (const [k, value] of Object.entries(params))
      path = path.replace(`{${k}}`, encodeURIComponent(value));
    if (/[{}]/.test(path)) throw new EngineError(400, 'Missing path parameter.');
    const url = new URL(`${this.config.basePath}${path}`, this.config.origin);
    if (url.origin !== this.config.origin)
      throw new EngineError(400, 'Outside the configured gateway.');
    const headers: Record<string, string> = {
      APIKey: this.config.apiKey,
      Accept: 'application/json',
    };
    if (!this.cookies.size) headers.Authorization = `Basic ${this.config.agent}`;
    else headers.Cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    let response: Response;
    try {
      response = await this.request(url, {
        method: spec.method,
        redirect: 'manual',
        signal: AbortSignal.timeout(15_000),
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch {
      throw new EngineError(503, 'The API Gateway could not be reached. Nothing was retried.');
    }
    for (const c of response.headers.getSetCookie?.() ?? []) {
      const [pair] = c.split(';');
      const i = pair.indexOf('=');
      if (i > 0) this.cookies.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
    }
    if (response.status >= 300 && response.status < 400)
      throw new EngineError(
        401,
        'The gateway redirected to a sign-in page: the agent session was not accepted.',
      );
    if (response.status === 401 && !retried && headers.Cookie) {
      // Session expired: authenticate once more with the agent, never more.
      this.cookies.clear();
      return this.call(op, params, body, true);
    }
    const text = await readBounded(response);
    if (!response.ok) {
      let message = `HTTP ${response.status}`;
      try {
        const parsed = JSON.parse(text) as { message?: unknown; detail?: unknown; type?: unknown };
        const m = parsed.message ?? parsed.detail ?? parsed.type;
        if (typeof m === 'string') message = m.slice(0, 300);
      } catch {
        /* non-JSON error body: keep the status only */
      }
      throw new EngineError(response.status, message);
    }
    if (!text.trim()) return undefined;
    if (!response.headers.get('content-type')?.includes('json'))
      throw new EngineError(502, 'Expected the documented JSON response.');
    try {
      return JSON.parse(text);
    } catch {
      throw new EngineError(502, 'The gateway returned invalid JSON.');
    }
  }
}

async function readBounded(response: Response) {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > MAX_BYTES) {
      await reader.cancel();
      throw new EngineError(502, 'The gateway response exceeded the one-megabyte limit.');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

const check = <T>(schema: z.ZodType<T>, body: unknown, op: string): T => {
  const parsed = schema.safeParse(body);
  if (!parsed.success)
    throw new EngineError(502, `The response does not match the ${op} schema (R2026x-FD04).`);
  return parsed.data;
};

type ProcessInfo = z.infer<typeof processInfoResponse>;
type VariableMap = {
  toTenant: Map<string, string>;
  toLab: Map<string, string>;
  source: 'definition' | 'derived';
};
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const generatedPart = (tenantId: string) => norm(tenantId.slice(tenantId.lastIndexOf('_') + 1));
const fieldPart = (labId: string) => labId.slice(labId.lastIndexOf('_') + 1);
/**
 * The designer generates variable ids as `<element>_<camelCaseName>` (a field named
 * `start_itLoadKw` on "Operating envelope" becomes `operatingEnvelope_startItloadkw`). A tenant id
 * matches a lab id when its generated part equals the lab id, or the lab id's own field part,
 * ignoring case and punctuation.
 */
export const matchesField = (tenantId: string, labId: string) => {
  if (tenantId === labId) return true;
  const generated = generatedPart(tenantId);
  return generated !== '' && (generated === norm(labId) || generated === norm(fieldPart(labId)));
};
/** One unambiguous match: the full lab id first, then the field part alone. */
function pick<T>(items: T[], full: (x: T) => boolean, partial: (x: T) => boolean) {
  const f = items.filter(full);
  if (f.length === 1) return f[0];
  const p = items.filter(partial);
  return p.length === 1 ? p[0] : undefined;
}
export const tenantIdFor = (labId: string, tenantIds: string[]) =>
  pick(
    tenantIds,
    (t) => t === labId || generatedPart(t) === norm(labId),
    (t) => generatedPart(t) === norm(fieldPart(labId)),
  );
export const labIdFor = (tenantId: string, labIds: string[]) =>
  pick(
    labIds,
    (l) => l === tenantId || generatedPart(tenantId) === norm(l),
    (l) => generatedPart(tenantId) === norm(fieldPart(l)),
  );
/** The designer's camel-casing, observed on the tenant: element ids are cut at 26 characters. */
export const camelId = (name: string, max = 200) =>
  name
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w, i) => (i === 0 ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1).toLowerCase()))
    .join('')
    .slice(0, max);
export const derivedVariableId = (element: string, field: string) =>
  `${camelId(element, 26)}_${camelId(field)}`;
const allLabFields = (d: ProcessDefinition) => [
  ...d.startVariables.map((v) => v.id),
  ...[...d.tasks, ...(d.rework ? [d.rework] : [])].flatMap((t) =>
    t.expectedFields.map((f) => f.id),
  ),
];

/** Resolve every lab field of one process to the id the tenant model declares, task by task. */
export function resolveVariables(def: ProcessDefinition, info: ProcessInfo) {
  const toTenant = new Map<string, string>();
  const missing: { scope: string; ids: string[] }[] = [];
  const taskOutputIds = new Set<string>();
  for (const t of [...def.tasks, ...(def.rework ? [def.rework] : [])]) {
    const human = info.humanTasks?.find((h) => sameTask(h.name, t.name));
    const ids = (human?.outputs ?? []).map((o) => o.id).filter((x): x is string => Boolean(x));
    ids.forEach((x) => taskOutputIds.add(x));
    const absent: string[] = [];
    for (const f of t.expectedFields) {
      const found = tenantIdFor(f.id, ids);
      if (found) toTenant.set(f.id, found);
      else if (f.required) absent.push(f.id);
    }
    if (!human) missing.push({ scope: t.name, ids: ['(task not found)'] });
    else if (absent.length) missing.push({ scope: t.name, ids: absent });
  }
  const startCandidates = Object.keys(info.variables ?? {}).filter((x) => !taskOutputIds.has(x));
  const absentStart: string[] = [];
  for (const v of def.startVariables) {
    const found = tenantIdFor(v.id, startCandidates);
    if (found) toTenant.set(v.id, found);
    else if (v.required) absentStart.push(v.id);
  }
  if (absentStart.length) missing.push({ scope: 'start form', ids: absentStart });
  return { toTenant, missing };
}

export class LiveEngine implements ProcessEngine {
  readonly source = 'live' as const;
  private toTenant: Map<string, string>;
  private toLab: Map<string, string>;
  private variables?: Promise<VariableMap>;
  constructor(
    private contract: LabContract,
    private http: GatewayHttp,
  ) {
    const pairs = Object.entries(contract.processKeys).filter((e): e is [string, string] =>
      Boolean(e[1]),
    );
    this.toTenant = new Map(pairs);
    this.toLab = new Map(pairs.map(([a, b]) => [b, a]));
  }
  admits(labKey: string) {
    return this.toTenant.has(labKey);
  }
  /** Re-read the deployed models (after a redeploy, or before a connection test). */
  refreshVariables() {
    this.variables = undefined;
  }
  /**
   * Start-form ids: from the deployed definition when this account may read it (getProcessInfo),
   * otherwise derived from the designer's naming rule. Contract overrides win in both cases.
   */
  private async variableMap(): Promise<VariableMap & { source: 'definition' | 'derived' }> {
    this.variables ??= (async () => {
      const toTenant = new Map<string, string>();
      let source: 'definition' | 'derived' = 'definition';
      for (const d of definitions) {
        if (!this.admits(d.key)) continue;
        try {
          for (const [a, b] of resolveVariables(d, await this.getProcessInfo(d.key)).toTenant)
            toTenant.set(a, b);
        } catch (e) {
          if (!(e instanceof EngineError) || e.status !== 403) throw e;
          // Run-only accounts may not read the design definition: derive the start-form ids.
          source = 'derived';
          for (const v of d.startVariables)
            toTenant.set(v.id, derivedVariableId(d.startElement, v.id));
        }
      }
      for (const [a, b] of Object.entries(this.contract.variableIds)) toTenant.set(a, b);
      return { toTenant, toLab: new Map([...toTenant].map(([a, b]) => [b, a])), source };
    })().catch((e) => {
      this.variables = undefined;
      throw e;
    });
    return this.variables;
  }
  async variableSource() {
    const m = await this.variableMap();
    return { source: m.source, start: [...m.toTenant] };
  }
  private async labIds<T extends { id?: string }>(items: T[] | undefined) {
    const { toLab } = await this.variableMap();
    const labs = definitions.filter((d) => this.admits(d.key)).flatMap(allLabFields);
    return items?.map((i) => ({
      ...i,
      id: (i.id && (toLab.get(i.id) ?? labIdFor(i.id, labs))) ?? i.id,
    }));
  }
  private tenantData(
    data: Record<string, unknown>,
    resolve: (labId: string) => string | undefined,
    required: Set<string>,
  ) {
    const out: Record<string, unknown> = {};
    const unknown: string[] = [];
    for (const [k, v] of Object.entries(data)) {
      const id = resolve(k);
      if (id) out[id] = v;
      else if (required.has(k)) unknown.push(k);
    }
    if (unknown.length)
      throw new EngineError(
        400,
        `The tenant model declares no field for ${unknown.join(', ')}. Check the field names in the designer.`,
      );
    return out;
  }
  private async rawTask(taskId: string) {
    return check(
      taskInstanceResponse,
      await this.http.call('getTaskInstanceInformations', { taskId: taskIdOf(taskId) }),
      'getTaskInstanceInformations',
    );
  }
  private tenant(labKey: string) {
    const key = this.toTenant.get(labKey);
    if (!key) throw new EngineError(403, 'That process is not admitted by the lab contract.');
    return key;
  }
  private allowed(op: 'startProcess' | 'completeTask') {
    if (!this.contract.driveApproval.operations.includes(op))
      throw new EngineError(403, `${op} is not approved in the lab contract.`);
  }

  async getAllStartableProcesses() {
    const body = check(
      startableProcessesList,
      await this.http.call('getAllStartableProcesses', {}),
      'getAllStartableProcesses',
    );
    // Lab processes are shown under their lab key; nothing else is relabelled.
    return {
      responses: (body.responses ?? []).map((p) => ({
        ...p,
        key: (p.key && this.toLab.get(p.key)) ?? p.key,
      })),
    };
  }
  async getBasicProcessInfo(labKey: string) {
    const body = check(
      basicProcessInfo,
      await this.http.call('getBasicProcessInfo', { processKey: this.tenant(labKey) }),
      'getBasicProcessInfo',
    );
    return { ...body, key: labKey };
  }
  async getProcessInfo(labKey: string) {
    return check(
      processInfoResponse,
      await this.http.call('getProcessInfo', { processKey: this.tenant(labKey) }),
      'getProcessInfo',
    );
  }
  async getTasksByUser() {
    return check(tasksByUser, await this.http.call('getTasksByUser', {}), 'getTasksByUser');
  }
  /** Field ids are returned under NOVA's lab ids, so the orchestrator never sees tenant ids. */
  async getTaskInstanceInformations(taskId: string) {
    const body = await this.rawTask(taskId);
    return {
      ...body,
      expectedFields: await this.labIds(body.expectedFields),
      providedData: await this.labIds(body.providedData),
    };
  }
  async getInstanceInfo(instanceId: string) {
    const body = check(
      instanceInfoResponse,
      await this.http.call('getInstanceInfo', { instanceId: taskIdOf(instanceId) }),
      'getInstanceInfo',
    );
    return { ...body, variables: await this.labIds(body.variables) };
  }
  async startProcess(labKey: string, body: unknown) {
    this.allowed('startProcess');
    const parsed = startProcessRequest.safeParse(body);
    if (!parsed.success || parsed.data.user !== undefined)
      throw new EngineError(400, 'NOVA never sends user.');
    const def = definition(labKey);
    const allowedVars = new Set(def?.startVariables.map((v) => v.id));
    for (const k of Object.keys(parsed.data.data ?? {}))
      if (!allowedVars.has(k))
        throw new EngineError(400, `${k} is not a start variable of the lab process.`);
    const required = new Set(def?.startVariables.filter((v) => v.required).map((v) => v.id));
    const { toTenant } = await this.variableMap();
    const data = this.tenantData(parsed.data.data ?? {}, (k) => toTenant.get(k), required);
    await this.http.call(
      'startProcess',
      { processKey: this.tenant(labKey) },
      { ...parsed.data, data },
    );
    return { status: 201 as const };
  }
  async completeTask(taskId: string, body: unknown) {
    this.allowed('completeTask');
    const parsed = completeTaskRequest.safeParse(body);
    if (!parsed.success || parsed.data.user !== undefined)
      throw new EngineError(400, 'NOVA never sends user.');
    // Only tasks of an admitted lab process, re-read from the platform just before the write.
    const info = await this.rawTask(taskId);
    const known = new Set(
      definitions
        .flatMap((d) => [...d.tasks, ...(d.rework ? [d.rework] : [])])
        .map((t) => taskName(t.name)),
    );
    if (!info.name || !known.has(taskName(info.name)))
      throw new EngineError(403, 'That task does not belong to a lab process.');
    const required = new Set(
      definitions
        .flatMap((d) => [...d.tasks, ...(d.rework ? [d.rework] : [])])
        .filter((t) => sameTask(t.name, info.name))
        .flatMap((t) => t.expectedFields.filter((f) => f.required).map((f) => f.id)),
    );
    // The task's own form names its fields: resolve each lab field against it.
    const formIds = (info.expectedFields ?? [])
      .map((f) => f.id)
      .filter((x): x is string => Boolean(x));
    const override = this.contract.variableIds;
    const data = this.tenantData(
      parsed.data.data ?? {},
      (k) => override[k] ?? tenantIdFor(k, formIds),
      required,
    );
    await this.http.call('completeTask', { taskId: taskIdOf(taskId) }, { ...parsed.data, data });
    return { status: 200 as const };
  }
}

const taskIdOf = (id: string) => {
  if (!/^[A-Za-z0-9_.:-]{1,200}$/.test(id)) throw new EngineError(400, 'Invalid identifier.');
  return id;
};

export function createLiveEngine(config: LabLiveConfig, request: typeof fetch = fetch) {
  if (config.blockers.length || !config.contract) return undefined;
  return new LiveEngine(
    config.contract,
    new GatewayHttp(
      {
        origin: config.origin!,
        apiKey: config.apiKey!,
        agent: config.agent!,
        basePath: config.contract.gatewayBasePath,
      },
      request,
    ),
  );
}

export type ProbeResult = {
  checkedAt: string;
  outcome: 'PASS' | 'PARTIAL' | 'DENIED' | 'FAIL';
  checks: { name: string; ok: boolean; detail: string }[];
};

/**
 * Read-only first live test: can the agent see the lab processes, and does each imported model
 * declare the tasks and output fields NOVA will write? Makes no write.
 */
export async function probeLive(engine: LiveEngine): Promise<ProbeResult> {
  const checks: ProbeResult['checks'] = [];
  const record = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });
  try {
    engine.refreshVariables();
    const list = await engine.getAllStartableProcesses();
    for (const d of definitions) {
      if (!engine.admits(d.key)) continue;
      record(
        `${d.name} is startable`,
        list.responses.some((p) => p.key === d.key),
        list.responses.some((p) => p.key === d.key)
          ? 'getAllStartableProcesses'
          : 'not in the agent’s startable list: deploy it and add the agent’s user as initiator',
      );
      let info: Awaited<ReturnType<LiveEngine['getProcessInfo']>> | undefined;
      try {
        info = await engine.getProcessInfo(d.key);
      } catch (e) {
        if (!(e instanceof EngineError) || e.status !== 403) throw e;
      }
      if (!info) {
        // Run-only account: the design definition is not readable. That is expected least privilege.
        const start = d.startVariables.map((v) => derivedVariableId(d.startElement, v.id));
        record(
          'Process definition',
          true,
          'not readable by this account (run rights only, 403): start-form ids derived from the designer naming rule; each task form is checked before NOVA writes',
        );
        record(`${d.name} start form`, true, `will send ${start.join(', ')}`);
        continue;
      }
      const { toTenant, missing } = resolveVariables(d, info);
      for (const scope of [
        'start form',
        ...[...d.tasks, ...(d.rework ? [d.rework] : [])].map((t) => t.name),
      ]) {
        const m = missing.find((x) => x.scope === scope);
        record(
          scope === 'start form' ? `${d.name} start form` : `“${scope}” is modelled`,
          !m,
          m ? `missing: ${m.ids.join(', ')}` : 'all fields found',
        );
      }
      record('Field mapping', true, `${toTenant.size} lab fields resolved to tenant ids`);
    }
    const tasks = await engine.getTasksByUser();
    record(
      'Agent task list readable',
      true,
      `${tasks.length} open task${tasks.length === 1 ? '' : 's'}`,
    );
  } catch (e) {
    const status = e instanceof EngineError ? e.status : 500;
    record('Gateway call', false, `${status} · ${e instanceof Error ? e.message : 'failed'}`);
    return {
      checkedAt: new Date().toISOString(),
      outcome: status === 401 || status === 403 ? 'DENIED' : 'FAIL',
      checks,
    };
  }
  const ok = checks.every((c) => c.ok);
  return { checkedAt: new Date().toISOString(), outcome: ok ? 'PASS' : 'PARTIAL', checks };
}
