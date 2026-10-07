import fixture from '../../docs/blueprint/benchmarks/fixtures/synthetic-iterop.json';
import type { Coverage, Evidence, Source } from '../../shared/types';
import { GatewayError, atPath, boundedGetJson } from '../http';
import type { IteropConfig } from './config';
import { operation, type OperationSpec } from './operations';

export type IteropArgs = { processKey?: string };
export type IteropResult = { records: Evidence[]; coverage: Coverage; spec: OperationSpec };
type Scalar = string | number | boolean;

const day = 86_400_000;
const dateAt = (offset?: number) =>
  offset === undefined ? undefined : new Date(Date.now() + offset * day).toISOString().slice(0, 10);
const clean = (row: Record<string, Scalar | undefined>) =>
  Object.fromEntries(Object.entries(row).filter(([, v]) => v !== undefined)) as Record<
    string,
    Scalar
  >;
const toEvidence = (
  spec: OperationSpec,
  row: Record<string, Scalar>,
  source: Source,
): Evidence => ({
  id: String(row.id),
  title: String(row.name),
  kind: spec.recordKind,
  source,
  fields: row,
  retrievedAt: new Date().toISOString(),
});
export const PROCESS_KEY = /^[A-Za-z0-9_.:-]{1,200}$/;

/** Synthetic, principal-scoped behaviour: self-only tasks, invisible process denial. */
function synthetic(spec: OperationSpec, args: IteropArgs): Record<string, Scalar>[] {
  const process = (p: (typeof fixture.processes)[number]) =>
    clean({
      id: p.processKey,
      name: p.name,
      description: p.description,
      version: p.version,
      category: p.category,
    });
  switch (spec.name) {
    case 'iterop.list_startable_processes':
      return fixture.processes.filter((p) => p.startable).map(process);
    case 'iterop.list_my_tasks':
      return fixture.tasks
        .filter((t) => t.assignee === 'self' && t.status === 'OPEN')
        .map((t) =>
          clean({
            id: t.taskId,
            name: t.name,
            processKey: t.processKey,
            processName: fixture.processes.find((p) => p.processKey === t.processKey)?.name,
            processInstanceId: t.processInstanceId,
            step: t.step,
            status: t.status,
            priority: t.priority,
            dueDate: dateAt(t.dueOffsetDays),
            createdAt: dateAt(t.createdOffsetDays),
          }),
        );
    case 'iterop.get_process_summary': {
      const found = fixture.processes.find((p) => p.processKey === args.processKey);
      if (!found) throw new GatewayError('NOT_FOUND', 'No process has that key.');
      if ((found as { visible?: boolean }).visible === false)
        throw new GatewayError(
          'AUTHORIZATION_DENIED',
          'The business process service denied access to this process for the current principal.',
        );
      return [process(found)];
    }
  }
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
      return {
        records: synthetic(spec, args).map((r) => toEvidence(spec, r, 'synthetic')),
        coverage: 'complete',
        spec,
      };
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
    const binding = this.config.contract?.operations[spec.name];
    if (!binding)
      throw new GatewayError(
        'UNVERIFIED_OPERATION',
        'This operation has no reviewed contract for the configured release.',
      );
    if (binding.method !== 'GET' || !binding.readOnly || binding.operationId !== spec.operationId)
      throw new GatewayError('WRITE_BLOCKED', 'Only the reviewed read operations are supported.');
    const headers: Record<string, string> = { Authorization: this.config.authorization! };
    if (this.config.contract?.securityContext === 'REQUIRED')
      headers.SecurityContext = this.config.securityContext!;
    const raw = await boundedGetJson(
      this.request,
      this.url(spec, args),
      headers,
      'business process service',
    );
    const rows = binding.rowsPath ? atPath(raw, binding.rowsPath) : raw;
    if (!rows || typeof rows !== 'object')
      throw new GatewayError(
        'SCHEMA_MISMATCH',
        'The response does not match the reviewed row mapping.',
      );
    const allRows = Array.isArray(rows) ? rows : [rows];
    const projected = allRows.slice(0, 100).map((row) =>
      Object.fromEntries(
        Object.entries(binding.fields)
          .filter(([key]) => spec.fields.includes(key))
          .flatMap<[string, Scalar]>(([key, path]) => {
            const value = atPath(row, path);
            if (typeof value === 'string') return [[key, value.slice(0, 4000)]];
            if (typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value)))
              return [[key, value]];
            return [];
          }),
      ),
    );
    if (projected.some((r) => spec.required.some((f) => r[f] === undefined || r[f] === '')))
      throw new GatewayError(
        'SCHEMA_MISMATCH',
        'Required fields are missing from the reviewed mapping.',
      );
    const total = binding.totalPath ? atPath(raw, binding.totalPath) : undefined;
    const complete = binding.completePath ? atPath(raw, binding.completePath) : undefined;
    const coverage: Coverage =
      allRows.length > 100
        ? 'partial'
        : (spec.shape === 'detail' && projected.length === 1) ||
            complete === true ||
            (typeof total === 'number' && Number.isInteger(total) && total === projected.length)
          ? 'complete'
          : complete === false || (typeof total === 'number' && total > projected.length)
            ? 'partial'
            : 'unknown';
    return { records: projected.map((r) => toEvidence(spec, r, 'live')), coverage, spec };
  }
}
