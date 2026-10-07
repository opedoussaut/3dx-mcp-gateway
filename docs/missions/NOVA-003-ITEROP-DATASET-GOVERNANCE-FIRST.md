# NOVA-003 — Connect ITEROP and Datasets Governance before AURA
**Commissioned by:** Olivier · **Date:** 7 October 2026 · **Priority:** P0 — immediately ahead of AURA benchmarking
**Implementation repo:** `opedoussaut/3dx-mcp-gateway` · **Mission HQ:** `opedoussaut/nova-hq`
**Status:** product direction approved, connectivity / endpoint contracts / credentials NOT verified.

## Decision and business objective

**NOVA's first genuine multi-application natural-language capabilities must target two specific apps:**
1. **ITEROP / Business Process** — discover and interrogate the business processes and tasks the authorized principal is permitted to see.
2. **Dataset(s) Governance / NETVIBES data catalog** — discover and explain datasets, metadata, ownership, provenance and relationships available to the authorized principal.

**AURA comparisons are explicitly deferred** until NOVA can perform and demonstrate at least one useful, independently verified LIVE read workflow in **each** app, or Olivier explicitly changes the order. Existing AURA UI/tests remain intact. P0 GEN7-inspired UX remains a parallel non-negotiable product criterion; don't postpone it indefinitely.

**What this is not:** an instruction to bypass the Enterprise Integration Architect (PFI) entitlement, use undocumented browser-network calls, export confidential datasets, or auto-start/complete processes. Do not promise a live connection without approved API access.

## Verified public research anchors — leads, not tenant contracts

- ITEROP publishes REST API documentation describing administrator-created REST access credentials with HTTP Basic and JWT variants; JWT is explicitly **not supported for API v2**. This is evidence of a product API family **not** proof that a particular Dassault Systèmes tenant or deployment permits that mechanism.
  https://doc.iterop.com/kb/utiliser-lapi-rest-2/
- ENOVIA Business Process Designer release/community notes say **ITEROP API via API Gateway** is available, and the **PFI role is mandatory** for the cited path. Olivier has reported not having that role. Do not assume the direct ITEROP REST route bypasses corporate approval or entitlement requirements.
  https://3dswym.3dexperience.3ds.com/wiki/3dexperience-platform-user-s-community/business-process-designer_fu5BkDD5SJiXJh1RndAgjg
- The product's Iterop Play screens have tasks/processes/history; UI existence **does not prove equivalent public REST operations** for this deployment.
  https://doc.iterop.com/en/kb/manage-tasks/
  https://doc.iterop.com/en/kb/manage-processes/
- NETVIBES **Datasets Governance** is a data catalog commonly associated with the **Data Steward** role; sources describe related datasets, metadata/lineage and data provenance. An official, release-scoped *external REST catalog API* is **not yet established**: this remains an explicit first research blocker.
  https://3dswym.3dexperience.3ds.com/wiki/3dexperience-platform-user-s-community/netvibes-data-steward_b6sqGZW_TPWd32ZEEp7zGw
  https://3dswym.3dexperience.3ds.com/wiki/3dexperience-platform-user-s-community/netvibes-data-scientist_AbwNuHtrT5OsVg92LRe6kg

### Discovery checklist (mandatory before live calls)
Record **separately for each app**: actual app name and deployment, release, authorized base service and API documentation, exact read operation contracts and request/response schemas, authentication and role/license requirements, approved service principal/security context, pagination/filter semantics, and one non-sensitive known result. Ask Olivier to supply URLs and public/reference docs, **never secrets in chat, source, commits or issues**.

If a supported API or access entitlement is unavailable, mark the blocker clearly and use synthetic/contract-test adapters while discussing legitimate platform-owner provisioning. This limitation does not block frontend, language contracts or synthetic integration tests.

## First natural-language questions to make possible

### ITEROP — first verified read slice
- "What processes am I allowed to start?"
- "Show the tasks assigned to me, sorted by due date or priority."
- "What is the status of process [approved test identifier]?"
- "Which steps and approvals remain on that process?" **Only if the reviewed API exposes the necessary fields and rights.**
- "Explain why this task needs my attention." **Interpret metadata only; never invent cause.**

Only later, in a sanctioned test environment with explicit approval and verified POST contracts:
- "Prepare to launch the contractor form process for [synthetic test case]."
- "Prepare to complete this task with the following field values." 
Preparing a reviewable draft is **not** execution. There must be deliberate, authenticated human approval before upstream mutation; the ability to click "Start" manually is not API authorization.

### Datasets Governance — first verified read slice
- "Find datasets related to [approved research topic]."
- "Who owns dataset [test identifier] and what does its description say?"
- "Which other datasets or assets are related to it?"
- "What is the reported lineage, freshness or declared classification?" **Only where authenticated, documented fields exist.**
- "Is this dataset suitable for a given experiment?" **Answer from provenance/metadata and clearly state missing evidence; no unsupported compliance certification.**

**No bulk content download, raw dataset extraction or automatic cross-domain joins** until separately authorized. Catalog metadata may itself be confidential.

## Architecture — keep independent app contracts

The existing `server/gateway.ts` targets reviewed **GET** mappings on one origin; it is currently engineering-item-centric. Do not force both products into the 3DSpace engineering-item schema or one universal authentication scheme.

Build a **small multi-application provider abstraction** with independent origin, auth context, operation registry, schema/projection/coverage rules, and isolation policies:

```text
NOVA Intent → route domain: ITEROP | DATASET_CATALOG | ENGINEERING
                  ↓
         capability + authorization check
                  ↓
        scoped, typed, read-only app adapter
                  ↓
      normalized evidence and explicit coverage
                  ↓
            cited, bounded answer
```

- Reuse tested HTTP isolation, input validation, evidence envelopes, trace presentation and operator-only configuration.
- Implement ITEROP and Datasets Governance **as independent capability namespaces** (e.g. `iterop.list_my_tasks`, `catalog.search_datasets`) that map only to validated documented read contracts; these **names are internal semantic intentions, NOT claims of real endpoints**.
- A prompt router must never infer permission, invent parameters, or choose a different service origin from arbitrary prompt text. Unrecognized/ambiguous requests trigger clarification or a safe `needs_input`.
- Provide a visible **source selector**: ITEROP / Datasets Governance / Engineering / Synthetic, with independent connection health, role/permission limits, read-only label, and clear provenance.
- Keep the `/nova-gen7-design` skill active for the rich product-like workspace. ITEROP can use process timeline/task insight; Dataset Governance can use catalog cards/relationships/lineage; consistent NOVA shell and premium typography.
- Model selection is separate from tool permission. LLM/NL orchestration may operate on approved local/sanitized metadata only; corporate model egress requires authorization.

## Deliverables, order and success gates

| Phase | Must deliver | Validation |
|---|---|---|
| P0-A — contracts & access | Current tenant-specific access map for ITEROP and Dataset Governance, entitlement findings, concrete operation candidates and precise blockers | Evidence citations; mark `UNVERIFIED` absent approved contract |
| P0-B — functioning synthetic vertical slices | Two realistic independent synthetic adapters + precise intent tests, evidence/unknown/denial/empty states, premium selectors and layouts | Node 24 unit and Playwright E2E green; no false claims of live support |
| P0-C — first ITEROP live read | Approved list/detail of one known test process or task, with attributable evidence | Approved private proof, permission failures tested, no data in public repo |
| P0-D — first Datasets Governance live read | Approved dataset metadata lookup and, if documented, related datasets | Approved private proof, scope/coverage and data sensitivity respected |
| P1 — natural-language exploration | At least five representative questions per app; measurable correctness, clarification, denial and evidence quality | Repeated independent test cases and human review |
| P2 — optional read/write expansion | Only explicitly approved sandbox process prepare/commit / dataset management flows | Separately reviewed contracts, approvals, idempotency, audit and rollback |
| Deferred — AURA evaluation | Controlled same-context trials, after working app access | Versioned measured observations, no guessed statistics |

If a real API is not accessible, leave the live milestone marked `BLOCKED`; complete tested offline work instead of substituting browser-cookie scraping or speculative calls.

## Critical prerequisite from existing NOVA-003
Claude already produced a **LOCAL-ONLY** gateway patch (`6df8728`) for 3DSpace API Gateway auth, literal `$searchStr` handling and error classification, with 25 unit tests and 12 e2e tests reported. **That work was not pushed into this repository.** Preserve it as a separate candidate. Before adopting/reusing it, locate actual patch bytes, review carefully and rerun current CI. **Do not claim it solved ITEROP or Datasets Governance**, whose auth/API contracts may differ.

## Immediate execution instruction to Claude Code
Start in **`opedoussaut/3dx-mcp-gateway`** with real repository access. Read this document and the existing handover, current tests and `/nova-gen7-design`. **Implement now** the unblocked app-selection, adapters/interface contracts and synthetic test cases for both products, in a reviewable PR, while identifying the smallest legitimate approved API prerequisites. Defer AURA-specific feature work. Record sanitized progress in `nova-hq`.

**Success is not a nice demo alone.** Success is actual authorized NL access to each application, defensible evidence, controlled behavior and premium NOVA UX.
