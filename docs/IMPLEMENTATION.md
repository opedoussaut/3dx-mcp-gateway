# v0.2 implementation boundary

The v0.1 blueprint remains the architecture target. This implementation turns its first read-only slice into a runnable local application; it does not claim all blueprint components are complete.

## NOVA-003 — ITEROP first (7 October 2026)

- `server/iterop/`: a dedicated ITEROP connector with its own origin, credential, contract and probe. Its operation inventory holds the three R2026x-FD04 P0 operations: `getAllStartableProcesses`, `getTasksByUser` and `getBasicProcessInfo`. A contract can bind only those operationIds; paths come from the inventory.
- Deterministic English/French routing for: startable processes; current, overdue and next tasks; process summary (with name resolution against your startable list); and task attention. Cross-user requests and all writes are refused before any call.
- Every upstream attempt carries provenance: operationId, documented call, spec release, source, scope, outcome, coverage and time.
- MCP exposes `iterop_*` read tools: synthetic by default, and only admitted operations in live mode.
- GEN7 Business Process workspace:
  - processes and tasks rail;
  - a canvas for the business object (task timeline, process context);
  - the NOVA Intelligence sidecar;
  - provenance, evidence and trace tabs.

  The shell is rethemed to industrial blue, and the Inter font is bundled locally.

- **LIVE: `BLOCKED`.** The FD04 schemas are pending (the file could not be retrieved), and no approved route or credential exists. See `docs/CONNECTING-ITEROP.md`.
- Dataset Governance work is parked on the branch `claude/dataset-governance-parked`.

## Implemented

- React/Vite interface with mission control, evidence inspection, history, connection readiness, registry and AURA observations.
- Five deterministic synthetic engineering missions; exact-identifier disambiguation and missing-evidence handling.
- Runtime source isolation: synthetic operations do not contact any tenant; live calls require an admitted private contract.
- Validated private GET bindings with one fixed service origin, server-only auth, denied redirects, bounded response size, projected fields and coverage reporting.
- A local stdio MCP server using the pinned official TypeScript SDK. The web runtime invokes the same semantic gateway directly; it does not incur an MCP transport hop for its internal calls.
- Model-provider interface and optional local Ollama intent classification, disabled by default.
- Manual black-box AURA observation capture with exact prompt matching and unknown metrics preserved.
- Read-only operation policies, same-origin HTTP writes, host checks, bounded session memory and no raw prompt/network logging.

## Explicitly incomplete

- No verified real tenant contract is checked in. No live platform requests were made during implementation.
- No real AURA run was observed, scored or compared. Test responses are labelled test fixtures.
- No real Ollama model inference was run; its adapter has contract and mock tests only.
- No automatic CAS/browser SSO, OAuth grant exchange, token refresh, multiple service origins, pagination traversal or POST-based reads.
- No approved live tenant eligibility policy. Live revision retrieval stops short of declaring review admissibility.
- No learned decision model, Jev/System-One adapter, specialist agents or A2A implementation yet.
- No automatic AURA API integration, blind multi-reviewer study or causal architecture-performance claim.
- Act creates a local draft and a digest only. It does not provide authenticated approval, a signature, an execution token or an upstream commit path. The digest is not a security authorization mechanism.
- No multi-user production deployment, durable private database, audit store or tenant credential vault. The local operator and OS are the trust boundary.

## Evidence and metrics

The deterministic mission runner uses allowlisted semantic fields. Untrusted record text can be displayed as source evidence but is never interpreted as an instruction to execute more tools. It is rendered as text, not HTML. Partial/unknown coverage is reported, and missing information does not become a positive qualification claim.

Elapsed time is actual server runtime for a request. Tool calls count attempted semantic calls; model calls count attempts. Deterministic routing records zero model tokens. Missing model usage remains unknown. Total compute cost is `null`: no infrastructure metering or price snapshot is configured. AURA internals remain not observable.

## Next live milestone

An authorized operator reviews authentication, engineering search and single-item retrieval for their exact release, creates private bindings and validates a narrow known-item read in an authorized environment. Then implement only the adapter features required by those contracts. A failed or inaccessible contract review does not authorize discovering private endpoints from application traffic.

## Primary technical references

- [3DEXPERIENCE developer guides](https://www.3ds.com/support/documentation/developer-guides)
- [Official MCP TypeScript SDK server guide](https://ts.sdk.modelcontextprotocol.io/server)
- [Ollama structured outputs](https://docs.ollama.com/capabilities/structured-outputs)
- [Vite production build](https://vite.dev/guide/build)

Historical API research is under `docs/blueprint/research/`. It is evidence of the initial review, not a live runtime validation report.
