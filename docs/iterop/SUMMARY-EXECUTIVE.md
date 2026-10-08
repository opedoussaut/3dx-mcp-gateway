# Claude ⇄ ITEROP: executive summary

*Status as of 8 October 2026*

## In one paragraph

We tested whether an engineer can drive an ITEROP business process in plain language through Claude, using their own Claude Enterprise account. Claude stays inside a narrow, governed scope; people keep the decisions. On a sandbox tenant, Claude reached ITEROP through the official API Gateway, under its own restricted robot account. It read the processes and started a real process instance that is visible in ITEROP. Most of the remaining capability works end to end in simulation: Claude designs the engineering configuration, an independent check verifies it, Claude fills in the process steps, and an engineer signs off, with a rework loop when they reject. **The one step still to prove live is a complete run, from request to sign-off, on the sandbox.**

## What was tested, and how far

| Capability | Status |
|---|---|
| Secure connection to ITEROP through the official API Gateway, with a dedicated non-admin robot account | **Proven live** |
| Reading which processes may be started and which tasks are waiting | **Proven live** |
| Starting a real process instance from a natural-language request; the instance appears in ITEROP, attributed to the robot account | **Proven live** |
| Claude, in the user's own Claude Enterprise account (Claude Desktop), connected to the sandbox and refusing to write before approval | **Proven live** |
| Claude engineering the configuration (coolant, unit sizing, temperatures, flows) with an independent check of its numbers | Implemented, tested in simulation |
| Claude completing all automated process steps, then an engineer's rejection, rework and re-approval | Implemented, tested in simulation; demo video available |
| A complete run, request to sign-off, on the sandbox through Claude | **Next step** |

## How control is kept

- **Narrow scope.** Claude can do only nine things: read processes and tasks, check a design, start a process, and complete its own tasks. It cannot sign, reassign, stop, delete, deploy or change rights. Those functions do not exist in the connector.
- **People decide.** Either an expert confirms every step, or Claude runs the automated steps and a person validates the final result. The operator chooses the mode, not Claude. The engineer's sign-off in ITEROP is always human and is what makes a result official.
- **Claude cannot mark its own homework.** The "system check" step accepts only the result of an independent, rule-based check of Claude's numbers.
- **Credentials never reach the AI.** The API key and robot secret stay on the user's computer. Claude only sees the test process data.
- **Traceable and revocable.** Every action appears in ITEROP's history under the robot account. Disabling the key or the agent cuts access immediately.
- **Test data only.** The lab uses an invented cooling process on a sandbox tenant.

## Two architectures were built

1. **Governed workspace (NOVA lab).** A local web page in which the user approves each write with a click. It includes an audit view and a plain-language explanation for non-specialists.
2. **Direct connector (recommended for the demo).** Claude talks to a single small connector, with no web page. It is simpler to explain and shows Claude's reasoning best.

Both share the same ITEROP connection layer and safety rules.

## What it means

The test suggests that natural-language control of ITEROP processes is technically feasible with off-the-shelf Claude, while keeping governance where it belongs: in fixed rules, in the platform's own permissions, and in human sign-off. Repetitive form-filling and hand-offs could move to the AI. Engineering judgement and approval stay with people.

## Limits to keep in mind

- Results so far come from a sandbox with synthetic processes. **No production or customer data has been used.**
- The engineering values come from Claude's design checked against illustrative limits. **They are not a certified design.**
- Production use would need an agreed access route, account and role with the platform owner, a review by security and compliance, and real engineering rules in place of the illustrative ones.

## Next steps

1. Record one complete live run on the sandbox (request → Claude's design → automated steps → engineer sign-off) and a rejection with rework.
2. Present to the technical team. The demo video and architecture diagrams are ready.
3. Decide on a pilot process, and agree the access model with the platform owner.
