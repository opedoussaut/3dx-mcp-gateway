import { createHash, randomUUID } from 'node:crypto';
import type { AppDomain, AppIntent, Evidence, Mission, Mode, Source } from '../../shared/types';
import { GatewayError } from '../http';
import type { AppArgs, AppConnector, AppResult } from './connector';
import { appLabels } from './registry';

/**
 * Deterministic natural-language routing for the business process and dataset catalog
 * domains. The domain is chosen by the operator, never inferred from prompt text, and
 * identifiers are only ever taken verbatim from the prompt.
 */
export type AppRoute = {
  intent: AppIntent | 'unknown' | 'blocked';
  id?: string;
  query?: string;
  sort?: 'due' | 'priority';
  action?: 'start' | 'complete';
};

const explicitId = (prompt: string, prefix: RegExp) =>
  prompt.match(prefix)?.[0]?.toUpperCase() ||
  prompt.match(/(?:\bid\s*[:=]?\s*|#)([A-Za-z0-9_.:-]{2,200})\b/i)?.[1] ||
  prompt.match(/[“"`']([A-Za-z0-9_.:-]{2,200})[”"`']/)?.[1];

export function routeProcess(prompt: string): AppRoute {
  const p = prompt.toLowerCase();
  const task = explicitId(prompt, /\bTSK-[A-Z0-9]+(?:-[A-Z0-9]+)*\b/i);
  const instance = explicitId(prompt, /\bPI-[A-Z0-9]+(?:-[A-Z0-9]+)*\b/i);
  const isTask = /\bTSK-/i.test(prompt);
  if (/\b(prepare|draft|prépare\w*|brouillon)\b/.test(p))
    return {
      intent: 'process.prepare',
      action: /\b(complete|finish|close|termine\w*|compl[eè]te\w*)\b/.test(p)
        ? 'complete'
        : 'start',
      id: isTask ? task : undefined,
      query: prompt,
    };
  if (
    /\bstartable\b/.test(p) ||
    (/\b(start|launch|initiate|démarrer|lancer)\b/.test(p) &&
      /\b(can|allowed|able|may|permitted|available|peux|puis-je|autorisé\w*)\b/.test(p))
  )
    return { intent: 'process.startable' };
  if (
    /\b(start|launch|complete|claim|assign|reassign|cancel|abort|delete|approve|reject|submit|validate|execute|close|démarre|lance|termine|valide|approuve|rejette|supprime|annule)\b/.test(
      p,
    )
  )
    return { intent: 'blocked' };
  if (/\b(steps?|approvals?|remain\w*|left|outstanding|étapes?|reste\w*|approbations?)\b/.test(p))
    return { intent: 'process.remaining_steps', id: isTask ? undefined : instance };
  if (isTask || /\b(attention|why|urgent|pourquoi)\b/.test(p))
    return { intent: 'process.task_attention', id: isTask ? task : undefined };
  if (/\bPI-/i.test(prompt) || /\b(status|state|statut|progress|avancement)\b/.test(p))
    return { intent: 'process.status', id: instance };
  if (/\b(tasks?|tâches?|to-?do|inbox|assigned|assignées?)\b/.test(p))
    return {
      intent: 'process.my_tasks',
      sort: /priorit/.test(p) && !/\b(due|deadline|échéance)\b/.test(p) ? 'priority' : 'due',
    };
  return { intent: 'unknown' };
}

const stopWords = new Set(
  'find search look up for show me list the a an any all of datasets dataset data related to about on concerning which what are is there approved research topic please cherche trouve les des jeux de données sur liés lié à concernant'.split(
    ' ',
  ),
);
export function routeCatalog(prompt: string): AppRoute {
  const p = prompt.toLowerCase();
  const id = explicitId(prompt, /\bDS-[A-Z0-9]+(?:-[A-Z0-9]+)*\b/i);
  if (
    /\b(download|export|extract|dump|copy|join|merge|delete|publish|share|modify|update|edit|grant|télécharge\w*|exporte\w*|extrai\w*|supprime\w*|partage\w*|modifie\w*)\b/.test(
      p,
    )
  )
    return { intent: 'blocked' };
  if (/\b(suitable|suitability|fit for|appropriate|usable|adapté\w*|convient|utilisable)\b/.test(p))
    return { intent: 'catalog.suitability', id, query: prompt };
  if (
    /\b(lineage|provenance|freshness|fresh|classification|classified|upstream|downstream|derived|lignage|fraîcheur)\b/.test(
      p,
    )
  )
    return { intent: 'catalog.lineage', id };
  if (id && /\b(related|linked|other|assets?|connected|lié\w*|associé\w*)\b/.test(p))
    return { intent: 'catalog.related', id };
  if (id && /\b(owner|owns|who|steward|description|describe|propriétaire)\b/.test(p))
    return { intent: 'catalog.owner', id };
  if (/\b(find|search|look|datasets?|cherche|trouve|jeux)\b/.test(p)) {
    const tail = prompt.match(
      /(?:related to|about|on|for|concerning|covering|sur|liés? à|concernant)\s+(.+)$/i,
    )?.[1];
    const words = (tail || prompt)
      .replace(/[?.!,;:[\]()]/g, ' ')
      .split(/\s+/)
      .filter((w) => w && !stopWords.has(w.toLowerCase()));
    return { intent: 'catalog.search', query: words.join(' ').slice(0, 200) };
  }
  if (id) return { intent: 'catalog.owner', id };
  return { intent: 'unknown' };
}

const priorityRank: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
const field = (e: Evidence, name: string) => e.fields[name];
const str = (e: Evidence, name: string) =>
  typeof e.fields[name] === 'string' ? (e.fields[name] as string) : undefined;
const today = () => new Date().toISOString().slice(0, 10);

type Ctx = {
  mission: Mission;
  connector: AppConnector;
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

export async function runAppMission(ctx: Ctx): Promise<Mission> {
  const { mission, connector, source, mode, prompt, trace, stop, finish } = ctx;
  const app: AppDomain = connector.app;
  const label = appLabels[app].label;
  if (source === 'live' && connector.config.blockers.length)
    return stop(
      'blocked',
      `Your ${label} connection needs setup`,
      `Open Connections to review the ${label} access requirements. Its origin, credential and reviewed read contract are independent of the engineering connection. No request was made.`,
    );
  const route = app === 'ITEROP' ? routeProcess(prompt) : routeCatalog(prompt);
  trace(
    'Deterministic route',
    `${app} · ${route.intent} · ${mode.toLowerCase()} · ${source}`,
    'route',
  );
  if (route.intent === 'blocked')
    return stop(
      'blocked',
      app === 'ITEROP'
        ? 'Process changes need a governed workflow'
        : 'Dataset content and changes are out of scope',
      app === 'ITEROP'
        ? 'NOVA can read processes and tasks you are allowed to see. It cannot start, complete, claim, approve or cancel anything. In Act mode it can prepare a local draft for you to review — nothing is submitted.'
        : 'NOVA reads catalog metadata only. Downloading, exporting or joining dataset content, and changing catalog entries, are not authorized in this version.',
    );
  if (route.intent === 'unknown')
    return stop(
      'needs_input',
      'What would you like to know?',
      app === 'ITEROP'
        ? 'Ask which processes you can start, which tasks are assigned to you, the status of a process (e.g. PI-SYN-1042), which steps remain, or why a task (e.g. TSK-SYN-301) needs your attention.'
        : 'Ask me to find datasets on a topic, who owns a dataset (e.g. DS-SYN-THERM-01), what is related to it, its lineage and freshness, or whether its metadata supports a planned use.',
    );
  mission.intent = route.intent;
  const call = async (name: string, args: AppArgs = {}): Promise<AppResult> => {
    const t = performance.now();
    mission.metrics.toolCalls++;
    try {
      const result = await connector.call(name, args, source);
      trace(
        name,
        `${result.records.length} records · ${result.coverage} coverage`,
        'tool',
        performance.now() - t,
      );
      for (const r of result.records)
        if (!mission.evidence.some((e) => e.id === r.id && e.kind === r.kind))
          mission.evidence.push(r);
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
  const partial = (coverage: AppResult['coverage']) => {
    if (coverage !== 'complete') {
      mission.status = 'insufficient_evidence';
      mission.findings.push(`Coverage is ${coverage}; this may not be the complete set.`);
    }
  };
  try {
    switch (route.intent) {
      case 'process.startable': {
        const r = await call('iterop.list_startable_processes');
        mission.title = `${r.records.length} ${r.records.length === 1 ? 'process' : 'processes'} you can start`;
        mission.answer = `The ${source === 'synthetic' ? 'synthetic' : 'business process'} service lists these definitions for your principal. NOVA did not infer permissions; starting one still happens in your process tool.`;
        mission.findings = r.records.map(
          (e) =>
            `[${e.id}] ${e.title}${str(e, 'category') ? ` · ${str(e, 'category')}` : ''}${field(e, 'version') !== undefined ? ` · v${field(e, 'version')}` : ''}`,
        );
        partial(r.coverage);
        break;
      }
      case 'process.my_tasks': {
        const r = await call('iterop.list_my_tasks');
        const tasks = [...r.records].sort((a, b) => {
          const due = (str(a, 'dueDate') || '9999').localeCompare(str(b, 'dueDate') || '9999');
          const pr =
            (priorityRank[str(a, 'priority') || ''] ?? 9) -
            (priorityRank[str(b, 'priority') || ''] ?? 9);
          return route.sort === 'priority' ? pr || due : due || pr;
        });
        mission.evidence = [...tasks, ...mission.evidence.filter((e) => !tasks.includes(e))];
        const now = today();
        const overdue = tasks.filter((t) => (str(t, 'dueDate') || '9999') < now).length;
        const undated = tasks.filter((t) => !str(t, 'dueDate')).length;
        mission.title = `${tasks.length} ${tasks.length === 1 ? 'task' : 'tasks'} assigned to you`;
        mission.answer = `Sorted by ${route.sort === 'priority' ? 'priority, then due date' : 'due date, then priority'}.${overdue ? ` ${overdue} ${overdue === 1 ? 'is' : 'are'} past due.` : ''}${undated ? ` ${undated} ${undated === 1 ? 'has' : 'have'} no declared due date.` : ''}`;
        mission.findings = tasks.map(
          (t) =>
            `[${t.id}] ${t.title} · ${str(t, 'priority') || 'priority not declared'} · ${str(t, 'dueDate') ? `due ${str(t, 'dueDate')}${str(t, 'dueDate')! < now ? ' (past due)' : ''}` : 'no due date declared'} · ${str(t, 'processName') || str(t, 'processId') || 'process unknown'}`,
        );
        partial(r.coverage);
        break;
      }
      case 'process.status': {
        if (!route.id)
          return stop(
            'needs_input',
            'Which process?',
            'Include the exact process identifier, for example PI-SYN-1042. NOVA never guesses an identifier.',
          );
        const r = await call('iterop.get_process_instance', { id: route.id });
        const p = r.records[0];
        if (!p)
          return stop(
            'insufficient_evidence',
            'No process record returned',
            'The service returned no record for that identifier.',
          );
        mission.title = `${p.id} is ${str(p, 'status') || 'in an undeclared state'}`;
        mission.answer = `${p.title}${str(p, 'processName') ? ` (${str(p, 'processName')})` : ''}. ${str(p, 'currentStep') ? `Current step: ${str(p, 'currentStep')}.` : 'The current step is not declared.'}`;
        mission.findings = [
          `[${p.id}] Status: ${str(p, 'status') || 'unknown'}`,
          `[${p.id}] Started ${str(p, 'startedAt') || 'date unknown'} by ${str(p, 'initiator') || 'unknown initiator'}; last updated ${str(p, 'updatedAt') || 'unknown'}.`,
        ];
        if (!str(p, 'status')) mission.status = 'insufficient_evidence';
        break;
      }
      case 'process.remaining_steps': {
        if (!route.id)
          return stop(
            'needs_input',
            'Which process?',
            'Include the exact process identifier, for example “Which steps remain on PI-SYN-1042?”.',
          );
        const instance = await call('iterop.get_process_instance', { id: route.id });
        const steps = await call('iterop.list_process_steps', { id: route.id });
        const ordered = [...steps.records].sort(
          (a, b) => Number(field(a, 'order') ?? 999) - Number(field(b, 'order') ?? 999),
        );
        mission.evidence = [...instance.records, ...ordered];
        const unknown = ordered.filter((s) => !str(s, 'status'));
        const remaining = ordered.filter(
          (s) => str(s, 'status') && str(s, 'status') !== 'COMPLETED',
        );
        const approvals = remaining.filter((s) => field(s, 'approval') === true);
        mission.title = remaining.length
          ? `${remaining.length} ${remaining.length === 1 ? 'step remains' : 'steps remain'} · ${approvals.length} ${approvals.length === 1 ? 'approval' : 'approvals'}`
          : 'No remaining steps reported';
        mission.answer = remaining.length
          ? `On ${route.id}, ${remaining.map((s) => `${s.title} (${str(s, 'status')!.toLowerCase()})`).join(', ')} ${remaining.length === 1 ? 'remains' : 'remain'}.`
          : `All ${ordered.length} reported steps of ${route.id} are completed.`;
        mission.findings = ordered.map(
          (s) =>
            `[${s.id}] ${field(s, 'order') ?? '?'} · ${s.title} · ${str(s, 'status') || 'status unknown'}${field(s, 'approval') === true ? ' · approval' : ''} · ${str(s, 'assignee') || 'assignee not declared'}${str(s, 'dueDate') && str(s, 'status') !== 'COMPLETED' ? ` · due ${str(s, 'dueDate')}` : ''}`,
        );
        if (unknown.length || !ordered.length) {
          mission.status = 'insufficient_evidence';
          mission.findings.push(
            'Some steps have no declared status; remaining work cannot be stated completely.',
          );
        }
        partial(steps.coverage);
        break;
      }
      case 'process.task_attention': {
        if (!route.id)
          return stop(
            'needs_input',
            'Which task?',
            'Include the exact task identifier, for example TSK-SYN-301. Ask “Show the tasks assigned to me” to find it.',
          );
        const r = await call('iterop.get_task', { id: route.id });
        const t = r.records[0];
        if (!t)
          return stop(
            'insufficient_evidence',
            'No task record returned',
            'The service returned no record for that identifier.',
          );
        const reasons: string[] = [];
        const due = str(t, 'dueDate');
        if (field(t, 'assignedToPrincipal') === true)
          reasons.push(`[${t.id}] It is assigned to you.`);
        else reasons.push(`[${t.id}] It is not declared as assigned to you.`);
        if (due)
          reasons.push(
            `[${t.id}] Due ${due}${due < today() ? ' — already past due' : due === today() ? ' — due today' : ''}.`,
          );
        else reasons.push(`[${t.id}] No due date is declared.`);
        reasons.push(`[${t.id}] Priority: ${str(t, 'priority') || 'not declared'}.`);
        if (str(t, 'step'))
          reasons.push(
            `[${t.id}] It holds step “${str(t, 'step')}” of ${str(t, 'processName') || str(t, 'processId')}.`,
          );
        mission.title = `Why ${t.id} needs your attention`;
        mission.answer = `From its metadata only: ${t.title}. NOVA reports declared fields and does not infer a business cause.`;
        mission.findings = reasons;
        if (str(t, 'status') && str(t, 'status') !== 'OPEN')
          mission.findings.push(`[${t.id}] Status is ${str(t, 'status')}; it may not need action.`);
        break;
      }
      case 'process.prepare': {
        if (mode !== 'ACT')
          return stop(
            'needs_input',
            'Switch to Prepare to draft this',
            'Prepare creates a local draft for you to review. It never starts a process or completes a task.',
          );
        let object: string | undefined;
        if (route.action === 'complete') {
          if (!route.id)
            return stop(
              'needs_input',
              'Which task?',
              'Include the exact task identifier to prepare a completion draft.',
            );
          const r = await call('iterop.get_task', { id: route.id });
          const t = r.records[0];
          if (!t || field(t, 'assignedToPrincipal') !== true || str(t, 'status') !== 'OPEN')
            return stop(
              'insufficient_evidence',
              'This task cannot be prepared for completion',
              'Only an open task declared as assigned to you can be drafted.',
            );
          object = t.id;
        } else {
          const r = await call('iterop.list_startable_processes');
          const words = prompt.toLowerCase();
          const matches = r.records.filter((d) =>
            d.title
              .toLowerCase()
              .split(/\s+/)
              .filter((w) => w.length > 3)
              .every((w) => words.includes(w)),
          );
          if (matches.length !== 1)
            return stop(
              'needs_input',
              'Which process should the draft start?',
              `Name one process you can start: ${r.records.map((d) => d.title).join(', ')}.`,
            );
          object = matches[0].id;
        }
        const payload = {
          kind:
            route.action === 'complete'
              ? ('process.complete_task' as const)
              : ('process.start' as const),
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
        mission.title =
          route.action === 'complete'
            ? 'Task completion draft — not submitted'
            : 'Process start draft — not submitted';
        mission.answer =
          'PREPARED — NOT SUBMITTED. Review the draft, then act in your process tool. NOVA has no write access and no approval step consumes this draft.';
        mission.findings = [
          `Draft object: ${object}`,
          'Field values are not validated against the process form. A verified form contract is required before any submission design.',
        ];
        break;
      }
      case 'catalog.search': {
        if (!route.query)
          return stop(
            'needs_input',
            'Which topic?',
            'Name a topic, for example “Find datasets related to thermal cooling”.',
          );
        const r = await call('catalog.search_datasets', { query: route.query });
        mission.title = r.records.length
          ? `${r.records.length} ${r.records.length === 1 ? 'dataset' : 'datasets'} on “${route.query}”`
          : `No visible datasets on “${route.query}”`;
        mission.answer = r.records.length
          ? 'Catalog metadata only. Results are limited to datasets visible to your principal.'
          : 'No visible dataset matches. This does not prove none exist: restricted datasets are not shown.';
        mission.findings = r.records.map(
          (d) =>
            `[${d.id}] ${d.title} · ${str(d, 'owner') || 'owner not declared'} · ${str(d, 'classification') || 'classification not declared'} · ${str(d, 'status') || 'status unknown'}`,
        );
        if (!r.records.length) mission.status = 'needs_input';
        partial(r.coverage);
        break;
      }
      case 'catalog.owner': {
        if (!route.id)
          return stop(
            'needs_input',
            'Which dataset?',
            'Include the exact dataset identifier, for example DS-SYN-THERM-01.',
          );
        const r = await call('catalog.get_dataset', { id: route.id });
        const d = r.records[0];
        mission.title = str(d, 'owner')
          ? `${str(d, 'owner')} owns ${d.id}`
          : `No owner declared for ${d.id}`;
        mission.answer = str(d, 'description')
          ? `“${str(d, 'description')}”`
          : 'No description is declared.';
        mission.findings = [
          `[${d.id}] Owner: ${str(d, 'owner') || 'not declared'}`,
          `[${d.id}] Data steward: ${str(d, 'steward') || 'not declared'}`,
          `[${d.id}] ${d.title} · ${str(d, 'domain') || 'domain not declared'} · ${str(d, 'classification') || 'classification not declared'}`,
        ];
        if (!str(d, 'owner')) mission.status = 'insufficient_evidence';
        break;
      }
      case 'catalog.related': {
        const d = (await call('catalog.get_dataset', { id: route.id })).records[0];
        const r = await call('catalog.list_related', { id: route.id });
        mission.title = `${r.records.length} related ${r.records.length === 1 ? 'resource' : 'resources'}`;
        mission.answer = `Declared relationships of ${d.title}. Resources you cannot see are not listed.`;
        mission.findings = r.records.map(
          (x) =>
            `[${x.id}] ${x.title} · ${str(x, 'relation') || 'relation unknown'} · ${str(x, 'assetType') || 'type unknown'} · ${str(x, 'direction') || ''}`,
        );
        partial(r.coverage);
        break;
      }
      case 'catalog.lineage':
      case 'catalog.suitability': {
        if (!route.id)
          return stop(
            'needs_input',
            'Which dataset?',
            'Include the exact dataset identifier, for example DS-SYN-THERM-01.',
          );
        const d = (await call('catalog.get_dataset', { id: route.id })).records[0];
        const lineage = await call('catalog.get_lineage', { id: route.id });
        const declared = field(d, 'lineageDeclared');
        const upstream = lineage.records.filter((x) => str(x, 'direction') === 'UPSTREAM');
        const downstream = lineage.records.filter((x) => str(x, 'direction') === 'DOWNSTREAM');
        const checks: [string, string | undefined][] = [
          ['Owner', str(d, 'owner')],
          ['Classification', str(d, 'classification')],
          ['Certification status', str(d, 'status')],
          ['Last updated', str(d, 'updatedAt')],
          [
            'Declared lineage',
            lineage.records.length
              ? `${upstream.length} upstream · ${downstream.length} downstream`
              : undefined,
          ],
        ];
        const missing = checks.filter(([, v]) => !v).map(([k]) => k);
        mission.findings = [
          ...checks.map(([k, v]) => `[${d.id}] ${k}: ${v || 'not declared'}`),
          ...lineage.records.map(
            (x) => `[${x.id}] ${str(x, 'direction')} · ${x.title} · ${str(x, 'relation') || ''}`,
          ),
        ];
        if (route.intent === 'catalog.lineage') {
          mission.title = lineage.records.length
            ? `Lineage of ${d.id}`
            : `No lineage declared for ${d.id}`;
          mission.answer = lineage.records.length
            ? `${d.title} derives from ${upstream.map((x) => x.title).join(', ') || 'no declared upstream'} and feeds ${downstream.map((x) => x.title).join(', ') || 'no declared downstream'}. Freshness: ${str(d, 'updatedAt') || 'unknown'}; classification ${str(d, 'classification') || 'not declared'}.`
            : `The catalog declares no lineage for ${d.title}${declared === false ? ' (lineage flagged as not declared)' : ''}. Missing lineage is not evidence of a clean source.`;
          if (missing.length) mission.status = 'insufficient_evidence';
        } else {
          const blocking = missing.length > 0 || str(d, 'status') !== 'CERTIFIED';
          mission.title = blocking
            ? 'Suitability cannot be established from metadata'
            : 'Metadata supports a reviewer decision';
          mission.answer = blocking
            ? `${d.title}: ${missing.length ? `missing ${missing.join(', ').toLowerCase()}` : ''}${missing.length && str(d, 'status') !== 'CERTIFIED' ? '; ' : ''}${str(d, 'status') && str(d, 'status') !== 'CERTIFIED' ? `status is ${str(d, 'status')}, not certified` : ''}. Ask the owner or data steward before using it. This is not a compliance assessment.`
            : `${d.title} declares an owner, classification, certified status, freshness and lineage. Whether it fits your experiment is a decision for you and the data owner; this is not a compliance certification.`;
          mission.status = blocking ? 'insufficient_evidence' : 'completed';
        }
        break;
      }
    }
    trace(
      'Evidence attached',
      `${mission.evidence.length} allowlisted metadata records. Source text cannot issue tool calls.`,
      'evidence',
    );
    return finish();
  } catch (error) {
    if (error instanceof GatewayError && error.code === 'AUTHORIZATION_DENIED')
      return stop(
        'blocked',
        'Access denied for this principal',
        `${error.message} NOVA does not retry with another identity or route.`,
      );
    if (error instanceof GatewayError && error.code === 'NOT_FOUND')
      return stop(
        'needs_input',
        'No record with that identifier',
        `${error.message} Check the identifier; NOVA does not guess alternatives.`,
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
