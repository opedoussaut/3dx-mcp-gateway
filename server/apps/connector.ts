import processFixture from '../../docs/blueprint/benchmarks/fixtures/synthetic-business-process.json';
import catalogFixture from '../../docs/blueprint/benchmarks/fixtures/synthetic-dataset-catalog.json';
import type { AppDomain, Coverage, Evidence, Source } from '../../shared/types';
import { GatewayError, atPath, boundedGetJson } from '../http';
import type { AppConfig } from './config';
import { appLabels, operation, type OperationSpec } from './registry';

export type AppArgs = { query?: string; id?: string };
export type AppResult = { records: Evidence[]; coverage: Coverage };
type Scalar = string | number | boolean;

const day = 86_400_000;
const dateAt = (offset?: number) =>
  offset === undefined ? undefined : new Date(Date.now() + offset * day).toISOString().slice(0, 10);
const clean = (row: Record<string, Scalar | undefined>) =>
  Object.fromEntries(Object.entries(row).filter(([, v]) => v !== undefined)) as Record<
    string,
    Scalar
  >;
const record = (spec: OperationSpec, row: Record<string, Scalar>, source: Source): Evidence => ({
  id: String(row.id),
  title: String(row.name),
  kind: spec.recordKind,
  source,
  fields: row,
  retrievedAt: new Date().toISOString(),
});

/** Synthetic principal-scoped behavior, including denial and not-found cases. */
function syntheticProcess(spec: OperationSpec, args: AppArgs): Record<string, Scalar>[] {
  const f = processFixture;
  const definition = (id: string) => f.definitions.find((d) => d.id === id);
  const instance = (id?: string) => {
    const found = f.instances.find((i) => i.id.toLowerCase() === id?.toLowerCase());
    if (!found) throw new GatewayError('NOT_FOUND', 'No process instance has that identifier.');
    if (!found.visible)
      throw new GatewayError(
        'AUTHORIZATION_DENIED',
        'The business process service denied access to this process for the current principal.',
      );
    return found;
  };
  const task = (t: (typeof f.tasks)[number]) =>
    clean({
      id: t.id,
      name: t.name,
      processId: t.process,
      processName: f.instances.find((i) => i.id === t.process)?.name,
      step: t.step,
      status: t.status,
      priority: t.priority,
      dueDate: dateAt(t.dueOffsetDays),
      createdAt: dateAt(t.createdOffsetDays),
      assignedToPrincipal: t.assignedToPrincipal,
    });
  switch (spec.name) {
    case 'iterop.list_startable_processes':
      return f.definitions
        .filter((d) => d.startable)
        .map((d) =>
          clean({
            id: d.id,
            name: d.name,
            category: d.category,
            version: d.version,
            description: d.description,
          }),
        );
    case 'iterop.list_my_tasks':
      return f.tasks.filter((t) => t.assignedToPrincipal && t.status === 'OPEN').map(task);
    case 'iterop.get_task': {
      const found = f.tasks.find((t) => t.id.toLowerCase() === args.id?.toLowerCase());
      if (!found) throw new GatewayError('NOT_FOUND', 'No task has that identifier.');
      if (!found.assignedToPrincipal && !instance(found.process).visible)
        throw new GatewayError('AUTHORIZATION_DENIED', 'This task is not visible to you.');
      return [task(found)];
    }
    case 'iterop.get_process_instance': {
      const i = instance(args.id);
      return [
        clean({
          id: i.id,
          name: i.name,
          processName: definition(i.definition)?.name,
          status: i.status,
          startedAt: dateAt(i.startedOffsetDays),
          updatedAt: dateAt(i.updatedOffsetDays),
          initiator: i.initiator,
          currentStep: i.currentStep,
        }),
      ];
    }
    case 'iterop.list_process_steps': {
      const i = instance(args.id);
      return (f.steps[i.id as keyof typeof f.steps] || []).map((s) =>
        clean({
          id: s.id,
          name: s.name,
          order: s.order,
          status: s.status,
          assignee: s.assignee,
          approval: s.approval,
          dueDate: dateAt((s as { dueOffsetDays?: number }).dueOffsetDays),
          completedAt: dateAt((s as { completedOffsetDays?: number }).completedOffsetDays),
        }),
      );
    }
  }
  return [];
}

function syntheticCatalog(spec: OperationSpec, args: AppArgs): Record<string, Scalar>[] {
  const f = catalogFixture;
  const project = (d: (typeof f.datasets)[number]) =>
    clean({
      id: d.id,
      name: d.name,
      description: d.description,
      domain: d.domain,
      owner: d.owner,
      steward: (d as { steward?: string }).steward,
      classification: d.classification,
      status: d.status,
      updatedAt: dateAt((d as { updatedOffsetDays?: number }).updatedOffsetDays),
      format: d.format,
      lineageDeclared: d.lineageDeclared,
    });
  const dataset = (id?: string) => {
    const found = f.datasets.find((d) => d.id.toLowerCase() === id?.toLowerCase());
    if (!found) throw new GatewayError('NOT_FOUND', 'No dataset has that identifier.');
    if (!found.visible)
      throw new GatewayError(
        'AUTHORIZATION_DENIED',
        'The dataset catalog denied access to this dataset for the current principal.',
      );
    return found;
  };
  const nameOf = (id: string) =>
    f.datasets.find((d) => d.id === id)?.name ||
    f.relations.find((r) => r.to === id)?.assetName ||
    id;
  switch (spec.name) {
    case 'catalog.search_datasets': {
      const terms = (args.query || '')
        .toLowerCase()
        .split(/\s+/)
        .filter((t) => t.length > 1);
      return f.datasets
        .filter((d) => d.visible)
        .filter((d) => {
          const text = `${d.id} ${d.name} ${d.description} ${d.topics} ${d.domain}`.toLowerCase();
          return terms.length > 0 && terms.every((t) => text.includes(t));
        })
        .map(project);
    }
    case 'catalog.get_dataset':
      return [project(dataset(args.id))];
    case 'catalog.list_related':
    case 'catalog.get_lineage': {
      const d = dataset(args.id);
      const lineage = spec.name === 'catalog.get_lineage';
      if (lineage && !d.lineageDeclared) return [];
      return f.relations
        .filter((r) => (r.from === d.id || r.to === d.id) && (lineage ? r.lineage : true))
        .filter((r) => {
          const other = r.from === d.id ? r.to : r.from;
          return f.datasets.find((x) => x.id === other)?.visible !== false;
        })
        .map((r) => {
          const outgoing = r.from === d.id;
          const other = outgoing ? r.to : r.from;
          return clean({
            id: other,
            name: nameOf(other),
            relation: r.relation,
            assetType: r.assetType || 'Dataset',
            direction: lineage
              ? outgoing
                ? 'UPSTREAM'
                : 'DOWNSTREAM'
              : outgoing
                ? 'OUTGOING'
                : 'INCOMING',
          });
        });
    }
  }
  return [];
}

export class AppConnector {
  constructor(
    public config: AppConfig,
    private request: typeof fetch = fetch,
  ) {}
  get app(): AppDomain {
    return this.config.app;
  }
  async call(name: string, args: AppArgs, source: Source): Promise<AppResult> {
    const spec = operation(this.app, name);
    if (!spec)
      throw new GatewayError(
        'UNKNOWN_OPERATION',
        'This operation is not part of the application registry.',
      );
    if (args.id !== undefined && !/^[a-zA-Z0-9_.:-]{1,200}$/.test(args.id))
      throw new GatewayError('INVALID_ID', 'The identifier is not valid for this adapter.');
    if ((spec.shape === 'detail' || spec.shape === 'children') && !args.id)
      throw new GatewayError('MISSING_ID', 'An identifier is required.');
    if (spec.shape === 'search' && !args.query?.trim())
      throw new GatewayError('INVALID_QUERY', 'A search phrase is required.');
    if (source === 'synthetic') {
      const rows =
        this.app === 'ITEROP' ? syntheticProcess(spec, args) : syntheticCatalog(spec, args);
      return { records: rows.map((r) => record(spec, r, 'synthetic')), coverage: 'complete' };
    }
    return this.live(spec, args);
  }
  private async live(spec: OperationSpec, args: AppArgs): Promise<AppResult> {
    const platform = appLabels[this.app].platform;
    if (this.config.blockers.length)
      throw new GatewayError(
        'NOT_CONFIGURED',
        'Live access to this application is blocked. Complete its private connection checklist.',
      );
    const binding = this.config.contract?.operations[spec.name as never] as
      NonNullable<AppConfig['contract']>['operations'][never] | undefined;
    if (!binding)
      throw new GatewayError(
        'UNVERIFIED_OPERATION',
        'This operation has no reviewed contract for the configured release.',
      );
    if (binding.method !== 'GET' || !binding.readOnly)
      throw new GatewayError('WRITE_BLOCKED', 'Only reviewed read operations are supported.');
    if (binding.path.includes('{id}') !== Boolean(args.id) && spec.shape !== 'list')
      throw new GatewayError(
        'MISSING_ID',
        'The reviewed path and the request disagree on the identifier.',
      );
    if (spec.shape === 'search' && !binding.queryParameter)
      throw new GatewayError('INVALID_QUERY', 'A documented query binding is required.');
    const url = new URL(
      binding.path.replace('{id}', encodeURIComponent(args.id || '')),
      this.config.origin,
    );
    if (url.origin !== this.config.origin)
      throw new GatewayError(
        'ORIGIN_BLOCKED',
        'The operation is outside the configured service origin.',
      );
    if (binding.queryParameter && args.query)
      url.searchParams.set(binding.queryParameter, args.query.slice(0, 300));
    const headers: Record<string, string> = { Authorization: this.config.authorization! };
    if (this.config.contract?.securityContext === 'REQUIRED')
      headers.SecurityContext = this.config.securityContext!;
    const raw = await boundedGetJson(this.request, url, headers, platform);
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
    return { records: projected.map((r) => record(spec, r, 'live')), coverage };
  }
}
