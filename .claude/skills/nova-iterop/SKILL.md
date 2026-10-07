---
name: nova-iterop
description: Implement and verify NOVA's ITEROP Business Process natural-language integration using documented REST operations, safe read-only adapters, Play-specific access boundaries, and accurate evidence. Use when working on ITEROP APIs, workflow processes, task lists, process instances, REST authentication, business-process search, or ITEROP UX.
---

# NOVA ITEROP — API-grounded natural-language business processes

**Primary objective:** Transform Olivier's **ITEROP Business Process Play** access into a polished, governed NOVA natural-language interface — first with working synthetic adapters, then through an actually authorized REST API.

Read **`docs/missions/NOVA-003-ITEROP-FIRST.md`**, `docs/CONNECTING.md`, `CLAUDE.md`, `docs/IMPLEMENTATION.md`, and the existing Gateway implementation before changing code. For UI tasks, also invoke `/nova-gen7-design`.

## Authoritative release documentation — open this FIRST

Olivier supplied the **official versioned R2026x-FD04 Business Process v2 OpenAPI JSON URL**. Read `docs/references/ITEROP-R2026x-FD04-OPENAPI.md` for the exact source and safe retrieval instructions; when network policy permits, fetch and parse the real JSON before implementation. This resolves the prior ambiguity that Claude only had an unnamed user-provided attachment.

Treat the document as the **release-scoped API specification**, not proof of access/permission on Olivier's tenant. If remote retrieval fails, request a file attachment supplied through an approved Claude/corporate workflow; do not invent contract details or commit the full vendor document to this public repo.

## What is known and what is not

- Olivier has **Play only**, not Design/Admin; being signed in to the Player does **not** grant REST/API Gateway access, credentials or process-administration rights.
- A user-provided OpenAPI 3.1 file declares **Business Process API 2.0.0**, 50 paths, 78 operations and globally `BasicAuth`. Its default server URLs are examples/templates, **not a verified host or origin**. The raw file is not committed here and need not be copied.
- Public standalone ITEROP docs explain Admin-issued REST access credentials via HTTP Basic; JWT is incompatible with API v2. Public 3DEXPERIENCE materials identify **PFI** as mandatory for the integrated API Gateway route. Olivier currently **lacks PFI**.
- Neither route is proven available to this tenant; PFI/agent access must be provisioned via the authorized platform owner. **Never bypass role checks, replay browser cookies, reverse engineer internal web calls, or solicit SSO credentials.**

## Implement these semantic intentions FIRST

Names below are NOVA names — **not real API routes**:

| Semantic tool | Spec operation | Method and documented relative path | Intended answer |
|---|---|---|---|
| `iterop.list_startable_processes` | `getAllStartableProcesses` | GET `/repository/processes/startable/list` | Processes the authenticated human can start. |
| `iterop.list_my_tasks` | `getTasksByUser` | GET `/runtime/tasks` | Active tasks under approved self-scope. |
| `iterop.get_process_summary` | `getBasicProcessInfo` | GET `/repository/processes/{processKey}/basic` | Description and version of a named, permitted process. |

Follow-on read operations **after contract validation**: `getProcessInfo` (GET `/repository/processes/{processKey}`), `getTaskInstanceInformations` (GET `/runtime/tasks/{taskId}`), `getInstanceInfo` (GET `/runtime/instances/{instanceId}`), `getHistoryUserTasks` (GET `/history/tasks`).

For the first operation the spec warns that human calls **must not supply `login`**. For `getTasksByUser`, an optional `user` parameter exists but must never enable querying others without explicitly reviewed identity semantics. Process instances may contain sensitive variables; default to the least metadata needed.

## Execution protocol

1. Build a separate ITEROP typed adapter/configuration: approved origin, exact version, per-operation allowlist, credential source and principal; safe URL assembly, encoding, bounded response size/timeout, explicit scope and coverage. Do **not** shoehorn ITEROP objects into engineering-item schemas.
2. Develop public-safe synthetic fixtures for a few sample processes and tasks, including an empty inbox. Use only invented names/IDs, never copy corporate process titles from screenshots into public source.
3. Let NOVA handle natural language deterministically for the first three intents. Support clarification for ambiguous labels and bounded identifiers. Model suggestions never grant tools, origins, access or write permission.
4. Return precise source, operation ID, execution status, timestamp, input scope, data class and `complete/partial/unknown` coverage for every result. Stop cleanly on 401/403 and document the legitimate entitlement blocker.
5. Expose ITEROP naturally in the premium NOVA shell with recognizable process tiles/task view and contextual AI sidecar. Label **SYNTHETIC** prominently until a genuine sanctioned read is verified. Avoid platform-specific trademarks in end-user branding.
6. Test safe queries, missing/empty tasks, cross-user denial, invalid process keys, malformed payloads, unexpected redirects, disallowed methods, wrong origin and data egress. Run Node 24 check, Playwright E2E and screenshot review.
7. Deliver a tested PR with honest status and a short checklist of what the platform owner needs to provision. Continue useful offline work without waiting for credentials.

## Strict action boundary

**Do NOT execute process creation/launch, complete tasks, change assignments, deploy models or alter variables** during P0. The provided OpenAPI includes write methods (e.g. POST `/runtime/processes/{processKey}`) but documentation also describes robot-specific rights; a clickable Start button in Play is not authorization to call the API. A future sanctioned test action requires official contract, valid non-admin identity, user approval, input validation, idempotency/reconciliation and a safe test process.

## Live authorization checklist

Require operator-provided, **private** release/origin; actual API routing; documented auth mechanism; corporate approval; REST app/service credentials provisioned in an approved environment; least privilege; and independently known, non-sensitive expected test output. Never commit secrets or live evidence; avoid model egress of corporate content unless approved.

**Milestone complete means a safe, working NL vertical slice and, once explicitly authorized, verifiable real platform evidence — not a pretty, speculative chatbot.**
