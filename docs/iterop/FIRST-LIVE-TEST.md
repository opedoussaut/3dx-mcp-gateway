# ITEROP — first governed live read: procedure

**Do not run this until** the administrator has answered [ACCESS-REQUEST.md](ACCESS-REQUEST.md) and the private configuration is in place. Synthetic mode stays the default.

## Preconditions

1. In `.env` (never committed), the `NOVA_ITEROP_*` values come from the administrator's answer.
2. In `.private/iterop-contract.json`, which starts from `config/iterop-contract.template.json`:
   - `release` and `basePath` come from the administrator;
   - `authMode` matches the confirmed mechanism;
   - only the three operations are bound;
   - `taskStartDateUnit` is `"unverified"`.
3. `npm run check` passes, and `npm run iterop:openapi` reports `sha256MatchesNova: true`.
4. **Connections → Business Process** shows _Live read admitted_.
5. Olivier has ITEROP Play open in his browser as the comparison source. NOVA does not touch that session.
6. Records stay local: export each NOVA mission (JSON) into `.private/live-evidence/<date>/`. Do not put screenshots of real processes into the repository or any external service.

**Optional connectivity probe:** _Connections → Test Business Process read_ sends exactly one `getTasksByUser` request. Any 401/403 stops the procedure; record the result as **DENIED** and return to the administrator.

## Test 1 — "Which processes can I start?"

- **Call made:** exactly one `GET {base}/repository/processes/startable/list`, with no query parameters.
- **Comparison:**
  1. In Play, open the list of processes you can start.
  2. Compare the set of **names** (and keys if Play shows them) with NOVA's list.
  3. Compare the **version** wherever Play displays it.
- **Also check:** Provenance shows `getAllStartableProcesses`, `LIVE`, coverage `complete` (100 or fewer rows) and outcome `ok`, and the request carried no `login`.

## Test 2 — "What are my current tasks?"

- **Call made:** exactly one `GET {base}/runtime/tasks`, with **no `user`** and no `processInstanceId`.
- **Comparison:**
  1. Compare the Play task inbox (current or active tasks) with NOVA's list on **count**, **task names** and **process name / instance identificator**.
  2. An empty Play inbox must give an empty NOVA list.
- **This test also proves:**
  - **Self-scope:** the returned tasks are Olivier's own. This turns the undocumented "no `user` means me" assumption into a verified fact for this tenant.
  - **The `startDate` unit:** compare one task's start date in Play with the raw `startDate` shown in Evidence, and decide whether it is milliseconds or seconds. Only then set `taskStartDateUnit` in the private contract and restart.

## Test 3 — "Explain the <known test> process."

- **Call made:** one `getAllStartableProcesses` to resolve the name, then one `GET {base}/repository/processes/{processKey}/basic`. Use the exact key form ("Explain the process key <key>") to make the single summary call alone.
- **Comparison:** compare **key, name, version and description** with Play or with what the administrator stated for the test process.

## Outcome definitions (applied to each test)

| Outcome     | Definition                                                                                                                                                                                                                                                                                                                                                                |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **PASS**    | HTTP 200, the body validates against the FD04 schema, and NOVA's answer matches Play exactly for the compared fields: the same set of processes, the same tasks, or the same key/name/version/description. Provenance shows the documented operation, `LIVE`, the expected scope, and no forbidden parameter. Zero writes.                                                |
| **PARTIAL** | HTTP 200 and schema-valid, but the comparison is incomplete for a stated, explainable reason. Examples: a field Play shows is absent from the API response; ordering differs; the `startDate` unit cannot yet be decided; coverage is `partial` because there are more than 100 rows; or Play shows items that are not startable or active. Record exactly what differed. |
| **DENIED**  | HTTP 401 or 403. NOVA stops after one request with no retry and no alternative identity or route. This means a route, credential or entitlement issue for the administrator. It is not a code defect.                                                                                                                                                                     |
| **FAIL**    | Anything that contradicts Play or the contract: tasks that are not Olivier's; a schema mismatch; a non-JSON response; a redirect; a 5xx; a 404 for your own tasks; any request other than the three GETs; or any parameter NOVA must never send. Stop and investigate before any further call.                                                                            |

## Exit criteria for the first live milestone

- Tests 1–3 all **PASS**, or **PARTIAL** with every difference understood and documented.
- The self-scope of `getTasksByUser` without `user` is confirmed.
- The `startDate` unit is recorded.
- The evidence is kept privately.
- Only then may the UI show live data by default for Olivier.
