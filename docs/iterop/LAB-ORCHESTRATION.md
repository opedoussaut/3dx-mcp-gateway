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

**Import result on the sandbox (8 October 2026).** Both files import successfully, with non-critical warnings only:

- _"no assignment defined for the task …"_ for every task. Expected: assignments are configured in the designer, not carried by standard BPMN.
- _"variable 'identificatorInstance' not found"_. The designer adds an instance-identificator variable to the start form automatically. NOVA sets the identificator through the `identificator` property of `startProcess` (`COOL-nnn`, `REQ-nnn`). The first live test must confirm that this property fills that variable, because NOVA relies on it to find the new instance.

## Going live on a sandbox tenant

The live engine (`server/iterop/lab-live.ts`) uses the route FD04 documents for the cloud: `{APIGateway}/api/businessprocess/v2`. It authenticates with an **API Gateway application key** plus an **Openness Agent** (HTTP Basic on the first call), then the gateway's session cookies. It is admitted only by a private **sandbox contract**, and it calls only the lab operations.

Operation by operation:

- **Reads:** the five lab reads, plus `getProcessInfo` for the connection test.
- **Writes:** `startProcess` and `completeTask`, only for the process keys named in the contract, and only after the operator approves each one in NOVA.
- **Before each write:** NOVA checks that start variables belong to the lab process, and re-reads a task to confirm it belongs to a lab process.
- **Never:** `user` or `login` are never sent.
- **Failures:**
  - A redirect counts as a rejected session.
  - A 401 re-authenticates once, then stops.
  - Every response is checked against FD04 and capped at 1 MB.

The tenant URL, key, agent and contract stay in `.env` and `.private/`. None of them is ever committed.

### 1. Data rule

The sandbox holds only the two lab processes and invented values. Never put customer or partner data there.

### 2. API Gateway application (API Gateway app → _My applications_ → +)

- **Name:** `NOVA orchestration lab`
- **Description:** _NOVA lab: AI-assisted orchestration of two synthetic test processes through the Business Process API. Reads, plus start/complete only after human approval. No admin calls. Synthetic data only._
- **API key expiry:** short, about 3 months.
- **Unrestricted mode: OFF.** Select **Business Process API**. Use _partial_ scope with these 8 endpoints, or _full_ scope on a sandbox:
  - `GET /repository/processes/startable/list`
  - `GET /repository/processes/{processKey}/basic`
  - `GET /repository/processes/{processKey}`
  - `GET /runtime/tasks`
  - `GET /runtime/tasks/{taskId}`
  - `GET /runtime/instances/{instanceId}`
  - `POST /runtime/processes/{processKey}`
  - `POST /runtime/tasks/{taskId}`
- **Copy the API key value at once.** It is shown only once.
- **API Collection → Business Process card:** check that it is _RELEASED_ and v2. Its `server` URL should end in `/api/businessprocess/v2`. Its origin is `NOVA_LAB_GATEWAY_ORIGIN`.

### 3. Openness Agent (Agent Management app)

Create an agent that acts as a **non-admin member user**, preferably a dedicated "NOVA" member:

- This user must be allowed to start the lab processes.
- This user must be the assignee of the automated tasks and the rework task.
- Assign the sign-off tasks to a different person.
- Copy the agent ID and secret. They are also shown only once.

### 4. Local configuration (on the machine that runs NOVA)

```bash
cp .env.example .env          # then fill the NOVA_LAB_* lines
mkdir -p .private && cp config/lab-contract.template.json .private/lab-contract.json
```

In `.private/lab-contract.json`, fill in:

- `processKeys`: the keys the tenant gave the imported models. They are shown in the designer or in the startable list.
- `driveApproval.approvedBy` and `driveApproval.approvedOn`.
- `reviewedBy` and `verifiedAt`.

The template is rejected until these are set.

### 5. First live test: read-only

```bash
npm run lab:probe
```

Or use **Orchestration → Sandbox (live) → Test connection (read-only)**. The test checks four things, with no write:

- the agent can see the lab processes;
- every task NOVA needs is modelled;
- each task declares the output fields NOVA will write;
- the start form has the start variables.

| Result    | Meaning                                                           |
| --------- | ----------------------------------------------------------------- |
| `PASS`    | All checks hold.                                                  |
| `PARTIAL` | Some checks fail. Fix the listed tasks or fields in the designer. |
| `DENIED`  | Key, agent or rights.                                             |
| `FAIL`    | Network or response.                                              |

### 6. First live drive

In **Sandbox (live)**, run the cooling-chain command with **Approve each write**, and compare each step with the process application. This run settles three open questions:

- **Who may start a process.** FD04 documents `startProcess` as "Only robot can use this API". If the start returns 400, the agent's user must be a robot, or the route must change.
- **The `startDate` unit.**
- **The run reference.** Check that the `identificator` sent by `startProcess` fills the instance identificator.
