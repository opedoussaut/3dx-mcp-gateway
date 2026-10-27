# Demo scenario: the AI zone of Hall B

Hall B runs an approved liquid cooling system: 1.2 MW, 16 racks of 75 kW, 4 × CDU-500 in the CDU gallery. The business needs a GPU cluster: **8 AI racks of 130 kW**, next to the existing rows. The obvious idea fails on the numbers, the architecture changes, the 3D view catches what the numbers cannot, the engineer rejects, Claude reworks, and the second pass is approved. The existing equipment never changes.

Synthetic data on the sandbox. Every value is illustrative, including the room (CDU gallery 4.2 m).

| | Hall B as built | Idea: one loop | AI zone, pass 1 (rejected) | AI zone, pass 2 (approved) |
|---|---|---|---|---|
| Load, racks | 1.2 MW, 16 × 75 kW | 2.24 MW, 24 racks | 1.04 MW, 8 × 130 kW | 1.04 MW, 8 × 130 kW |
| Loop | 35 → 45 °C | 35 → 45 °C | own loop 35 → 50 °C | own loop 35 → 50 °C |
| CDUs | 4 × CDU-500, gallery | — | 3 × CDU-800, gallery | 4 × CDU-IR-400, **in-row** |
| `cooling_check` | PASS | **FAIL: AI racks need 196 L/min** | PASS (131 L/min) | PASS |
| Space check (3D) | PASS: 3.5 of 4.2 m | — | **FAIL: 6.65 m in 4.2 m** | PASS: gallery unchanged |
| ITEROP | approved earlier | nothing written | run, rejected | same run, approved |

## How it works
- The AI zone is **its own run** of the same 7-step process: the deployed ITEROP process doesn't change.
- `cooling_check` takes `maxRackKw` (the densest rack): with mixed densities, the average flow per rack hides the AI racks.
- `view3d_build` takes `hall: "hall-b"`. The scene is the hall as built plus the new zone; the space check counts every unit in the shared gallery; units whose model says *in-row* stand in the new rack row.
- The existing equipment comes from the **as-built record** the operator keeps in `.private/twin/halls/hall-b.json`. Claude can read it through the tool, never write it. Without it, the tool refuses rather than inventing the hall.
- The viewer compares with `hall-b-as-built.usda`: the existing hall is unchanged, every part of the new zone is *added*.

## Before recording (10 min)
1. **Connector:** quit Claude Desktop **from the tray**, then reopen it, so it loads the connector with `hall` and `maxRackKw`. Re-upload `.private/skill/iterop-orchestrator.zip`.
2. **CATIA Magic:** the approved model is open (package *Liquid cooling – 1.2 MW hall (COOL-261026-222827)*, `rack [16]`). Open the BDD and IBD side by side.
3. **Viewer:** the hall as built:
   ```bash
   npm run twin:view -- .private/twin/hall-b-as-built.usda
   ```
   then <http://127.0.0.1:8765>.
4. **New Claude chat:** "Check the ITEROP and CATIA Magic connections." Both ready.

## Act 1: the request, and the obvious idea fails (Claude, 1 min 30)
> Hall B needs a GPU cluster: 8 AI racks of 130 kW next to the existing rows. The existing system is approved and must not change: 16 racks of 75 kW, 4 × CDU-500, PG25 35 → 45 °C, 32 °C facility water, as in the CATIA Magic model. First check whether the existing loop can simply take the AI racks.

Claude runs `cooling_check` for the whole hall with the densest rack: **FAIL, the 130 kW racks need 196 L/min each, above the 150 L/min limit; the average of 141 L/min hides them.**

*"Nothing was recorded: the dead end is found before it reaches the process."*

## Act 2: the architecture changes (Claude → CATIA Magic → ITEROP, 2 min)
> Design the AI zone as its own loop and run it through ITEROP, including the system model and the 3D view of Hall B.

- Claude proposes a dedicated loop at 35 → 50 °C (131 L/min per rack, PASS) and CDUs. Answer "Go" for each step. Write down the run, **COOL-AI**.
- **CATIA Magic, live:** new blocks and parts appear in *LiquidCoolingSystem*: `aiLoop`, `aiRack [8]`, `aiCdu`, a new branch of connectors in the IBD, and the requirement **COOL-R6 "AI zone: 130 kW per rack"** on the BDD.
- **3D:** `view3d_build` with `hall-b`: **space check FAIL, 4 existing and 3 new CDUs need 6.65 m, the gallery is 4.2 m.** Answer "Go" to record it as is.
- **Viewer:**
  ```bash
  npm run twin:view -- .private/twin/COOL-AI.usda --baseline .private/twin/hall-b-as-built.usda --port 8766
  ```
  - *Proposed:* the new CDUs **red** beyond the gallery, the AI racks in navy, their loop above the existing one.
  - *Compare:* the existing hall grey and unchanged, the AI zone green.

## Act 3: the engineer rejects (Play, 30 s)
*Engineering sign-off* of COOL-AI: the 3D summary shows the FAIL. **Rejected**:
> The AI zone CDUs don't fit the gallery. Use in-row units next to the AI racks.

## Act 4: the rework (Claude, 1 min 30)
> The engineer rejected COOL-AI: "The AI zone CDUs don't fit the gallery. Use in-row units next to the AI racks." Check my tasks and handle the rework.

- Claude chooses **4 × CDU-IR-400 in-row** (3 duty, 87 %), `cooling_check` PASS.
- **CATIA Magic:** the same zone parts change: CDU type and count, plus the requirement **COOL-R5 "CDU gallery space"**.
- **3D:** **space check PASS: the gallery keeps its 4 CDUs; the 4 in-row units stand at the head of the AI row.** Refresh the viewer on 8766.

## Act 5: approval (Play, 30 s)
**Approved**: *"OK: in-row CDUs, the gallery is unchanged."* ITEROP's history holds both passes of COOL-AI.

*"One change request, a dead end found before any write, an architecture that changed visibly, a spatial problem caught in 3D, and people decided."*

## Rehearsing without the sandbox
The story's two scenes, generated from the same generator and the as-built record:
```bash
npm run twin:view -- .private/twin/story-ai-pass1.usda --baseline .private/twin/hall-b-as-built.usda
```
```bash
npm run twin:view -- .private/twin/story-ai-pass2.usda --baseline .private/twin/hall-b-as-built.usda
```
To regenerate them: `npm run twin:usd -- <zone>.json <out>.usda --hall .private/twin/halls/hall-b.json`. The test *the AI zone story* in `tests/iterop-direct.test.ts` drives the whole loop on the simulated engine.

## If something goes wrong
| Problem | Fix |
|---|---|
| "No as-built record for hall-b" | The file `.private/twin/halls/hall-b.json` is missing: restore it (values in the table above). |
| Claude passes `baselineRun` | "This is a new zone: build the 3D view with hall hall-b." |
| A connector between ports fails in CATIA Magic | The parts and requirements still show the change; draw the connector by hand off camera. |
| No rework task yet | Wait 5 s, then: "Check my tasks again." |
