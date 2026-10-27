import { createHash, randomUUID } from 'node:crypto';
import type { AppIntent, Evidence, Mission, Mode, Source } from '../../shared/types';
import { GatewayError } from '../http';
import { PROCESS_KEY, type IteropConnector, type IteropResult } from './connector';
import { SPEC, operation } from './operations';

/**
 * Deterministic EN/FR routing for the three P0 ITEROP read intentions. The operator selects
 * the ITEROP domain in the UI; prompt text can never change the origin, identity or scope.
 * Identifiers are only taken verbatim from the prompt or resolved from a listed record.
 */
export type IteropRoute = {
  intent: AppIntent | 'unknown' | 'blocked' | 'other_user';
  view?: 'all' | 'next' | 'overdue';
  sort?: 'waiting' | 'priority';
  processKey?: string;
  taskId?: string;
};

const explicitKey = (prompt: string) =>
  prompt.match(/\b(?:process\s*key|key|clé)\s*[:=]?\s*([A-Za-z0-9_.:-]{2,200})\b/i)?.[1] ||
  prompt.match(/[“"`]([A-Za-z0-9_.:-]{2,200})[”"`]/)?.[1];
const taskRef = (prompt: string) =>
  prompt.match(/\b(syn-task-\d+)\b/i)?.[1]?.toLowerCase() ||
  prompt.match(/\btask\s*(?:id)?\s*[:=#]\s*([A-Za-z0-9_.:-]{1,200})\b/i)?.[1];

export function routeIterop(prompt: string): IteropRoute {
  // Quoted text names an object; it is never read as a command ("Approve quality impact").
  const p = prompt.toLowerCase().replace(/[“"][^”"]{1,200}[”"]/g, ' “name” ');
  if (/\b(prepare|draft|prépare\w*|brouillon)\b/.test(p)) return { intent: 'process.prepare' };
  if (
    /\b(startable|launchable)\b/.test(p) ||
    (/\b(start|launch|initiate|démarrer|lancer|démarre)\b/.test(p) &&
      /\b(can|could|allowed|able|may|permitted|peux|puis|puis-je|autorisé\w*)\b/.test(p)) ||
    /\b(workflows?|processes|processus)\b.*\b(available|to me|for me|disponibles?)\b/.test(p)
  )
    return { intent: 'process.startable' };
  // Another person's tasks: never enumerable without a reviewed authorization model.
  if (
    /\b(?:tasks?|tâches?|inbox|workload)\s+(?:of|for|assigned to|belonging to|de|d'|pour|assignées? à)\s+(?!me\b|moi\b|myself\b|my\b)[a-zà-ÿ]/i.test(
      prompt,
    ) ||
    /\b(?!my\b)[a-zà-ÿ]+'s\s+(?:tasks?|inbox|workload)\b/i.test(prompt) ||
    /\b(everyone|all users|other users?|team's|my team|tous les utilisateurs)\b/.test(p)
  )
    return { intent: 'other_user' };
  if (
    /\b(start|launch|complete|claim|assign|reassign|delegate|cancel|abort|delete|approve|reject|submit|validate|execute|deploy|close|démarre|lance|termine|valide|approuve|rejette|supprime|annule|déploie)\b/.test(
      p,
    )
  )
    return { intent: 'blocked' };
  const taskId = taskRef(prompt);
  if (taskId && /\b(why|attention|urgent|explain|pourquoi|explique)\b/.test(p))
    return { intent: 'process.task_attention', taskId };
  if (/\b(need|needs)\b.*\battention\b|\bpourquoi\b.*\b(tâche|attention)\b/.test(p))
    return { intent: 'process.task_attention' };
  if (
    /\b(tasks?|tâches?|to-?do|inbox|work on|overdue|late|en retard|assigned|assignées?)\b/.test(p)
  )
    return {
      intent: 'process.my_tasks',
      view: /\b(overdue|late|past due|due date|deadline|en retard|échéance)\b/.test(p)
        ? 'overdue'
        : (/\b(first|next|d'abord|en premier)\b/.test(p) &&
              /\b(work|travaill|should|dois)/.test(p)) ||
            /\b(waiting|longest|oldest|attend\w*)\b/.test(p)
          ? 'next'
          : 'all',
      sort: /priorit/.test(p) ? 'priority' : 'waiting',
    };
  if (
    /\b(explain|describe|summary|summarize|basic info\w*|information|what is|what's|tell me about|explique|décris|résumé|qu'est-ce)\b/.test(
      p,
    ) &&
    /\b(process|workflow|processus|flux)\b/.test(p)
  )
    return { intent: 'process.summary', processKey: explicitKey(prompt) };
  return { intent: 'unknown' };
}

const num = (e: Evidence, k: string) =>
  typeof e.fields[k] === 'number' ? (e.fields[k] as number) : undefined;
/** FD04 gives priority as int32 with no documented scale or direction. */
const priorityText = (e: Evidence) =>
  num(e, 'priority') === undefined
    ? 'priority not returned'
    : `priority value ${num(e, 'priority')}`;
const waitingText = (e: Evidence) => {
  const at = str(e, 'startedAt');
  if (!at)
    return num(e, 'startDate') === undefined
      ? 'start date not returned'
      : 'start date returned (unit to be confirmed)';
  const days = Math.floor((Date.now() - Date.parse(at)) / 86_400_000);
  return days <= 0 ? 'started today' : `waiting ${days} ${days === 1 ? 'day' : 'days'}`;
};
const str = (e: Evidence, k: string) =>
  typeof e.fields[k] === 'string' ? (e.fields[k] as string) : undefined;
const titleCaseFirst = (s: string) => s[0].toUpperCase() + s.slice(1);
const words = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 3 && !['process', 'workflow', 'processus', 'request'].includes(w));

/** Resolve a process by name against the startable list. Never guesses on ties. */
export function matchProcess(prompt: string, records: Evidence[]) {
  const asked = new Set(words(prompt));
  const scored = records
    .map((r) => {
      const name = words(r.title);
      const hit = name.filter((w) => asked.has(w)).length;
      return { r, score: name.length ? hit / name.length : 0, hit };
    })
    .filter((s) => s.hit > 0 && s.score >= 0.6)
    .sort((a, b) => b.score - a.score);
  if (!scored.length) return { match: undefined, candidates: [] as Evidence[] };
  const best = scored.filter((s) => s.score === scored[0].score);
  return best.length === 1
    ? { match: best[0].r, candidates: [] }
    : { match: undefined, candidates: best.map((b) => b.r) };
}

type Ctx = {
  mission: Mission;
  connector: IteropConnector;
  source: Source;
  mode: Mode;
  prompt: string;
  trace: (
    label: string,
    detail: string,
    kind: 'policy' | 'route' | 'tool' | 'evidence',
    ms?: number,
  ) => void;
  stop: (status: Mission['status'], title: string, answer: string) => Mission;
  finish: () => Mission;
};

export async function runIteropMission(ctx: Ctx): Promise<Mission> {
  const { mission, connector, source, mode, prompt, trace, stop, finish } = ctx;
  mission.provenance = [];
  if (source === 'live' && connector.config.blockers.length)
    return stop(
      'blocked',
      'Your Business Process connection needs approval',
      'Live access needs an approved API route, credential and reviewed contract — independent of the engineering connection. Open Connections for the exact requirements. No request was made.',
    );
  const route = routeIterop(prompt);
  trace(
    'Deterministic route',
    `ITEROP · ${route.intent} · ${mode.toLowerCase()} · ${source}`,
    'route',
  );
  if (route.intent === 'other_user')
    return stop(
      'blocked',
      "Other people's tasks are out of scope",
      'NOVA lists only your own tasks. Enumerating another person’s tasks needs a reviewed authorization model, which does not exist. No request was made.',
    );
  if (route.intent === 'blocked')
    return stop(
      'blocked',
      'Process changes need a governed workflow',
      'NOVA reads processes and your tasks only. It cannot start a process, complete or reassign a task, or deploy a model. In Prepare mode it can draft a start request for you to review — nothing is sent.',
    );
  if (route.intent === 'unknown')
    return stop(
      'needs_input',
      'What would you like to know?',
      'Ask which processes you can start, what your current or overdue tasks are, what to work on first, or for an explanation of a process (for example “Explain the contractor access form process”).',
    );
  mission.intent = route.intent;
  const call = async (name: string, args: { processKey?: string } = {}): Promise<IteropResult> => {
    const t = performance.now();
    mission.metrics.toolCalls++;
    const base = {
      operation: name,
      source,
      at: new Date().toISOString(),
      specRelease: SPEC.release,
      method: 'GET' as const,
    };
    try {
      const result = await connector.call(name, args, source);
      mission.provenance!.push({
        ...base,
        operationId: result.spec.operationId,
        path: result.spec.path,
        scope: result.spec.scope,
        outcome: 'ok',
        coverage: result.coverage,
        records: result.records.length,
      });
      trace(
        `${name} · ${result.spec.operationId}`,
        `${result.records.length} records · ${result.coverage} coverage`,
        'tool',
        performance.now() - t,
      );
      return result;
    } catch (error) {
      const code = error instanceof GatewayError ? error.code : 'REQUEST_FAILED';
      const spec = operation(name);
      mission.provenance!.push({
        ...base,
        operationId: spec?.operationId || 'unknown',
        path: spec?.path || 'unknown',
        scope: spec?.scope || 'unknown',
        outcome:
          code === 'AUTHORIZATION_DENIED' ? 'denied' : code === 'NOT_FOUND' ? 'not_found' : 'error',
        coverage: null,
        records: 0,
      });
      trace(name, code, 'tool', performance.now() - t);
      throw error;
    }
  };
  const coverageNote = (r: IteropResult) => {
    if (r.coverage !== 'complete') {
      mission.status = 'insufficient_evidence';
      mission.findings.push(`Coverage is ${r.coverage}; this may not be the complete set.`);
    }
  };
  try {
    switch (route.intent) {
      case 'process.startable': {
        const r = await call('iterop.list_startable_processes');
        mission.evidence = r.records;
        mission.title = r.records.length
          ? `${r.records.length} ${r.records.length === 1 ? 'process' : 'processes'} you can start`
          : 'No processes you can start';
        mission.answer = r.records.length
          ? 'Listed by the service for your own identity. NOVA did not infer permissions; starting one still happens in your process tool.'
          : 'The service returned no startable process for your identity. That is an answer, not an error.';
        mission.findings = r.records.map(
          (e) =>
            `[${e.id}] ${e.title}${e.fields.version !== undefined ? ` · version ${e.fields.version}` : ''}`,
        );
        coverageNote(r);
        break;
      }
      case 'process.my_tasks':
      case 'process.task_attention': {
        const r = await call('iterop.list_my_tasks');
        // startDate ordering is valid whatever its (undocumented) unit; missing values sort last.
        const started = (t: Evidence) => num(t, 'startDate') ?? Number.MAX_SAFE_INTEGER;
        const sorted = [...r.records].sort((a, b) =>
          route.sort === 'priority'
            ? (num(b, 'priority') ?? -Infinity) - (num(a, 'priority') ?? -Infinity) ||
              started(a) - started(b)
            : started(a) - started(b),
        );
        if (route.intent === 'process.task_attention') {
          const byName = route.taskId ? undefined : matchProcess(prompt, sorted);
          if (byName?.candidates.length)
            return stop(
              'needs_input',
              'Which task do you mean?',
              `Several of your tasks match: ${byName.candidates.map((c) => c.title).join(', ')}. Name one exactly.`,
            );
          const t = route.taskId
            ? sorted.find((x) => x.id.toLowerCase() === route.taskId?.toLowerCase())
            : byName?.match;
          if (!t)
            return stop(
              'needs_input',
              'That task is not in your current tasks',
              `NOVA can only explain tasks returned for your own identity. ${sorted.length} current tasks were returned and none matches.`,
            );
          mission.evidence = [t];
          mission.title = `Why “${t.title}” needs your attention`;
          mission.answer = `From its returned fields only: ${(str(t, 'description') || t.title).replace(/\.$/, '')}. NOVA reports returned values and does not infer a business cause; the task API returns no due date.`;
          mission.findings = [
            `[${t.id}] It is an active task waiting to be performed (returned by getTasksByUser).`,
            `[${t.id}] ${titleCaseFirst(waitingText(t))}; position ${sorted.indexOf(t) + 1} of ${sorted.length} by waiting time.`,
            `[${t.id}] ${titleCaseFirst(priorityText(t))} — FD04 does not document the scale.`,
            `[${t.id}] Part of ${str(t, 'processName') || 'an unnamed process'}${str(t, 'processIdentificator') ? ` (“${str(t, 'processIdentificator')}”)` : ''}.`,
          ];
          break;
        }
        mission.evidence = sorted;
        if (route.view === 'overdue') {
          mission.status = 'insufficient_evidence';
          mission.title = 'Overdue status is not available';
          mission.answer =
            'The task API (getTasksByUser, R2026x-FD04) returns no due date, so NOVA cannot say which tasks are overdue. Your current tasks are listed by how long they have been waiting instead.';
        } else if (route.view === 'next') {
          const first = sorted[0];
          mission.title = first ? `Start with ${first.title}` : 'You have no current tasks';
          mission.answer = first
            ? 'Ranked by how long each task has been waiting — a transparent rule, not a judgement of business importance. The task API returns no due date, and its priority scale is undocumented.'
            : 'The service returned an empty task list for your identity.';
        } else {
          mission.title = sorted.length
            ? `${sorted.length} current ${sorted.length === 1 ? 'task' : 'tasks'}`
            : 'You have no current tasks';
          mission.answer = sorted.length
            ? route.sort === 'priority'
              ? 'Sorted by returned priority value, highest first. FD04 does not document whether a higher value means more urgent.'
              : 'Sorted by waiting time, longest first. The task API returns no due date.'
            : 'The service returned an empty task list for your identity. That is an answer, not an error.';
        }
        mission.findings = sorted.map(
          (t, i) =>
            `${route.view === 'next' ? `${i + 1}. ` : ''}[${t.id}] ${t.title} · ${waitingText(t)} · ${priorityText(t)}${str(t, 'processName') ? ` · ${str(t, 'processName')}` : ''}`,
        );
        coverageNote(r);
        break;
      }
      case 'process.summary': {
        let key = route.processKey;
        if (key && !PROCESS_KEY.test(key))
          return stop(
            'needs_input',
            'That process key is not valid',
            'Process keys contain letters, digits, dot, colon, dash or underscore only.',
          );
        if (!key) {
          const list = await call('iterop.list_startable_processes');
          const { match, candidates } = matchProcess(prompt, list.records);
          if (candidates.length)
            return stop(
              'needs_input',
              'Which process do you mean?',
              `Several of your processes match: ${candidates.map((c) => c.title).join(', ')}. Name one exactly.`,
            );
          if (!match)
            return stop(
              'needs_input',
              'Which process?',
              `Name a process you can start (${list.records.map((r) => r.title).join(', ') || 'none returned'}), or give its exact process key.`,
            );
          key = match.id;
          trace(
            'Name resolution',
            `Matched “${match.title}” in your startable list → ${key}`,
            'route',
          );
        }
        const r = await call('iterop.get_process_summary', { processKey: key });
        const d = r.records[0];
        mission.evidence = [d];
        mission.title = d.title;
        mission.answer = str(d, 'description') || 'The process returns no description.';
        mission.findings = [
          `[${d.id}] Version ${d.fields.version ?? 'not returned'}.`,
          `[${d.id}] Basic information only. Inputs, steps and variables need a separate reviewed operation.`,
        ];
        if (!str(d, 'description')) mission.status = 'insufficient_evidence';
        break;
      }
      case 'process.prepare': {
        if (mode !== 'ACT')
          return stop(
            'needs_input',
            'Switch to Prepare to draft this',
            'Prepare creates a local draft for you to review. It never starts a process.',
          );
        const r = await call('iterop.list_startable_processes');
        const { match, candidates } = matchProcess(prompt, r.records);
        if (!match)
          return stop(
            'needs_input',
            'Which process should the draft start?',
            `Name one process you can start: ${(candidates.length ? candidates : r.records).map((d) => d.title).join(', ')}.`,
          );
        mission.evidence = [match];
        const payload = {
          kind: 'process.start' as const,
          object: match.id,
          summary: prompt,
          evidenceRefs: [match.id],
          status: 'DRAFT_ONLY' as const,
          expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
        };
        mission.draft = {
          id: randomUUID(),
          ...payload,
          digest: createHash('sha256').update(JSON.stringify(payload)).digest('hex'),
        };
        mission.status = 'prepared';
        mission.title = `${match.title} — start draft, not submitted`;
        mission.answer =
          'PREPARED — NOT SUBMITTED. NOVA has no write access; startProcess is out of scope. Review the draft, then start the process yourself in your process tool if appropriate.';
        mission.findings = [
          `Draft object: ${match.id}`,
          'Input fields are not validated against the process form. Starting via API needs a separate, approved mission.',
        ];
        break;
      }
    }
    trace(
      'Evidence attached',
      `${mission.evidence.length} allowlisted records. Source text cannot issue tool calls.`,
      'evidence',
    );
    return finish();
  } catch (error) {
    if (error instanceof GatewayError && error.code === 'AUTHORIZATION_DENIED')
      return stop(
        'blocked',
        'Access denied for this identity',
        `${error.message} This is final: NOVA does not retry with another identity, route or parameter.`,
      );
    if (error instanceof GatewayError && error.code === 'NOT_FOUND')
      return stop(
        'needs_input',
        'No process with that key',
        `${error.message} NOVA does not guess alternatives.`,
      );
    return stop(
      'blocked',
      error instanceof GatewayError
        ? error.code.replaceAll('_', ' ').toLowerCase()
        : 'Mission could not complete',
      error instanceof GatewayError
        ? error.message
        : 'An unexpected runtime error occurred. No upstream change was attempted.',
    );
  }
}
