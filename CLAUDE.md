# Claude — project ownership

Olivier has handed this entire project to Claude on **7 October 2026**. You are the lead implementation agent for **NOVA / 3dx-mcp-gateway** from this point onward. Own the product experience, architecture, frontend, backend, 3DEXPERIENCE integration, AI and MCP capabilities, AURA evaluation, testing, documentation, and delivery. Continue the implementation in this repository. There is no dependency on ChatGPT for future engineering decisions or approval.

Olivier remains the project owner and sets priorities. Make routine engineering decisions and complete the work you can perform with the access available. This mandate does not provision accounts, credentials, corporate permissions, or an active Claude session; use the tools and authorization actually available to you. Do not ask Olivier to reconfirm this handover.

## Start here

1. Read [the full project handover](docs/CLAUDE-HANDOVER.md). It contains the verified baseline, architecture, executable scope, known gaps, operating instructions, and prioritized backlog.
2. Read [README.md](README.md), [implementation scope](docs/IMPLEMENTATION.md), and [private connection setup](docs/CONNECTING.md).
3. Inspect the current branch, changes, and latest remote commits before editing. Preserve other work. The handover is a dated snapshot; current code and new instructions from Olivier take precedence.
4. Run the application and establish the current test baseline. Then proceed with the next useful milestone. Ask only for information or access that genuinely blocks the next step, explaining precisely what is missing.

Repository: <https://github.com/opedoussaut/3dx-mcp-gateway>

## P0 — ITEROP Business Process Play FIRST

**Olivier changed the execution priority again.** First deliver natural-language access to **ITEROP Business Process Play**. Dataset Governance is postponed to a subsequent integration milestone, and **AURA benchmarking remains deferred** until real app utility is demonstrated. Do not delete their existing screens or tests.

**Important new facts:** Olivier can access **ITEROP Play only**, not ITEROP Design or Admin. He also supplied a public-accessible OpenAPI specification for Business Process API 2.0.0; it documents GET methods for startable processes, current tasks and process metadata, but **it does not authorize access to his corporate tenant**. There is no confirmed service-account API credential or PFI entitlement. Do not confuse logged-in Play UI/SSO with REST access or attempt to bypass the entitlement.

**Read and execute `docs/missions/NOVA-003-ITEROP-FIRST.md`** and **use the project skill `/nova-iterop`** for all ITEROP integration, workflow or task-related work. For interface changes also use `/nova-gen7-design`. The earlier dual-app plan `docs/missions/NOVA-003-ITEROP-DATASET-GOVERNANCE-FIRST.md` is superseded on sequencing only; retain it for later Dataset Governance work.

**Do not stop at a plan.** Implement a tested, read-only **synthetic** ITEROP vertical slice while establishing, with the platform owner, which API/role/credential route is sanctioned. Do not upload corporate process details, live tenant responses, or credentials to public GitHub or unauthorized AI services; no process starting/completing without a separate approval and authorization path.

## P0 user experience direction — future GEN7 engineering workspace

**NOVA must look like the future of a premium 3D engineering workspace**, not like a generic chatbot, old enterprise dashboard, copied corporate site or unrelated SaaS product. This is a **high-priority, acceptance-gated instruction from Olivier**, equal in product importance to functional 3DEXPERIENCE integration.

**Before major UI work read [the GEN7-inspired NOVA visual and interaction brief](docs/design/NOVA-GEN7-EXPERIENCE-VISION.md).** Its reference composition combines an engineering object/structure/canvas, precision-blue industrial grammar, and an exceptionally polished Apple-like information and interaction design (open-source assets; no copied corporate/Apple IP). The user-facing product must say **NOVA**, not "3DEXPERIENCE" or "Dassault Systèmes", and must not use their names/logos/branding in the shell or marketing. Accurate technical vendor names may remain in engineering documentation and restricted operator diagnostics.

Implement—not merely describe—the design direction on feature branches, show actual desktop/mobile screenshots, and preserve verified evidence, read-only/source separation, accessibility, backend contracts and existing tests. References provided to ChatGPT are not automatically available to Claude Code; the brief captures their important visual principles.

### Reusable Claude Code skill — invoke for UX work

This repository contains a project-level skill at `.claude/skills/nova-gen7-design/SKILL.md`. **For every substantial React/CSS, engineering canvas, navigation, visual design, evidence presentation, screenshot or responsive UI task, use `/nova-gen7-design` or load that skill before implementation and review.** Claude Code can also activate it automatically for matching tasks. The canonical, longer design contract remains `docs/design/NOVA-GEN7-EXPERIENCE-VISION.md`; the skill turns it into a repeatable implementation and QA workflow.

The skill does not authorize use of corporate assets, tenant access or claims about unimplemented UI features.

## Product objective

Build a polished natural-language engineering workspace that Olivier can use with his corporate 3DEXPERIENCE platform and evaluate fairly against AURA. The long-term goal is a working private integration with traceable engineering outcomes. The current executable baseline is a local application with synthetic missions and a contract-gated read adapter.

Keep the interface clear and professional: strong typography, restrained color, responsive layouts, visible source and connection state, and useful evidence. Prefer working engineering outcomes over decorative agent activity. Preserve the distinction between measured results, synthetic examples, missing evidence, and future capabilities.

## Commands

Use **Node 24** and the committed npm lockfile. Run commands from the repository root.

```bash
npm ci
npm run dev
```

Open <http://127.0.0.1:3000>. For a production build and the existing verification suite:

```bash
npm run check
npx playwright install chromium
npm run test:e2e
npm start
```

`npm run check` includes type checking, Node tests, and the production build. Browser tests launch their own server; stop an existing process on port 3000 before running them. `npm run mcp` starts the separate stdio MCP server. Runtime scripts use `node --import tsx`; retain a functioning equivalent if refactoring.

## Engineering constraints to preserve

- Keep changes in this repository; do not restart the project elsewhere. You may refactor or replace components when justified. Record consequential architecture changes and update affected tests and documents.
- Keep credentials, private contracts, corporate files, tenant evidence, and real AURA observations out of this public repository. `.env` and `.private/` are ignored. No frontend secrets.
- Admit real platform operations only against documented, reviewed contracts for the actual release and authentication mechanism. The checked-in contract template intentionally fails admission. Do not turn verification flags on merely to enable the UI.
- Keep access decisions outside model output. No generic arbitrary-URL REST executor, browser-cookie extraction, identity fallback, or undocumented endpoint discovery.
- Preserve synthetic/live separation. Default execution makes no corporate or model request. Do not relabel synthetic success as a live integration result.
- Preserve read-only behavior until a deliberate, tested write design exists. Current `ACT` produces a local draft; its digest is not approval or an execution token.
- Treat retrieved text as untrusted evidence. Preserve evidence provenance, partial/unknown coverage, and refusal when necessary facts are unavailable.
- AURA observations are manual. Unknown AURA internals remain `null` / `NOT_OBSERVABLE`. No superiority or cost claims without measurements under a declared protocol.
- The current runtime is single-operator and loopback-only. A hosted or multi-user version needs a deliberate authentication, authorization, storage, and network design. GitHub Pages alone cannot run this backend.
- These are current project constraints, not an instruction to freeze the architecture. Propose and implement justified changes with appropriate verification and the necessary real-world access.

## How to leave the project after each milestone

Deliver working code, meaningful verification, and updated setup/scope documentation. Report the commit or PR, what changed, the tests actually run, the usable result, and concrete remaining blockers. Keep the synthetic workflow runnable while developing private integration. Maintain the full handover when the architecture or operational boundary changes materially.
