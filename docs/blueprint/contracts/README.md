# NOVA contracts v0.1

These are original design contracts, not implemented guarantees or Dassault Systemes API schemas. Files containing `$defs` are schema libraries: validate against the referenced definition, not their unconstrained document root.

`semantic-tool.schema.json` defines bounded tool inputs and a result envelope. Tool results refer to evidence records in the private evidence store. Local discovery/status utilities produce sanitized registry summaries or readiness facts in the same evidence format. They never expose configured hosts, principal identifiers or credential references.

The Mission Manager resolves evidence handles under the current principal and security context. The provider broker rechecks data-class and egress policy before serializing permitted facts into an actual model request. A handle is a reference, not a bearer credential. Guessing one does not grant access. Provider adapters do not fetch arbitrary handles or have direct access to platform credentials.

`evidence.schema.json` keeps source data explicitly untrusted. Structure occurrences and relationships must be represented with provenance-preserving records; do not collapse multiple occurrences into one reference. Contracts may be extended through versioned schema revisions once upstream APIs are verified.

`model-provider.schema.json` normalizes provider-independent request intent and responses. Structured outputs and proposed tool arguments still require validation against their task/tool-specific schema. Preserve vendor-specific usage information only through an approved numeric billing-field mapping; never pass raw HTTP metadata as usage.

`decision-model.schema.json` defines bounded decision interfaces. The runtime must additionally check that a returned non-abstention decision is in the request's permitted decisions, that its schema/artifact version matches, and that any calibrated score has a valid held-out calibration record. A result marked abstained must use ABSTAIN. These relational checks cannot be established merely by parsing the result object.

`benchmark-observation.schema.json` prohibits numeric values for unobserved, inapplicable or unrun metrics. Interpretation still requires the protocol and a verified observation source. An OBSERVED value must not be accepted merely because the producer labels it that way.

The registry schema encodes structural admission prerequisites. Human-verifiable support evidence, user entitlement, actual semantics and runtime security tests remain separate prerequisites. No schema can prove these facts on its own.
