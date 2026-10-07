# ITEROP Business Process API v2 — verified P0 contracts (R2026x-FD04)

This is NOVA's own, public-safe summary of the three read operations it may call. The official specification itself is **not** in this repository.

## Source verification

| Check                                | Result                                                                                                                                                                                               |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| File                                 | `businessprocess_v2.openapi.json`, supplied by Olivier and stored only in Git-ignored `.private/`                                                                                                    |
| SHA-256                              | `90212fe7b2a1740e39952178faa06422d177c71ff65e7ddb3ce908d294f6326e` (matches)                                                                                                                         |
| `openapi`                            | `3.1.0`                                                                                                                                                                                              |
| `info.title` / `info.version`        | `Business Process API Documentation` / `2.0.0`                                                                                                                                                       |
| Size                                 | 50 paths, 78 HTTP operations                                                                                                                                                                         |
| `servers`                            | (1) `https://{baseUrl}/businessprocess/v2/api/v2`, where `baseUrl` defaults to an example API Gateway host ending in `/api`; (2) `{APIGateway}/api/businessprocess/v2`, labelled "Cloud API Gateway" |
| Global `security`                    | `[{ "BasicAuth": [] }]`                                                                                                                                                                              |
| `components.securitySchemes`         | `BasicAuth: { type: http, scheme: basic }`. This is the only scheme.                                                                                                                                 |
| Per-operation `security`             | None of the three operations overrides it, so all inherit BasicAuth.                                                                                                                                 |
| Documented error body (status ≥ 400) | `{ "code": <int>, "message": <string> }`                                                                                                                                                             |
| `required` / `additionalProperties`  | Not declared on any of the three response schemas, so every property is optional.                                                                                                                    |

To reproduce, run `npm run iterop:openapi`. It writes the fully resolved contracts to `.private/iterop-p0-contracts.json`.

## 1. `getAllStartableProcesses` → `iterop.list_startable_processes`

- **Call:** `GET /repository/processes/startable/list`
- **Documented semantics:** "For Human User. The API retrieves all the startable processes for the currently logged in user. If the `login` query parameter is provided the permission won't be granted (access forbidden)."
- **Parameters:** `login` (query, optional string). **NOVA never sends it.**
- **200 response:** `GetAllStartableProcessesInfoList` = `{ responses?: GetAllStartableProcessesInfo[] }`
  - `GetAllStartableProcessesInfo` = `{ key?: string, name?: string, version?: int32 }`
- **Other statuses:** `403` "User not authorized."
- **NOVA projection:** `key → id`, `name → name`, `version → version`.

## 2. `getTasksByUser` → `iterop.list_my_tasks`

- **Call:** `GET /runtime/tasks`
- **Documented semantics:** "Return all information about active tasks waiting to be performed for the given user."
- **Parameters:** `user` (query, optional string, **no description**) and `processInstanceId` (query, optional string, no description). **NOVA never sends either.**
- **What happens without `user`:** the specification does **not** say. No default and no description is documented. NOVA's assumption — that the tasks are the authenticated identity's own — is a **hypothesis to prove in the first live read** (Test 2), not a verified fact.
- **200 response:** an array of `GetTaskInstanceBasicResponse`:
  - `id?: string` — task execution ID
  - `name?: string`
  - `description?: string`
  - `priority?: int32` — the scale and its direction are **undocumented**
  - `startDate?: int64` — the unit is **undocumented**; the example is `685620584`
  - `process?: ProcessInstanceInformation` = `{ identificator?: string, instanceId?: string, name?: string }`
- **Not returned:** due date, status, assignee, process key, or step. NOVA therefore cannot say whether a task is overdue, and it links a task to a process definition only by exact process **name**.
- **Other statuses:** `404` "User not found or process instance not found."
- **NOVA projection:** `id`, `name`, `description`, `priority`, `startDate`, `process.name → processName`, `process.instanceId → processInstanceId`, `process.identificator → processIdentificator`.
  - `startedAt` is derived only when the unit is known: synthetic data uses milliseconds, and a live source uses the private contract's `taskStartDateUnit` once it has been proven.

## 3. `getBasicProcessInfo` → `iterop.get_process_summary`

- **Call:** `GET /repository/processes/{processKey}/basic`
- **Documented semantics:** "Get basic and non sensitive information about process."
- **Parameters:** `processKey` (path, required string). NOVA validates it as `[A-Za-z0-9_.:-]{1,200}` and URL-encodes it.
- **200 response:** `GetBasicProcessInfoResponse` = `{ key?: string, name?: string, description?: string, version?: int32, icon?: string }`
- **Other statuses:** `404` "Process unknown. Check provided processKey." and `500` "Unexpected error occurred." **No `403` is documented**, although a gateway may still return 401 or 403; NOVA treats both as terminal.
- **NOVA projection:** `key → id`, `name`, `description`, `version`, `icon` (kept as text evidence only, never rendered as markup or a URL).

## Out of scope (present in the spec, never callable by NOVA)

`startProcess` and every other write — task completion, assignment changes, deployments and design operations — plus every read other than the three above.
