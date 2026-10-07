# Operation verification record

Use one record per operation, release and deployment profile. A product feature, public example or successful HTTP response is insufficient to establish supported API status.

## Required evidence

- Operation name and stable documentation section or operation ID.
- Official source URL and date reviewed; public API designation and support scope.
- Documentation version, deployment type, applicable release range and deprecation state.
- Exact HTTP method and relative path, including all required query/header parameters.
- Input and output contracts, limits, pagination, ordering, partial-result semantics and error behavior.
- Authentication scheme and supported client flow; service origins and approved redirect behavior.
- CSRF requirements for this operation and authentication profile, including explicit non-applicability where documented.
- Roles, licenses, collaborative-space/security-context requirements and object-level access semantics.
- Read/write behavior, all relevant downstream effects and risk classification.
- Idempotency, rate limits, retry rules and upstream concurrency/precondition support.
- Publication rights for any schema or example proposed for redistribution. Link rather than copying restricted source content.

## Admission decisions

Use `PUBLIC_SUPPORTED`, `PUBLIC_UNCLEAR`, `PRIVATE_OR_INTERNAL` or `UNKNOWN`. Keep documentation access status as a separate field in the evidence register. An entitlement-gated public API can be supported; a publicly visible internal endpoint can still be prohibited.

Promote to `IMPLEMENTABLE` only when the required public contract is verified and design prerequisites are explicit. Empty roles/licenses arrays mean a verified absence of such prerequisites, not lack of research. Set `NOT_APPLICABLE` only when justified. A check script must validate both JSON schema and cross-record invariants; JSON shape alone cannot establish real-world support.

Enabling a tool additionally requires configured approved origins, the intended principal/entitlements, passing adapter tests and current runtime policy. Never promote based on a 200 response, a model's recommendation or a browser trace.

## First verification queue

1. One suitable gateway authentication profile for the target deployment.
2. Engineering item search and single-item read for the first slice.
3. Current-user and security-context contracts, or a documented alternative binding that provides equivalent identity assurance.
4. Configured product-structure and effectivity reads.
5. Document/requirement/knowledge reads, individually verified.
6. Business Process task/process reads; writes remain a separate later gate.

Every unresolved item gets a blocker reason. Evidence is allowed to reduce scope; it must never be used to disguise an unsupported endpoint as a supported one.
