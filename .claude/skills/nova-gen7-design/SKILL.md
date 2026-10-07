---
name: nova-gen7-design
description: Create, implement, and review the premium NOVA GEN7-inspired engineering workspace UI. Use for any UI/UX design, React component, CSS, layout, responsive, 3D canvas, product-structure visualization, assistant panel, navigation, visual QA, screenshot, or user-facing copy change in the 3DX MCP Gateway.
---

# NOVA GEN7 Design Vision — engineering precision × premium simplicity

**Mandate:** Ship a distinctive, credible *future engineering workspace* for the NOVA application. This is a **P0 acceptance criterion for NOVA-003**, not optional visual polish. Work in the existing repository; do not create another app or deliver a mood board instead of working code.

## Read the design contract first

Before modifying a user-facing screen, read:
1. `docs/design/NOVA-GEN7-EXPERIENCE-VISION.md` — canonical product vision and visual acceptance criteria.
2. `CLAUDE.md` — engineering ownership, access and public/corporate separation.
3. `src/App.tsx`, `src/Compare.tsx`, `src/Settings.tsx`, `src/ui.tsx`, `src/styles.css` — current interaction and implementation.
4. `docs/IMPLEMENTATION.md` — actual capabilities versus proposed ones.

The design vision wins over subjective styling preferences, but does **not** override security, evidence integrity, accessibility, official API contracts, or user instructions. Its color samples are **starting hypotheses**, not exact corporate brand tokens.

## Outcome to build

Make the engineering object—not a generic chatbot—the hero.

For large screens, compose a high-quality spatial workspace:
- **Top control bar:** NOVA identity, workspace context, universal search/intent, trustworthy source and connection status.
- **Left engineering context:** product/BOM tree, revision/configuration, related objects, clear current selection.
- **Central engineering canvas:** relevant product/part/relationship or semantic engineering visualization. Only show actual 3D geometry when supported by usable assets and an implemented viewer; otherwise create a purposeful 2D engineering view, not pretend 3D.
- **Right NOVA Intelligence sidecar:** Ask / Investigate / Prepare, context-aware engineering queries, concise outcomes, citations, evidence coverage, and obvious next steps.
- **Progressively disclosed lower panels:** evidence, version comparison, requirements, history, trace and governed actions.

On tablets/mobile, **recompose** into object-first focus views with an expandable copilot and contextual drawers; never cram desktop's three columns into 390px.

## Aesthetic signature

- **Industrial blue × premium restraint:** deep midnight blue, purposeful strong blue, luminous cyan, soft-white porcelain, delicate cool-gray dividers; restrained teal for verified states, amber for pending decisions, red only for errors. Avoid orange-first branding, intense gradients, neon glow, purple AI clichés, or indiscriminate glass effects.
- **Typography:** use attractive, legally redistributable modern sans fonts (e.g. Geist, Manrope, Inter) with excellent hierarchy; crisp technical identifiers, measured type scales and generous line heights. Do not use proprietary corporate/Apple fonts.
- **Materials and details:** architectural whitespace, gentle layered surfaces, precise hairlines, restrained translucency for floating controls only, careful iconography and subtle purposeful depth. More spacious than legacy enterprise software; more engineering-specific than generic SaaS.
- **Geometry and motion:** controlled rounding for interaction surfaces; sharper data/evidence tables; fast transitions tied to selection, inspection and state, with `prefers-reduced-motion` support. Avoid continual decorative animation.
- **Branding:** end-user shell, menus, banners, illustrations, demo titles and marketing should use **NOVA**, not the names, logos or wordmarks of **Dassault Systèmes** or **3DEXPERIENCE**. Use neutral public-facing labels such as *Engineering platform*, *My workspace*, *Connected sources*. Accurate vendor names may remain in internal documentation or authorized operator diagnostics. Do not copy a company's UI pixel-for-pixel or imply official endorsement.

## Critical trust language and states

NOVA is an engineering decision interface. Make its provenance more visible than its theatrics.

- Show `SYNTHETIC`, `LIVE`, or `MOCKED` next to any relevant demonstration/output and do not obscure the source state behind aesthetic flourishes.
- Evidence cards need meaningful object/revision scope, source, retrieval time and coverage. **Partial** and **unknown** must not look **complete**.
- Treat `insufficient_evidence`, `needs_input`, and `blocked` as first-class, elegantly explained states.
- For actions, show **PREPARED — NOT SUBMITTED** until authenticated approval and real commits are independently implemented and verified.
- AURA comparison must remain a controlled evaluation view with honest, non-equivalent/unknown metrics clearly labelled. Never suggest benchmark superiority without fair measured evidence.

## Execute — not just concept

For each meaningful design task:

1. **Inspect the running baseline.** Review the current app, navigation, modes and test coverage; capture actual screenshots. Preserve functional flows and backend boundaries.
2. **Select a coherent design direction.** Compare `Precision Studio`, `Spatial Engineering`, and `Calm Copilot` briefly; default to *Spatial Engineering* when a truthful engineering canvas is feasible. Record your chosen rationale succinctly.
3. **Implement the smallest convincing vertical slice.** Focus on one engineering object, its selected structure/revision, the contextual NOVA response and a traceable outcome. Link selection → data → assistant → evidence visually *and functionally*.
4. **Establish design tokens and reusable components.** Implement in the existing React/TypeScript/CSS app. Keep constraints and data representation explicit; avoid hardcoded fixture-specific UI answers presented as general engineering reasoning.
5. **Demonstrate true behavior.** For synthetic flows use reproducible synthetic data, clear source labels, real selection state and coherent evidence links. Decorative CAD art or fake chart values must be identified as illustration.
6. **Check desktop and mobile screenshots**, ideally at 1920×1080, 1440×900, 1366×768, tablet 1024px and mobile 390px. Inspect the actual render for legibility, hierarchy, overlap, cropping, scroll traps and data density.
7. **Verify UX and accessibility:** keyboard/focus, accessible names, visible state, contrast, interactive hit areas and reduced motion. Run `npm run check` and `npm run test:e2e` (using Node 24 and available Playwright browser). Update regression tests for new behavior.
8. **Ship reviewable work.** Commit to a feature branch, share the PR and real screenshots, and distinguish implemented UI from aspirations. Ask Olivier for visual feedback at an early working-screen checkpoint.

## Required demonstration journey

A user should understand the interaction in **5–10 seconds**:

1. Open a clean NOVA workspace with a selected synthetic engineering object and recognizable product structure.
2. Select a part or occurrence and observe coherent highlighting in the canvas, structure and inspector.
3. Ask: **"What changes if I move this component to the latest revision?"**
4. Read a concise evidence-linked impact summary, specific missing checks and clearly marked source state.
5. Expand revision comparison or evidence without losing context.
6. See refusal / insufficiency surfaced as clearly and attractively as a confident result.
7. In Prepare mode, see a draft that is **not submitted**, never an invented upstream action.

The exact scenario is an **experience test**, not proof that unsupported platform operations or CAD geometry work.

## Visual quality gate — self-review before declaring success

- [ ] Reads instantly as a next-generation industrial engineering workspace, not a chat app, fake 3D product or generic admin dashboard.
- [ ] Clear NOVA identity; no user-facing corporate trademarks, logos, proprietary assets or misleading official affiliation.
- [ ] Distinct navigation, object context, central workspace, copilot and evidence flow.
- [ ] Meaningful selection/context synchronisation; no non-functional pseudo-controls posing as real features.
- [ ] Correct source labels, evidence provenance/coverage, `insufficient_evidence`, and approval boundaries.
- [ ] Actual screenshots checked at requested breakpoints; no accidental horizontal scrolling or clipped content.
- [ ] Keyboard and reduced-motion tested; readable contrast and useful error/empty states.
- [ ] Existing working synthetic experiences, MCP/backend protections and AURA protocols are not regressed.
- [ ] Tests and screenshot evidence reported truthfully, with identified limits.
- [ ] **Working implementation delivered**, not just a proposed visual direction.

## Repository and IP boundary

Do not commit screenshots provided solely for visual reference, vendor/Apple brand assets, confidential engineering geometry, corporate documents, live tenant captures or AURA observations. Use original or appropriately licensed graphics and public synthetic datasets. Keep tenant secrets and platform authentication server-side. All real corporate access must occur through approved mechanisms and reviewed contracts.

This project-level skill guides **design and engineering implementation**. It does not grant credentials, permit production deployment or overrule NOVA HQ governance.

**Success:** A polished, usable NOVA engineering experience in which **one selected object + one question → one credible, governed engineering result**.
