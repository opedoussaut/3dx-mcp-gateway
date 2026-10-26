# System model step in the cooling chain

The cooling chain has a sixth task, **Update system model**. It sits between *Check system limits* and *Engineering sign-off*. It records which system model (SysML) revision describes the checked configuration, so that the engineer signs the design and its model together, and ITEROP keeps the link between the run and the model.

```
Operating envelope → Select coolant → Size CDUs → Configure secondary loop
  → Check system limits → Update system model → Engineering sign-off → (Reject → Rework → again)
```

## Design choice

**Claude calls the modelling tool directly. ITEROP records and gates the result.**

- A modelling connector, for example a Cameo bridge MCP, is a second MCP server in the same Claude client. ITEROP does not call it.
- Building a model is iterative, and an ITEROP task form only holds flat fields.
- A call from ITEROP to the modeller would need a hosted endpoint, authentication and network access to the tenant. That belongs to a later production design.
- Each connector keeps its own credentials and its own short list of operations; only Claude combines them.

## The task

| Field | Type | Content |
|---|---|---|
| `systemModel_reference` | TEXT | Project and element of the model, for example the cooling system block |
| `systemModel_revision` | TEXT | Revision or commit that holds this configuration |
| `systemModel_summary` | TEXT_AREA | What was created or updated |

- **Who fills it:** this connector, as the operator, like the other automated tasks.
- **Where the values come from:** the modelling tool's own result. The skill tells Claude never to invent a reference or revision. If no modelling tool is connected, Claude asks the user.
- **NOVA lab and demo recording:** a labelled synthetic placeholder (`SYNTHETIC/<run>/CoolingSystem`, "synthetic, no model created"). No model is created.
- **Rework:** the earlier reference is in `runContext.stages`, so the rework updates the same model.

## What the model should contain (guidance in the skill)

- A cooling system block with the CDUs, the secondary loop and the racks as parts.
- Flow ports carrying coolant flow and temperatures.
- Requirements, for example supply ≤ 40 °C and ≤ 150 L/min per rack, with *satisfy* links.
- An energy-balance constraint: Q = ρ · cp · V̇ · ΔT.

## Sandbox: add the task to the deployed process

The sandbox runs version 2 without this task. Until it is added, live runs go straight from *Check system limits* to the sign-off, and Claude reports that the run waits for a person.

To add it, open Business Process Design → **Deployment management** (▶) → *NOVA lab — Liquid cooling configuration chain* → the model, then:

1. Add a **user task** named exactly `Update system model` in the operator lane, between *Check system limits* and *Engineering sign-off*. Reconnect the flows: Check system limits → Update system model → Engineering sign-off.
2. Assign it like the other operator tasks: to the robot account.
3. In its form, use **+** to create three new variables: `systemModel_reference` (Text field), `systemModel_revision` (Text field) and `systemModel_summary` (Block of text). Make all three **Mandatory**.
4. Save, then deploy as version 3.

The connector matches the task by name and the fields by their names, so these names must be exact.

## The guarded CATIA Magic connector (`npm run cameo:mcp`)

The open-source [Cameo MCP Bridge](https://github.com/ajhcs/cameo-mcp-bridge) (MIT) runs as a plugin inside CATIA Magic and listens on `127.0.0.1:18740`. Its own MCP server exposes 162 tools. The plugin has **no authentication**, and its tools include arbitrary Groovy execution (`cameo_execute_macro`, with full file and network access), deletes, Java reflection probes and Teamwork commits.

**Do not register the bridge's own MCP server with Claude.** Register `server/cameo-mcp.ts` instead. It talks to the plugin directly and enforces, in code:

| Control | How |
|---|---|
| Plugin admission | Version pinned to 2.3.5 (handshake 1). Loopback only, fixed routes, 30 s timeout, 5 MB cap. |
| Project admission | The open project must be named `CAMEO_GUARD_PROJECT` and be local, not on Teamwork Cloud. Checked on every call. |
| Scope | Every element read or written must sit inside the package `CAMEO_GUARD_PACKAGE`, found once directly under the model. Checked by walking the owner chain. Elements outside the package are hidden from searches and diagram lists. |
| Fixed tools (14) | Reads: `cameo_connection`, `cameo_find`, `cameo_get_element`, `cameo_get_specification`, `cameo_list_diagrams`. Writes: `cameo_create_element` (11 SysML types), `cameo_update_element`, `cameo_set_specification`, `cameo_set_tagged_values`, `cameo_create_relationship` (13 types), `cameo_create_diagram` (BDD, IBD, requirement, parametric, package), `cameo_add_to_diagram`, `cameo_layout_diagram`, `cameo_model_receipt`. |
| Never exposed | Macros, deletes, probes, session reset, imports, Teamwork commits, profiles, stereotype definitions. |
| Model receipt | `cameo_model_receipt` reads the model below one element, saves the project and returns the three *Update system model* values. The summary is built from the model's contents, and the values are signed with `CAMEO_RECEIPT_KEY` (HMAC-SHA256). |
| ITEROP binding | With the same `CAMEO_RECEIPT_KEY`, the ITEROP connector accepts *Update system model* only with a valid signature. Invented or edited values are refused (HTTP 400). |

Tested with a fake plugin in `tests/cameo-guard.test.ts`. Checked read-only against a live CATIA Magic 2024x session with plugin 2.3.5: the plugin is admitted, and the guard refuses because the lab project is not open.

### Setup

1. In CATIA Magic, create a **new local project** (not on Teamwork Cloud), for example *NOVA Lab Cooling*, and directly under its model a package **NOVA Lab**. Use synthetic content only, and never open a corporate model while the bridge plugin is loaded.
2. In `.env`:
   ```dotenv
   CAMEO_GUARD_PROJECT=NOVA Lab Cooling
   CAMEO_GUARD_PACKAGE=NOVA Lab
   CAMEO_RECEIPT_KEY=<48 random hex characters>
   ```
   Generate the key with `node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"`. The ITEROP connector reads the same variable.
3. Claude Desktop: add a second server next to `iterop` in `claude_desktop_config.json`, then fully quit Claude from the system tray and restart it:
   ```json
   "cameo": {
     "command": "cmd",
     "args": ["/c", "cd /d E:\\users\\opt2.ai\\NOVA\\3dx-mcp-gateway && node --import tsx server/cameo-mcp.ts"]
   }
   ```
   Remove any `cameo-bridge` entry that points at the bridge's own Python server.
4. Re-upload the skill. Ask Claude "Check the CATIA Magic connection": it should report `ready: true` with the lab package id.

## Next steps

1. **First live run:** Claude builds the cooling system model in the lab package, takes a receipt, and completes *Update system model* on a sandbox run.
2. **Compare the design values.** The receipt proves which model and revision were saved, but does not yet compare the model's values (units, flow, temperatures) with the checked design. Once the live model's value properties are known, add that comparison to the receipt.
3. **Optionally, read requirements from the model** at the start of a run, instead of only from the chat.
