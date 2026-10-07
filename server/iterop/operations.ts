/**
 * ITEROP Business Process API v2 — operation inventory used by NOVA.
 *
 * Source of record: R2026x-FD04 `businessprocess_v2.openapi.json` (link only, see
 * docs/references/ITEROP-R2026x-FD04-OPENAPI.md). The operationId, method and path below are
 * those recorded on `main` from that release document. Request/response schemas, status codes
 * and the security scheme are NOT yet verified here: the specification could not be retrieved
 * in the development session (egress denied). Field mapping therefore lives only in a reviewed
 * private contract; NOVA's own fields are a normalized projection, not the vendor schema.
 */
export const SPEC = {
  release: 'R2026x-FD04',
  document: 'businessprocess_v2.openapi.json',
  apiVersion: '2.0.0',
} as const;

export type SemanticOperation =
  'iterop.list_startable_processes' | 'iterop.list_my_tasks' | 'iterop.get_process_summary';

export type OperationSpec = {
  name: SemanticOperation;
  operationId: string;
  method: 'GET';
  /** Documented relative path. `{processKey}` is the only placeholder in P0. */
  path: string;
  recordKind: 'process.definition' | 'process.task';
  description: string;
  /** Query parameters NOVA must never send for this operation. */
  forbiddenQuery: readonly string[];
  /** Normalized, allowlisted fields. Anything else in an upstream row is dropped. */
  fields: readonly string[];
  required: readonly string[];
  shape: 'list' | 'detail';
  scope: string;
  verification: { inventory: 'RECORDED_FROM_SPEC'; schemas: 'PENDING_SPEC_FILE' };
};

const verification = { inventory: 'RECORDED_FROM_SPEC', schemas: 'PENDING_SPEC_FILE' } as const;
const processFields = ['id', 'name', 'description', 'version', 'category'] as const;

export const operations: readonly OperationSpec[] = [
  {
    name: 'iterop.list_startable_processes',
    operationId: 'getAllStartableProcesses',
    method: 'GET',
    path: '/repository/processes/startable/list',
    recordKind: 'process.definition',
    description: 'Process definitions the authenticated human user can start.',
    // The specification states that a human caller must not supply `login`.
    forbiddenQuery: ['login'],
    fields: processFields,
    required: ['id', 'name'],
    shape: 'list',
    scope: 'Authenticated principal (human); no login parameter',
    verification,
  },
  {
    name: 'iterop.list_my_tasks',
    operationId: 'getTasksByUser',
    method: 'GET',
    path: '/runtime/tasks',
    recordKind: 'process.task',
    description: 'Current tasks of the authenticated principal only.',
    // `user` would enumerate another person's tasks; no reviewed authorization model permits it.
    forbiddenQuery: ['user', 'login'],
    fields: [
      'id',
      'name',
      'processKey',
      'processName',
      'processInstanceId',
      'step',
      'status',
      'priority',
      'dueDate',
      'createdAt',
    ],
    required: ['id', 'name'],
    shape: 'list',
    scope: 'Self only; the user parameter is never sent',
    verification,
  },
  {
    name: 'iterop.get_process_summary',
    operationId: 'getBasicProcessInfo',
    method: 'GET',
    path: '/repository/processes/{processKey}/basic',
    recordKind: 'process.definition',
    description: 'Basic description and version of one named process.',
    forbiddenQuery: ['login', 'user'],
    fields: processFields,
    required: ['id', 'name'],
    shape: 'detail',
    scope: 'One process key resolved from your startable list or typed exactly',
    verification,
  },
];

export const operation = (name: string) => operations.find((o) => o.name === name);
/** Write operations present in the specification but out of scope. Never callable. */
export const outOfScopeWrites = ['startProcess'] as const;
