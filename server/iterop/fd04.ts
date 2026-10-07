import { z } from 'zod';

/**
 * NOVA's runtime validators for the three R2026x-FD04 Business Process API v2 response bodies.
 * Written from the parsed specification (SHA-256 in operations.ts). The specification declares no
 * `required` properties and no `additionalProperties` restriction, so every property is optional
 * and unknown properties are tolerated (then dropped by NOVA's projection).
 *
 * int32/int64 are JSON integers. `startDate` is int64 with no documented unit.
 */
const int = z.number().int();

/** components.schemas.GetAllStartableProcessesInfo */
export const startableProcessInfo = z.looseObject({
  key: z.string().optional(),
  name: z.string().optional(),
  version: int.optional(),
});
/** components.schemas.GetAllStartableProcessesInfoList — 200 of getAllStartableProcesses */
export const startableProcessesList = z.looseObject({
  responses: z.array(startableProcessInfo).optional(),
});

/** components.schemas.ProcessInstanceInformation */
export const processInstanceInformation = z.looseObject({
  identificator: z.string().optional(),
  instanceId: z.string().optional(),
  name: z.string().optional(),
});
/** components.schemas.GetTaskInstanceBasicResponse — items of the 200 array of getTasksByUser */
export const taskInstanceBasic = z.looseObject({
  id: z.string().optional(),
  name: z.string().optional(),
  description: z.string().optional(),
  priority: int.optional(),
  startDate: int.optional(),
  process: processInstanceInformation.optional(),
});
export const tasksByUser = z.array(taskInstanceBasic);

/** components.schemas.GetBasicProcessInfoResponse — 200 of getBasicProcessInfo */
export const basicProcessInfo = z.looseObject({
  key: z.string().optional(),
  name: z.string().optional(),
  description: z.string().optional(),
  version: int.optional(),
  icon: z.string().optional(),
});

/** Documented error body for HTTP status >= 400 (info.description, "Errors"). */
export const errorBody = z.looseObject({ code: int.optional(), message: z.string().optional() });

export type StartableProcessesList = z.infer<typeof startableProcessesList>;
export type TaskInstanceBasic = z.infer<typeof taskInstanceBasic>;
export type BasicProcessInfo = z.infer<typeof basicProcessInfo>;
