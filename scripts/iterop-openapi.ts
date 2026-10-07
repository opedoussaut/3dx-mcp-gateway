/**
 * Parse the R2026x-FD04 Business Process API v2 OpenAPI document and resolve the exact contracts
 * of NOVA's three P0 read operations.
 *
 * The vendor document is never committed. Place it at `.private/businessprocess_v2.openapi.json`
 * (ignored by Git) or pass a path. Output goes to `.private/iterop-p0-contracts.json` plus a short
 * console report. Nothing here makes a network request.
 *
 *   node --import tsx scripts/iterop-openapi.ts [path/to/businessprocess_v2.openapi.json]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { operations } from '../server/iterop/operations';

type Json = Record<string, unknown>;
const file = process.argv[2] || '.private/businessprocess_v2.openapi.json';
if (!existsSync(file)) {
  console.error(`OpenAPI file not found: ${file}`);
  process.exit(2);
}
const spec = JSON.parse(readFileSync(file, 'utf8')) as Json;

/** Resolve local JSON pointers ("#/components/..."), cycle-safe. */
function pointer(ref: string): unknown {
  if (!ref.startsWith('#/')) throw new Error(`External $ref not supported: ${ref}`);
  return ref
    .slice(2)
    .split('/')
    .map((p) => p.replace(/~1/g, '/').replace(/~0/g, '~'))
    .reduce<unknown>((v, k) => (v as Json)?.[k], spec);
}
export function deref(value: unknown, seen: string[] = []): unknown {
  if (Array.isArray(value)) return value.map((v) => deref(v, seen));
  if (!value || typeof value !== 'object') return value;
  const obj = value as Json;
  if (typeof obj.$ref === 'string') {
    if (seen.includes(obj.$ref)) return { $circular: obj.$ref };
    const { $ref, ...siblings } = obj;
    return { $resolvedFrom: $ref, ...(deref(pointer($ref), [...seen, $ref]) as Json), ...siblings };
  }
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, deref(v, seen)]));
}

const methods = ['get', 'put', 'post', 'delete', 'patch', 'head', 'options'];
const paths = (spec.paths || {}) as Record<string, Json>;
const index = Object.entries(paths).flatMap(([path, item]) =>
  methods
    .filter((m) => item[m])
    .map((m) => ({
      path,
      method: m.toUpperCase(),
      op: item[m] as Json,
      shared: (item.parameters || []) as unknown[],
    })),
);
const report = {
  source: file,
  openapi: spec.openapi,
  info: { title: (spec.info as Json)?.title, version: (spec.info as Json)?.version },
  servers: spec.servers,
  security: spec.security,
  securitySchemes: (spec.components as Json)?.securitySchemes,
  counts: { paths: Object.keys(paths).length, operations: index.length },
  operations: operations.map((nova) => {
    const found = index.find((o) => o.op.operationId === nova.operationId);
    if (!found) return { nova: nova.name, operationId: nova.operationId, found: false };
    return {
      nova: nova.name,
      operationId: nova.operationId,
      found: true,
      pathMatches: found.path === nova.path,
      methodMatches: found.method === nova.method,
      documented: { method: found.method, path: found.path },
      summary: found.op.summary,
      description: found.op.description,
      security: found.op.security ?? '(inherits global)',
      parameters: deref([...found.shared, ...((found.op.parameters as unknown[]) || [])]),
      requestBody: deref(found.op.requestBody),
      responses: deref(found.op.responses),
    };
  }),
};
mkdirSync('.private', { recursive: true });
writeFileSync('.private/iterop-p0-contracts.json', JSON.stringify(report, null, 2));
console.log(
  JSON.stringify(
    {
      openapi: report.openapi,
      info: report.info,
      servers: report.servers,
      security: report.security,
      securitySchemes: report.securitySchemes,
      counts: report.counts,
      operations: report.operations.map((o) =>
        'documented' in o
          ? {
              operationId: o.operationId,
              documented: o.documented,
              pathMatches: o.pathMatches,
              methodMatches: o.methodMatches,
              parameters: (o.parameters as Json[]).map(
                (p) => `${p.name} (${p.in}${p.required ? ', required' : ''})`,
              ),
              responses: Object.keys((o.responses as Json) || {}),
            }
          : o,
      ),
    },
    null,
    2,
  ),
);
console.log(
  '\nFull resolved contracts written to .private/iterop-p0-contracts.json (not committed).',
);
