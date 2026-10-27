/**
 * Parse the R2026x-FD04 Business Process API v2 OpenAPI document and resolve the exact contracts
 * of NOVA's three P0 read operations.
 *
 * The vendor document is never committed. Place it at `.private/businessprocess_v2.openapi.json`
 * (ignored by Git) or pass a path. Output goes to `.private/iterop-p0-contracts.json` plus a short
 * console report. Nothing here makes a network request.
 *
 *   npm run iterop:openapi [-- path/to/businessprocess_v2.openapi.json]
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { operations, SPEC } from '../server/iterop/operations';
import { loadSpec } from './openapi-lib';

const file = process.argv[2] || '.private/businessprocess_v2.openapi.json';
if (!existsSync(file)) {
  console.error(`OpenAPI file not found: ${file}`);
  process.exit(2);
}
const text = readFileSync(file, 'utf8');
const { spec, index, operation } = loadSpec(text);
const sha256 = createHash('sha256').update(text).digest('hex');
const info = spec.info as Record<string, unknown>;
const report = {
  source: file,
  sha256,
  sha256MatchesNova: sha256 === SPEC.sha256,
  openapi: spec.openapi,
  info: { title: info?.title, version: info?.version },
  servers: spec.servers,
  security: spec.security,
  securitySchemes: (spec.components as Record<string, unknown>)?.securitySchemes,
  counts: { paths: Object.keys(spec.paths as object).length, operations: index.length },
  operations: operations.map((nova) => {
    const found = operation(nova.operationId);
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
      parameters: found.parameters,
      requestBody: found.op.requestBody,
      responses: found.responses,
    };
  }),
};
mkdirSync('.private', { recursive: true });
writeFileSync('.private/iterop-p0-contracts.json', JSON.stringify(report, null, 2));
const short = {
  ...report,
  operations: report.operations.map((o) =>
    'documented' in o
      ? {
          operationId: o.operationId,
          documented: o.documented,
          pathMatches: o.pathMatches,
          methodMatches: o.methodMatches,
          parameters: o.parameters.map(
            (p) => `${p.name} (${p.in}${p.required ? ', required' : ''})`,
          ),
          responses: Object.keys(o.responses || {}),
        }
      : o,
  ),
};
process.stdout.write(`${JSON.stringify(short, null, 2)}\n`);
process.stdout.write(
  '\nFull resolved contracts written to .private/iterop-p0-contracts.json (not committed).\n',
);
