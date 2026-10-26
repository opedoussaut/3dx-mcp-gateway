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

## Next steps

1. **Connect the modelling tool.** Add the Cameo bridge MCP to the same Claude client, on a sandbox or synthetic project only, with an allow-list: read, plus create and update in one package. No deletes.
2. **Add an independent consistency check** in the connector. Before accepting *Update system model*, it reads the model back through the modelling tool and compares it with the checked design (units, flow, temperatures). Claude then cannot record a model that doesn't match, in the same way "Check system limits" accepts only `cooling_check` output. This needs the bridge's read API.
3. **Optionally, read requirements from the model** at the start of a run, instead of only from the chat.
