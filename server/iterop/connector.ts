import fixture from '../../docs/blueprint/benchmarks/fixtures/synthetic-iterop.json';
import type { Coverage, Evidence, Source } from '../../shared/types';
import { GatewayError, atPath, boundedGetJson } from '../http';
import type { IteropConfig } from './config';
import type { BasicProcessInfo, StartableProcessesList, TaskInstanceBasic } from './fd04';
import { operation, type OperationSpec } from './operations';

export type IteropArgs = { processKey?: string };
export type IteropResult = { records: Evidence[]; coverage: Coverage; spec: OperationSpec };
type Scalar = string | number | boolean;
export type StartDateUnit = 'ms' | 's' | 'unverified';

export const PROCESS_KEY = /^[A-Za-z0-9_.:-]{1,200}$/;
const MAX_ROWS = 100;
const day = 86_400_000;

/**
 * Synthetic responses in the exact FD04 shapes. Fixture-only controls (startable, visible,
 * assignee, startOffsetDays) never appear in a response. Synthetic startDate is epoch milliseconds.
 */
export function syntheticResponse(spec: OperationSpec, args: IteropArgs): unknown {
  switch (spec.name) {
    case 'iterop.list_startable_processes':
      return {
        responses: fixture.processes
          .filter((p) => p.startable)
          .map(({ key, name, version }) => ({ key, name, version })),
      } satisfies StartableProcessesList;
    case 'iterop.list_my_tasks':
      return fixture.tasks
        .filter((t) => t.assignee === 'self')
        .map(({ id, name, description, priority, startOffsetDays, process }) => ({
          id,
          name,
          description,
          priority,
          startDate: Date.now() + startOffsetDays * day,
          process,
        })) satisfies TaskInstanceBasic[];
    case 'iterop.get_process_summary': {
      const found = fixture.processes.find(
        (p) => p.key === args.processKey && (p as { visible?: boolean }).visible !== false,
      );
      // FD04 documents 404 "Process unknown" for a key that cannot be read.
      if (!found)
        throw new GatewayError('NOT_FOUND', 'Process unknown. Check the provided process key.');
      const { key, name, description, version, icon } = found;
      return { key, name, description, version, icon } satisfies BasicProcessInfo;
    }
  }
}

/** FD04 validation, then allowlisted projection. Identical for synthetic and live bodies. */
export function project(
  spec: OperationSpec,
  body: unknown,
  source: Source,
  startDateUnit: StartDateUnit,
): { records: Evidence[]; coverage: Coverage } {
  const parsed = spec.response.safeParse(body);
  if (!parsed.success)
    throw new GatewayError(
      'SCHEMA_MISMATCH',
      `The response does not match the ${spec.operationId} schema (R2026x-FD04).`,
    );
  const rows =
    spec.rows.kind === 'property'
      ? (atPath(parsed.data, spec.rows.property) ?? [])
      : spec.rows.kind === 'array'
        ? parsed.data
        : [parsed.data];
  const all = rows as unknown[];
  const retrievedAt = new Date().toISOString();
  const records = all.slice(0, MAX_ROWS).map((row) => {
    const fields: Record<string, Scalar> = {};
    for (const [key, path] of Object.entries(spec.mapping)) {
      const value = atPath(row, path);
      if (typeof value === 'string') fields[key] = value.slice(0, 4000);
      else if (typeof value === 'number' && Number.isFinite(value)) fields[key] = value;
    }
    // Derived only when the unit is known: synthetic data, or a live unit proven and recorded.
    if (typeof fields.startDate === 'number' && startDateUnit !== 'unverified')
      fields.startedAt = new Date(
        startDateUnit === 'ms' ? fields.startDate : fields.startDate * 1000,
      ).toISOString();
    if (spec.required.some((f) => fields[f] === undefined || fields[f] === ''))
      throw new GatewayError(
        'SCHEMA_MISMATCH',
        `A ${spec.operationId} record lacks ${spec.required.join(' or ')}; NOVA cannot cite it.`,
      );
    return {
      id: String(fields.id),
      title: String(fields.name),
      kind: spec.recordKind,
      source,
      fields,
      retrievedAt,
    } satisfies Evidence;
  });
  // FD04 documents these operations as returning all matching records (no paging fields).
  return { records, coverage: all.length > MAX_ROWS ? 'partial' : 'complete' };
}

export class IteropConnector {
  constructor(
    public config: IteropConfig,
    private request: typeof fetch = fetch,
  ) {}
  async call(name: string, args: IteropArgs, source: Source): Promise<IteropResult> {
    const spec = operation(name);
    if (!spec)
      throw new GatewayError(
        'UNKNOWN_OPERATION',
        'This operation is not in the ITEROP read inventory.',
      );
    if (spec.shape === 'detail' && !args.processKey)
      throw new GatewayError('MISSING_ID', 'A process key is required.');
    if (args.processKey !== undefined && !PROCESS_KEY.test(args.processKey))
      throw new GatewayError('INVALID_ID', 'The process key is not valid for this adapter.');
    if (source === 'synthetic')
      return { ...project(spec, syntheticResponse(spec, args), 'synthetic', 'ms'), spec };
    return this.live(spec, args);
  }
  /** Fully assembled request URL for a bound operation. Exported for tests and diagnostics. */
  url(spec: OperationSpec, args: IteropArgs): URL {
    const path = `${this.config.contract?.basePath || ''}${spec.path.replace('{processKey}', encodeURIComponent(args.processKey || ''))}`;
    const url = new URL(path, this.config.origin);
    if (url.origin !== this.config.origin)
      throw new GatewayError(
        'ORIGIN_BLOCKED',
        'The operation is outside the configured service origin.',
      );
    for (const forbidden of spec.forbiddenQuery)
      if (url.searchParams.has(forbidden))
        throw new GatewayError('SCOPE_BLOCKED', `The ${forbidden} parameter is never sent.`);
    return url;
  }
  private async live(spec: OperationSpec, args: IteropArgs): Promise<IteropResult> {
    if (this.config.blockers.length)
      throw new GatewayError(
        'NOT_CONFIGURED',
        'Live ITEROP access is blocked. Complete its private connection checklist.',
      );
    const contract = this.config.contract;
    const binding = contract?.operations[spec.name];
    if (!contract || !binding)
      throw new GatewayError(
        'UNVERIFIED_OPERATION',
        'This operation has no reviewed contract for the configured release.',
      );
    if (binding.method !== 'GET' || !binding.readOnly || binding.operationId !== spec.operationId)
      throw new GatewayError('WRITE_BLOCKED', 'Only the reviewed read operations are supported.');
    const headers: Record<string, string> = { Authorization: this.config.authorization! };
    if (contract.securityContext === 'REQUIRED')
      headers.SecurityContext = this.config.securityContext!;
    const body = await boundedGetJson(
      this.request,
      this.url(spec, args),
      headers,
      'business process service',
    );
    return { ...project(spec, body, 'live', contract.taskStartDateUnit), spec };
  }
}
