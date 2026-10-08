# Process orchestration lab — read and drive

Branch `claude/iterop-orchestration-lab`. An experiment, separate from the governed read-only path.

**Question it answers:** how much of a business process can Claude drive through the Business Process API v2 (R2026x-FD04), and where must a person stay in control?

## What it does

The **Orchestration** view and the MCP server take a natural-language command. They plan a sequence of FD04 operations and local tools, then run it against a **synthetic process engine**:

- Reads and tool calls run at once.
- Every write (`startProcess`, `completeTask`) stops as **PREPARED — NOT SUBMITTED** until the operator approves it. The operator can also approve all writes of one run up front.

| Command (examples)                                                                      | What happens                                                                                                                                                                                                                                                            |
| --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Configure the cooling chain for 1.2 MW IT load, 32 °C facility water, 16 racks, N+1`   | Confirms the process can be started, then reads its definition and starts it. It finds the new instance by its identificator. For each of the four automated tasks it reads the form, runs the tool and completes the task. It then hands the sign-off to the reviewer. |
| `Facility water is now 38 °C — what needs to be recalculated?`                          | Reuses the previous inputs, states which stages depend on the change, runs a new instance and shows a before/after table.                                                                                                                                               |
| `Check my inbox and handle any rework`                                                  | Picks up the task the process returned after a rejection, reads the reviewer's comment and applies it. It completes the rework task and reruns the chain.                                                                                                               |
| `Register a candidate requirement: …, source: …`                                        | Starts the requirement intake and assigns it to the reviewer.                                                                                                                                                                                                           |
| `What tasks are waiting for me?` / `What is the status?`                                | Read only.                                                                                                                                                                                                                                                              |
| `Reassign…`, `Sign off…`, `Delete…`, `Deploy…`, `Stop…`, `Grant…`, other people's tasks | Refused with the reason. Nothing is planned.                                                                                                                                                                                                                            |

Missing or out-of-range inputs get `needs_input`, and nothing starts. Plans come from fixed rules. A prompt cannot add operations, targets or permissions.

## Back and forth between Claude and the process

1. **Claude → process:** `startProcess` and `completeTask`, each prepared and then approved.
2. **Process → Claude:** the process assigns a task to the operator, and Claude finds it with `getTasksByUser`. The task inbox is the mailbox. No inbound connection is needed.
3. **Process → person:** the signature task is human only.
4. **Person → process → Claude:** a rejection opens _Rework configuration_ in the operator's inbox. Claude reads the comment (`getTaskInstanceInformations`) and loops.

The reviewer panel in the UI is labelled **SIMULATED**. It stands in for the engineer signing in the process application. The MCP server does not expose it: a model must never sign on a person's behalf.

A push from the process to Claude (a service task calling NOVA, or `completeTaskAsWebHook`) would need an endpoint the platform can reach. The runtime is loopback only, so that is a later design decision.

## Control boundary (verified against FD04)

| Class                  | Operations                                                                                                                                                                                               |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Read · automatic       | `getAllStartableProcesses`, `getBasicProcessInfo`, `getTasksByUser`, `getTaskInstanceInformations`, `getInstanceInfo`                                                                                    |
| Write · after approval | `startProcess`, `completeTask`                                                                                                                                                                           |
| Human only             | signature tasks: FD04 documents 403 "Task need to be signed (only doable via ui)"                                                                                                                        |
| Never called           | `setTaskAssignments`, `updateTaskAssignments`, `stopProcessInstance`, `deployProcessModel`, `importProcessModel`, `deleteDeployment`, `addProcessRights`, `deleteProcessRights`, `completeTaskAsWebHook` |

NOVA never sends `user` or `login`. In FD04 those fields address another login, and the synthetic engine answers a `user` field with the documented 400 "Only robot can use this API".

### Findings from the specification worth knowing

- **`startProcess` returns 201 with no body.** The caller does not get the instance id back. NOVA sets an `identificator` (`COOL-001`) and finds the instance again through `getTasksByUser`. Any orchestrator needs a correlation key like this.
- **`startProcess` documents 400 "Only robot can use this API".** Whether a human credential can start a process through the API must be proven on the target tenant. It is the first thing to test.
- **Signed tasks are UI only.** This guarantees a human decision point: an agent can prepare, but not sign.
- **`getInstanceInfo` returns 404 once an instance is completed.** Status after completion needs the history operations, which are not used yet.
- **`getTaskInstanceInformations` returns `expectedFields`.** NOVA checks that the live form declares exactly the fields it will write. A process model that drifts from the lab definition stops before any write.

## The engineering tools are illustrative

`server/iterop/configurators.ts` uses textbook relations and an **invented** catalogue and limits:

- Flow comes from Q = ṁ·cp·ΔT.
- Approach is 3 K and design ΔT is 10 K.
- The units are CDU-350, CDU-800 and CDU-1500.
- The check limits are a 40 °C supply and 150 L/min per rack.

They show how tools attach to process tasks. **They are not engineering values.** In a real deployment, the approved configurators and system models produce every number. The UI and MCP results say so.

## Use it

```bash
npm run dev            # http://127.0.0.1:3000 → Orchestration
npm run mcp            # stdio MCP: lab_run_command, lab_approve_write, lab_cancel_run (synthetic only)
```

In an MCP client, set `lab_approve_write` to require your confirmation. That prompt is the approval step.

## Importable test processes

The two files in `docs/iterop/lab/` are standard BPMN 2.0 with diagram layout. Their task ids and names match `server/iterop/chain.ts`, and `tests/lab.test.ts` keeps them in sync:

- `nova-lab-cooling-chain.bpmn` — _NOVA lab — Liquid cooling configuration chain_. Operator and reviewer lanes, five tasks, a decision gateway and a rework loop.
- `nova-lab-requirement-intake.bpmn` — _NOVA lab — Candidate requirement intake_.

Import: process list → **Import model** → choose the `.bpmn` file. BPMN carries the structure only. Forms, variables, assignment and signature are configured in the designer after import, using **exactly** these ids. NOVA verifies them through `expectedFields` before writing.

| Step                                               | Variables (id · type)                                                                                                                                                                                                                   |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Start form                                         | `start_itLoadKw` DECIMAL 50–20000 · `start_facilityWaterC` DECIMAL 10–45 · `start_rackCount` INTEGER 1–500 · `start_redundancy` SELECT `N##N+1##2N` (default N+1) · `start_coolant` SELECT `auto##water##PG25` (default auto, optional) |
| Select coolant                                     | `coolantSelection_fluid` TEXT · `coolantSelection_cp` DECIMAL · `coolantSelection_density` DECIMAL · `coolantSelection_rationale` TEXT_AREA                                                                                             |
| Size coolant distribution units                    | `cduSizing_model` TEXT · `cduSizing_units` INTEGER · `cduSizing_dutyUnits` INTEGER · `cduSizing_utilisation` DECIMAL                                                                                                                    |
| Configure secondary loop                           | `loopConfiguration_supplyC` · `loopConfiguration_returnC` · `loopConfiguration_flowLpm` · `loopConfiguration_rackFlowLpm` (DECIMAL)                                                                                                     |
| Check system limits                                | `systemCheck_result` SELECT `PASS##REVIEW##FAIL` · `systemCheck_findings` TEXT_AREA                                                                                                                                                     |
| Engineering sign-off (signature, reviewer)         | `engineeringSignoff_decision` SELECT `Approve##Reject` · `engineeringSignoff_comment` TEXT_AREA (optional)                                                                                                                              |
| Rework configuration (operator)                    | `configurationRework_coolant` SELECT · `configurationRework_redundancy` SELECT · `configurationRework_facilityWaterC` DECIMAL · `configurationRework_note` TEXT_AREA                                                                    |
| Requirement intake start                           | `start_statement` TEXT_AREA 10–1000 · `start_sourceReference` TEXT ≤300                                                                                                                                                                 |
| Review candidate requirement (signature, reviewer) | `requirementReview_decision` SELECT `Accept##Edit##Reject`                                                                                                                                                                              |

Assign the automated tasks and the rework task to the operator identity NOVA will use. Assign the signature tasks to a **different** person. The gateway routes on `engineeringSignoff_decision`. The designer may ask you to re-enter the condition expressions in its own syntax.

The BPMN import has not yet been tried on a tenant. Expect to adjust the forms and the gateway after import.

## Going live on a sandbox tenant

The owner has a sandbox tenant with full rights, where the data can be deleted at any time. That is the right place for the first live drive test. The tenant URL stays out of this public repository; it goes in a private `.env` as `NOVA_ITEROP_ORIGIN`.

There is **no live transport for drive operations yet**, by design. To add one:

1. **Data rule.** Only the synthetic lab processes and invented values go on the sandbox, never customer or partner data.
2. **Model.** Import both BPMN files and configure the forms and assignments as above.
3. **Route and credential.** Establish which REST route the sandbox offers: administrator-issued Business Process API credentials (HTTP Basic, as FD04 declares) or the platform API gateway. Then create a credential for the operator identity. Store it only in the private `.env` on the machine that runs NOVA. Never paste it in chat or commit it.
4. **Drive contract.** Add a reviewed private contract that admits `startProcess` and `completeTask` for the two lab process keys only and declares the tenant a sandbox. Then add a live engine behind the same `ProcessEngine` interface, with the same approval gates, bounded transport and FD04 validation.
5. **First live test.** Start one cooling-chain instance and compare each step with the process application. Prove three things:
   - whether a human credential may call `startProcess` (because of the documented robot-only 400);
   - the `startDate` unit;
   - the identificator correlation.
