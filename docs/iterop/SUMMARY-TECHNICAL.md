# Claude ⇄ ITEROP: technical summary

*Status as of 8 October 2026. Repository `opedoussaut/3dx-mcp-gateway`, branches `claude-iterop-orchestrator` (direct connector) and `claude/iterop-orchestration-lab` (NOVA lab).*

## 1. Scope

The aim is natural-language read and drive of ITEROP Business Process API v2 (R2026x-FD04) processes from Claude.
- **Processes:** two synthetic BPMN models imported into a sandbox tenant:
  - `syn-cooling-chain`: operating envelope → select coolant → size coolant distribution units → configure secondary loop → check system limits → engineering sign-off, with a rework loop;
  - `syn-requirement-intake`.
- **Operations used:** `getAllStartableProcesses`, `getBasicProcessInfo`, `getProcessInfo`, `getTasksByUser`, `getTaskInstanceInformations`, `getInstanceInfo`, `startProcess`, `completeTask`.
- **Never implemented:** assignments, stop, deploy, import, delete, rights, `completeTaskAsWebHook`.

## 2. Architectures

### 2.1 Direct connector (`claude-iterop-orchestrator`), recommended

```
Claude Desktop / Code (user's Claude Enterprise account) ── MCP stdio ── server/iterop-mcp.ts ── HTTPS ── API Gateway ── ITEROP
```

- **Start:** `npm run iterop:mcp`. There is no web server and no open port.
- **Settings in `.env`:**
  - `ITEROP_MCP_ENGINE=simulated|live`;
  - `ITEROP_MCP_REVIEW=step|final`;
  - the `NOVA_LAB_*` gateway settings;
  - the reviewed lab contract in `.private/`.
- **Tools** (`server/iterop/direct.ts`):

| Tool | Type | Notes |
|---|---|---|
| `iterop_connection` | local | Engine, readiness, admitted processes, review mode and rule. |
| `iterop_list_startable_processes` | read | Filtered to the processes in the contract. |
| `iterop_get_process_model` | read | `getBasicProcessInfo` plus the lab model: start form, tasks and field ids. |
| `iterop_list_my_tasks` | read | Filtered to lab processes by run-reference prefix or task name; a count of hidden tasks only. |
| `iterop_get_task` / `iterop_get_instance` | read | Field ids are translated to lab ids. |
| `cooling_check` | local | Deterministic check of Claude's proposal (§4). |
| `iterop_start_process` | write (destructive hint) | Run reference `PREFIX-YYMMDD-HHMMSS`; finds the new instance through `getTasksByUser`. |
| `iterop_complete_task` | write (destructive hint) | Refuses signature tasks; the check task accepts only `cooling_check` output. |

- **Skill:** `.claude/skills/iterop-orchestrator/SKILL.md`. It covers tool usage, the review modes, process knowledge, refusal rules and answer style. It is uploaded to Claude Desktop under Skills.

### 2.2 NOVA lab (`claude/iterop-orchestration-lab`)

- **Stack:** an Express loopback server, React pages at `/lab` (Run, How it works) and a deterministic orchestrator.
- **Approvals:** every write is "PREPARED — NOT SUBMITTED" until the operator clicks Approve.
- **Claude access:** through 13 `lab_*` MCP tools that proxy to the local server. Sandbox runs are shared with the page. By default Claude cannot approve sandbox writes: the server refuses them unless `NOVA_LAB_MCP_APPROVAL=client`.

### 2.3 Shared layer (`server/iterop/lab-live.ts`)

- **`GatewayHttp`** talks to `{gateway}/api/businessprocess/v2`:
  - `APIKey` header, plus Openness Agent HTTP Basic on the first call;
  - after that, the gateway's session cookies are echoed back;
  - redirects are never followed, and are treated as a rejected session;
  - one re-authentication on 401;
  - 15 s timeout and a 1 MB response cap.
- **`LiveEngine`:**
  - admits only the process keys in the contract;
  - translates field ids in both directions (§3.3);
  - validates responses against FD04 schemas whose fields are nullable; errors name the property path, never the value;
  - never sends `user` or `login`.
- **Lab contract** (`labContractSchema`): `SANDBOX`, `SYNTHETIC_ONLY`, spec binding, process keys, variable overrides and drive approval. The template is rejected until it is filled in.

## 3. Live findings on the sandbox

### 3.1 Access

| Finding | Consequence |
|---|---|
| An Openness Agent bound to an administrator account is refused (401 "Unable to auth using 3DS Openness agent"). | Use a non-admin member account. The robot account now has initiator and assignee roles on the lab processes only. |
| The API Gateway application needs the Business Process API in its scope, and the tenant must have the API Gateway role. | It was configured on a second tenant, where the role is available. |
| A run-only account gets **403** on `getProcessInfo`, and on `getInstanceInfo` for some instances. | Start-variable ids are derived from the designer naming rule; task fields come from each task's `expectedFields`; the probe treats the 403 as expected. |

### 3.2 API behaviour

| Finding | Consequence |
|---|---|
| `startProcess` returns 201 with **no body**, so there is no instance id. | The caller sets `identificator` and finds the instance through `getTasksByUser`. Live references are unique (time-based). |
| Task names arrive prefixed with their BPMN lane, e.g. `[Operator (NOVA acts as you)] Select coolant`. | Tasks are compared after removing the prefix. |
| Responses contain `null` where FD04 shows optional fields. | Schemas accept null. Before this fix, a live call had failed with a 502 schema mismatch. |
| Signature tasks are documented as "only doable via UI". | The connector refuses them regardless of rights. |

### 3.3 Designer-generated field ids

The designer generates field ids as `<camelCase(element name) truncated to 26 chars>_<camelCase(field name)>`, for example `operatingEnvelope_startItloadkw`. NOVA resolves them by name, trying the full lab id first and then the field part, and contract overrides are possible.

### 3.4 Results

- The read-only probe returns **PASS**.
- `getAllStartableProcesses` returns 200.
- `startProcess` created **COOL-001**: visible in Play, initiator = robot account, waiting at Select coolant. That run was later finished and signed off manually in Play.
- Claude Desktop (Enterprise, Microsoft Store build) with the `iterop` MCP server: `iterop_connection` reports **live, ready, `syn-cooling-chain` admitted**. Claude computed a configuration and **stopped before the 5 writes**, asking for approval.

## 4. Engineering check (`server/iterop/proposal-check.ts`)

Claude proposes the coolant (cp, ρ), the CDU model and capacity, installed and duty units, utilisation, supply and return temperatures, total flow and flow per rack. The check is deterministic:

| Check | Rule |
|---|---|
| Energy balance | V̇ = Q / (ρ·cp·ΔT) · 60 000 L/min. More than 25 % off is FAIL; more than 10 % off is REVIEW. |
| Temperatures | ΔT > 0. The supply must be at least 1 K above facility water (FAIL), and 2 K or more is expected (REVIEW below). Supply ≤ 40 °C. |
| Flow per rack | It must equal total flow / racks; ≤ 150 L/min. |
| Redundancy | Installed units are duty (N), duty + 1 (N+1) or 2 × duty (2N). |
| Utilisation | Load / (duty × capacity) ≤ 90 %, and the stated value must match within 2 %. |
| Properties | cp between 3.0 and 4.3 kJ/kg·K, and ρ between 950 and 1100 kg/m³ (REVIEW otherwise). |

The output is PASS, REVIEW or FAIL with findings, plus `checkTaskValues`. The connector stores the values each check issues. `completeTask` on the check task is rejected (400) unless the values match one of them, so Claude cannot mark its own homework. The limits are illustrative lab values.

## 5. Review and permission model

- `ITEROP_MCP_REVIEW` is an operator setting that `iterop_connection` reports to Claude:
  - **`step`:** the expert confirms or corrects each stage before it is written;
  - **`final`:** Claude completes the automated stages, and a person validates at the ITEROP sign-off. Claude stops if the check stays FAIL or REVIEW.
- **Client prompts:** the write tools carry `destructiveHint`, so Claude clients may prompt depending on their permission mode. Claude Code's *auto* mode can approve calls on its own, so use the default ("ask") mode for strict step demos.
- **Not an enforcement point:** the connector cannot verify that a human confirmed in the chat. The enforceable guarantees are:
  - the tool allow-list;
  - the filtering of processes and tasks;
  - the refusal of signature tasks;
  - the check-task binding;
  - human sign-off in ITEROP.

## 6. Security properties

- Secrets live in `.env` and `.private/` on the user's PC. They are never committed, and never sent to Claude or the browser.
- `iterop_connection` reports only whether each setting is present.
- There is no generic HTTP tool, no endpoint discovery, no browser-cookie reuse and no identity fallback.
- Gateway calls go to one fixed origin; NOVA's `NOVA_LAB_URL` must be loopback.
- Retrieved text is treated as data; the skill tells Claude not to follow instructions found in process fields.
- Everything is traceable in ITEROP history (robot account) and revocable by disabling the key or the agent.

## 7. Verification

- **Automated tests:** 76 Node tests on the `claude-iterop-orchestrator` branch:
  - the full chain through the connector on the simulated engine, and through a gateway double;
  - filtering of foreign tasks;
  - signature refusal;
  - refusal of a self-graded check;
  - checker FAIL and REVIEW cases;
  - blockers;
  - review-mode reporting;
  - stdio start.
- **On the NOVA lab branch:** 40 Playwright end-to-end tests, including accessibility (axe) and horizontal-overflow checks.
- **Demo video:** generated by `npm run demo:run && npm run demo:record`. The tool results in it are real outputs on the simulated engine; Claude's lines and the engineer's decisions are scripted.

## 8. Setup notes (Windows)

- The Claude Desktop Microsoft Store build keeps its config at `%LOCALAPPDATA%\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Claude\claude_desktop_config.json`, not `%APPDATA%\Claude\`.
- The server entry is `cmd /c "cd /d <repo> && node --import tsx server/iterop-mcp.ts"`. The server changes into the repository folder itself and loads `.env`.
- The skill must be uploaded under Settings → Capabilities → Skills, and re-uploaded after each change.

## 9. Open items

1. A complete live run through the direct connector, including Claude's design, the automated stages, the sign-off, and a rejection followed by rework.
2. Showing the start values and earlier outputs in each task's "Information to display", so that rework can read context.
3. Production path: agree the route, account and roles with the platform owner, a security review, real engineering rules instead of `LIMITS`, and a decision on whether step-mode confirmation must be enforceable outside the chat (for example, approval in the NOVA page).
4. A hosted or multi-user version, which needs a deliberate authentication, storage and network design. The current runtime is single-operator and local.
