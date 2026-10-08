import { z } from 'zod';

/**
 * Orchestration-lab operations, verified against the same R2026x-FD04 specification as
 * operations.ts (method, path, documented status codes and messages, request schemas).
 *
 * They run ONLY against NOVA's synthetic process engine. There is no live transport for them:
 * live process control needs a reviewed drive contract, a sanctioned credential and an explicit
 * approval path, none of which exists yet.
 */
export type LabOperation = {
  operationId: string;
  method: 'GET' | 'POST';
  path: string;
  kind: 'read' | 'drive';
  documentedStatus: readonly number[];
  note: string;
};

export const labOperations = {
  getAllStartableProcesses: {
    operationId: 'getAllStartableProcesses',
    method: 'GET',
    path: '/repository/processes/startable/list',
    kind: 'read',
    documentedStatus: [200, 403],
    note: 'For a human user; login is never sent.',
  },
  getBasicProcessInfo: {
    operationId: 'getBasicProcessInfo',
    method: 'GET',
    path: '/repository/processes/{processKey}/basic',
    kind: 'read',
    documentedStatus: [200, 404, 500],
    note: 'Basic, non-sensitive process information.',
  },
  getProcessInfo: {
    operationId: 'getProcessInfo',
    method: 'GET',
    path: '/repository/processes/{processKey}',
    kind: 'read',
    documentedStatus: [200, 400, 403, 404, 500],
    note: 'Human tasks and their expected outputs; used to check a live model before any write.',
  },
  getTasksByUser: {
    operationId: 'getTasksByUser',
    method: 'GET',
    path: '/runtime/tasks',
    kind: 'read',
    documentedStatus: [200, 404],
    note: 'Requested without the user parameter.',
  },
  getTaskInstanceInformations: {
    operationId: 'getTaskInstanceInformations',
    method: 'GET',
    path: '/runtime/tasks/{taskId}',
    kind: 'read',
    documentedStatus: [200, 404],
    note: 'Provided data and expected output fields of one task.',
  },
  getInstanceInfo: {
    operationId: 'getInstanceInfo',
    method: 'GET',
    path: '/runtime/instances/{instanceId}',
    kind: 'read',
    documentedStatus: [200, 404],
    note: 'Instance status and variables; 404 once the instance is completed.',
  },
  startProcess: {
    operationId: 'startProcess',
    method: 'POST',
    path: '/runtime/processes/{processKey}',
    kind: 'drive',
    documentedStatus: [201, 400, 403, 404],
    note: '201 has no body: the new instance is found again through its identificator. 400 is also documented as "Only robot can use this API".',
  },
  completeTask: {
    operationId: 'completeTask',
    method: 'POST',
    path: '/runtime/tasks/{taskId}',
    kind: 'drive',
    documentedStatus: [200, 400, 403, 404],
    note: '403 is documented as "Task need to be signed (only doable via ui)".',
  },
} as const satisfies Record<string, LabOperation>;
export type LabOperationId = keyof typeof labOperations;

/** Operations present in FD04 that the lab never calls, by any route. */
export const neverCalled = [
  'setTaskAssignments',
  'updateTaskAssignments',
  'stopProcessInstance',
  'deployProcessModel',
  'importProcessModel',
  'deleteDeployment',
  'addProcessRights',
  'deleteProcessRights',
  'completeTaskAsWebHook',
] as const;

/** components.schemas.StartProcessRequest. NOVA never sends `user` (robot impersonation). */
export const startProcessRequest = z
  .object({
    data: z.record(z.string(), z.unknown()).optional(),
    identificator: z.string().optional(),
    user: z.string().optional(),
  })
  .strict();
/** components.schemas.CompleteTaskRequest. NOVA never sends `user`. */
export const completeTaskRequest = z
  .object({
    user: z.string().optional(),
    data: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

const int = z.number().int();
const variableType = z.enum([
  'TEXT',
  'TEXT_AREA',
  'RICH_TEXT',
  'CURRENCY',
  'PASSWORD',
  'DATE',
  'DATETIME',
  'BOOLEAN',
  'SELECT',
  'INTEGER',
  'DECIMAL',
  'USER',
  'FILE',
  'GROUP',
  'MULTI_USER',
  'MULTI_GROUP',
  'COMPOSED',
  'OBJECT_3DS',
]);
/** components.schemas.VariableValue */
export const variableValue = z.looseObject({
  id: z.string().nullish(),
  name: z.string().nullish(),
  type: z.string().nullish(),
  value: z.unknown().nullish(),
});
/** components.schemas.VariableDefinition (the properties the lab uses) */
export const variableDefinition = z.looseObject({
  id: z.string().nullish(),
  name: z.string().nullish(),
  description: z.string().nullish(),
  type: z.string().nullish(),
  parameter: z.boolean().nullish(),
  required: z.union([z.boolean(), z.string()]).nullish(),
  values: z.string().nullish(),
  defaultValue: z.union([z.string(), z.number(), z.boolean()]).nullish(),
  min: z.union([z.string(), z.number()]).nullish(),
  max: z.union([z.string(), z.number()]).nullish(),
});
/** components.schemas.GetTaskInstanceResponse */
export const taskInstanceResponse = z.looseObject({
  id: z.string().nullish(),
  name: z.string().nullish(),
  description: z.string().nullish(),
  priority: int.nullish(),
  startDate: int.nullish(),
  providedData: z.array(variableValue).nullish(),
  expectedFields: z.array(variableDefinition).nullish(),
});
/** components.schemas.GetProcessInfoResponse (the properties the lab uses) */
export const processInfoResponse = z.looseObject({
  key: z.string().nullish(),
  name: z.string().nullish(),
  version: int.nullish(),
  humanTasks: z
    .array(
      z.looseObject({
        id: z.string().nullish(),
        name: z.string().nullish(),
        outputs: z.array(z.looseObject({ id: z.string().nullish() })).nullish(),
      }),
    )
    .nullish(),
  variables: z.record(z.string(), variableDefinition).nullish(),
});
/** components.schemas.GetInstanceInfoResponse */
export const instanceInfoResponse = z.looseObject({
  id: z.string().nullish(),
  identificator: z.string().nullish(),
  variables: z.array(variableValue).nullish(),
});
