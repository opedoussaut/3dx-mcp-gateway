# Dataset Governance PoC — evidence ledger

## Purpose

This branch is a controlled foundation for the CECB L01 PoC path. It is **Olivier's custom PoC**, not a native or demonstrated 3DEXPERIENCE MCP gateway.

## Demonstrated before this branch

- 3DCompass service discovery returned HTTP 200 from the evaluator's corporate Windows environment.
- The tenant discovery response contained 123 services and a registered `lakegovernance` service.
- An unauthenticated GET to `/3drdfpersist/governance/v4/catalogs` returned HTTP 302 to the tenant IAM login, with the original service URL carried as the login service.
- The production Dataset Governance browser UI was observed calling `lakegovernance/3drdfpersist/governance/v4/controlled/language/values` and receiving HTTP 200.
- The production UI was also observed calling `lakegovernance/3drdfpersist/governance/v3/catalogs/{id}` and receiving HTTP 200 under the evaluator's authenticated browser session.
- That successful catalog request visibly carried browser cookies. No Authorization, SecurityContext or X-DS-CSRFTOKEN header was established from the observation.

## Do not overclaim

- The successful browser request proves a browser-mediated authenticated user path, not a reusable server-side authentication method.
- Browser cookies must not be copied into this gateway or into an AI prompt.
- The supplied OpenAPI is v4 while the observed catalog UI request was v3. Compatibility is not assumed.
- Openness Agent exists in implementation/documentation evidence, but Dataset Governance compatibility was not demonstrated.
- The evaluator does not have the Enterprise Integration Architect (PFI) role required by the examined Openness Agent client path.
- No approved user-delegated server-side authentication mechanism has yet been established.
- No Claude → MCP → 3DEXPERIENCE end-to-end path has been demonstrated.
- No write operation is in scope.
- No production-readiness claim is supported.

## This branch

The foundation deliberately accepts **no credentials**. It can:

1. discover `lakegovernance` through 3DCompass;
2. issue one fixed, minimal, unauthenticated v4 GET;
3. refuse redirect following;
4. expose no arbitrary target URL or path;
5. retain a bounded local audit trail;
6. return no enterprise response body from the unauthenticated probe.

The expected live result today is an authentication boundary (for example HTTP 302), not a dataset result.

## Next gate

Before adding authenticated reads, select and document an **approved** authentication adapter. Credentials must remain outside the model context and outside repository source. The adapter must preserve the user's authorization, fail closed, and support audit. Only then should an MCP tool such as `count_datasets_under_catalog_path` be connected to a live Dataset Governance read.
