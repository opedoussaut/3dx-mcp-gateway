import type { z } from 'zod';
import { basicProcessInfo, startableProcessesList, tasksByUser } from './fd04';

/**
 * ITEROP Business Process API v2 — the three P0 read operations NOVA may call.
 *
 * Verified against the official R2026x-FD04 `businessprocess_v2.openapi.json` (OpenAPI 3.1.0,
 * info.version 2.0.0, 50 paths, 78 operations). The vendor document is kept privately in
 * `.private/` and is never committed; `npm run iterop:openapi` re-resolves these contracts.
 */
export const SPEC = {
  release: 'R2026x-FD04',
  document: 'businessprocess_v2.openapi.json',
  openapi: '3.1.0',
  apiVersion: '2.0.0',
  sha256: '90212fe7b2a1740e39952178faa06422d177c71ff65e7ddb3ce908d294f6326e',
  security: 'BasicAuth (http, scheme basic) — declared globally; no operation overrides it',
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
  /** Documented query parameters NOVA never sends. */
  forbiddenQuery: readonly string[];
  /** FD04 200 response schema (NOVA validator). */
  response: z.ZodType;
  /** Where rows sit in the 200 body: a property, the root array, or the root object. */
  rows: { kind: 'property'; property: string } | { kind: 'array' } | { kind: 'object' };
  /** NOVA normalized field ← FD04 property path. Nothing else survives projection. */
  mapping: Readonly<Record<string, string>>;
  required: readonly string[];
  shape: 'list' | 'detail';
  /** Status codes documented by FD04 for this operation. */
  documentedStatus: readonly number[];
  scope: string;
};

export const operations: readonly OperationSpec[] = [
  {
    name: 'iterop.list_startable_processes',
    operationId: 'getAllStartableProcesses',
    method: 'GET',
    path: '/repository/processes/startable/list',
    recordKind: 'process.definition',
    description: 'All startable processes for the currently logged-in (human) user.',
    // FD04: "If `login` query parameter is provided the permission won't be granted (access forbidden)".
    forbiddenQuery: ['login'],
    response: startableProcessesList,
    rows: { kind: 'property', property: 'responses' },
    mapping: { id: 'key', name: 'name', version: 'version' },
    required: ['id', 'name'],
    shape: 'list',
    documentedStatus: [200, 403],
    scope: 'Currently logged-in human user; login is never sent',
  },
  {
    name: 'iterop.list_my_tasks',
    operationId: 'getTasksByUser',
    method: 'GET',
    path: '/runtime/tasks',
    recordKind: 'process.task',
    description: 'Active tasks waiting to be performed — requested without the user parameter.',
    // `user` would target another person; FD04 does not document its default. Never sent.
    forbiddenQuery: ['user', 'login', 'processInstanceId'],
    response: tasksByUser,
    rows: { kind: 'array' },
    mapping: {
      id: 'id',
      name: 'name',
      description: 'description',
      priority: 'priority',
      startDate: 'startDate',
      processName: 'process.name',
      processInstanceId: 'process.instanceId',
      processIdentificator: 'process.identificator',
    },
    required: ['id', 'name'],
    shape: 'list',
    documentedStatus: [200, 404],
    scope: 'No user parameter sent; self-scope to be confirmed in the first live read',
  },
  {
    name: 'iterop.get_process_summary',
    operationId: 'getBasicProcessInfo',
    method: 'GET',
    path: '/repository/processes/{processKey}/basic',
    recordKind: 'process.definition',
    description: 'Basic and non-sensitive information about one process.',
    forbiddenQuery: ['login', 'user'],
    response: basicProcessInfo,
    rows: { kind: 'object' },
    mapping: {
      id: 'key',
      name: 'name',
      description: 'description',
      version: 'version',
      icon: 'icon',
    },
    required: ['id', 'name'],
    shape: 'detail',
    documentedStatus: [200, 404, 500],
    scope: 'One process key resolved from your startable list or typed exactly',
  },
];

export const operation = (name: string) => operations.find((o) => o.name === name);
/** Write operations present in the specification but out of scope. Never callable. */
export const outOfScopeWrites = ['startProcess'] as const;
