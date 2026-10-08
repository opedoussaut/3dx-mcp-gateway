# claude-iterop-orchestrator — Claude drives ITEROP directly

The simplified architecture has no NOVA web server and no UI. One small MCP server sits between your Claude account and ITEROP:

```
You ──► Claude (Desktop / Code, your account) ──MCP stdio──► claude-iterop-orchestrator ──HTTPS──► API Gateway ──► ITEROP
            plans, calculates, asks you,                     holds the credentials,                 (sandbox tenant,
            explains                                         9 fixed tools                           NOVA robot account)
```

- **Claude is the orchestrator.** It reads the process model, asks for missing inputs, starts the process, runs the illustrative calculator, completes each task, and tells you when an engineer has to sign.
- **The connector is deliberately small** (`server/iterop-mcp.ts`, `server/iterop/direct.ts`). It holds the API key and the Openness Agent secret, so they never reach Claude. It translates the field ids the designer generated, shows only the reviewed lab processes and their tasks, and exposes exactly these tools:

| Tool | ITEROP operation |
|---|---|
| `iterop_connection` | none (configuration, presence only) |
| `iterop_list_startable_processes` | `getAllStartableProcesses` (filtered to lab processes) |
| `iterop_get_process_model` | `getBasicProcessInfo` + the lab model (start form, tasks, fields) |
| `iterop_list_my_tasks` | `getTasksByUser` (filtered to lab processes) |
| `iterop_get_task` | `getTaskInstanceInformations` |
| `iterop_get_instance` | `getInstanceInfo` |
| `cooling_calculate` | none (local, illustrative calculator) |
| `iterop_start_process` | `startProcess` — **write** |
| `iterop_complete_task` | `completeTask` — **write**; signature tasks refused |

There is no tool for signing, reassigning, stopping, deleting, deploying or rights, and no generic "call any URL" tool.

**Approvals:** the two write tools are marked destructive. Claude Desktop and Claude Code therefore ask you before each call, and the `iterop-orchestrator` skill tells Claude to show the values and ask first. Keep the tool permission on **Ask**. With "Always allow", Claude writes without asking, and the connector cannot detect that. That is the trade-off against the NOVA version, where a person clicks **Approve** in the NOVA page.

## Setup

1. Get the branch:
   ```bash
   git fetch origin claude-iterop-orchestrator
   git checkout claude-iterop-orchestrator
   npm ci
   ```
2. In `.env`, keep the sandbox settings you already have (`NOVA_LAB_GATEWAY_ORIGIN`, `NOVA_LAB_API_KEY`, `NOVA_LAB_AGENT_ID`, `NOVA_LAB_AGENT_SECRET`, `NOVA_LAB_CONTRACT_FILE`, optionally `NOVA_LAB_PLAY_ORIGIN`) and add:
   ```dotenv
   ITEROP_MCP_ENGINE=live      # omit or "simulated" to rehearse without the tenant
   ```
3. **Claude Desktop:** *Settings → Developer → Edit config*. Add the server to `claude_desktop_config.json`, then fully quit and restart Claude Desktop:
   ```json
   {
     "mcpServers": {
       "iterop": {
         "command": "cmd",
         "args": ["/c", "cd /d E:\\users\\opt2.ai\\NOVA\\3dx-mcp-gateway && node --import tsx server/iterop-mcp.ts"]
       }
     }
   }
   ```
   If the old `nova-lab` entry is there, remove it or keep only one of the two, so Claude doesn't see two sets of tools.
4. **Claude Code:** from the repository folder, run `claude mcp add iterop -- node --import tsx server/iterop-mcp.ts`.
5. **Skill:** zip `.claude/skills/iterop-orchestrator` and upload it under *Settings → Capabilities → Skills*, replacing the earlier NOVA-lab version. Claude Code picks it up from the repository.

Nothing else needs to run: no `npm run dev`, no browser.

## Try it

- "Check the ITEROP connection."
- "Configure the cooling chain for a 1.2 MW hall, 32 °C facility water, 16 racks, N+1 — run all the steps."
- "What tasks are waiting for me?"
- "The engineer rejected COOL-251008-141210 — handle the rework."

## Boundaries

- Claude only sees tool results: lab process values, statuses and references. It never sees credentials. Other processes and tasks on the tenant are filtered out before they reach Claude.
- The calculator values are illustrative, not engineering values.
- Sign-off is always a person in ITEROP Play.
- The NOVA version (web page, shared run view, approval click, VP explanation) is still on the `claude/iterop-orchestration-lab` branch.
