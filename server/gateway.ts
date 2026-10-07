import { z } from 'zod';
import corpus from '../docs/blueprint/benchmarks/fixtures/synthetic-engineering-corpus.json';
import type { Evidence, Item, Source, ToolName, ToolResult } from '../shared/types';
import type { Config } from './config';

export class GatewayError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
const itemSchema = z.object({
  id: z.string().min(1).max(300),
  identifier: z.string().min(1).max(300),
  title: z.string().max(500),
  revision: z.string().max(100),
  state: z.string().max(100).optional(),
  superseded: z.boolean().optional(),
  owner: z.string().max(300).optional(),
  material: z.string().max(300).optional(),
  connector: z.string().max(100).optional(),
  pinCount: z.number().optional(),
  voltage: z.number().optional(),
});
const fieldNames = new Set([
  'id',
  'identifier',
  'title',
  'revision',
  'state',
  'superseded',
  'owner',
  'material',
  'connector',
  'pinCount',
  'voltage',
  'occurrence',
  'reference',
  'included',
  'quantity',
  'configuration',
  'statement',
  'scope',
  'status',
  'text',
  'linkedFields',
  'displayName',
]);
export function atPath(value: unknown, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>(
      (v, p) =>
        v !== null && typeof v === 'object' && Object.hasOwn(v, p)
          ? (v as Record<string, unknown>)[p]
          : undefined,
      value,
    );
}
export function evidence(
  id: string,
  title: string,
  fields: Evidence['fields'],
  source: Source,
): Evidence {
  return { id, title, fields, source, retrievedAt: new Date().toISOString() };
}
export const syntheticItems: Item[] = [
  ...corpus.objects.map((o) => ({
    id: o.handle,
    identifier: o.identifier,
    title: o.title,
    revision: o.revision,
    state: o.review_state,
    superseded: o.superseded,
    owner: o.owner_role,
    material: o.material_declaration,
  })),
  ...corpus.controller_revisions.map((o) => ({
    id: `h_controller_${o.revision.toLowerCase()}`,
    identifier: 'SYN-CTRL-100',
    title: '48 V controller',
    revision: o.revision,
    state: o.revision === 'A' ? 'SUPERSEDED' : 'REVIEW_ELIGIBLE',
    superseded: o.revision === 'A',
    owner: 'Controls Engineering',
    material: 'DECL-CTRL',
    connector: o.connector,
    pinCount: o.pin_count,
    voltage: o.voltage_V,
  })),
];
const itemEvidence = (item: Item, source: Source) =>
  evidence(
    item.id,
    `${item.title} · ${item.revision}`,
    Object.fromEntries(
      Object.entries(item).filter(([, value]) => value !== undefined),
    ) as Evidence['fields'],
    source,
  );

export function syntheticCall(name: ToolName, args: { query?: string; id?: string }): ToolResult {
  let items: Item[] = [];
  let records: Evidence[] = [];
  if (name === 'search_engineering_items') {
    const query = (args.query || '').toLowerCase().trim();
    items = syntheticItems.filter((item) =>
      `${item.identifier} ${item.title}`.toLowerCase().includes(query),
    );
    records = items.map((item) => itemEvidence(item, 'synthetic'));
  } else if (name === 'get_engineering_item') {
    items = syntheticItems.filter((item) => item.id === args.id);
    records = items.map((item) => itemEvidence(item, 'synthetic'));
  } else if (name === 'get_product_structure') {
    if (args.id !== 'h_assembly_b') return { items: [], evidence: [], coverage: 'unknown' };
    records = corpus.structure.occurrences.map((o) =>
      evidence(
        o.occurrence,
        `Fan occurrence ${o.occurrence}`,
        { ...o, configuration: corpus.structure.configuration },
        'synthetic',
      ),
    );
  } else if (name === 'get_requirements') {
    records = corpus.requirements.map((r) =>
      evidence(
        r.identifier,
        r.identifier,
        { text: r.text, linkedFields: r.linked_fields.join(', ') },
        'synthetic',
      ),
    );
  } else if (name === 'search_knowledge') {
    records = corpus.knowledge.map((k) =>
      evidence(k.identifier, `Material evidence · ${k.scope}`, { ...k }, 'synthetic'),
    );
  } else if (name === 'get_current_user')
    records = [
      evidence(
        'synthetic-operator',
        'Synthetic operator',
        { displayName: 'Demo operator' },
        'synthetic',
      ),
    ];
  return { items, evidence: records, coverage: 'complete' };
}

export class Gateway {
  constructor(
    public config: Config,
    private request: typeof fetch = fetch,
  ) {}
  async call(
    name: ToolName,
    args: { query?: string; id?: string },
    source: Source,
  ): Promise<ToolResult> {
    if (source === 'synthetic') return syntheticCall(name, args);
    if (this.config.blockers.length)
      throw new GatewayError(
        'NOT_CONFIGURED',
        'Live access is blocked. Complete the private connection checklist.',
      );
    const binding = this.config.contract?.operations[name];
    if (!binding)
      throw new GatewayError(
        'UNVERIFIED_OPERATION',
        'This operation has no verified public contract for the configured release.',
      );
    if (binding.method !== 'GET' || !binding.readOnly)
      throw new GatewayError('WRITE_BLOCKED', 'Only reviewed read operations are supported.');
    if (args.id && !/^[a-zA-Z0-9_-]{1,300}$/.test(args.id))
      throw new GatewayError('INVALID_ID', 'The object identifier is not valid for this adapter.');
    if (binding.path.includes('{id}') && !args.id)
      throw new GatewayError('MISSING_ID', 'An object identifier is required.');
    if (name.startsWith('search_') && (!args.query || !binding.queryParameter))
      throw new GatewayError(
        'INVALID_QUERY',
        'A documented query binding and a query are required.',
      );
    const url = new URL(
      binding.path.replace('{id}', encodeURIComponent(args.id || '')),
      this.config.origin,
    );
    if (url.origin !== this.config.origin)
      throw new GatewayError(
        'ORIGIN_BLOCKED',
        'The operation is outside the configured tenant origin.',
      );
    if (binding.queryParameter && args.query)
      url.searchParams.set(binding.queryParameter, args.query.slice(0, 300));
    let response: Response;
    try {
      response = await this.request(url, {
        method: 'GET',
        redirect: 'error',
        signal: AbortSignal.timeout(12_000),
        headers: {
          Accept: 'application/json',
          Authorization: this.config.authorization!,
          SecurityContext: this.config.securityContext!,
        },
      });
    } catch {
      throw new GatewayError(
        'UPSTREAM_UNAVAILABLE',
        'The platform could not be reached. Check the private runtime; no retry or redirect was attempted.',
      );
    }
    if (response.status === 401 || response.status === 403)
      throw new GatewayError(
        'AUTHORIZATION_DENIED',
        'The platform denied access. No identity or endpoint fallback was attempted.',
      );
    if (!response.ok)
      throw new GatewayError('UPSTREAM_ERROR', `The platform returned HTTP ${response.status}.`);
    if (!response.headers.get('content-type')?.includes('json'))
      throw new GatewayError('INVALID_RESPONSE', 'Expected the documented JSON response.');
    let raw: unknown;
    try {
      const reader = response.body?.getReader();
      if (!reader) throw new Error();
      const chunks: Uint8Array[] = [];
      let length = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.length;
        if (length > 1_000_000) {
          await reader.cancel();
          throw new Error();
        }
        chunks.push(value);
      }
      raw = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      throw new GatewayError(
        'INVALID_RESPONSE',
        'The platform response was invalid or exceeded the one-megabyte limit.',
      );
    }
    const rows = binding.rowsPath ? atPath(raw, binding.rowsPath) : raw;
    const allRows = Array.isArray(rows) ? rows : rows && typeof rows === 'object' ? [rows] : [];
    if (!rows || typeof rows !== 'object')
      throw new GatewayError(
        'SCHEMA_MISMATCH',
        'The platform response does not match the reviewed row mapping.',
      );
    const projected = allRows.slice(0, 100).map((row) =>
      Object.fromEntries(
        Object.entries(binding.fields)
          .filter(([key]) => fieldNames.has(key))
          .flatMap<[string, string | number | boolean]>(([key, path]) => {
            const value = atPath(row, path);
            if (typeof value === 'string') return [[key, value.slice(0, 4000)]];
            if (typeof value === 'boolean' || typeof value === 'number') return [[key, value]];
            return [];
          }),
      ),
    );
    let items: Item[] = [];
    if (name === 'search_engineering_items' || name === 'get_engineering_item') {
      const parsed = z.array(itemSchema).safeParse(projected);
      if (!parsed.success)
        throw new GatewayError(
          'SCHEMA_MISMATCH',
          'Required engineering fields are missing from the reviewed mapping.',
        );
      items = parsed.data;
    }
    const total = binding.totalPath ? atPath(raw, binding.totalPath) : undefined;
    const complete = binding.completePath ? atPath(raw, binding.completePath) : undefined;
    const singleItem = name === 'get_engineering_item' && projected.length === 1;
    const coverage =
      allRows.length > 100
        ? 'partial'
        : singleItem ||
            complete === true ||
            (typeof total === 'number' &&
              Number.isInteger(total) &&
              total >= 0 &&
              total === projected.length)
          ? 'complete'
          : complete === false || (typeof total === 'number' && total > projected.length)
            ? 'partial'
            : 'unknown';
    return {
      items,
      evidence: projected.map((r, i) =>
        evidence(
          String(r.id || `${name}-${i + 1}`),
          String(r.title || name.replaceAll('_', ' ')),
          r,
          'live',
        ),
      ),
      coverage,
    };
  }
}
