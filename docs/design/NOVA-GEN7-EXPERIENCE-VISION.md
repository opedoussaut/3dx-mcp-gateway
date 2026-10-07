# NOVA GEN7 Experience — Premium Engineering Workspace
**Status:** HIGH-PRIORITY PRODUCT DESIGN REQUIREMENT · 2026-10-07
**Owner:** Olivier · **Implementation repository:** `opedoussaut/3dx-mcp-gateway`
**Audience:** Claude Code, NOVA implementer, front-end/product designers, UX verifier

## The north star (non-negotiable)
Create a credible glimpse of a **next-generation industrial engineering platform**: the engineering depth and familiar spatial grammar of a 3D product lifecycle workspace, reimagined with the precision, restraint, materials, delight and immediacy of a best-in-class Apple-like consumer experience.

**Think: future GEN7 engineering experience, not a legacy enterprise dashboard, a chatbot landing page, an imitation corporate site or a generic SaaS admin console.**

The supplied visual references show existing engineering interfaces: blue navigation rails and command bars; structured product/BOM trees; immersive CAD/3D product viewers; selection/highlighting/inspection; and contextual assistants or service sidecars. Treat these as **visual-concept references only**. Do not copy screenshots, proprietary icons, logos, source code, layouts pixel-for-pixel, or branded assets. The references are not permission to publish corporate material.

## Brand positioning
User-facing product identity is **NOVA** (e.g., "NOVA — Engineering Intelligence" or "NOVA Workspace"). It must **not** display the names, wordmarks or logos **“3DEXPERIENCE” or “Dassault Systèmes”**, nor suggest an official product or endorsement, in branding, shell, menus, marketing cards, demo headings or footer. Existing internal technical integration docs can identify the actual platform when needed for accuracy. If status information needs to mention the connection, use neutral user-facing terms such as **"Engineering platform", "My workspace", "Connected sources"**. Keep exact vendor/release identifiers in operator-only integration documentation or a restricted diagnostic area only when essential and authorized.

**Inspired by** industrial-platform blue/cyan and purposeful engineering interaction patterns, not a brand clone. **Inspired by** Apple's premium minimalism, fluidity and crafted simplicity, not a copy of any Apple product or UI. Open-source licensed fonts/icons only.

## Visual DNA: industrial precision × premium human experience
- **Color:** luminous cool blue, deep midnight engineering blue, clean porcelain/soft-white neutral canvas, subtle silver-gray surfaces; restrained cyan/teal for verified intelligence, warm amber only for approval/uncertainty, red only for errors. Avoid orange-first branding, rainbow accents, pure black slabs, saturated blue everywhere, or decorative neon.
- **Reference tokens for exploration, not official corporate values:** `--nova-midnight: #10283F`, `--nova-blue: #1768A4`, `--nova-cyan: #46B6D7`, `--nova-porcelain: #F5F8FA`, `--nova-ink: #172B3D`, `--nova-silver: #D9E3EA`, `--nova-teal: #138D91`, `--nova-amber: #A76A20`. Adjust contrast to accessible standards before shipping.
- **Typography:** modern open-source sans (Inter, Geist, or Manrope) with precise hierarchy, quiet weight changes, readable body and exceptional number/identifier typography. Do not distribute proprietary fonts or imitate an exact brand font.
- **Materials:** tactile, layered precision: subtle gradients, faint hairlines, restrained translucency for floating inspector and command surfaces, delicate shadow; never blur away CAD labels, evidence or tool states.
- **Geometry:** generous whitespace and elegant rounded corners for control surfaces, sharper precise edges for technical evidence tables and metadata. Avoid pill-everything styling, crowded nested cards, faux complexity and icon soup.
- **Motion:** short, purposeful transitions connected to user meaning (object selection, evidence retrieval, panel expansion, approval), respecting reduced-motion preferences. No gratuitous continuous effects.

## Essential spatial composition: engineering object is the hero
On large screens the application should *feel like an engineering workspace*:

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│ NOVA    Workspace / Project         Search & intent              ○ Status  │
├───────────────┬─────────────────────────────────────┬──────────────────────┤
│ PRODUCT       │                                     │ NOVA INTELLIGENCE    │
│ STRUCTURE     │      ENGINEERING CANVAS             │ Ask / Investigate /  │
│ & CONTEXT     │      3D object / semantic 2D        │ Prepare              │
│               │      evidence / relationships       │                      │
│ product       │                                     │ Answer + cited       │
│ configuration │      Selected object highlighted    │ evidence + coverage  │
│ versions      │                                     │                      │
│ requirements  │                                     │ Trace / approval     │
├───────────────┴─────────────────────────────────────┴──────────────────────┤
│ Evidence / history / compare / actions                     source: SYNTHETIC │
└─────────────────────────────────────────────────────────────────────────────┘
```

- **Primary canvas** occupies meaningful visual area and demonstrates *actual engineering context*: product/part relationships, structured BOM, variant/revision state, and a CAD-like 3D scene only when a legally usable asset / rendering pipeline exists. Preserve semantic correctness: a decorative 3D image is not proof of platform data.
- **Left context rail** presents search, product structure/navigation, entity/revision selection and context switching, with crisp hierarchy, not a dense tree editor.
- **Right intelligence sidecar** is NOVA's natural-language companion, *contextual to selected engineering objects*, not a giant chat screen. Ask, Investigate and Prepare actions; concise decision summary, cited evidence, confidence/coverage and relevant next action.
- **Bottom/secondary details** accommodate compare, requirements, trace, approvals, execution history and source provenance. Reveal details progressively, never by hiding critical trust information.
- **Mobile/tablet:** prioritize focus modes and an expandable assistant; do not miniaturize three desktop columns. Inspection and summaries must remain genuinely usable.

## Product journey to communicate in under 10 seconds
"I select an engineering object, ask a question, NOVA inspects the right evidence and gives me a governed answer or a prepared action."

Minimum scripted, clearly marked **synthetic** scenario for UX iteration:
1. Enter a clean workspace showing a synthetic mechanical product with structure and revisions.
2. Select a part/occurrence; its corresponding structure row and engineering facts highlight coherently.
3. Ask: "What changes if I move this component to the latest revision?"
4. NOVA shows an evidence-based impact summary with source links, revision scope, missing checks, explicit **SYNTHETIC** indicator and **PREPARED — NOT SUBMITTED** for any action.
5. Expand a comparison/evidence panel without losing object context.
6. Show that NOVA can refuse unsupported conclusions: insufficient evidence and its required next check are first-class outcomes.
7. AURA comparison remains available as a controlled evidence/benchmark workspace, not a superiority advertisement.

## Design deliverables and implementation sequence
1. **Audit existing UI**: read `src/App.tsx`, `src/Compare.tsx`, `src/Settings.tsx`, `src/styles.css`, `src/ui.tsx`; launch and capture current screenshots. Identify the strongest existing flows; do not rebuild the working app.
2. **Explore three restrained directions** in short written concepts and low-detail screen compositions: (A) Precision Studio, (B) Spatial Engineering, (C) Calm Copilot. Default preference **Spatial Engineering** if it can be built honestly with verified data/assets.
3. Pick and **implement** one coherent visual system: CSS tokens, layout, information hierarchy, icon grammar, typography, responsive behavior, motion, evidence/status states. Do not stop at a mood board.
4. Make the central engineering context real against **synthetic, reproducible data first**. If a functioning 3D viewer is not yet justified, use an elegant semantic structure + evidence visualization and clearly label any mock imagery. Avoid calling a decorative prototype a working engineering viewer.
5. Preserve existing backend, mode separation, MCP tools, tests, AURA observations and approval boundaries. Frontend must not access credentials.
6. Produce actual application screenshots at **1920×1080, 1440×900, 1366×768, tablet 1024px and mobile 390px**, along with keyboard and reduced-motion checks.
7. Iterate based on visible evidence (not "it looks premium" as an untested claim), then update E2E and relevant UI assertions. Review with Olivier at an early functional screenshot checkpoint.

## Acceptance gates: must pass before visual milestone is called complete
- [ ] Within **5–10 seconds**, an engineer can identify the **engineering object, assistant and governed outcome**.
- [ ] Overall aesthetic reads as a sophisticated industrial engineering environment plus premium consumer-level polish; not a generic chat/SaaS app.
- [ ] No user-facing Dassault Systèmes or 3DEXPERIENCE naming, logo or trademarked icons; NOVA branding clear.
- [ ] Visual hierarchy is legible in desktop conference screen and laptop resolutions. No accidental clipping/overlap or horizontal scroll.
- [ ] Product selection, revision, evidence panel and copilot context remain visually synchronized where functional; unsupported interactions are clearly labeled.
- [ ] Tested synthetic/live distinction, timestamps, provenance, incomplete coverage, insufficient evidence and approval boundaries are always visible.
- [ ] No counterfeit engineering capability: 3D/structure/evidence shown matches implemented functionality or is explicitly marked illustrative.
- [ ] Keyboard navigation, sensible focus, color contrast, responsiveness and reduced-motion preferences meet tested acceptance checks.
- [ ] Existing `npm run check` and `npm run test:e2e` continue to pass, or every remaining failure is documented with its cause.
- [ ] Evidence includes current screenshots and a concise design rationale; milestone shipped through a reviewable PR.

## Scope and intellectual property
No direct 3DS or Apple UI reconstruction; no proprietary fonts, logos, screenshots, models or CAD geometry committed without verified rights. Any supplied reference screenshots are for *private design guidance*, not assets to publish. Data from a corporate tenant or AURA must remain in an approved environment. Do not connect external models/services to corporate evidence without authorization.

**This design requirement is a P0 for NOVA-003, alongside real integration and correct engineering outcomes.** An app that connects but looks like a generic chatbot has not achieved the product vision.
