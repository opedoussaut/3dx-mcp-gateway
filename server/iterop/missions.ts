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
  sort?: 'due' | 'priority';
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
  const p = prompt.toLowerCase();
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
  if (
    /\b(tasks?|tâches?|to-?do|inbox|work on|overdue|late|en retard|assigned|assignées?)\b/.test(p)
  )
    return {
      intent: 'process.my_tasks',
      view: /\b(overdue|late|past due|en retard)\b/.test(p)
        ? 'overdue'
        : /\b(first|next|priorit\w*|d'abord|en premier)\b/.test(p) &&
            /\b(work|travaill|should|dois)/.test(p)
          ? 'next'
          : 'all',
      sort: /priorit/.test(p) && !/\b(due|deadline|échéance)\b/.test(p) ? 'priority' : 'due',
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

const priorityRank: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
const str = (e: Evidence, k: string) =>
  typeof e.fields[k] === 'string' ? (e.fields[k] as string) : undefined;
const today = () => new Date().toISOString().slice(0, 10);
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
            `[${e.id}] ${e.title}${str(e, 'category') ? ` · ${str(e, 'category')}` : ''}${e.fields.version !== undefined ? ` · v${e.fields.version}` : ''}`,
        );
        coverageNote(r);
        break;
      }
      case 'process.my_tasks':
      case 'process.task_attention': {
        const r = await call('iterop.list_my_tasks');
        const now = today();
        const sorted = [...r.records].sort((a, b) => {
          const due = (str(a, 'dueDate') || '9999').localeCompare(str(b, 'dueDate') || '9999');
          const pr =
            (priorityRank[str(a, 'priority') || ''] ?? 9) -
            (priorityRank[str(b, 'priority') || ''] ?? 9);
          return route.sort === 'priority' ? pr || due : due || pr;
        });
        const overdue = sorted.filter((t) => (str(t, 'dueDate') || '9999') < now);
        if (route.intent === 'process.task_attention') {
          const t = sorted.find((x) => x.id.toLowerCase() === route.taskId?.toLowerCase());
          if (!t)
            return stop(
              'needs_input',
              'That task is not in your current tasks',
              `NOVA can only explain tasks returned for your own identity. ${sorted.length} current tasks were returned; ${route.taskId} is not among them.`,
            );
          mission.evidence = [t];
          const due = str(t, 'dueDate');
          mission.title = `Why ${t.id} needs your attention`;
          mission.answer = `From its returned fields only: ${t.title}. NOVA reports declared values and does not infer a business cause.`;
          mission.findings = [
            `[${t.id}] Returned in your current task list.`,
            due
              ? `[${t.id}] Due ${due}${due < now ? ' — past due' : due === now ? ' — due today' : ''}.`
              : `[${t.id}] No due date is declared.`,
            `[${t.id}] Priority: ${str(t, 'priority') || 'not declared'}.`,
            `[${t.id}] Part of ${str(t, 'processName') || str(t, 'processKey') || 'an undeclared process'}${str(t, 'processInstanceId') ? ` (instance ${str(t, 'processInstanceId')})` : ''}.`,
          ];
          break;
        }
        const shown = route.view === 'overdue' ? overdue : sorted;
        mission.evidence = shown;
        if (route.view === 'next') {
          const first = sorted[0];
          mission.title = first ? `Start with ${first.title}` : 'You have no current tasks';
          mission.answer = first
            ? `Ranked by due date, then priority — a transparent rule, not a judgement of business importance. ${overdue.length ? `${overdue.length} ${overdue.length === 1 ? 'task is' : 'tasks are'} past due.` : ''}`.trim()
            : 'The service returned an empty task list for your identity.';
        } else if (route.view === 'overdue') {
          mission.title = overdue.length
            ? `${overdue.length} overdue ${overdue.length === 1 ? 'task' : 'tasks'}`
            : 'No overdue tasks';
          const undated = sorted.filter((t) => !str(t, 'dueDate')).length;
          mission.answer = `Compared with today (${now}).${undated ? ` ${undated} of your tasks ${undated === 1 ? 'has' : 'have'} no declared due date and cannot be classified.` : ''}`;
        } else {
          mission.title = sorted.length
            ? `${sorted.length} current ${sorted.length === 1 ? 'task' : 'tasks'}`
            : 'You have no current tasks';
          mission.answer = sorted.length
            ? `Sorted by ${route.sort === 'priority' ? 'priority, then due date' : 'due date, then priority'}.${overdue.length ? ` ${overdue.length} past due.` : ''}${sorted.some((t) => !str(t, 'dueDate')) ? ' Some have no declared due date.' : ''}`
            : 'The service returned an empty task list for your identity. That is an answer, not an error.';
        }
        mission.findings = shown.map(
          (t, i) =>
            `${route.view === 'next' ? `${i + 1}. ` : ''}[${t.id}] ${t.title} · ${str(t, 'priority') || 'priority not declared'} · ${str(t, 'dueDate') ? `due ${str(t, 'dueDate')}${str(t, 'dueDate')! < now ? ' (past due)' : ''}` : 'no due date declared'}`,
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
          `[${d.id}] Version ${d.fields.version ?? 'not declared'} · ${str(d, 'category') || 'category not declared'}`,
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
        `${error.message} Check the key; NOVA does not guess alternatives.`,
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
