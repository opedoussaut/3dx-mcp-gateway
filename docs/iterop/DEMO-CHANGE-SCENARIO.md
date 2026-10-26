# Demo scenario: Hall B expansion

A realistic engineering change. The approved configuration of Hall B already exists in ITEROP, CATIA Magic and 3D. A change request comes in. Claude designs the change and modifies the model and the 3D view; ITEROP records every step. The 3D view reveals a problem that the numbers alone do not show. The engineer rejects, Claude adjusts, and the second loop is approved.

Synthetic data on the sandbox. Every value is illustrative, including the room dimensions (CDU gallery 4.2 m).

| | Baseline (approved) | Change 1 (rejected) | Change 2 (approved) |
|---|---|---|---|
| IT load, racks | 1.2 MW, 16 | 1.8 MW, 24 | 1.8 MW, 24 |
| CDUs | 4 × CDU-500 (N+1) | 5–6 × CDU-500 (N+1) | 4 × CDU-800 (N+1) |
| `cooling_check` | PASS | **PASS** | PASS |
| Space check (3D) | PASS: 3.5 of 4.2 m | **FAIL: 5.3 m in 4.2 m** | PASS: 4.1 of 4.2 m |

## Before the demo: create the baseline (off camera)

1. **CATIA Magic:** open *NOVA Lab – Cooling (synthetic)* with an empty **NOVA Lab** package.
2. **Claude Desktop, new chat:**
   > Configure the liquid cooling chain for Hall B: 1.2 MW, 32 °C facility water, 16 racks, N+1, PG25. Run all the steps in ITEROP, including the SysML model and the 3D view.

   Confirm each step.
3. **Play:** approve the sign-off. **Write down the run reference.** This is the baseline, `COOL-BASE` below.
4. **Leave on screen for the opening shot:**
   - CATIA Magic with the *Cooling System* model and its diagrams;
   - the viewer with the baseline: `npm run twin:view -- .private/twin/COOL-BASE.usda`, then <http://127.0.0.1:8765>.

## Act 1: the change request (in Claude)
> Hall B is expanding to 24 racks and 1.8 MW, same coolant and redundancy. The approved baseline is COOL-BASE. Prepare the change and run it through ITEROP.

Claude states the impact (+8 racks, +50 % flow, more CDU capacity, larger headers), redesigns with more CDU-500 units, and `cooling_check` returns **PASS**. Claude then starts the run (`COOL-CHG` below) and writes the engineering stages; you confirm each one.

## Act 2: the model and the 3D view are modified
- **CATIA Magic:** Claude updates the **existing** *Cooling System* model in place: rack and CDU counts and values. Then a signed receipt and *Update system model*.
- **3D:** Claude calls `view3d_build` with the baseline. **Space check FAIL: 6 CDUs need 5.3 m but the CDU gallery is 4.2 m.** Claude reports it and records it in *Update 3D view*, so the engineer sees it at sign-off.
- **Viewer:** `npm run twin:view -- .private/twin/COOL-CHG.usda --baseline .private/twin/COOL-BASE.usda`
  - *Proposed:* the units outside the gallery are **red**.
  - *Compare:* added parts are green, changed or moved parts amber, unchanged parts faded.
  - *Baseline:* the approved hall.

## Act 3: the engineer rejects (in Play)
*Engineering sign-off* shows the system model and 3D view references, and the 3D summary with the failed space check. **Rejected**, with the comment:
> The CDUs don't fit the CDU gallery. Use fewer, larger units.

## Act 4: the adjustment (back in Claude)
> The engineer rejected COOL-CHG. Check my tasks and handle the rework.

Claude finds the rework task, shows the rejected design, and asks for the reviewer's comment, because the API doesn't expose it; paste it. Claude redesigns with **4 × CDU-800** (N+1, 75 % utilisation). `cooling_check` returns PASS. Claude updates the same model, then rebuilds the 3D view against the same baseline: **space check PASS, 4.1 m of 4.2 m**. Refresh the viewer: *Compare* now shows the larger units replacing the baseline's CDUs, with no red.

## Act 5: final validation (in Play)
The second sign-off: **Approved**, *"OK: 4 × CDU-800 fits the gallery."* The run is completed. ITEROP's history holds both passes: the rejected change with its space finding, and the approved one. COOL-CHG is the new baseline for the next change.

## What each part contributes

| | Role in the story |
|---|---|
| Claude | Understands the request, designs, explains the impact, modifies the model and the 3D view, asks when information is missing. |
| `cooling_check` | Independent numeric check. It passes in Change 1: the numbers are fine. |
| 3D view (`view3d_build`) | Spatial check. It catches what the numbers can't: the units don't fit the room. |
| CATIA Magic (guarded) | The system model, modified in place, with a signed receipt. |
| ITEROP | The process, the record of every step and value, and the human decisions: reject, then approve. |

## Rehearsing without the sandbox
`npm run demo:run` drives the simulated engine. The three scenes of this story can be opened directly:
- `npm run twin:view -- .private/twin/story-change1.usda --baseline .private/twin/story-baseline.usda`
- `npm run twin:view -- .private/twin/story-change2.usda --baseline .private/twin/story-baseline.usda`

Both scenes are produced by the generator in `server/twin/cooling-usd.ts`.
