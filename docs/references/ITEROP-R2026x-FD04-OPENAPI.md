# ITEROP Business Process v2 — authoritative OpenAPI reference

**Versioned documentation link supplied by Olivier (2026-10-07):**
https://media.3ds.com/support/documentation/developer/cloud/R2026x-FD04/en/English/CAABusinessProcessWS/businessprocess_v2.openapi.json

- **Documentation release:** 3DEXPERIENCE cloud **R2026x-FD04**, English.
- **API:** Business Process / ITEROP Web Services **v2** (the linked OpenAPI filename is `businessprocess_v2.openapi.json`).
- **Format:** OpenAPI JSON (uploaded reference previously showed OpenAPI **3.1.0**, API `info.version=2.0.0`).
- **Usage:** authoritative versioned *documentation of possible methods and schemas*, **not** proof that an operation is deployed, licensed, authorized, authenticated, or reachable on Olivier's tenant.
- **Distribution:** this repo stores the **link only**, not a copy of the vendor's specification or any tenant-derived responses.

## Instructions for Claude Code working on NOVA-003

1. Read `docs/missions/NOVA-003-ITEROP-FIRST.md`, `.claude/skills/nova-iterop/SKILL.md` and this file.
2. In an **authorized** development environment, retrieve the versioned JSON documentation using HTTPS, for example:
   ```bash
   curl --fail --location --show-error --silent \
     "https://media.3ds.com/support/documentation/developer/cloud/R2026x-FD04/en/English/CAABusinessProcessWS/businessprocess_v2.openapi.json" \
     -o /tmp/businessprocess_v2.openapi.json
   ```
   If blocked, do not guess the spec; ask Olivier to **download the JSON in his corporate browser and provide it privately via an approved Claude session/file attachment or authorized private workspace**. Never request SSO cookies or tokens.
3. Inspect the JSON with a real parser. First check `openapi`, `info.title`, `info.version`, `servers`, `security`, `components.securitySchemes`; then inspect `paths` and request/response schemas for each target operation. Avoid assuming server URL defaults are valid tenant hosts.
4. For P0 the candidate **GET** operations are `getAllStartableProcesses`, `getTasksByUser`, and `getBasicProcessInfo`. **Reverify names/paths/schemas against this exact release document**, not just earlier notes. Save only a short, original, public-safe operation mapping in the repository, linking to the source instead of copying its content.
5. Build the ITEROP read-only adapter against **synthetic test fixtures** first. Implement safe request construction, projection, scope and errors. Do not call real corporate endpoints until approved credentials, deployment origin, access rights, and data-handling conditions are confirmed.
6. Do not treat Basic authentication declared in OpenAPI as evidence that Olivier's Play login permits Basic API use. The integrated API Gateway route may require additional application credentials / **PFI entitlement**. No reverse-engineered internal endpoints, browser-cookie reuse, credential copying, or access bypass.
7. If HTTP retrieval is unsuccessful, report the actual error and use **one of the approved fallback document transfer methods**; do not claim to have verified the release.

## Version discipline

The release in this URL is **R2026x-FD04**. Do not replace it automatically with an unversioned/latest copy: the contract can change across releases. Record which exact source/version each operation and test references. If Olivier's corporate tenant runs a different release, repeat the API compatibility and deployment review.

**Design:** pair this ITEROP API knowledge with `/nova-gen7-design` for the premium user-facing process/task experience. Dataset Governance and AURA remain out of the initial implementation scope.
