import { createHash, randomUUID } from 'node:crypto';
import type {
  Evidence,
  Intent,
  Item,
  Mission,
  Mode,
  Source,
  ToolName,
  ToolResult,
} from '../shared/types';
import { Gateway, GatewayError, evidence } from './gateway';
import { deterministicRoute, OllamaProvider, type ModelProvider } from './provider';

export class MissionRunner {
  constructor(
    private gateway: Gateway,
    private provider?: ModelProvider,
  ) {}
  async run(prompt: string, source: Source, mode: Mode): Promise<Mission> {
    const start = performance.now();
    const mission: Mission = {
      id: randomUUID(),
      prompt,
      source,
      mode,
      intent: 'unknown',
      status: 'completed',
      title: 'Mission result',
      answer: '',
      findings: [],
      evidence: [],
      trace: [],
      metrics: {
        elapsedMs: 0,
        toolCalls: 0,
        modelCalls: 0,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: null,
        writes: 0,
      },
      createdAt: new Date().toISOString(),
    };
    const trace = (
      label: string,
      detail: string,
      kind: 'policy' | 'route' | 'tool' | 'evidence',
      ms = 0,
    ) => mission.trace.push({ label, detail, kind, durationMs: Math.round(ms * 100) / 100 });
    const finish = () => {
      mission.metrics.elapsedMs = Math.round((performance.now() - start) * 100) / 100;
      return mission;
    };
    const stop = (status: Mission['status'], title: string, answer: string) => {
      mission.status = status;
      mission.title = title;
      mission.answer = answer;
      return finish();
    };
    trace(
      'Read-only boundary',
      source === 'synthetic'
        ? 'Isolated synthetic corpus. No platform connection.'
        : 'Only admitted public read operations. No platform mutations.',
      'policy',
    );
    const actionable = prompt
      .toLowerCase()
      .replace(
        /\b(do not|don't|never|without)\s+(submit|delete|release|approve|execute|commit)\b/g,
        '',
      );
    if (
      /\b(delete|destroy|purge|execute|commit|submit|approve|release|supprime|supprimer|exécute|approuve)\b/.test(
        actionable,
      )
    )
      return stop(
        'blocked',
        'This action needs a governed write workflow',
        'This version can investigate and prepare a local draft. It cannot submit, approve, release or delete anything on your platform.',
      );
    if (source === 'live' && this.gateway.config.blockers.length)
      return stop(
        'blocked',
        'Your platform connection needs setup',
        'Open Connections to complete the private configuration and verify the read API contracts for your release. No platform request was made.',
      );
    let route = deterministicRoute(prompt);
    if (
      route.intent === 'unknown' &&
      this.gateway.config.model.provider === 'ollama' &&
      this.gateway.config.model.egress &&
      this.gateway.config.model.name
    ) {
      const t = performance.now();
      mission.metrics.modelCalls = 1;
      try {
        route = await (this.provider || new OllamaProvider(this.gateway.config.model)).classify(
          prompt,
        );
        mission.metrics.inputTokens = route.usage.input;
        mission.metrics.outputTokens = route.usage.output;
        trace(
          'Local intent model',
          'Validated a bounded intent. No evidence, credentials or tool authority sent.',
          'route',
          performance.now() - t,
        );
      } catch {
        mission.metrics.inputTokens = null;
        mission.metrics.outputTokens = null;
        trace(
          'Local model unavailable',
          'Clarification requested. Model failure does not unlock any capability.',
          'route',
          performance.now() - t,
        );
      }
    }
    mission.intent = route.intent;
    trace(
      route.origin === 'deterministic' ? 'Deterministic route' : 'Validated model route',
      `${route.intent} · ${mode.toLowerCase()} · ${source}`,
      'route',
    );
    if (route.intent === 'unknown')
      return stop(
        'needs_input',
        'What would you like to investigate?',
        'Ask me to find an engineering item, identify a revision, inspect a structure, compare revisions, check material qualification, or prepare a review. Include an exact identifier when possible.',
      );
    if (route.intent === 'prepare' && mode !== 'ACT')
      return stop(
        'needs_input',
        'Switch to Act to prepare a draft',
        'Act creates a local review draft for you to inspect. It does not submit anything to 3DEXPERIENCE.',
      );
    const call = async (
      name: ToolName,
      args: { query?: string; id?: string },
    ): Promise<ToolResult> => {
      const t = performance.now();
      mission.metrics.toolCalls++;
      try {
        const result = await this.gateway.call(name, args, source);
        trace(
          name,
          `${result.evidence.length} evidence records · ${result.coverage} coverage`,
          'tool',
          performance.now() - t,
        );
        for (const record of result.evidence)
          if (!mission.evidence.some((e) => e.id === record.id)) mission.evidence.push(record);
        return result;
      } catch (error) {
        trace(
          name,
          error instanceof GatewayError ? error.code : 'REQUEST_FAILED',
          'tool',
          performance.now() - t,
        );
        throw error;
      }
    };
    try {
      if (route.intent === 'qualification' || route.intent === 'prepare') {
        if (source === 'synthetic' && (!/\bM2\b/i.test(prompt) || !/\bBENCH-48V\b/i.test(prompt)))
          return stop(
            'needs_input',
            'Specify a material and qualification scope',
            'The synthetic corpus covers material M2 on BENCH-48V. Include both in your mission, or choose your platform for live evidence.',
          );
        const result = await call('search_knowledge', {
          query: source === 'synthetic' ? 'M2 BENCH-48V' : route.query,
        });
        mission.title = 'Qualification evidence needs review';
        mission.answer =
          'The retrieved evidence does not establish qualification for this substitution.';
        mission.status = 'insufficient_evidence';
        if (source === 'synthetic') {
          mission.findings = [
            '[SYN-K-01] The material M1 recommendation is superseded.',
            '[SYN-K-02] M2 passed tests for BENCH-24V only; that evidence does not qualify BENCH-48V.',
            '[SYN-K-03] No M2 qualification result for BENCH-48V is available.',
          ];
        } else
          mission.findings = [
            'An engineering reviewer must assess current evidence against the exact material, configuration and qualification policy.',
            `Retrieved coverage is ${result.coverage}. Missing evidence is not proof of qualification.`,
          ];
        if (route.intent === 'prepare') {
          const object = prompt.match(/\bSYN-COOL-100\b/i)?.[0]?.toUpperCase() || route.identifier;
          if (!object)
            return stop(
              'needs_input',
              'Which item should the review cover?',
              'Include the exact engineering item identifier to prepare a traceable draft.',
            );
          const payload = {
            object,
            summary: prompt,
            evidenceRefs: mission.evidence.map((e) => e.id),
            status: 'DRAFT_ONLY' as const,
            expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
          };
          mission.draft = {
            id: randomUUID(),
            ...payload,
            digest: createHash('sha256').update(JSON.stringify(payload)).digest('hex'),
          };
          mission.status = 'prepared';
          mission.title = 'Your review draft is ready';
          mission.answer =
            'A local draft captures the proposed substitution and the missing qualification evidence. Review it before using your approved change process. Nothing has been submitted.';
        }
      } else {
        const lookupQuery =
          route.identifier ||
          (/cooling assembly/i.test(prompt)
            ? 'Cooling assembly'
            : /controller/i.test(prompt)
              ? 'controller'
              : route.query);
        const search = await call('search_engineering_items', { query: lookupQuery });
        let candidates = route.identifier
          ? search.items.filter(
              (i) => i.identifier.toLowerCase() === route.identifier!.toLowerCase(),
            )
          : search.items;
        if (!candidates.length)
          return stop(
            search.coverage === 'complete' ? 'needs_input' : 'insufficient_evidence',
            'No matching item in the returned evidence',
            `Try an exact identifier or a shorter search phrase. Search coverage: ${search.coverage}.`,
          );
        const identifiers = [...new Set(candidates.map((i) => i.identifier))];
        if (identifiers.length > 1 && route.intent !== 'search')
          return stop(
            'needs_input',
            'Which engineering item do you mean?',
            `The title matches ${identifiers.join(' and ')}. Include one exact identifier so I can continue without guessing.`,
          );
        if (route.intent === 'search') {
          mission.title = `${candidates.length} engineering ${candidates.length === 1 ? 'item' : 'items'} found`;
          mission.answer = `These records match “${lookupQuery}” in the ${source === 'synthetic' ? 'synthetic workspace' : 'platform response'}.`;
          mission.findings = candidates.map(
            (i) =>
              `[${i.id}] ${i.identifier} · revision ${i.revision} · ${i.state || 'lifecycle state unavailable'}`,
          );
          if (search.coverage !== 'complete') {
            mission.status = 'insufficient_evidence';
            mission.findings.push(
              `Coverage is ${search.coverage}; this is not a complete result set.`,
            );
          }
        } else if (route.intent === 'revision') {
          if (source === 'live') {
            mission.findings = candidates.map(
              (i) => `[${i.id}] Revision ${i.revision}: ${i.state || 'state unavailable'}.`,
            );
            return stop(
              'insufficient_evidence',
              'Revisions found; review policy needed',
              'The live records are available, but this installation has no approved tenant review policy. An engineering reviewer must define eligibility criteria before NOVA can declare a revision admissible.',
            );
          }
          const eligible = candidates.filter(
            (i) => i.state === 'REVIEW_ELIGIBLE' && i.superseded === false,
          );
          if (eligible.length !== 1 || search.coverage !== 'complete')
            return stop(
              'insufficient_evidence',
              'Eligibility cannot be established',
              'I need complete search coverage and one eligible, non-superseded revision.',
            );
          const record = await call('get_engineering_item', { id: eligible[0].id });
          const item = record.items[0];
          if (
            !item ||
            !item.identifier ||
            !item.revision ||
            !item.state ||
            !item.owner ||
            !item.material ||
            item.superseded !== false ||
            item.state !== 'REVIEW_ELIGIBLE'
          )
            return stop(
              'insufficient_evidence',
              'Required review evidence is missing',
              'The item must have an identifier, revision, eligible state, owner role and material declaration.',
            );
          mission.title = `Revision ${item.revision} is eligible for review`;
          mission.answer = `${item.identifier}, revision ${item.revision}, meets the supplied synthetic component-review policy. This is review eligibility, not release approval.`;
          mission.findings = [
            `[${item.id}] Lifecycle state is REVIEW_ELIGIBLE and the revision is not superseded.`,
            `[${item.id}] Owner: ${item.owner}. Material declaration: ${item.material}.`,
            `Excluded ${
              candidates
                .filter((i) => i.id !== item.id)
                .map((i) => `revision ${i.revision} (${i.state})`)
                .join(', ') || 'no other revision'
            }.`,
          ];
          mission.evidence.push(
            evidence(
              'review-policy-v1',
              'Synthetic review policy',
              {
                eligibleState: 'REVIEW_ELIGIBLE',
                excludeSuperseded: true,
                requiredFields: 'identifier, revision, state, owner, material',
              },
              source,
            ),
          );
        } else if (route.intent === 'structure') {
          const revision = prompt
            .match(/(?:revision|révision|rev\.?)[ ]+([A-Za-z0-9]+)/i)?.[1]
            ?.toUpperCase();
          const config = prompt.match(/\bBENCH-[A-Z0-9]+\b/i)?.[0]?.toUpperCase();
          if (!revision || (source === 'synthetic' && config !== 'BENCH-48V'))
            return stop(
              'needs_input',
              'Specify a revision and configuration',
              'For the synthetic mission, use SYN-COOL-100 revision B in BENCH-48V. Counts are meaningful only within an explicit configuration.',
            );
          candidates = candidates.filter((i) => i.revision.toUpperCase() === revision);
          if (candidates.length !== 1)
            return stop(
              'needs_input',
              'Select one exact revision',
              'The requested revision could not be uniquely resolved from the returned evidence.',
            );
          const structure = await call('get_product_structure', { id: candidates[0].id });
          const included = structure.evidence.filter(
            (e) => e.fields.included === true && (!config || e.fields.configuration === config),
          );
          const unique = new Set(included.map((e) => e.fields.reference).filter(Boolean)).size;
          const sufficient =
            structure.coverage === 'complete' &&
            structure.evidence.length > 0 &&
            structure.evidence.every(
              (e) =>
                typeof e.fields.included === 'boolean' &&
                typeof e.fields.reference === 'string' &&
                typeof e.fields.occurrence === 'string' &&
                (!config || e.fields.configuration === config),
            );
          mission.title = `${included.length} included occurrences · ${unique} unique references`;
          mission.answer = `${included.length} occurrence records refer to ${unique} distinct component references in the returned structure. ${sufficient ? 'Coverage is complete within the declared scope.' : 'Coverage is incomplete or unverified; these are known counts only.'}`;
          mission.status = sufficient ? 'completed' : 'insufficient_evidence';
          mission.findings = structure.evidence.map(
            (e) =>
              `[${e.id}] ${e.fields.reference || 'Reference unavailable'} · ${e.fields.included === true ? 'included' : e.fields.included === false ? 'excluded' : 'inclusion unknown'} · ${e.fields.configuration || 'configuration unavailable'}`,
          );
        } else if (route.intent === 'compare') {
          const revisions = prompt.match(
            /(?:revisions?|révisions?)\s+([A-Za-z0-9]+)\s+(?:and|et|to|versus|vs\.?|→)\s+([A-Za-z0-9]+)/i,
          );
          if (!revisions)
            return stop(
              'needs_input',
              'Which revisions should I compare?',
              'Include two explicit revisions, such as “Compare SYN-CTRL-100 revisions A and B”.',
            );
          const selected = [revisions[1], revisions[2]].map((r) =>
            candidates.filter((i) => i.revision.toUpperCase() === r.toUpperCase()),
          );
          if (selected.some((s) => s.length !== 1))
            return stop(
              'insufficient_evidence',
              'Both revisions are needed',
              'The requested pair was not uniquely present in the returned records.',
            );
          const items: Item[] = [];
          for (const match of selected) {
            const r = await call('get_engineering_item', { id: match[0].id });
            if (r.items.length === 1) items.push(r.items[0]);
          }
          if (items.length !== 2)
            return stop(
              'insufficient_evidence',
              'Both revision details are needed',
              'One of the detail reads returned incomplete evidence.',
            );
          const requirements = await call('get_requirements', { id: items[1].id });
          const fields = ['connector', 'pinCount', 'voltage'] as const;
          mission.findings = fields.map(
            (field) =>
              `[${items[0].id}, ${items[1].id}] ${field}: ${items[0][field] ?? 'unknown'} → ${items[1][field] ?? 'unknown'}${items[0][field] !== undefined && items[0][field] === items[1][field] ? ' (unchanged)' : ''}.`,
          );
          mission.findings.push(
            ...requirements.evidence.map(
              (e) => `[${e.id}] ${e.fields.text || 'Requirement text unavailable'}`,
            ),
          );
          mission.title = 'Revision comparison is ready';
          mission.answer =
            source === 'synthetic'
              ? 'The connector changes from J1 to J2, and the pin count from 4 to 6. Review the harness interface requirement SYN-REQ-01. The 48 V supply requirement is unchanged.'
              : 'The mapped revision fields and linked requirements are shown below. Engineering review is required to determine impact.';
          if (
            fields.some((f) => items.some((i) => i[f] === undefined)) ||
            requirements.coverage !== 'complete'
          )
            mission.status = 'insufficient_evidence';
        }
      }
      trace(
        'Evidence attached',
        `${mission.evidence.length} allowlisted records. Source content cannot issue tool calls.`,
        'evidence',
      );
      return finish();
    } catch (error) {
      return stop(
        'blocked',
        error instanceof GatewayError
          ? error.code.replaceAll('_', ' ').toLowerCase()
          : 'Mission could not complete',
        error instanceof GatewayError
          ? error.message
          : 'An unexpected runtime error occurred. No platform mutation was attempted.',
      );
    }
  }
}
