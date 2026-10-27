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
  key: z.string().nullish(),
  name: z.string().nullish(),
  version: int.nullish(),
});
/** components.schemas.GetAllStartableProcessesInfoList — 200 of getAllStartableProcesses */
export const startableProcessesList = z.looseObject({
  responses: z.array(startableProcessInfo).nullish(),
});

/** components.schemas.ProcessInstanceInformation */
export const processInstanceInformation = z.looseObject({
  identificator: z.string().nullish(),
  instanceId: z.string().nullish(),
  name: z.string().nullish(),
});
/** components.schemas.GetTaskInstanceBasicResponse — items of the 200 array of getTasksByUser */
export const taskInstanceBasic = z.looseObject({
  id: z.string().nullish(),
  name: z.string().nullish(),
  description: z.string().nullish(),
  priority: int.nullish(),
  startDate: int.nullish(),
  process: processInstanceInformation.nullish(),
});
export const tasksByUser = z.array(taskInstanceBasic);

/** components.schemas.GetBasicProcessInfoResponse — 200 of getBasicProcessInfo */
export const basicProcessInfo = z.looseObject({
  key: z.string().nullish(),
  name: z.string().nullish(),
  description: z.string().nullish(),
  version: int.nullish(),
  icon: z.string().nullish(),
});

/** Documented error body for HTTP status >= 400 (info.description, "Errors"). */
export const errorBody = z.looseObject({ code: int.nullish(), message: z.string().nullish() });

export type StartableProcessesList = z.infer<typeof startableProcessesList>;
export type TaskInstanceBasic = z.infer<typeof taskInstanceBasic>;
export type BasicProcessInfo = z.infer<typeof basicProcessInfo>;
