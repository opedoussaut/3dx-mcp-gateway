# OpenUSD 3D representation of the cooling system

![OpenUSD cooling system, rendered in Blender](../screenshots/cooling-system-usd.png)

`npm run twin:usd -- [design.json] [out.usda]` writes an OpenUSD scene of a checked cooling configuration. Without arguments it uses the configuration from the live run and writes `.private/twin/cooling-system.usda`.

## What the scene contains

- **Deterministic geometry:** every count and size comes from the design. There's no hand-modelled content, and the scene is never a second source of engineering numbers.
  - The racks, in rows facing a shared aisle.
  - The CDUs: duty units in teal, standby units lighter.
  - The secondary loop:
    - per-CDU risers and a distribution header;
    - a header per rack row and a supply drop and return drop per rack;
    - supply pipes in blue, return pipes in red.
  - Facility water to each CDU from a wall header, in green.
- **Pipe sizes:** inner diameters come from the flows at a 1.5 m/s design velocity, rounded up to 5 mm.
- **Engineering values:** stored as `nova:` attributes on the prims, for example `nova:flowLpm`, `nova:supplyC`, `nova:role` and `nova:capacityKw`. When the SysML model exists, `nova:sysmlElementId` links the parts to the CATIA Magic elements.
- **USD conventions:**
  - `metersPerUnit = 1`, `upAxis = "Z"`, `defaultPrim = "CoolingSystem"`, `kind = "assembly"`;
  - explicit polygon meshes with `UsdPreviewSurface` materials;
  - display colours as a fallback for simple viewers.
- **Status:** synthetic schematic geometry with illustrative lab values. This is *not* a SimReady-validated asset: no physics, no semantic schema, no vendor geometry.

## Checking and viewing

**In the browser:** `npm run twin:view`, then open <http://127.0.0.1:8765>.
- The viewer uses three.js 0.183 `USDLoader`, which reads `.usda` directly.
- It has orbit, zoom and pan, and rotates Z-up stages so the floor lies flat.
- Clicking a part shows its name and `nova:` values.
- The local server serves only the viewer page and the one scene file. `.env` and `.private/` are not reachable.
- With no argument it shows the newest `.usda` in `.private/twin`. Give a path to show another file. An unknown name lists the available files.


`blender -b --factory-startup --python scripts/twin/render_blender.py -- <in.usda> <out.png>` (absolute paths) imports the file and renders a preview. The import doubles as a validity check: all 89 prims of the example import. The file also opens in any OpenUSD viewer, for example USD Composer or usdview.

A note on implicit shapes: Blender 5.2 imports material bindings on explicit meshes but not on implicit `Cube`/`Cylinder` prims. The generator therefore writes meshes.

## Space check and comparison with a baseline

- **Space check.** The generator checks whether the CDUs fit the hall's CDU gallery (4.2 m, an illustrative room). The gallery is drawn on the floor in yellow, and units outside it are red, with `nova:clash`. The result is stored as `nova:spaceCheck` and `nova:spaceFinding` on the root, and written into the *Update 3D view* summary. The heat balance can pass while the room can't hold the units: that's what this check catches.
- **Baseline.** `view3d_build` with `baselineRun` writes both scenes and records the change list (`nova:baselineRun`, `nova:changes`, and the summary in ITEROP).
- **New zone in an existing hall.** `view3d_build` with `hall` (for example `hall-b`) reads the hall's as-built record, which the operator keeps in `<twin folder>/halls/<hall>.json`. The scene is the existing equipment, with the same prim paths and values as its own scene `<hall>-as-built.usda`, plus the run as the `Extension` zone: its racks (high-density racks in navy), CDUs and its own loop above the existing one. The space check counts every unit in the shared gallery. Units whose model name says *in-row* stand at the head of the new rack row instead. Without the record, the tool refuses: the existing equipment is never invented.
- **Comparing in the viewer:** `npm run twin:view -- <change.usda> --baseline <baseline.usda>`. The viewer offers three views:
  - *Proposed* and *Baseline* show each scene on its own;
  - *Compare* matches parts by prim path, position, size and values. Added parts are green, changed or moved parts amber, removed parts a red ghost, and unchanged parts faded.

The demo stories are [DEMO-AI-ZONE.md](DEMO-AI-ZONE.md) (a new AI zone, the current demo) and [DEMO-CHANGE-SCENARIO.md](DEMO-CHANGE-SCENARIO.md) (a change to an approved run).

## The ITEROP step: *Update 3D view*

The cooling chain has a seventh task, between *Update system model* and *Engineering sign-off*:

```
… Check system limits → Update system model → Update 3D view → Engineering sign-off
```

- **Who produces the values:** the ITEROP connector's local tool `view3d_build`, not Claude. It builds the scene from the values this connector wrote to ITEROP for the run: start values, coolant, CDU sizing and loop. The CATIA Magic element id from the model receipt goes into the scene. The tool writes `.private/twin/<run>.usda` and returns the three task values.
- **The binding:** *Update 3D view* accepts only values that `view3d_build` issued in this session, unchanged, the same rule as *Check system limits*. An invented or edited reference is refused (HTTP 400).
- **Fields:**

| Field | Type | Example |
|---|---|---|
| `view3d_reference` | TEXT | `twin/COOL-261026-235127.usda` |
| `view3d_revision` | TEXT | `sha256 1a2b3c4d5e6f · generated 2026-10-26 23:51 UTC` |
| `view3d_summary` | TEXT_AREA | `16 racks, 4 × CDU-500 (3 duty, 1 standby), secondary loop 1810 L/min at 35 → 45 °C, PG25. Linked to system model …` |

- **To view a run:** `npm run twin:view` opens the newest scene in `.private/twin`. For a specific run, use `npm run twin:view -- .private/twin/COOL-261026-235127.usda`, replacing the name with the actual run reference. Then open <http://127.0.0.1:8765>.
- **NOVA lab:** a labelled synthetic placeholder; no file is written.

### Sandbox: add the task in the designer

Open Business Process Design → **Deployment management** (▶) → *NOVA lab — Liquid cooling configuration chain* → open the model, then:

1. **Add the task.** Add a **user task** named exactly `Update 3D view` in the operator lane, after *Update system model*.
2. **Reconnect the flows.** Delete the flow *Update system model → Engineering sign-off*, then add *Update system model → Update 3D view* and *Update 3D view → Engineering sign-off*.
3. **Assignment:** the robot account, like the other operator tasks.
4. **Form:** use **+** to create three new variables, all **Mandatory**:
   - `view3d_reference`: Text field;
   - `view3d_revision`: Text field;
   - `view3d_summary`: Block of text.
5. **Optional, for the reviewer:** in the **Engineering sign-off** form, use the **link** button (not **+**) to add the existing `systemModel_reference` and `view3d_reference`, and tick **Read-only (only for this task)**. The engineer then sees which model and which 3D view they are signing.
6. **Save, then deploy.** This gives version 4.

The connector matches the task by its name and the fields by their names, so these must be exact. After deploying, restart Claude Desktop from the system tray so it loads the new connector, and re-upload the skill.

## Next steps

1. Done: the scene is generated from the live run and recorded by *Update 3D view*.
2. Show it in the NOVA workspace's 3D canvas.
3. When licensed vendor assets are available, reference SimReady CDU and rack assets instead of boxes, and run the SimReady validator.
