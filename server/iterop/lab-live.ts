import { existsSync, readFileSync } from 'node:fs';
import { z } from 'zod';
import { COOLING_CHAIN, REQUIREMENT_INTAKE, definition, definitions } from './chain';
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

export class LiveEngine implements ProcessEngine {
  readonly source = 'live' as const;
  private toTenant: Map<string, string>;
  private toLab: Map<string, string>;
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
  async getTaskInstanceInformations(taskId: string) {
    return check(
      taskInstanceResponse,
      await this.http.call('getTaskInstanceInformations', { taskId: taskIdOf(taskId) }),
      'getTaskInstanceInformations',
    );
  }
  async getInstanceInfo(instanceId: string) {
    return check(
      instanceInfoResponse,
      await this.http.call('getInstanceInfo', { instanceId: taskIdOf(instanceId) }),
      'getInstanceInfo',
    );
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
    await this.http.call('startProcess', { processKey: this.tenant(labKey) }, parsed.data);
    return { status: 201 as const };
  }
  async completeTask(taskId: string, body: unknown) {
    this.allowed('completeTask');
    const parsed = completeTaskRequest.safeParse(body);
    if (!parsed.success || parsed.data.user !== undefined)
      throw new EngineError(400, 'NOVA never sends user.');
    // Only tasks of an admitted lab process, re-read from the platform just before the write.
    const info = await this.getTaskInstanceInformations(taskId);
    const known = new Set(
      definitions.flatMap((d) => [...d.tasks, ...(d.rework ? [d.rework] : [])]).map((t) => t.name),
    );
    if (!info.name || !known.has(info.name))
      throw new EngineError(403, 'That task does not belong to a lab process.');
    await this.http.call('completeTask', { taskId: taskIdOf(taskId) }, parsed.data);
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
    const list = await engine.getAllStartableProcesses();
    for (const d of definitions) {
      if (!engine.admits(d.key)) continue;
      record(
        `${d.name} is startable`,
        list.responses.some((p) => p.key === d.key),
        'getAllStartableProcesses',
      );
      const info = await engine.getProcessInfo(d.key);
      for (const t of [...d.tasks, ...(d.rework ? [d.rework] : [])]) {
        const task = info.humanTasks?.find((h) => h.name === t.name);
        const outputs = new Set((task?.outputs ?? []).map((o) => o.id));
        const missing = t.expectedFields
          .filter((f) => f.required && !outputs.has(f.id))
          .map((f) => f.id);
        record(
          `“${t.name}” is modelled`,
          Boolean(task) && missing.length === 0,
          !task
            ? 'task not found in getProcessInfo'
            : missing.length
              ? `missing outputs: ${missing.join(', ')}`
              : 'all outputs declared',
        );
      }
      const vars = info.variables ?? {};
      const missingStart = d.startVariables
        .filter((s) => s.required && !(s.id in vars))
        .map((s) => s.id);
      record(
        `${d.name} start form`,
        missingStart.length === 0,
        missingStart.length
          ? `missing: ${missingStart.join(', ')}`
          : 'all start variables declared',
      );
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
