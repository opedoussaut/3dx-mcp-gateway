# NOVA-003 — Business Process (ITEROP) and Datasets Governance access map

**Status (7 October 2026):** P0-A access map complete and P0-B synthetic vertical slices implemented. **P0-C (first live ITEROP read) and P0-D (first live Datasets Governance read) are `BLOCKED`.** They are waiting on the access and contract inputs listed below, not on code. No request has been sent to any corporate service.

This document is for the operator. It names the actual vendor products so that the right teams can be asked. The user-facing NOVA shell uses the neutral labels _Business Process_ and _Datasets Governance_.

## 1. How the connectors are built

Each application has its own connector. Neither one shares anything with the engineering-item gateway (`server/gateway.ts`) or with the other application.

| Concern                                    | Business Process (`ITEROP`)                   | Datasets Governance (`DATASET_CATALOG`)           |
| ------------------------------------------ | --------------------------------------------- | ------------------------------------------------- |
| Environment prefix                         | `NOVA_ITEROP_*`                               | `NOVA_CATALOG_*`                                  |
| Contract template                          | `config/iterop-contract.template.json`        | `config/catalog-contract.template.json`           |
| Documentation hosts accepted in a contract | `doc.iterop.com`, `*.3ds.com`                 | `*.3ds.com`                                       |
| Minimum live slice                         | `iterop.list_my_tasks`                        | `catalog.search_datasets` + `catalog.get_dataset` |
| Auth modes supported by the adapter        | `basic` (access key / secret key) or `bearer` | `bearer` or `basic`                               |
| `SecurityContext` header                   | Only if the contract says `REQUIRED`          | Only if the contract says `REQUIRED`              |

What every live call goes through:

1. The operator chooses the application in the UI. Prompt text can never switch the application, the service origin or the credential.
2. A deterministic router (`server/apps/missions.ts`) maps the question to a **semantic** operation, such as `iterop.list_my_tasks`. Identifiers are taken word for word from the prompt and are never inferred.
3. The connector (`server/apps/connector.ts`) runs that operation only if a reviewed private contract binds it. The binding must be GET, read-only, `PUBLIC_SUPPORTED` and documented, with a reviewed request and response schema and no CSRF. Requests go to one fixed HTTPS origin, follow no redirects, time out after 12 s, are never retried, and are capped at 1 MB and 100 rows.
4. Only allowlisted, normalized scalar fields survive projection. Missing required fields are treated as a schema mismatch. Coverage is reported as `complete`, `partial` or `unknown`, and is `unknown` unless the contract documents a total or a completeness flag.
5. A 401 or 403 stops the mission as **Access denied for this principal**. There is no retry and no fallback to another identity or route. Upstream error bodies never reach the browser.
6. Write-like requests are refused before any call. For ITEROP that means start, complete, claim, approve, cancel and similar. For the catalog it means download, export, extract, join and edit. In Prepare (ACT) mode NOVA produces only a local draft, labelled `PREPARED — NOT SUBMITTED`.

The semantic operation names are NOVA's intentions. **They are not claims about real endpoints.** The paths in a contract must come from official documentation for your exact release.

## 2. Business Process (ITEROP): findings

| Item                                 | Finding                                                                                                                                                                                                                                                                                                | Status                                          |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------- |
| Product API family                   | ITEROP documents a REST API. Administrators create REST access credentials (an access key and secret key pair) under _Administration → REST access_, with an access-rights type. HTTP Basic is supported. A JWT can be requested with `POST /api/auth/jwt`, but JWT is **not compatible with API v2**. | Public documentation lead. Not tenant-verified. |
| Platform-integrated route            | Business Process Designer notes describe the "ITEROP API via API Gateway", for which the **PFI (Enterprise Integration Architect) role is mandatory**. The 2026x FD01 release notes mention API Gateway changes.                                                                                       | Lead. Olivier reports **not having PFI**.       |
| Task, process and history operations | The ITEROP Play UI has tasks, processes and history screens. That the UI exists does **not** prove that equivalent public REST read operations exist for this deployment.                                                                                                                              | `UNVERIFIED`                                    |
| Research limits in this session      | `doc.iterop.com` and `3dswym.3dexperience.3ds.com` were blocked by this environment's network egress policy. The findings above come from search-result extracts of those pages. Exact paths, schemas, pagination and role requirements were therefore **not** read.                                   | Needs operator review                           |

**Smallest legitimate path to a first live ITEROP read (P0-C).** Choose **one** of these:

- **Route A — direct ITEROP REST access (preferred if policy allows).** The ITEROP tenant administrator issues a dedicated, **read-only** REST access credential for NOVA, scoped to a test principal. This does not bypass PFI: it is a separate, administrator-approved credential and needs that administrator's sign-off.
- **Route B — API Gateway.** A person holding PFI, or the platform owner, provisions the API Gateway access for NOVA's read operations, or grants Olivier the role.

Either way, provide the following **privately**. Never paste it into chat, issues or commits:

1. The ITEROP deployment: the service origin (`https://…`, no path), the exact release (for example 2026x FD0x), and the API version (v1 or v2).
2. The official documentation pages, for that release, for these operations:
   - list the tasks assigned to the authenticated principal;
   - list the process definitions the principal may start;
   - read one process instance;
   - read one instance's steps or history.

   For each operation, give the method, path, query parameters, response schema, pagination fields, and whether the results are filtered to the principal.

3. Which authentication mode is approved: Basic with an access key/secret, or a bearer token through the gateway. Also say who issues the credential and which role or licence it carries.
4. One **non-sensitive** test process instance or task identifier, and its expected status, assigned person and due date as seen in the ITEROP UI.
5. Confirmation that NOVA may call this service from Olivier's workstation, so that it is not a policy violation.

Then copy `config/iterop-contract.template.json` to `.private/iterop-contract.json`, bind only the reviewed operations, set the `NOVA_ITEROP_*` variables in `.env`, restart NOVA, and use **Connections → Test Business Process read**.

## 3. Datasets Governance (data catalog): findings

| Item               | Finding                                                                                                                                                                                                                                    | Status                             |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------- |
| Product            | The Datasets Governance data catalog. Community pages associate it with the **Data Steward** role. They describe a _related_ tab, metadata, lineage and provenance.                                                                        | Public lead                        |
| External REST API  | **No official, release-scoped external REST API for the catalog has been found.** General platform REST services exist (3DPassport authentication, 3DSwym, People and Organization data), but none was shown to cover the dataset catalog. | `BLOCKED` — first research blocker |
| Undocumented calls | Browser network calls made by the catalog UI are **not** an acceptable contract. NOVA will not use cookies or undocumented endpoints.                                                                                                      | Policy                             |

**Smallest legitimate path to a first live catalog read (P0-D):**

1. Ask the platform owner or Dassault Systèmes support/Developer Assistance (through Olivier's authorized channel) whether a **documented, supported API** exists for searching catalog datasets and reading a dataset's metadata, related items and lineage, for the deployed release. Ask for the documentation URL on `*.3ds.com`.
2. If it exists, provide the same details as for ITEROP:
   - origin, release and API version;
   - method, path, parameters and response schema for each operation;
   - authentication mode, role and licence (Data Steward or other), and whether a `SecurityContext` is needed;
   - one **non-sensitive** test dataset identifier with its owner and classification as shown in the UI.
3. Confirm that catalog **metadata** may be processed locally by NOVA. Catalog metadata can itself be confidential. No dataset content will be read.

If no documented API exists, P0-D stays `BLOCKED`. The synthetic adapter remains the working substitute and is labelled `SYNTHETIC` everywhere.

## 4. What works now (synthetic, reproducible)

Fixtures: `docs/blueprint/benchmarks/fixtures/synthetic-business-process.json` and `synthetic-dataset-catalog.json`. These are invented records. Their dates are computed relative to "today" so the demo stays current.

| Question (Business Process)                                    | Outcome                                                                                                   |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| What processes am I allowed to start?                          | 3 startable definitions. The non-startable one is excluded.                                               |
| Show the tasks assigned to me, sorted by due date or priority. | 3 tasks. The past-due task is flagged and the undated task is called out. Sorting by priority also works. |
| What is the status of process PI-SYN-1042?                     | RUNNING, current step, initiator and dates.                                                               |
| Which steps and approvals remain on PI-SYN-1042?               | 3 steps remain, 2 of them approvals. Shown as a timeline.                                                 |
| Explain why TSK-SYN-302 needs my attention.                    | Answered from metadata only (assigned, past due, priority, step). No cause is invented.                   |
| Status of PI-SYN-9001                                          | **Access denied for this principal.** No retry.                                                           |
| Start the contractor access form                               | **Blocked** (write).                                                                                      |
| _Prepare_ to launch the contractor access form…                | Local draft, `PREPARED — NOT SUBMITTED`.                                                                  |

| Question (Datasets Governance)                                     | Outcome                                                                                         |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| Find datasets related to thermal cooling.                          | 2 visible datasets. The restricted dataset is not revealed.                                     |
| Who owns dataset DS-SYN-THERM-01…?                                 | Owner, steward and description.                                                                 |
| Which other datasets or assets are related to DS-SYN-THERM-01?     | 4 relationships, shown as a relationship map.                                                   |
| What is the lineage, freshness, classification of DS-SYN-THERM-01? | 1 upstream and 1 downstream, update date, INTERNAL.                                             |
| Is DS-SYN-MAT-02 suitable for a 48 V qualification experiment?     | `insufficient_evidence`: DRAFT status, no update date, no lineage. Not a compliance assessment. |
| Download DS-SYN-THERM-01                                           | **Blocked** (no content extraction).                                                            |

The same operations are exposed by the stdio MCP server as `iterop_*` and `catalog_*` tools. They are synthetic by default. In live mode, only admitted operations are exposed.

## 5. Not done, by design

- No process start, task completion, claim or approval. No dataset download, export, join or catalog edit.
- No browser-cookie reuse, CAS/SSO automation, token refresh, or discovery of undocumented endpoints.
- No model egress of catalog or process data. Routing is deterministic.
- No multi-turn memory. "That process" asks for the identifier instead of guessing.
