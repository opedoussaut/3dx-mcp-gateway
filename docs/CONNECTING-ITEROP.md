# NOVA-003 — ITEROP Business Process: contract inventory and live-access requirements

**Status (7 October 2026):** the synthetic P0 slice is implemented and tested. **LIVE = `BLOCKED`.** No approved API route, credential or reviewed tenant contract exists yet, and no request has ever been sent to a corporate service.

This is an operator document, so it names the vendor product. The user-facing shell says _Business Process_. Dataset Governance is postponed; its earlier prototype is parked on the branch `claude/dataset-governance-parked`.

## 1. Specification of record

The official R2026x-FD04 `businessprocess_v2.openapi.json` has been **parsed and verified**:

- SHA-256 `90212fe7…6326e`;
- OpenAPI 3.1.0, API version 2.0.0;
- 50 paths, 78 operations.

The file is kept only in the Git-ignored `.private/` folder. NOVA's public-safe summary of the three P0 contracts is in **[iterop/FD04-CONTRACTS.md](iterop/FD04-CONTRACTS.md)**. `npm run iterop:openapi` re-resolves them, and `tests/iterop-fd04.test.ts` checks them against the private file whenever it is present.

## 2. Operation inventory

| NOVA semantic operation           | operationId                | Method and path                                | Scope rule enforced by NOVA                                                                                                                                                                         | Status                    |
| --------------------------------- | -------------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| `iterop.list_startable_processes` | `getAllStartableProcesses` | `GET /repository/processes/startable/list`     | Human caller; `login` is never sent (FD04: sending it is forbidden).                                                                                                                                | **Verified against FD04** |
| `iterop.list_my_tasks`            | `getTasksByUser`           | `GET /runtime/tasks`                           | `user`, `login` and `processInstanceId` are never sent. Prompts asking for someone else's tasks are refused before any call. Self-scope without `user` is **undocumented** and must be proven live. | **Verified against FD04** |
| `iterop.get_process_summary`      | `getBasicProcessInfo`      | `GET /repository/processes/{processKey}/basic` | `processKey` is typed exactly or resolved from your own startable list, then validated and URL-encoded.                                                                                             | **Verified against FD04** |

"Verified" means the operation is documented in FD04 and NOVA's request, response validation and projection match that document. It does **not** mean the operation is enabled or authorized on the tenant.

## 3. What NOVA enforces regardless of the contract

- **Paths come from NOVA's inventory, never from the contract.** The contract can add only a tenant `basePath`. Prompt text cannot change the origin, path, credential or scope; tests send a prompt containing a foreign host, `login=`, `user=` and an `Authorization:` string, and the request still goes to the configured origin and path only.
- **Bounded requests:** one fixed HTTPS origin, `GET` only, `redirect: error`, a 12 s timeout, no retry, JSON only, a 1 MB cap and at most 100 rows.
- **Projection:** only allowlisted scalar fields survive, and required `id` and `name` must be present. Coverage is `complete`, `partial` or `unknown`; it is `unknown` unless the contract documents a total or a completeness flag.
- **401 and 403** end the mission as **Access denied for this identity**. NOVA makes exactly one request, does not retry, does not fall back to another identity or route, and does not leak the upstream error body.
- **Synthetic mode makes no network call,** even when a live configuration is present. This is tested with a request spy and by recording browser requests.
- **Writes:** start, complete, claim, assign or reassign, approve, cancel and deploy are refused before any call, in every mode. Prepare mode produces only a local draft marked `PREPARED — NOT SUBMITTED`.

## 4. Authentication analysis and minimum access request

See **[iterop/ACCESS-REQUEST.md](iterop/ACCESS-REQUEST.md)**. It separates what the specification declares (HTTP Basic only, placeholder servers, human-user semantics) from what the tenant must still confirm. It also contains the message to send to the administrator.

## 5. First live read

See **[iterop/FIRST-LIVE-TEST.md](iterop/FIRST-LIVE-TEST.md)** for the three governed tests, the comparison with ITEROP Play, and the PASS / PARTIAL / DENIED / FAIL definitions.

## 6. Synthetic slice (reproducible)

The fixture is `docs/blueprint/benchmarks/fixtures/synthetic-iterop.json`. It contains invented names and keys, and its responses have the exact FD04 shapes (`{ responses: [...] }`, the `GetTaskInstanceBasicResponse` array, and `GetBasicProcessInfoResponse`). They pass through the same validation and projection as live bodies. Synthetic `startDate` values are epoch milliseconds relative to today.

| Question                                                                                              | Outcome                                                                                                                           |
| ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Which processes can I start? / What workflows are available to me? / Quels processus puis-je lancer ? | 3 processes (`getAllStartableProcesses`). The non-startable and restricted processes are absent.                                  |
| What are my current tasks? / Quelles sont mes tâches en cours ?                                       | 3 of my tasks (`getTasksByUser`). Another user's task never appears.                                                              |
| What should I work on first? / Which task has been waiting longest?                                   | Ranked by waiting time (`startDate`), stated as a transparent rule. FD04 has no due date, and its priority scale is undocumented. |
| Show my overdue tasks.                                                                                | `insufficient_evidence`: FD04 `getTasksByUser` returns no due date.                                                               |
| Explain the Contractor Form process.                                                                  | The name resolves against my startable list, then `getBasicProcessInfo` is called.                                                |
| What is this workflow?                                                                                | `needs_input`: NOVA lists candidates and never guesses.                                                                           |
| Explain process key `syn_restricted_audit`                                                            | `needs_input`: “Process unknown” (FD04 documents 404 here, not 403). Live 401/403 are terminal and covered by tests.              |
| Show Alice's tasks                                                                                    | Blocked: other people's tasks are out of scope (0 calls).                                                                         |
| Start / complete / reassign …                                                                         | Blocked (0 calls).                                                                                                                |
| _Prepare_ to launch the contractor access form                                                        | Local draft `PREPARED — NOT SUBMITTED`.                                                                                           |

**Process flows on the canvas are a SYNTHETIC illustration.** They are served by `GET /api/iterop/flows`, labelled `illustration: true`, and are not returned by any P0 operation. In live mode the canvas states that the flow is unavailable: a real flow needs the reviewed P1 operation `getProcessInfo`, and NOVA never draws stages it cannot evidence.

The stdio MCP server exposes `iterop_list_startable_processes`, `iterop_list_my_tasks` and `iterop_get_process_summary`. They are synthetic by default; in live mode only admitted operations are exposed.
