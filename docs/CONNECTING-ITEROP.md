# NOVA-003 — ITEROP Business Process: contract inventory and live-access requirements

**Status (7 October 2026):** the synthetic P0 slice is implemented and tested. **LIVE = `BLOCKED`.** No approved API route, credential or reviewed tenant contract exists yet, and no request has ever been sent to a corporate service.

This is an operator document, so it names the vendor product. The user-facing shell says _Business Process_. Dataset Governance is postponed; its earlier prototype is parked on the branch `claude/dataset-governance-parked`.

## 1. Specification of record

- **Source:** R2026x-FD04 Business Process API v2, `businessprocess_v2.openapi.json`. The URL is in [`references/ITEROP-R2026x-FD04-OPENAPI.md`](references/ITEROP-R2026x-FD04-OPENAPI.md). Only the link is stored in this repository; the vendor document is not copied.
- **Retrieval attempt (7 Oct 2026):** this development environment's egress proxy refused `media.3ds.com` (`curl: (22) … 403`, proxy `connect_rejected`). **NOVA has not parsed the JSON.** The inventory below is limited to facts already recorded on `main` from that release document: operationId, method, path, and the `login`/`user` constraints. No contract detail was taken from search snippets.

## 2. Operation inventory (public-safe summary)

| NOVA semantic operation           | operationId                | Method and path                                | Scope rule enforced by NOVA                                                                                                                | Status                                             |
| --------------------------------- | -------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------- |
| `iterop.list_startable_processes` | `getAllStartableProcesses` | `GET /repository/processes/startable/list`     | Human caller: the `login` parameter is never sent.                                                                                         | Inventory recorded from FD04. Schemas **pending**. |
| `iterop.list_my_tasks`            | `getTasksByUser`           | `GET /runtime/tasks`                           | Self only: `user` (and `login`) are never sent. Prompts asking for someone else's tasks are refused before any call.                       | Inventory recorded from FD04. Schemas **pending**. |
| `iterop.get_process_summary`      | `getBasicProcessInfo`      | `GET /repository/processes/{processKey}/basic` | `processKey` is either typed exactly or resolved from your own startable list. It is validated (`[A-Za-z0-9_.:-]{1,200}`) and URL-encoded. | Inventory recorded from FD04. Schemas **pending**. |

**Not implemented (P1, after contract validation):** `getProcessInfo`, `getTaskInstanceInformations`, `getInstanceInfo`, `getHistoryUserTasks`.

**Out of scope, and impossible to bind:** `startProcess` (`POST /runtime/processes/{processKey}`), task completion, assignment changes and model deployment. The contract schema accepts only the three operationIds above, with `GET`, `readOnly: true` and `principalScoped: true`.

## 3. What NOVA enforces regardless of the contract

- **Paths come from NOVA's inventory, never from the contract.** The contract can add only a tenant `basePath`. Prompt text cannot change the origin, path, credential or scope; tests send a prompt containing a foreign host, `login=`, `user=` and an `Authorization:` string, and the request still goes to the configured origin and path only.
- **Bounded requests:** one fixed HTTPS origin, `GET` only, `redirect: error`, a 12 s timeout, no retry, JSON only, a 1 MB cap and at most 100 rows.
- **Projection:** only allowlisted scalar fields survive, and required `id` and `name` must be present. Coverage is `complete`, `partial` or `unknown`; it is `unknown` unless the contract documents a total or a completeness flag.
- **401 and 403** end the mission as **Access denied for this identity**. NOVA makes exactly one request, does not retry, does not fall back to another identity or route, and does not leak the upstream error body.
- **Synthetic mode makes no network call,** even when a live configuration is present. This is tested with a request spy and by recording browser requests.
- **Writes:** start, complete, claim, assign or reassign, approve, cancel and deploy are refused before any call, in every mode. Prepare mode produces only a local draft marked `PREPARED — NOT SUBMITTED`.

## 4. What I still need from the specification

The file cannot be retrieved here, so please supply `businessprocess_v2.openapi.json` (R2026x-FD04) as a private file attachment, or paste these sections only. I need:

1. `openapi`, `info`, `servers`, `security` and `components.securitySchemes`.
2. For `getAllStartableProcesses`, `getTasksByUser` and `getBasicProcessInfo`:
   - all `parameters` (names, `in`, required flags, schemas, descriptions — especially `login`, `user` and `processInstanceId`);
   - the `200` response schema, every `$ref` it uses under `components.schemas`, and any pagination fields;
   - the documented error status codes (`400`, `401`, `403`, `404` and others).

With that, I will:

- replace NOVA's normalized field names with a reviewed mapping;
- align the synthetic fixtures to the real response shapes;
- set `requestSchemaReviewed` and `responseSchemaReviewed` honestly in a private contract;
- add schema-conformance tests.

## 5. Requirements for the first LIVE read

Obtain these privately, through the platform owner. Never put them in chat, issues or commits.

1. **A sanctioned route** (one of the following). Play sign-in alone is UI access only and does not count.
   - **API Gateway:** requires the **PFI** role, which Olivier does not hold. A PFI holder or the platform owner must provision it.
   - **Standalone ITEROP REST access:** an ITEROP administrator issues a read-only access key and secret (HTTP Basic). JWT is not compatible with API v2.
2. **Deployment facts:**
   - the exact service origin (HTTPS, no path) and any base path;
   - the deployed release and API version (a different release requires re-review);
   - the required headers (for example, whether a `SecurityContext` is needed);
   - how the identity is represented for "my" tasks.
3. **A least-privilege, read-only credential,** stored only in the private `.env` (`NOVA_ITEROP_ACCESS_KEY` and `NOVA_ITEROP_SECRET_KEY`, or `NOVA_ITEROP_ACCESS_TOKEN`).
4. **One non-confidential test process and your task-list result** (empty is fine), with the values you independently expect.
5. **Data-handling approval:** confirmation that NOVA may process these responses locally. Live responses must not leave the machine, and no model egress is allowed.

Then copy `config/iterop-contract.template.json` to `.private/iterop-contract.json`, bind the three operations with the reviewed field mapping, set the `NOVA_ITEROP_*` variables, restart NOVA, and run **Connections → Test Business Process read**.

## 6. Synthetic slice (reproducible)

The fixture is `docs/blueprint/benchmarks/fixtures/synthetic-iterop.json`. It contains invented names and keys, uses NOVA-normalized fields, and computes dates relative to today.

| Question                                                                                              | Outcome                                                                                            |
| ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Which processes can I start? / What workflows are available to me? / Quels processus puis-je lancer ? | 3 processes (`getAllStartableProcesses`). The non-startable and restricted processes are absent.   |
| What are my current tasks? / Quelles sont mes tâches en cours ?                                       | 3 of my tasks (`getTasksByUser`). Another user's task never appears.                               |
| What should I work on first?                                                                          | Ranked by due date, then priority. This is stated as a transparent rule, not a business judgement. |
| Show my overdue tasks.                                                                                | 1 overdue task. Undated tasks are called out as unclassifiable.                                    |
| Explain the Contractor Form process.                                                                  | The name resolves against my startable list, then `getBasicProcessInfo` is called.                 |
| What is this workflow?                                                                                | `needs_input`: NOVA lists candidates and never guesses.                                            |
| Explain process key `syn_restricted_audit`                                                            | **Access denied for this identity** (terminal).                                                    |
| Show Alice's tasks                                                                                    | Blocked: other people's tasks are out of scope (0 calls).                                          |
| Start / complete / reassign …                                                                         | Blocked (0 calls).                                                                                 |
| _Prepare_ to launch the contractor access form                                                        | Local draft `PREPARED — NOT SUBMITTED`.                                                            |

**Process flows on the canvas are a SYNTHETIC illustration.** They are served by `GET /api/iterop/flows`, labelled `illustration: true`, and are not returned by any P0 operation. In live mode the canvas states that the flow is unavailable: a real flow needs the reviewed P1 operation `getProcessInfo`, and NOVA never draws stages it cannot evidence.

The stdio MCP server exposes `iterop_list_startable_processes`, `iterop_list_my_tasks` and `iterop_get_process_summary`. They are synthetic by default; in live mode only admitted operations are exposed.
