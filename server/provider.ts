import { z } from 'zod';
import type { Config } from './config';
import type { Intent } from '../shared/types';

export type RoutingDecision = {
  intent: Intent;
  query: string;
  identifier?: string;
  origin: 'deterministic' | 'local_model';
  usage: { input: number | null; output: number | null };
};
export interface ModelProvider {
  classify(prompt: string): Promise<RoutingDecision>;
}
const decisionSchema = z
  .object({
    intent: z.enum([
      'revision',
      'structure',
      'compare',
      'qualification',
      'prepare',
      'search',
      'unknown',
    ]),
    query: z.string().max(300),
    identifier: z.string().max(150).optional(),
  })
  .strict();
export function deterministicRoute(prompt: string): RoutingDecision {
  const p = prompt.toLowerCase();
  const identifier = prompt
    .match(/\b(?:SYN-)?[A-Z][A-Z0-9]*-[A-Z0-9]+(?:-[A-Z0-9]+)*\b/i)?.[0]
    .toUpperCase();
  let intent: Intent = 'unknown';
  if (/\b(prepare|draft|prépare|préparer|brouillon)\b/.test(p)) intent = 'prepare';
  else if (/\b(qualifi\w*|material|matériau|substitut\w*|replace|remplac\w*)\b/.test(p))
    intent = 'qualification';
  else if (
    /\b(structure|occurrence\w*|fan\w*|bom|nomenclature)\b/.test(p) ||
    (/\b(assembly|assemblage)\b/.test(p) &&
      !/\b(revision|révision|admissible|eligible|éligible)\b/.test(p))
  )
    intent = 'structure';
  else if (/\b(compare|compar\w*|difference|différence|changed|change)\b/.test(p))
    intent = 'compare';
  else if (/\b(revision|révision|eligible|éligible|admissible|review|revue)\b/.test(p))
    intent = 'revision';
  else if (/\b(search|find|look up|retrieve|cherche|trouve|recherche)\b/.test(p) || identifier)
    intent = 'search';
  const query =
    identifier ||
    prompt
      .replace(
        /^(?:please\s+)?(?:search(?: for)?|find|look up|retrieve|cherche|trouve|recherche)\s+/i,
        '',
      )
      .replace(/[?.!]$/, '')
      .slice(0, 300);
  return { intent, query, identifier, origin: 'deterministic', usage: { input: 0, output: 0 } };
}
export class OllamaProvider implements ModelProvider {
  constructor(
    private config: Config['model'],
    private request: typeof fetch = fetch,
  ) {}
  async classify(prompt: string): Promise<RoutingDecision> {
    if (!this.config.egress || !this.config.name) throw new Error('MODEL_DISABLED');
    const result = await this.request(`${this.config.url}/api/chat`, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(25_000),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.config.name,
        stream: false,
        format: z.toJSONSchema(decisionSchema),
        options: { temperature: 0, num_predict: 200 },
        messages: [
          {
            role: 'system',
            content:
              'Classify an engineering mission into a fixed read-only intent. Extract search keywords and an exact object identifier only if the user supplied it. Never infer an identifier. Commands to submit, delete, release, approve or execute are unknown. Your output cannot authorize any action. Return the requested JSON only.',
          },
          { role: 'user', content: prompt },
        ],
      }),
    });
    if (!result.ok) throw new Error('MODEL_UNAVAILABLE');
    const body = await result.text();
    if (body.length > 100_000) throw new Error('MODEL_RESPONSE_TOO_LARGE');
    const value = JSON.parse(body);
    const decision = decisionSchema.parse(JSON.parse(value.message?.content));
    if (decision.identifier && !prompt.toLowerCase().includes(decision.identifier.toLowerCase()))
      throw new Error('INVENTED_IDENTIFIER');
    const count = (v: unknown) =>
      typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : null;
    return {
      ...decision,
      origin: 'local_model',
      usage: { input: count(value.prompt_eval_count), output: count(value.eval_count) },
    };
  }
}
