import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { project, syntheticResponse } from '../server/iterop/connector';
import { operations, SPEC } from '../server/iterop/operations';
import { loadSpec, propertyNames } from '../scripts/openapi-lib';

type Wrapped = { unwrap?: () => Wrapped; element?: { shape: object } };
/** Peel nullable/optional wrappers down to the array schema. */
const unwrapArray = (w: Wrapped): { element: { shape: object } } => {
  let cur = w;
  while (!cur.element && cur.unwrap) cur = cur.unwrap();
  return cur as { element: { shape: object } };
};
const synthetic = () =>
  operations.map((op) => ({
    op,
    body: syntheticResponse(op, { processKey: 'syn_contractor_form' }),
  }));

test('synthetic responses are valid FD04-shaped bodies and go through the live projection', () => {
  for (const { op, body } of synthetic()) {
    assert.ok(
      op.response.safeParse(body).success,
      `${op.operationId} fixture violates its FD04 schema`,
    );
    const { records, coverage } = project(op, body, 'synthetic', 'ms');
    assert.equal(coverage, 'complete');
    assert.ok(records.length > 0);
    for (const r of records)
      for (const field of Object.keys(r.fields))
        assert.ok(
          field in op.mapping || field === 'startedAt',
          `${field} is not an FD04-mapped field`,
        );
  }
  const startable = syntheticResponse(operations[0], {}) as { responses: object[] };
  assert.ok(Array.isArray(startable.responses), 'startable list is wrapped in `responses`');
  for (const p of startable.responses)
    assert.deepEqual(Object.keys(p).sort(), ['key', 'name', 'version']);
  const tasks = syntheticResponse(operations[1], {}) as Record<string, unknown>[];
  for (const t of tasks) {
    assert.deepEqual(Object.keys(t).sort(), [
      'description',
      'id',
      'name',
      'priority',
      'process',
      'startDate',
    ]);
    assert.deepEqual(Object.keys(t.process as object).sort(), [
      'identificator',
      'instanceId',
      'name',
    ]);
    assert.ok(Number.isInteger(t.priority) && Number.isInteger(t.startDate));
  }
});

const file = '.private/businessprocess_v2.openapi.json';
const available = existsSync(file);
const why =
  'Private FD04 spec not present (never committed); run locally after placing it in .private/.';

test(
  'the private specification is exactly the reviewed R2026x-FD04 document',
  { skip: !available && why },
  () => {
    const text = readFileSync(file, 'utf8');
    assert.equal(createHash('sha256').update(text).digest('hex'), SPEC.sha256);
    const { spec, index } = loadSpec(text);
    assert.equal(spec.openapi, SPEC.openapi);
    assert.equal((spec.info as { version: string }).version, SPEC.apiVersion);
    assert.equal(Object.keys(spec.paths as object).length, 50);
    assert.equal(index.length, 78);
    assert.deepEqual(spec.security, [{ BasicAuth: [] }]);
    assert.deepEqual((spec.components as { securitySchemes: unknown }).securitySchemes, {
      BasicAuth: { type: 'http', scheme: 'basic' },
    });
  },
);

test(
  'NOVA inventory, parameters, status codes and schemas match FD04 exactly',
  { skip: !available && why },
  () => {
    const { operation } = loadSpec(readFileSync(file, 'utf8'));
    for (const op of operations) {
      const doc = operation(op.operationId)!;
      assert.ok(doc, `${op.operationId} missing from FD04`);
      assert.equal(doc.method, op.method);
      assert.equal(doc.path, op.path);
      assert.equal(doc.op.security, undefined, 'operation inherits global BasicAuth');
      assert.deepEqual(
        Object.keys(doc.responses).map(Number).sort(),
        [...op.documentedStatus].sort(),
      );
      // Every documented query parameter is one NOVA never sends.
      for (const p of doc.parameters.filter((p) => p.in === 'query'))
        assert.ok(
          op.forbiddenQuery.includes(String(p.name)),
          `${op.operationId}: ${p.name} must be forbidden`,
        );
      // NOVA's zod validator declares exactly the FD04 properties.
      const ok = doc.okSchema!;
      const rowSchema =
        op.rows.kind === 'property'
          ? (ok.properties as Record<string, unknown>)[op.rows.property]
          : ok;
      const zodShape = (
        op.rows.kind === 'property'
          ? unwrapArray(
              (op.response as unknown as { shape: Record<string, Wrapped> }).shape[
                op.rows.property
              ],
            ).element.shape
          : op.rows.kind === 'array'
            ? (op.response as unknown as { element: { shape: object } }).element.shape
            : (op.response as unknown as { shape: object }).shape
      ) as object;
      assert.deepEqual(
        Object.keys(zodShape).sort(),
        propertyNames(rowSchema),
        `${op.operationId} property set`,
      );
      // Every mapping path exists in the FD04 schema.
      for (const path of Object.values(op.mapping)) {
        const [head, tail] = path.split('.');
        assert.ok(
          propertyNames(rowSchema).includes(head),
          `${op.operationId}: ${head} not in FD04`,
        );
        if (tail) {
          const items = (rowSchema as { items?: unknown }).items ?? rowSchema;
          const nested = (items as { properties: Record<string, unknown> }).properties[
            head
          ] as object;
          assert.ok(propertyNames(nested).includes(tail), `${op.operationId}: ${path} not in FD04`);
        }
      }
    }
    const startable = operation('getAllStartableProcesses')!;
    assert.match(String(startable.op.description), /For Human User/);
    assert.match(
      String(startable.op.description),
      /`login` query parameter is provided the permission won't be granted/,
    );
    const tasks = operation('getTasksByUser')!;
    const user = tasks.parameters.find((p) => p.name === 'user')!;
    assert.equal(user.required, undefined, 'user is optional');
    assert.equal(
      user.description,
      undefined,
      'FD04 does not document the default when user is omitted',
    );
  },
);

test(
  'synthetic responses validate against the official FD04 JSON Schemas',
  { skip: !available && why },
  () => {
    const { operation } = loadSpec(readFileSync(file, 'utf8'));
    const ajv = new Ajv2020({ strict: false, validateFormats: false, allErrors: true });
    for (const { op, body } of synthetic()) {
      const validate = ajv.compile(operation(op.operationId)!.okSchema!);
      assert.ok(validate(body), `${op.operationId}: ${ajv.errorsText(validate.errors)}`);
    }
    // A body with a wrong type is rejected by both the official schema and NOVA's validator.
    const tasksSchema = ajv.compile(operation('getTasksByUser')!.okSchema!);
    const bad = [{ id: 'x', priority: 'HIGH' }];
    assert.equal(tasksSchema(bad), false);
    assert.equal(operations[1].response.safeParse(bad).success, false);
  },
);
