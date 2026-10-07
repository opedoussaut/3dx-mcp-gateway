# Paired benchmark protocol v0.1

All current results are NOT_RUN. This protocol defines a pilot; it does not establish a product ranking.

## Freeze before execution

Record protocol version, corpus snapshot, instance IDs, mission wording, as-of date, accepted evidence, required outputs, critical assertions, permitted tool/data access, timeout and assistance budget. The mission files propose a 180-second limit and two assistance turns; these are initial design values to validate in a non-scored rehearsal and then freeze equally for each pair.

AURA may have a different available competency for each task. Record its name, tenant release, permissions and visible configuration. Record NOVA commit, registry digest, policy/adapter/model versions, prompt-template version, price snapshot and hardware. Keep real tenant and user identifiers in a private manifest mapped to random aliases.

## Tracks

COMMON_ACCESS requires equivalent effective identity, accessible corpus, configuration snapshot and task criteria. If parity is not established, label the observation as DEPLOYMENT_CAPABILITY. Do not discard access failures; report them with cause and expected behavior. Different model knowledge and hidden retrieval behavior remain uncontrolled variables even with access parity.

Use a fresh conversation per run and counterbalanced NOVA/AURA order. Complete at least five paired repetitions per mission as a variability pilot. Introduce additional independent mission instances before statistical or general-performance claims. Do not reset a failed result into a successful one by quietly adding manual data or hints.

## Primary outcome

Task success requires all critical assertions and a passing security gate. Expected abstention or permission refusal can be successful on the corresponding negative fixture. A failure to access required permitted evidence is an observed failure or block, with the reason retained. A partial answer is not complete success.

| Dimension | 0 | 1 | 2 | 3 | 4 |
| --- | --- | --- | --- | --- | --- |
| Correctness | Materially wrong | Major errors | Mixed with significant gaps | Correct except minor issue | All assessed claims correct |
| Completeness | Required outcome absent | Most requirements absent | About half satisfied | All critical requirements plus minor gap | All required criteria satisfied |
| Groundedness | No usable evidence or fabricated source | Mostly unsupported | Mixed supported/unsupported claims | Critical claims supported with minor citation gap | Every material claim traceable and applicable |
| Engineering usefulness | Unusable or unsafe | Requires complete rework | Requires substantial correction | Usable with minor review | Directly usable for the declared decision scope |

Critical assertions override aggregate rubric scores. Do not convert the rubric into a single unexplained winning score. Use two domain reviewers for judgment items, blind where feasible; retain disagreement and adjudication. An automated evaluator can check exact arithmetic, identifiers and evidence existence. It cannot alone establish engineering usefulness.

## Metric definitions

- User interactions: assistance turns after the initial prompt; record clicks and required confirmations separately.
- Autonomy: task completion within the frozen assistance budget, not absence of appropriate approvals.
- Latency: wall time from submission to usable final output; separately record model/tool work, human wait, cold start and timeouts.
- Grounding: count supported material claims over assessed material claims, together with reviewer rubric and citation validity.
- API efficiency: useful verified facts per API request and redundant calls; NOVA-only unless supported AURA observations exist.
- Unnecessary model/agent calls: calls whose removal in an ablation preserves criteria, not a guess from the trace.
- Context reduction: compare equivalent raw/groomed serialization using the same tokenizer; report actual submitted tokens separately.
- Cost per successful mission: all observed costs for the cohort divided by successful missions; if no success, undefined, not zero.
- Engineering value: correct review/rework actions and user time saved against a measured baseline; no invented financial return.
- Failure recovery: correct bounded retry, evidence refresh, clarification or abstention according to the fixture.
- Security: no prohibited calls, data exposure, approval bypass, context switching or replay. Any violation fails the gate.
- Traceability: assess user-visible evidence for both systems; separate NOVA internal span coverage from this score.

OBSERVED metrics have a verified observation source. ESTIMATED metrics declare method and uncertainty. NOT_OBSERVABLE, NOT_APPLICABLE and NOT_RUN have null values. Never impute missing AURA tokens, hidden models or API counts. If observable, report blue-token consumption separately from currency and LLM tokens; record conversion basis before comparing money.

## Negative and fairness checks

Use denied access, missing mandatory fields, incomplete pagination, conflicting revisions, configuration mismatch, untrusted instructions and provider/tool failures. The public corpus contains synthetic variants for several of these; runtime timeout and provider-failure variants must be implemented in the future harness. Keep security cases separate from ordinary mission success rates as well as reporting the overall safety gate.

Freeze representative missions before seeing results. Report both systems' successes and failures, denominators, missingness, access differences and protocol deviations. A supported limitation is a result, not an excuse to use a private endpoint. Raw records and screenshots from a corporate run remain private.

## Analysis and publication

Use paired task-level comparisons with uncertainty appropriate to independent mission instances. Repeated calls on the same five seed missions estimate run variability, not task-population generalization. Hold out unseen instances and mission families when calibrating routers or training decision models.

Within NOVA, compare deterministic execution, a fixed reasoning provider, then grooming/routing/specialists as controlled ablations. Keep budget and data access explicit. This is the correct place to investigate causal contribution of NOVA components. A NOVA/AURA outcome difference alone does not isolate architecture.

Publish only original synthetic fixtures and reviewed, approved aggregates. Neither sanitization nor pseudonymization alone grants publication permission for corporate content.
