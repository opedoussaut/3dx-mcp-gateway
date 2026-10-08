# Claude ⇄ ITEROP: first proof of concept (8 Oct 2026)

**What:** a reasoning agent (Claude) plans and engineers. ITEROP governs the process, records every step and keeps the human sign-off. This is a pattern study, not a product choice.

**Status:**
- **Proven live on a sandbox:** a secure API connection, reading processes and starting a real process from a plain-language request.
- **Working in simulation:** Claude designs the configuration, an independent check verifies it, Claude completes the steps, and an engineer approves or sends it back for rework. A live end-to-end run is next.

**Control:** Claude has a narrow set of allowed actions, never sees credentials, and cannot sign or approve its own work. Nothing is official without a person's sign-off.

**Next:** record a full live run, then explore connecting real solvers through ITEROP.

Details: [technical summary](SUMMARY-TECHNICAL.md).
