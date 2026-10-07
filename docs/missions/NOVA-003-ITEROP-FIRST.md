# NOVA-003 / ITEROP FIRST — Business Process Play to Natural Language
**Owner:** Olivier · **Priority:** P0, supersedes the prior "ITEROP + Datasets Governance in parallel" order · **Status:** commissioned; LIVE API unverified

## Decision and observed access boundary

Olivier can sign into the **ITEROP Business Process Play** application and browse process definitions. He **cannot access Business Process Design/Administration**. This proves **UI entitlement only**; it does not supply API credentials, rights to use API Gateway, or a service account. The Play screenshot also shows zero tasks in the current view; do not assert there are pending tasks or that all displayed processes are startable without verifying per-user rights.

Olivier has provided a **Business Process API OpenAPI 3.1 document**, API `version: 2.0.0` covering 50 paths and 78 methods; the declared global security scheme is HTTP Basic. Its two server templates are inconsistent/placeholder-like; **do not construct a tenant URL from those defaults**. It establishes operation descriptions, not access to this tenant, supported credentials, deployment routing, or entitlement.

**The development order is now: ITEROP (first) → Dataset Governance (later) → AURA comparison (after live integration value).** Preserve pre-existing Dataset Governance and AURA work, but defer their feature expansion.

**Public references (for links, not copying vendor documentation):**
- https://doc.iterop.com/kb/utiliser-lapi-rest-2/ — standalone Iterop REST authentication; v2 does **not** support JWT, and REST access keys are provisioned from an Admin interface.
- https://3dswym.3dexperience.3ds.com/wiki/3dexperience-platform-user-s-community/business-process-designer_fu5BkDD5SJiXJh1RndAgjg — platform notes: ITEROP API via API Gateway, **PFI role mandatory** for that path.
- Supplied OpenAPI source: user attachment, **not committed** to this public repository. Where available to an approved Claude session, inspect it as documentation; do not redistribute raw source, private samples, screenshots or live process instances without authorization.

## Product promise: the smallest live outcome worth building

Within NOVA's beautiful GEN7-inspired shell, Olivier should eventually be able to ask:

> "Which business processes can I launch, what tasks are currently mine, and where can I find the details of a process?"

NOVA must answer based on **documented, authorized evidence**, not guessed task assignments from the Play dashboard or static mockups. The AI layer interprets intents and summarizes *only the projected, permitted data*. It cannot decide authorization, invent IDs or start workflows without explicit approval.

## OpenAPI-backed read operations for the first adapter

These operation IDs and paths were extracted from the supplied OpenAPI 2.0.0 definition. They are **verified as present in that specification, NOT verified as enabled for Olivier's tenant**.

| Priority | Natural language goal | OpenAPI operationId | Method / relative path | Special constraints |
|---|---|---|---|---|
| P0 | What can I start? | `getAllStartableProcesses` | GET `/repository/processes/startable/list` | Spec: for **human user**; supplying `login` in this mode is forbidden. |
| P0 | What are my open tasks? | `getTasksByUser` | GET `/runtime/tasks` | Optional `user` and `processInstanceId`; default to approved self-scope, never enumerate others. |
| P0 | Explain this process | `getBasicProcessInfo` | GET `/repository/processes/{processKey}/basic` | Non-sensitive process summary; validate/encode bounded processKey. |
| P1 | Show required inputs/tasks | `getProcessInfo` | GET `/repository/processes/{processKey}` | May expose input fields, task definitions and variables; minimize fields. |
| P1 | What is this task about? | `getTaskInstanceInformations` | GET `/runtime/tasks/{taskId}` | Include assignments only with documented rights; reject arbitrary cross-user requests. |
| P1 | Where is this process? | `getInstanceInfo` | GET `/runtime/instances/{instanceId}` | Instance may expose process variables; default to metadata-only projection. |
| P2 | Completed work | `getHistoryUserTasks` | GET `/history/tasks` | Defaults to past 30 days; avoid unapproved full variable retrieval. |

**Important:** The OpenAPI also declares `startProcess` (POST `/runtime/processes/{processKey}`, response 201), but documents robot-specific permission behavior. **It is explicitly OUT OF SCOPE** until legitimate admin/API provisioning, rights, input schema, sandbox and a per-action human approval workflow are in place. Likewise do not complete tasks, import/deploy process models or change assignments in P0.

## Authentication and licensing: separate product routes

**ITEROP Play login** ≠ **ITEROP REST client account** ≠ **3DEXPERIENCE API Gateway / Openness Agent / PFI**.

- The standalone product's Admin UI can generate dedicated REST key/secret pairs, with HTTP Basic; that is not available merely by having Play access. Do not solicit the user's SSO password.
- The public platform note says the integrated API Gateway path requires PFI. Olivier currently reports that he **does not have PFI**. Do not work around the absence of that entitlement.
- The OpenAPI advertises HTTP Basic but does not, by itself, establish how the 3DEXPERIENCE cloud gateway authenticates this tenant. Verify exact origin, required API key/service principal, delegated user scope, header and session semantics **with platform owner**.
- Stop on 401/403, report `blocked` and the missing authorization facts; never scrape browser cookies or use developer tools to replay internal Play endpoints as an alternate integration.
- Treat both public docs and the user's uploaded API definition as source material; runtime allowance requires deployment-specific contract review and signed-off operator access.

## P0 implementation contract (offline, can begin immediately)

1. Inspect current Gateway code (`server/gateway.ts`, `server/config.ts`, `server/missions.ts`, `server/mcp.ts`, front-end, tests) and implement **one ITEROP-only semantic namespace**, e.g. `iterop.list_startable_processes`, `iterop.list_my_tasks`, `iterop.get_process_summary`.
2. Build a **typed, allowlisted adapter** with per-service origin/auth config separated from 3DSpace. Start from synthetic contract fixtures, covering normal, empty, 401, 403, 404, partial/unknown, malformed JSON, malicious prompt, large-body and wrong-user scenarios. No requests to a corporate domain from CI.
3. Implement natural-language intent recognition for the three P0 operations (English + French where practical), safe ID parsing, scope confirmation and provenance. Ignore user prompts asking to bypass permissions.
4. In the premium NOVA UI use an **ITEROP / Processes** source view, well-designed process cards, compact task list and contextual right-side copilot. Show **SYNTHETIC** until the real tenant response was observed. Keep existing 3DSpace functionality and UX modes intact.
5. Follow `/nova-gen7-design`, preserve a clear operator connection-readiness screen, and leave every process action **READ-ONLY**. Any "Start process" control must be absent or clearly `PREPARED — NOT EXECUTED`.
6. Run Node 24 `npm run check`, `npm run test:e2e`; review Playwright screenshots, add tests for app selector, empty lists and permissions. Ship a feature PR with working screens and measurable results.

### P1 live authorization checklist (needed from corporate service owner)

Do **not** ask Olivier to paste credentials into Claude, public issues, or Git.

- Confirm whether the deployment supports a sanctioned **API Gateway + PFI/agent** route, a separately approved ITEROP REST client route, or neither.
- Confirm actual API service base, version/release, exact documented operation URLs for the three P0 GETs, headers and identity representation. The attachment's server templates are insufficient by themselves.
- Obtain authorized **read-only service/application credentials** in an organization-approved local secret store or corporate environment, with minimum roles/permissions and approved scope.
- Obtain approval to query one **non-confidential test process** and one task or empty-task result in an isolated environment; verify returned fields against independent expected values.
- Confirm the information may be processed by the chosen Claude/LLM runtime; until then, prohibit corporate model egress and store live responses only in approved private evidence records.

**If the role or API route is unavailable, label LIVE = BLOCKED** and complete the synthetic adapter + UI; present a short, specific access request for the application owner. Play-only browser access is not a reason to stop engineering work.

## Acceptance

**Offline:** A selected source + one natural-language request returns a traceable synthetic ITEROP response with honest status, stable action constraints, good design and passing CI.

**Live:** Under an authorized identity, the gateway retrieves the exact permitted process definition list and/or task list, displays evidence, scopes access correctly, and stops safely on permission failures. Record private verification evidence without leaking user/process data to public GitHub.

**AURA remains deferred until NOVA delivers practical live utility.**
