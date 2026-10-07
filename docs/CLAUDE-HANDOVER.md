# NOVA / 3dx-mcp-gateway — full handover to Claude

| Field                         | Value                                            |
| ----------------------------- | ------------------------------------------------ |
| Handover date                 | 7 October 2026                                   |
| Project owner                 | Olivier Pedoussaut                               |
| Incoming implementation owner | Claude                                           |
| Repository                    | <https://github.com/opedoussaut/3dx-mcp-gateway> |
| Application baseline          | v0.2.0                                           |

> **Update — NOVA-003, ITEROP first (7 October 2026):** The ITEROP Business Process connector, the synthetic P0 slice and the GEN7 workspace are implemented. See [CONNECTING-ITEROP.md](CONNECTING-ITEROP.md) and [ADR-011](decisions/ADR-011.md). The app opens on **Business Process**. LIVE is `BLOCKED` on an approved route, a credential and the FD04 schemas. Dataset Governance (parked branch) and AURA are deferred. The tables below describe the earlier v0.2 baseline.

## 1. Ownership and mandate

Claude, Olivier has asked you to take over the **entire project**. You now lead its implementation and evolution: product design, user interface, architecture, runtime, platform integration, models, MCP, evaluation against AURA, quality, documentation, and delivery. This is a continuation of an existing working codebase, not a request for another proposal.

Work directly in `opedoussaut/3dx-mcp-gateway`. Make routine engineering decisions, investigate issues, implement changes, verify them, and maintain the project without routing decisions back through ChatGPT. You may refactor, change dependencies, or revise the architecture where that improves the outcome; explain consequential changes and preserve a reproducible working baseline. Olivier remains the owner and decides product priorities and any external commitments that require his authority.

The handover transfers implementation responsibility. It does not install Claude, start a Claude session, transfer credentials, or create permissions in GitHub, 3DEXPERIENCE, AURA, or a hosting service. Use the actual access in your environment. When something is unavailable, finish the unblocked work and request the smallest specific missing input.

### What Olivier wants

- A polished interface for working with his corporate 3DEXPERIENCE platform through natural language.
- Useful engineering results with traceable evidence, understandable execution, and honest measurements.
- A practical way to evaluate the same missions with AURA.
- All implementation maintained in this repository.
- Continued delivery of working software, with precise statements about what is operational and what remains incomplete.

Do not mistake the existing synthetic demonstrator for the completed corporate integration. Reaching a validated private live workflow is the next substantive milestone.

## 2. Verified transfer baseline

The following was checked against GitHub during handover preparation. Recheck the remote if continuing later.

| Item                                        | Verified state                                                                                                                                   |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Source branch                               | `main`                                                                                                                                           |
| Implementation commit                       | [`21cf63f5fcd870aabb444d2533e6982779380e52`](https://github.com/opedoussaut/3dx-mcp-gateway/commit/21cf63f5fcd870aabb444d2533e6982779380e52)     |
| Implementation Git tree                     | `539b2a12b5ef6a1817c08abcfc08852d561df9a3`                                                                                                       |
| Source inventory at that commit             | 69 tracked files, including source, tests, blueprint, configuration examples, and a UI screenshot                                                |
| GitHub CI                                   | [Verify NOVA run 37569242312](https://github.com/opedoussaut/3dx-mcp-gateway/actions/runs/37569242312), completed successfully on 7 October 2026 |
| CI steps confirmed successful               | `npm ci`, `npm run check`, Chromium installation, and `npm run test:e2e`                                                                         |
| Recorded local validation                   | 19 runtime/API/MCP tests and 12 browser test executions passed; TypeScript and production build passed                                           |
| Dependency audit at implementation delivery | `npm audit --omit=dev --audit-level=high` reported zero vulnerabilities at that time; this is a dated result                                     |
| Hosting                                     | Source is published on GitHub. No hosted application deployment is included in this handover                                                     |
| Corporate integration                       | No real tenant connection has been validated                                                                                                     |
| AURA evaluation                             | No real AURA run has been recorded or scored                                                                                                     |
| Local model evaluation                      | No real Ollama inference run has been validated                                                                                                  |

The documentation commit containing this handover comes after the implementation commit above. The baseline identifier deliberately names the code that was tested, rather than treating a changing `main` branch as a fixed artifact.

All code required for the synthetic application is in the repository. No previous chat, scratch directory, generated Word document, or external asset is needed to run it. Private credentials, corporate materials, and a real model installation are not part of the public source.

## 3. Product experience and current capability

The UI is named **NOVA**. It uses a warm off-white background, dark text, restrained orange accents, a persistent desktop sidebar, and mobile navigation. Its actual appearance is captured in [the workspace screenshot](screenshots/workspace.png). The screenshot contains synthetic content.

There are four views:

| View            | Current behavior                                                                                                                                                                |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mission control | Natural-language composer, ASK / INVESTIGATE / ACT modes, five guided missions, session history, evidence cards, execution trace, and JSON export                               |
| AURA comparison | Run an exact NOVA benchmark prompt, copy that prompt, download a shared synthetic context pack, manually enter the visible AURA response and metadata, save and export the pair |
| Connections     | Readiness checks for private server configuration and reviewed bindings; one identity read when its binding is admitted                                                         |
| Tool registry   | Search and filter 20 researched capabilities; distinguish local utilities, unverified candidates, and admitted private bindings                                                 |

The source selector distinguishes `synthetic` from `live`. Connection readiness is not evidence of a completed live mission. An identity check only establishes that the reviewed identity operation succeeded under the supplied configuration.

### Executable scope

| Area              | Implemented                                                                                                                            | Remaining boundary                                                                                            |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Natural language  | Deterministic intent/identifier routing with some English and French patterns                                                          | Not general conversation; no multi-turn task state or open-ended reasoning                                    |
| Engineering logic | Search, synthetic revision eligibility, structure occurrence counts, a bounded revision comparison, qualification review, local drafts | Several mission rules and explanations are specific to the supplied synthetic corpus                          |
| Model provider    | Optional local Ollama structured intent classifier for otherwise unknown wording                                                       | Disabled by default; mock-tested, not evaluated with a real model; no remote provider implementation          |
| Read gateway      | Reviewed GET bindings, field projection, bounded responses, coverage reporting                                                         | No reviewed corporate contract is included; no automated login, pagination traversal, or multi-origin routing |
| MCP               | Separate working stdio server using the official TypeScript SDK                                                                        | No MCP-over-HTTP deployment or A2A agent system                                                               |
| Action mode       | Local draft with evidence references, expiry metadata, and SHA-256 digest                                                              | No authenticated approval, upstream submit, commit, or mutation path                                          |
| Observations      | Session-scoped mission and AURA records with JSON export                                                                               | No database, import workflow, durable audit trail, or user accounts                                           |
| Deployment        | Local operator machine, loopback HTTP service                                                                                          | No production multi-user or public cloud deployment                                                           |

The full blueprint is the architecture target. [`IMPLEMENTATION.md`](IMPLEMENTATION.md) describes the executable slice. Some architecture decision records still say “implementation pending”; treat those as historical blueprint status, not a current inventory of completed features.

## 4. Start and operate the application

Use **Node 24**, as selected by `.nvmrc` and CI. `package.json` declares a minimum of Node 22.12. Use npm and the committed `package-lock.json`; there is no reason to upgrade the stack just to begin the handover.

```bash
git clone https://github.com/opedoussaut/3dx-mcp-gateway.git
cd 3dx-mcp-gateway
npm ci
npm run dev
```

Open <http://127.0.0.1:3000>. No `.env`, tenant credential, or model is needed for synthetic use. Select a guided mission and run it.

For the production client build served by the same local backend:

```bash
npm run build
npm start
```

Run all existing verification:

```bash
npm run check
npx playwright install chromium
npm run test:e2e
```

`npm run check` runs type checking, Node tests, and the build. Browser tests use the production build and start `npm start` themselves. Port 3000 must be free. On a fresh Linux environment, use `npx playwright install --with-deps chromium` if system browser dependencies are missing and installation is allowed.

| Command             | Purpose                                                      |
| ------------------- | ------------------------------------------------------------ |
| `npm run dev`       | Express with Vite middleware; starts at `127.0.0.1:3000`     |
| `npm run build`     | Type check, then build the browser assets into `dist/client` |
| `npm start`         | Express serving the existing production browser build        |
| `npm run typecheck` | TypeScript check only                                        |
| `npm test`          | Node runtime, HTTP, and MCP tests                            |
| `npm run test:e2e`  | Playwright desktop and Pixel 7 viewport projects             |
| `npm run mcp`       | Separate stdio MCP process                                   |

The server loads `.env` from its working directory. Run from the repository root. `PORT` defaults to 3000 and must be an integer from 1024 to 65535. Both development and production runtime bind to `127.0.0.1`.

The server executes TypeScript through `node --import tsx`; it is not bundled into a standalone backend distribution. A deployment must retain the necessary runtime tooling, which currently sits partly in `devDependencies`. Do not assume `npm ci --omit=dev` alone produces a runnable server.

### Local MCP use

The README contains an example MCP client configuration. Use the Node executable and repository paths for the actual machine, set the working directory to the repository, and start with `NOVA_MCP_SOURCE=synthetic`. Client configuration formats differ, so adapt the example to the installed client instead of copying paths blindly.

Only MCP protocol output goes to stdout. The web application and MCP process share source code and gateway semantics, but they are separate processes; the web app does not invoke an MCP transport for its internal calls.

## 5. Code map and architecture

The baseline pins React 19.3.0, Vite 8.3.2, TypeScript 7.0.2, Express 5.2.1, Zod 4.6.5, MCP SDK 1.32.1, and Playwright 1.63.0. These are repository facts at the transfer commit, not claims about the latest available packages. The lockfile is authoritative for the installed dependency tree.

| Path                            | Responsibility                                                                                  |
| ------------------------------- | ----------------------------------------------------------------------------------------------- |
| `src/App.tsx`                   | Application shell, navigation, composer, mission state/history, help, and source/mode selection |
| `src/Compare.tsx`               | AURA observation form, exact benchmark runs, saved observations, and export                     |
| `src/Settings.tsx`              | Connection readiness and searchable capability registry                                         |
| `src/ui.tsx`                    | Shared visual elements, evidence rendering, result cards, and copy controls                     |
| `src/api.ts`                    | Same-origin browser API helper and JSON download helper                                         |
| `src/styles.css`                | Visual design, responsiveness, state styling, and focus treatment                               |
| `server/index.ts`               | Environment loading, development/production hosting, production CSP, and loopback listener      |
| `server/app.ts`                 | HTTP routes, input validation, sessions, request limits, and origin/host checks                 |
| `server/missions.ts`            | Mission execution, engineering rules, traces, metrics, and local draft preparation              |
| `server/provider.ts`            | Deterministic routing, provider interface, and optional Ollama classifier                       |
| `server/config.ts`              | Private configuration loading, Zod binding schema, admission checks, and non-secret status      |
| `server/gateway.ts`             | Synthetic adapter and private live GET adapter; evidence projection and coverage                |
| `server/mcp.ts`                 | MCP tool registration and stdio transport                                                       |
| `shared/types.ts`               | Runtime mission, evidence, observation, tool, and readiness types                               |
| `shared/benchmarks.ts`          | Five executable benchmark prompts and their modes                                               |
| `config/contract.template.json` | Intentionally unverified private binding template                                               |
| `tests/`                        | Runtime, HTTP, MCP, and browser tests                                                           |
| `docs/blueprint/`               | Original architecture, research, registry, schemas, benchmark protocol, and synthetic fixtures  |
| `docs/decisions/`               | Ten architecture decision records                                                               |
| `.github/workflows/ci.yml`      | Push/PR validation on Node 24                                                                   |

### Request execution

1. The browser posts a prompt, source, and mode to `/api/missions`.
2. The HTTP layer validates the origin, session, and request schema.
3. `MissionRunner` applies the read-only boundary and source readiness checks.
4. Deterministic routing identifies a supported intent. Only an otherwise unknown intent may use the explicitly enabled local classifier.
5. The runner invokes named semantic gateway tools and applies ordinary code to the returned records.
6. The result carries its status, findings, evidence, trace, and measured counters back to the UI.

An MCP client invokes the same gateway tools through `server/mcp.ts` directly. It does not run the web mission orchestrator automatically. Its host is responsible for subsequent use of returned evidence, including any model egress.

### Runtime contracts and observability

Mission states are `completed`, `needs_input`, `blocked`, `insufficient_evidence`, and `prepared`. Evidence contains an ID, title, source, retrieval timestamp, and projected scalar fields. Tool coverage is `complete`, `partial`, or `unknown`.

Elapsed time measures the NOVA server request, not full user interaction time. Tool/model counters count attempts. Deterministic routing reports zero model tokens; missing provider usage is unknown. `costUsd` is `null` because the runtime has no complete compute/pricing meter. Platform writes remain zero in this implementation.

The trace is an explanation of policy, routing, tool execution, and evidence attachment. It is not a record of hidden model reasoning or a raw HTTP capture.

### Local HTTP interface

| Method and path              | Purpose                                                                        |
| ---------------------------- | ------------------------------------------------------------------------------ |
| `GET /api/status`            | Non-secret readiness and admitted-tool summary                                 |
| `GET /api/benchmarks`        | Executable benchmark definitions                                               |
| `GET /api/registry`          | Research registry with runtime admission labels                                |
| `GET /api/missions`          | Current session mission history                                                |
| `POST /api/missions`         | Run `{ prompt, source, mode }`                                                 |
| `POST /api/connection/test`  | One admitted live identity read                                                |
| `GET /api/benchmark-context` | Download synthetic source facts and policy, excluding negative-case assertions |
| `GET /api/comparisons`       | Current session observations                                                   |
| `POST /api/comparisons`      | Save an observation associated with an exact benchmark mission                 |
| `POST /api/session/clear`    | Clear mission and observation records in this session                          |

All local POSTs require JSON, the exact HTTP origin, and `X-Nova-Client: workspace`. They modify local session state or run reads; none is a corporate mutation endpoint. The browser helper supplies the required headers. There is no generic upstream proxy route.

## 6. 3DEXPERIENCE integration and outstanding inputs

Read [`CONNECTING.md`](CONNECTING.md) before changing this layer. The official developer-guide entry point is <https://www.3ds.com/support/documentation/developer-guides>. Initial research encountered sign-in gates; it did not establish complete operation contracts for Olivier's corporate deployment.

### Existing capabilities

The MCP server always exposes `get_runtime_status` and `list_capabilities`. In synthetic mode it also exposes these six reads:

| Semantic tool              | Expected role                             |
| -------------------------- | ----------------------------------------- |
| `get_current_user`         | Identity read                             |
| `search_engineering_items` | Search item/revision records              |
| `get_engineering_item`     | Retrieve one item record                  |
| `get_product_structure`    | Retrieve configured occurrence records    |
| `get_requirements`         | Retrieve mapped requirement evidence      |
| `search_knowledge`         | Retrieve qualification/knowledge evidence |

In live mode, only admitted private bindings are exposed, and readiness blockers suppress platform tools. The research registry contains 20 entries: two local utilities and 18 platform-related candidates. It is not a list of 20 implemented, live APIs. Process launch, task completion, effectivity, datasets, and other researched candidates remain future work.

### Private configuration

```bash
cp .env.example .env
mkdir -p .private
cp config/contract.template.json .private/verified-contract.json
```

The template is deliberately not executable as a verified contract. Complete it only from a real review. `.env` and `.private/` are ignored by Git.

| Variable                                | Purpose                                                                        |
| --------------------------------------- | ------------------------------------------------------------------------------ |
| `NOVA_TENANT_ORIGIN`                    | Exact HTTPS service origin; no credentials, path, query, or fragment           |
| `NOVA_RELEASE`                          | Exact reviewed release                                                         |
| `NOVA_SECURITY_CONTEXT`                 | Authorized context for the server-side `SecurityContext` header                |
| `NOVA_CONTRACT_FILE`                    | Path to the private reviewed manifest                                          |
| `NOVA_AUTH_MODE`                        | `bearer` or `basic`, matching the contract                                     |
| `NOVA_ACCESS_TOKEN`                     | Pre-provisioned bearer token when documented                                   |
| `NOVA_CLIENT_ID` / `NOVA_CLIENT_SECRET` | Basic credential pair when documented                                          |
| `NOVA_MCP_SOURCE`                       | `synthetic` by default; explicitly choose `live` for an authorized MCP runtime |

Supporting bearer and Basic header construction is not evidence that either works for the corporate tenant. There is no CAS/browser SSO flow, OAuth grant exchange, or token refresh. Being logged into a platform browser session does not authenticate this server.

The manifest records schema version, release, auth mechanism, reviewer, review date, and individual operations. Each binding includes the documented method/path, public-support classification, role/license requirements, documentation source, reviewed request/response schemas, CSRF requirement, and field mappings. The present adapter accepts **GET, read-only, no-CSRF** contracts only. A documented POST-based read needs an intentional adapter extension; do not change its method in the manifest to make it pass.

Core live readiness requires both `search_engineering_items` and `get_engineering_item`. The connection test additionally requires `get_current_user`. Bindings currently share one service origin and one authentication context. Mappings use simple property paths, one optional `{id}` placeholder, and a documented search query parameter. Unknown pagination/coverage stays unknown.

### Minimum inputs for the first real mission

Obtain through Olivier or the authorized platform owner, in a private channel or local configuration:

1. The exact deployment/release and service origin for the intended read operations.
2. The supported authentication/provisioning method for that service and operator.
3. The approved principal, roles/licenses, and security context.
4. Release-specific official contracts for identity if available, engineering search, and item retrieval, including schemas and coverage semantics.
5. One authorized test item identifier and the independently known expected result.
6. For review eligibility beyond retrieval, an approved tenant policy defining the required fields and admissible states.

Start with a known-item read and retain private evidence of the result. Do not declare review eligibility solely from a maturity label: the live revision mission intentionally returns `insufficient_evidence` until the tenant review policy is implemented. Add only the authentication, mapping, or pagination features required by the verified contracts.

Private corporate reference PDFs were provided separately under the names `howtoclassify.pdf`, `rasci.pdf`, and `howtoqualify.pdf`. Their contents are not reproduced in this repository or this handover and were not used as public API evidence. If needed for a future policy or workflow, obtain them privately from Olivier and confirm their intended application; do not assume their presence in a fresh checkout.

## 7. Models, language, and engineering generalization

The current application is intentionally usable without any model. `deterministicRoute` extracts an identifier and classifies a small family of requests. Some extraction rules and answers assume the synthetic cooling/controller/material examples. Synthetic knowledge and requirement adapters are fixture-oriented, not general production search implementations. Generalization needs real schemas, scope handling, and tests on independent cases.

The optional Ollama path uses a fixed JSON intent schema at a loopback `/api/chat` endpoint. Enable it only in the private configuration:

```dotenv
NOVA_MODEL_PROVIDER=ollama
NOVA_MODEL_URL=http://127.0.0.1:11434
NOVA_MODEL_NAME=your-installed-compatible-model
NOVA_MODEL_EGRESS=true
```

Only mission text and the classifier instructions are sent. Retrieved engineering evidence and credentials are not included. The adapter validates the returned intent, rejects an invented identifier, and cannot grant additional tools or authorize writes. It has a 25-second request timeout. Its presence does not prove model quality or hardware suitability.

Claude may extend the provider layer, introduce controlled conversational clarification, and improve engineering reasoning. Keep supported evidence, scope, provenance, and access limits explicit. Add a model because a measured task needs it; do not turn zero-model baseline results into fictitious AI inference metrics.

There is currently no learned decision model, Jev/System-One integration, specialist-agent network, or A2A implementation. Those appear in the architecture direction, not the executable transfer baseline.

## 8. AURA comparison and benchmark facts

The canonical executable prompts live in `shared/benchmarks.ts`. Use those exact strings when reproducing the UI workflow. The following are expected **synthetic** outcomes, not observations of AURA:

| Mission             | Scope and expected result                                                                                                                |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| B01 — revision      | `SYN-COOL-100` revision B satisfies the supplied synthetic review policy; exclude superseded A and an unrelated item with the same title |
| B02 — structure     | Revision B in `BENCH-48V`: two included occurrence records referring to one unique fan reference                                         |
| B03 — comparison    | `SYN-CTRL-100` A/B: connector J1 to J2; pin count 4 to 6; voltage unchanged at 48 V; review the linked interface requirement             |
| B04 — qualification | M2 evidence for `BENCH-24V` does not establish qualification for `BENCH-48V`; expose missing evidence and superseded advice              |
| B05 — preparation   | Create a local draft for the M2 substitution review, cite evidence, and submit nothing                                                   |

### Current observation procedure

1. Select a mission in AURA comparison and run NOVA.
2. Copy its exact prompt. For a synthetic comparison, make the same exported source facts and policy accessible in AURA through a supported, authorized workflow.
3. Run the prompt in the actual AURA environment.
4. Enter its visible response, release, competency, citations, and optional elapsed time. Declare matching context only if justified.
5. Save and export the observation; store real corporate observations privately.

The server checks that the saved NOVA mission belongs to the session and matches the chosen benchmark prompt and mode. The matching-context flag is an operator declaration, not independent validation. The current UI does not establish full identity/corpus parity automatically.

AURA tool calls, tokens, and costs remain `null` with visibility `NOT_OBSERVABLE`. NOVA server elapsed time and manually entered AURA interaction time are different boundaries; do not rank them as equivalent latency without harmonizing the measurement procedure.

### Evaluation work that remains

The [blueprint benchmark protocol](blueprint/benchmarks/scoring/PROTOCOL.md) specifies common-access versus deployment-capability tracks, a frozen context and assistance budget, counterbalanced order, at least five paired pilot repetitions per mission, negative cases, and domain review. Those are protocol requirements, not completed trials.

There is a concrete schema/rubric difference to resolve before a scored study: **the UI stores optional 0–2 scores for correctness, evidence, and completeness; the blueprint protocol specifies 0–4 scores for correctness, completeness, groundedness, and engineering usefulness.** The executable runtime types and Zod input validation are in `shared/types.ts` and `server/app.ts`; the blueprint schemas are not automatically enforced by the runtime. Version and align the protocol, form, export, and schemas deliberately. Do not silently reinterpret old observations.

Repeated runs on five fixed fixtures measure variation on those fixtures. Broader quality claims require independent mission instances. Expected answers and evaluator assertions must remain outside the context given to the compared systems. No AURA superiority, cost advantage, or architecture-causality conclusion has been established.

## 9. Security, data, and operational limits

These describe the current implementation. They are not a certification of a production deployment.

- The trusted boundary is the local operator and OS. There are no application user accounts or tenant vault.
- The runtime accepts loopback host names and rejects cross-site API use. Local POSTs require origin/header checks; no CORS integration is configured.
- API responses use `Cache-Control: no-store`. Sessions use an HTTP-only, SameSite=Strict cookie with an eight-hour maximum age; records are kept in process memory, with inactivity cleanup. Restarting clears them.
- State is bounded to 100 sessions, 50 missions and 20 observations per session. API traffic is limited to 90 requests per minute per session, and only one mission runs at a time in a session. These are local safeguards, not a complete multi-user rate-limiting design.
- Mission prompts are limited to 2,000 characters; JSON request bodies to 64 KB. Gateway responses are limited to one megabyte and 100 projected records. These caps may yield partial results rather than full platform coverage.
- Live requests use the fixed configured origin, no redirects, a 12-second timeout, and no retry or identity fallback on denial. Raw upstream errors and authorization headers are not returned to the browser.
- Only allowlisted scalar evidence fields survive projection. Engineering records must satisfy their runtime schema. Record text is rendered as text and never interpreted as tool instructions.
- The optional model endpoint is constrained to loopback and explicit prompt egress. An MCP host receiving live evidence must independently be authorized to process it.
- No prompt or raw network logging is implemented. JSON exports may contain confidential live evidence; the current application does not implement a corporate data-classification or export-approval system.
- A local draft's digest and expiry are metadata, not signed authorization. There is no commit endpoint that consumes them. A future write workflow needs authenticated approval binding, concurrency/precondition handling, replay protection, and reconciliation according to verified upstream semantics.

Do not put private `.env`, completed contracts, corporate exports, live screenshots, browser session material, model keys, or real AURA records into commits or public CI artifacts. Changing the public deployment model requires more than binding the server to `0.0.0.0` or disabling the host/origin checks.

## 10. Verification, reproduction, and caveats

The transfer baseline had **31 passing local test executions**: 19 Node tests and six Playwright scenarios run in both desktop and mobile projects, giving 12 browser executions. The successful GitHub run independently completed both test commands and the build.

| Test file                     | Coverage                                                                                                                                                                                                                           |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/runtime.test.ts`       | Five mission outcomes; ambiguity; incomplete/missing evidence; untrusted source text; write blocking; contract admission; release/auth mismatch; projection; permission-denial behavior; malformed responses; provider constraints |
| `tests/http.test.ts`          | Actual HTTP flow, source/origin checks, session separation, exact benchmark association, and unknown AURA metrics                                                                                                                  |
| `tests/mcp.test.ts`           | Actual MCP SDK client-to-stdio exchange, tool inventory, labelled synthetic evidence, and invalid input                                                                                                                            |
| `tests/e2e/workspace.spec.ts` | Missions, trace/evidence/export, structure/comparison facts, blocked live setup, AURA form/export, registry/navigation, and accessibility/layout checks                                                                            |

Accessibility tests check the home and Connections views with WCAG 2 A/AA and 2.1 AA axe tags. They passed with no reported violations in those checks; this is not a full accessibility audit of all flows. Browser tests use viewport emulation, not a physical-device lab. Live HTTP and model behavior are mocked where marked.

The E2E test writes a desktop screenshot to the tracked `docs/screenshots/workspace.png`. Inspect that diff after browser tests; retain intentional visual changes and avoid mixing incidental screenshot churn into unrelated work.

The original hosted execution environment required a temporary Chromium executable because its usual browser download path failed. `NOVA_TEST_BROWSER` is an optional Playwright override for such an environment. It is not required on a normal machine, and the temporary browser is not part of the project. Start with standard Playwright installation. The successful GitHub CI used standard installation.

The initial local Git commit was `49eabb0`; publication through GitHub created the canonical `21cf63f` commit with the identical tree on top of the repository initialization commit. This explains older local-hash references. Start from current `origin/main` and do not force-push old local history.

## 11. Prioritized continuation backlog

The order below follows Olivier's expressed objective. Claude owns implementation choices and may adjust sequencing when new evidence or priorities warrant it.

| Priority / milestone                  | Concrete work                                                                                                                                        | Completion evidence                                                                                                                                     |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0 — take control                     | Inspect current remote and worktree; read this handover; launch the UI; establish current tests; keep a concise implementation backlog               | Reproducible checkout and accurate current status, with specific blockers                                                                               |
| P1 — first private live read          | Review the actual release/auth/search/item contracts; implement only required adapter changes; configure privately; retrieve a known authorized item | Successful identity read where supported, search and detail evidence for the known item, denied-access behavior, no secret exposure, private run record |
| P1 — real language-to-result workflow | Generalize intent/scope extraction and field interpretation for the admitted data; add clarification where needed; retain deterministic baselines    | Independent supported mission cases, factual evidence-backed answers, and predictable handling of ambiguity/missing data                                |
| P1 — make AURA evaluation usable      | Resolve the rubric/schema mismatch; record protocol/version/context; perform supported manual paired trials                                          | Exported, privately retained real observations with clear comparability and no invented metrics                                                         |
| P2 — engineering breadth              | Add configuration/effectivity/structure, requirements, and knowledge behavior justified by contracts and user value                                  | Domain-reviewed outputs, correct occurrence semantics, explicit scope/coverage, and relevant tests                                                      |
| P2 — private operational deployment   | Define the actual operator/hosting model; add persistence and authentication only as needed; document restore/retention and credential handling      | Reproducible authorized deployment with access isolation and retained private records                                                                   |
| P3 — richer intelligence              | Evaluate provider adapters, controlled reasoning, decision models, and specialists on held-out tasks                                                 | Measured quality/cost contribution versus a fixed baseline; access policy remains independent                                                           |
| P3 — governed actions                 | Define a specific valuable write/process use case, verify its API, implement prepare/approve/commit and recovery                                     | Authorized sandbox proof of binding, concurrency, replay handling, and uncertain-outcome reconciliation                                                 |

Additional maintenance items: update historical ADR status as features land; reconcile blueprint/runtime schemas rather than assuming they match; decide a repository license with Olivier before representing this as licensed open-source software. No top-level `LICENSE` exists at the transfer baseline. Recheck dependencies and upstream contracts when changing or upgrading them.

## 12. First-session checklist for Claude

1. Confirm the available GitHub and local filesystem access. Clone or update this repository without overwriting unrelated local changes. Inspect `git status`, branch, and current remote head.
2. Read the root [`CLAUDE.md`](../CLAUDE.md), this document, and the setup/scope guides. Inspect the implementation paths relevant to your next task.
3. Install from the lockfile, launch the synthetic UI, and reproduce the current verification baseline. Report new failures as findings rather than assuming the dated result still holds.
4. Identify which P1 tasks can proceed immediately. Improve code or evaluation setup where useful while gathering exact missing live inputs. Do not spend a session merely restating this handover.
5. If tenant access is missing, request the precise release/contracts/authentication facts in section 6 through an appropriate private mechanism. Never ask Olivier to paste secrets into a public issue or this repository.
6. Implement and test the next bounded milestone. Preserve working synthetic use and update the relevant documentation.
7. Deliver the commit or PR, usable behavior, actual verification results, and the next concrete blocker or milestone. Claude is now responsible for continuing the project.

## 13. Reference map

| Reference                                                                           | Use                                                                                   |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| [README](../README.md)                                                              | Launch commands and user-visible scope                                                |
| [Claude project instructions](../CLAUDE.md)                                         | Ownership and standing development guidance                                           |
| [Connection guide](CONNECTING.md)                                                   | Private manifest, field mappings, auth limits, and local model setup                  |
| [Implementation boundary](IMPLEMENTATION.md)                                        | Implemented versus incomplete features                                                |
| [Technical blueprint](blueprint/NOVA-Technical-Blueprint-v0.1.md)                   | Long-term architecture and rationale                                                  |
| [API operation verification](blueprint/registry/OPERATION-VERIFICATION.md)          | Evidence required before admitting an upstream operation                              |
| [Research registry](blueprint/registry/api-registry.json)                           | Candidate capabilities and original research classifications                          |
| [Benchmark protocol](blueprint/benchmarks/scoring/PROTOCOL.md)                      | Planned paired evaluation methodology                                                 |
| [Blueprint contract notes](blueprint/contracts/README.md)                           | Intended schema boundaries; compare with actual runtime types                         |
| [Synthetic corpus](blueprint/benchmarks/fixtures/synthetic-engineering-corpus.json) | Original fixture facts; no corporate data                                             |
| [Architecture decisions](decisions/)                                                | Ten design records; historical status needs to be read alongside implementation scope |
| [UI screenshot](screenshots/workspace.png)                                          | Actual synthetic workspace appearance                                                 |

This handover is based on inspected repository code, the published implementation commit, recorded local checks, and the successful GitHub workflow. It makes no claim that Claude has already opened the repository or that corporate connectivity, real model inference, hosted deployment, or AURA benchmarking has been completed.
