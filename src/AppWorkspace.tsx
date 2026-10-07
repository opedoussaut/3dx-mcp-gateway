import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  ArrowUp,
  CalendarClock,
  CircleCheck,
  CircleDashed,
  CircleDot,
  Database,
  Diamond,
  FileText,
  FlaskConical,
  GitBranch,
  Lock,
  MessageSquare,
  Network,
  Radio,
  Settings2,
  ShieldCheck,
  Target,
  UserRound,
  Workflow,
} from 'lucide-react';
import type { AppDomain, Evidence, Mission, Mode, RuntimeStatus, Source } from '../shared/types';
import { api } from './api';
import { ErrorNote, EvidenceCard, Result, SourceTag, Spinner } from './ui';

type Starter = { prompt: string; mode: Mode; synthetic?: boolean };
const domains: Record<
  AppDomain,
  { title: string; subtitle: string; icon: typeof Workflow; starters: Starter[]; empty: string }
> = {
  ITEROP: {
    title: 'Business Process',
    subtitle: 'Processes and tasks your principal is allowed to see',
    icon: Workflow,
    empty:
      'Ask about your processes and tasks. NOVA maps the answer here — tasks, process timelines and approvals — with every record cited.',
    starters: [
      { prompt: 'What processes am I allowed to start?', mode: 'ASK' },
      { prompt: 'Show the tasks assigned to me, sorted by due date or priority.', mode: 'ASK' },
      { prompt: 'What is the status of process PI-SYN-1042?', mode: 'ASK', synthetic: true },
      {
        prompt: 'Which steps and approvals remain on PI-SYN-1042?',
        mode: 'INVESTIGATE',
        synthetic: true,
      },
      {
        prompt: 'Explain why TSK-SYN-302 needs my attention.',
        mode: 'INVESTIGATE',
        synthetic: true,
      },
      {
        prompt: 'Prepare to launch the contractor access form process for synthetic test case 7.',
        mode: 'ACT',
        synthetic: true,
      },
    ],
  },
  DATASET_CATALOG: {
    title: 'Datasets Governance',
    subtitle: 'Catalog metadata, ownership and lineage — never dataset content',
    icon: Database,
    empty:
      'Ask about datasets on a topic, their owners, relationships or lineage. NOVA maps catalog metadata here with explicit gaps.',
    starters: [
      { prompt: 'Find datasets related to thermal cooling.', mode: 'ASK' },
      {
        prompt: 'Who owns dataset DS-SYN-THERM-01 and what does its description say?',
        mode: 'ASK',
        synthetic: true,
      },
      {
        prompt: 'Which other datasets or assets are related to DS-SYN-THERM-01?',
        mode: 'ASK',
        synthetic: true,
      },
      {
        prompt:
          'What is the reported lineage, freshness and declared classification of DS-SYN-THERM-01?',
        mode: 'INVESTIGATE',
        synthetic: true,
      },
      {
        prompt: 'Is DS-SYN-MAT-02 suitable for a 48 V qualification experiment?',
        mode: 'INVESTIGATE',
        synthetic: true,
      },
    ],
  },
};
const modeLabel: Record<Mode, string> = { ASK: 'Ask', INVESTIGATE: 'Investigate', ACT: 'Prepare' };
const f = (e: Evidence, k: string) =>
  e.fields[k] === undefined || e.fields[k] === null ? undefined : String(e.fields[k]);
const today = () => new Date().toISOString().slice(0, 10);

function followUps(e: Evidence): Starter[] {
  switch (e.kind) {
    case 'process.task':
      return [
        { prompt: `Explain why ${e.id} needs my attention.`, mode: 'INVESTIGATE' },
        ...(f(e, 'processId')
          ? [
              {
                prompt: `Which steps and approvals remain on ${f(e, 'processId')}?`,
                mode: 'INVESTIGATE' as Mode,
              },
            ]
          : []),
        { prompt: `Prepare to complete ${e.id}.`, mode: 'ACT' },
      ];
    case 'process.instance':
    case 'process.step':
      return [];
    case 'process.definition':
      return [{ prompt: `Prepare to launch the ${e.title.toLowerCase()} process.`, mode: 'ACT' }];
    case 'catalog.dataset':
    case 'catalog.lineage':
    case 'catalog.relation':
      if (e.kind !== 'catalog.dataset' && f(e, 'assetType') && f(e, 'assetType') !== 'Dataset')
        return [];
      return [
        { prompt: `Who owns dataset ${e.id} and what does its description say?`, mode: 'ASK' },
        { prompt: `Which other datasets or assets are related to ${e.id}?`, mode: 'ASK' },
        {
          prompt: `What is the reported lineage, freshness and declared classification of ${e.id}?`,
          mode: 'INVESTIGATE',
        },
        { prompt: `Is ${e.id} suitable for a design review?`, mode: 'INVESTIGATE' },
      ];
  }
  return [];
}

export function AppWorkspace({
  domain,
  status,
  source,
  setSource,
  active,
  setActive,
  history,
  onMission,
  openConnections,
}: {
  domain: AppDomain;
  status: RuntimeStatus | null;
  source: Source;
  setSource: (s: Source) => void;
  active: Mission | null;
  setActive: (m: Mission | null) => void;
  history: Mission[];
  onMission: (m: Mission) => void;
  openConnections: () => void;
}) {
  const meta = domains[domain];
  const app = status?.apps?.[domain];
  const [mode, setMode] = useState<Mode>('ASK');
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => setSelected(null), [active?.id]);
  const selectedRecord = active?.evidence.find((e) => `${e.kind}:${e.id}` === selected) || null;
  const recent = history.filter((m) => m.domain === domain).slice(0, 5);
  const run = async (text = prompt, nextMode = mode) => {
    if (loading || text.trim().length < 3) return;
    setLoading(true);
    setError('');
    setMode(nextMode);
    setPrompt(text);
    try {
      const mission = await api<Mission>('/missions', {
        prompt: text,
        source,
        mode: nextMode,
        domain,
      });
      onMission(mission);
      setActive(mission);
      setPrompt('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Mission failed.');
    } finally {
      setLoading(false);
    }
  };
  const starters = meta.starters.filter((s) => source === 'synthetic' || !s.synthetic);
  const Icon = meta.icon;
  return (
    <div className={`gen7 gen7-${domain.toLowerCase()}`}>
      <header className="g7-context">
        <div className="g7-context-title">
          <span className="g7-app-icon">
            <Icon size={20} strokeWidth={1.7} />
          </span>
          <div>
            <h1>{meta.title}</h1>
            <p>{meta.subtitle}</p>
          </div>
        </div>
        <div className="g7-context-controls">
          <div className="g7-segment" role="group" aria-label={`${meta.title} source`}>
            {(['synthetic', 'live'] as Source[]).map((s) => (
              <button
                key={s}
                aria-pressed={source === s}
                className={source === s ? 'on' : ''}
                onClick={() => setSource(s)}
              >
                {s === 'synthetic' ? <FlaskConical size={14} /> : <Radio size={14} />}
                {s === 'synthetic' ? 'Synthetic' : 'Live'}
              </button>
            ))}
          </div>
          <button
            className={`g7-health ${app?.liveReady ? 'ready' : 'pending'}`}
            onClick={openConnections}
          >
            <span className="g7-dot" />
            {app?.liveReady ? 'Live connection ready' : 'Live access not yet approved'}
          </button>
          <span className="g7-chip">
            <ShieldCheck size={13} /> Read-only
          </span>
        </div>
      </header>
      <div className="g7-grid">
        <aside className="g7-rail" aria-label={`${meta.title} context`}>
          {selectedRecord && (
            <section className="g7-selected" aria-label="Selected object">
              <h2 className="g7-label">Selected</h2>
              <strong>{selectedRecord.title}</strong>
              <code>{selectedRecord.id}</code>
              <dl>
                {Object.entries(selectedRecord.fields)
                  .filter(([k]) => !['id', 'name'].includes(k))
                  .slice(0, 6)
                  .map(([k, v]) => (
                    <div key={k}>
                      <dt>{k}</dt>
                      <dd>{String(v)}</dd>
                    </div>
                  ))}
              </dl>
            </section>
          )}
          <section>
            <h2 className="g7-label">Ask about</h2>
            <div className="g7-starters">
              {starters.map((s) => (
                <button
                  key={s.prompt}
                  className="g7-starter"
                  onClick={() => void run(s.prompt, s.mode)}
                  disabled={loading || !status}
                >
                  <span className="g7-starter-mode">{modeLabel[s.mode]}</span>
                  <span>{s.prompt}</span>
                  <ArrowRight size={14} />
                </button>
              ))}
            </div>
          </section>
          {!!recent.length && (
            <section>
              <h2 className="g7-label">Recent in {meta.title}</h2>
              <div className="g7-recent">
                {recent.map((m) => (
                  <button
                    key={m.id}
                    className={active?.id === m.id ? 'on' : ''}
                    onClick={() => setActive(m)}
                  >
                    <MessageSquare size={13} />
                    <span>{m.prompt}</span>
                  </button>
                ))}
              </div>
            </section>
          )}
        </aside>
        <section className="g7-canvas" aria-label={`${meta.title} canvas`}>
          <div className="g7-canvas-bar">
            <span className="g7-label">{active ? canvasTitle(active) : 'Canvas'}</span>
            {active && <SourceTag source={active.source} />}
          </div>
          <div className="g7-canvas-body">
            {!active ? (
              <div className="g7-empty">
                <Icon size={30} strokeWidth={1.2} />
                <p>{meta.empty}</p>
                <small>
                  {source === 'synthetic'
                    ? 'Synthetic workspace — invented records, no platform connection.'
                    : 'Live mode reads only through a reviewed, approved contract.'}
                </small>
              </div>
            ) : (
              <Canvas mission={active} selected={selected} onSelect={setSelected} />
            )}
          </div>
        </section>
        <aside className="g7-copilot" aria-label="NOVA Intelligence">
          <div className="g7-copilot-head">
            <span className="g7-label">NOVA Intelligence</span>
            <span className="g7-chip subtle">{source === 'synthetic' ? 'SYNTHETIC' : 'LIVE'}</span>
          </div>
          <div className="g7-composer">
            <div className="g7-modes" role="group" aria-label="Mission mode">
              {(['ASK', 'INVESTIGATE', 'ACT'] as Mode[]).map((m) => (
                <button
                  key={m}
                  aria-pressed={mode === m}
                  className={mode === m ? 'on' : ''}
                  onClick={() => setMode(m)}
                >
                  {modeLabel[m]}
                </button>
              ))}
            </div>
            <textarea
              ref={inputRef}
              value={prompt}
              maxLength={2000}
              aria-label={`Ask NOVA about ${meta.title}`}
              placeholder={
                mode === 'ACT'
                  ? 'Describe the draft to prepare — nothing is submitted…'
                  : `Ask about ${meta.title.toLowerCase()}…`
              }
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void run();
                }
              }}
            />
            <div className="g7-composer-foot">
              <span>
                {mode === 'ACT'
                  ? 'Local draft only · never submitted'
                  : 'Read-only · cited evidence'}
              </span>
              <button
                className="g7-send"
                aria-label="Ask NOVA"
                disabled={loading || prompt.trim().length < 3 || !status}
                onClick={() => void run()}
              >
                {loading ? <Spinner /> : <ArrowUp size={18} />}
              </button>
            </div>
          </div>
          {selectedRecord && followUps(selectedRecord).length > 0 && (
            <div className="g7-followups" aria-label="Suggested questions for the selection">
              {followUps(selectedRecord).map((s) => (
                <button
                  key={s.prompt}
                  onClick={() => void run(s.prompt, s.mode)}
                  disabled={loading}
                >
                  <Target size={13} /> {s.prompt}
                </button>
              ))}
            </div>
          )}
          {loading && (
            <div className="running-note" role="status">
              <Spinner /> Reading through the governed connector…
            </div>
          )}
          {error && <ErrorNote message={error} />}
          {active && (
            <div className="g7-answer">
              <Result mission={active} />
              {active.status === 'blocked' && active.source === 'live' && (
                <button className="button secondary" onClick={openConnections}>
                  <Settings2 size={16} /> Review access requirements
                </button>
              )}
              <details className="g7-evidence">
                <summary>
                  Evidence{' '}
                  <span>
                    {active.evidence.length} {active.evidence.length === 1 ? 'record' : 'records'}
                  </span>
                </summary>
                {active.evidence.map((e) => (
                  <EvidenceCard key={`${e.kind}:${e.id}`} record={e} />
                ))}
              </details>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

function canvasTitle(m: Mission) {
  const kinds = new Set(m.evidence.map((e) => e.kind));
  if (kinds.has('process.step')) return 'Process timeline';
  if (kinds.has('process.task')) return 'Task agenda';
  if (kinds.has('process.definition')) return 'Startable processes';
  if (kinds.has('process.instance')) return 'Process instance';
  if (m.intent === 'catalog.lineage' || m.intent === 'catalog.suitability')
    return 'Lineage & declared metadata';
  if (kinds.has('catalog.relation')) return 'Relationship map';
  if (kinds.has('catalog.dataset')) return 'Catalog';
  return 'Outcome';
}

type CanvasProps = {
  mission: Mission;
  selected: string | null;
  onSelect: (key: string | null) => void;
};
function Canvas({ mission, selected, onSelect }: CanvasProps) {
  const by = (kind: string) => mission.evidence.filter((e) => e.kind === kind);
  if (!mission.evidence.length) return <StateCard mission={mission} />;
  const pick = (e: Evidence) => ({
    'aria-pressed': selected === `${e.kind}:${e.id}`,
    className: selected === `${e.kind}:${e.id}` ? 'is-selected' : '',
    onClick: () => onSelect(selected === `${e.kind}:${e.id}` ? null : `${e.kind}:${e.id}`),
  });
  const steps = by('process.step');
  const instance = by('process.instance')[0];
  if (steps.length || instance)
    return <ProcessTimeline instance={instance} steps={steps} pick={pick} />;
  if (by('process.task').length) return <TaskAgenda tasks={by('process.task')} pick={pick} />;
  if (by('process.definition').length)
    return <DefinitionGrid items={by('process.definition')} pick={pick} />;
  const datasets = by('catalog.dataset');
  if (mission.intent === 'catalog.lineage' || mission.intent === 'catalog.suitability')
    return <Lineage focal={datasets[0]} links={by('catalog.lineage')} pick={pick} />;
  if (by('catalog.relation').length)
    return <Relations focal={datasets[0]} links={by('catalog.relation')} pick={pick} />;
  return <DatasetGrid items={datasets} pick={pick} detailed={datasets.length === 1} />;
}
type Pick = (e: Evidence) => { 'aria-pressed': boolean; className: string; onClick: () => void };

function StateCard({ mission }: { mission: Mission }) {
  const Icon = mission.status === 'blocked' ? Lock : CircleDashed;
  return (
    <div className={`g7-state ${mission.status}`}>
      <Icon size={26} strokeWidth={1.5} />
      <strong>{mission.title}</strong>
      <p>{mission.answer}</p>
      {mission.draft && (
        <div className="g7-draft">
          <FileText size={16} /> {mission.draft.object} · PREPARED — NOT SUBMITTED
        </div>
      )}
    </div>
  );
}

function Due({ date }: { date?: string }) {
  if (!date) return <span className="g7-due none">No due date</span>;
  const now = today();
  const tone = date < now ? 'late' : date === now ? 'today' : 'ok';
  return (
    <span className={`g7-due ${tone}`}>
      <CalendarClock size={13} />{' '}
      {tone === 'late' ? 'Past due · ' : tone === 'today' ? 'Due today · ' : 'Due '}
      {date}
    </span>
  );
}
function TaskAgenda({ tasks, pick }: { tasks: Evidence[]; pick: Pick }) {
  return (
    <ol className="g7-agenda">
      {tasks.map((t, i) => (
        <li key={t.id}>
          <span className="g7-agenda-rank">{String(i + 1).padStart(2, '0')}</span>
          <button {...pick(t)}>
            <span className="g7-obj-head">
              <strong>{t.title}</strong>
              <span className={`g7-priority p-${(f(t, 'priority') || 'none').toLowerCase()}`}>
                {f(t, 'priority') || 'No priority'}
              </span>
            </span>
            <span className="g7-meta">
              <code>{t.id}</code>
              <span>{f(t, 'processName') || f(t, 'processId') || 'Process unknown'}</span>
              {f(t, 'step') && <span>Step · {f(t, 'step')}</span>}
            </span>
            <Due date={f(t, 'dueDate')} />
          </button>
        </li>
      ))}
    </ol>
  );
}
function ProcessTimeline({
  instance,
  steps,
  pick,
}: {
  instance?: Evidence;
  steps: Evidence[];
  pick: Pick;
}) {
  const ordered = [...steps].sort(
    (a, b) => Number(f(a, 'order') ?? 999) - Number(f(b, 'order') ?? 999),
  );
  return (
    <div className="g7-process">
      {instance && (
        <button
          className={`g7-instance ${pick(instance).className}`}
          aria-pressed={pick(instance)['aria-pressed']}
          onClick={pick(instance).onClick}
        >
          <span className={`g7-status s-${(f(instance, 'status') || 'unknown').toLowerCase()}`}>
            {f(instance, 'status') || 'UNKNOWN'}
          </span>
          <strong>{instance.title}</strong>
          <span className="g7-meta">
            <code>{instance.id}</code>
            <span>{f(instance, 'processName')}</span>
            <span>Started {f(instance, 'startedAt') || '—'}</span>
            <span>Updated {f(instance, 'updatedAt') || '—'}</span>
          </span>
        </button>
      )}
      {!!ordered.length && (
        <ol className="g7-timeline" aria-label="Process steps">
          {ordered.map((s) => {
            const st = (f(s, 'status') || 'UNKNOWN').toLowerCase();
            const Icon =
              st === 'completed' ? CircleCheck : st === 'active' ? CircleDot : CircleDashed;
            return (
              <li key={s.id} className={`t-${st}`}>
                <span className="g7-node">
                  <Icon size={18} />
                </span>
                <button {...pick(s)}>
                  <span className="g7-step-order">Step {f(s, 'order') ?? '?'}</span>
                  <strong>{s.title}</strong>
                  <span className="g7-meta">
                    <span>
                      <UserRound size={12} /> {f(s, 'assignee') || 'Unassigned'}
                    </span>
                    {f(s, 'approval') === 'true' && (
                      <span className="g7-approval">
                        <Diamond size={11} /> Approval
                      </span>
                    )}
                  </span>
                  <span className="g7-step-state">
                    {st === 'completed'
                      ? `Completed ${f(s, 'completedAt') || ''}`
                      : st === 'unknown'
                        ? 'Status not declared'
                        : st}
                  </span>
                  {st !== 'completed' && f(s, 'dueDate') && <Due date={f(s, 'dueDate')} />}
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
function DefinitionGrid({ items, pick }: { items: Evidence[]; pick: Pick }) {
  return (
    <div className="g7-cards">
      {items.map((d) => (
        <button key={d.id} {...pick(d)} className={`g7-card ${pick(d).className}`}>
          <span className="g7-card-icon">
            <Workflow size={18} />
          </span>
          <strong>{d.title}</strong>
          <p>{f(d, 'description') || 'No description declared.'}</p>
          <span className="g7-meta">
            <span>{f(d, 'category') || 'Uncategorised'}</span>
            {f(d, 'version') && <span>v{f(d, 'version')}</span>}
            <code>{d.id}</code>
          </span>
        </button>
      ))}
    </div>
  );
}
function Declared({ d }: { d: Evidence }) {
  const rows: [string, string | undefined][] = [
    ['Owner', f(d, 'owner')],
    ['Steward', f(d, 'steward')],
    ['Classification', f(d, 'classification')],
    ['Status', f(d, 'status')],
    ['Updated', f(d, 'updatedAt')],
  ];
  return (
    <dl className="g7-declared">
      {rows.map(([k, v]) => (
        <div key={k} className={v ? '' : 'missing'}>
          <dt>{k}</dt>
          <dd>{v || 'Not declared'}</dd>
        </div>
      ))}
    </dl>
  );
}
function DatasetGrid({
  items,
  pick,
  detailed,
}: {
  items: Evidence[];
  pick: Pick;
  detailed: boolean;
}) {
  return (
    <div className={`g7-cards ${detailed ? 'single' : ''}`}>
      {items.map((d) => (
        <button key={d.id} {...pick(d)} className={`g7-card ${pick(d).className}`}>
          <span className="g7-obj-head">
            <span className="g7-card-icon">
              <Database size={18} />
            </span>
            <span className={`g7-class c-${(f(d, 'classification') || 'none').toLowerCase()}`}>
              {f(d, 'classification') || 'Unclassified'}
            </span>
          </span>
          <strong>{d.title}</strong>
          <p>{f(d, 'description') || 'No description declared.'}</p>
          <span className="g7-meta">
            <code>{d.id}</code>
            <span>{f(d, 'domain')}</span>
          </span>
          {detailed && <Declared d={d} />}
        </button>
      ))}
    </div>
  );
}
function Node({ e, pick, focal = false }: { e: Evidence; pick: Pick; focal?: boolean }) {
  const p = pick(e);
  return (
    <button {...p} className={`g7-node-card ${focal ? 'focal' : ''} ${p.className}`}>
      <span className="g7-meta">
        <code>{e.id}</code>
        {e.kind === 'catalog.lineage' ? (
          <span>{f(e, 'direction') === 'UPSTREAM' ? 'source' : 'derived product'}</span>
        ) : f(e, 'direction') === 'INCOMING' ? (
          <span>points to this dataset</span>
        ) : f(e, 'direction') === 'OUTGOING' ? (
          <span>this dataset points to it</span>
        ) : null}
        {f(e, 'assetType') && f(e, 'assetType') !== 'Dataset' && <span>{f(e, 'assetType')}</span>}
      </span>
      <strong>{e.title}</strong>
    </button>
  );
}
function Lineage({ focal, links, pick }: { focal?: Evidence; links: Evidence[]; pick: Pick }) {
  if (!focal) return null;
  const up = links.filter((l) => f(l, 'direction') === 'UPSTREAM');
  const down = links.filter((l) => f(l, 'direction') === 'DOWNSTREAM');
  return (
    <div className="g7-lineage-wrap">
      <div className="g7-lineage" aria-label="Declared lineage">
        <div className="g7-col">
          <span className="g7-label">
            <GitBranch size={12} /> Upstream
          </span>
          {up.length ? (
            up.map((l) => <Node key={l.id} e={l} pick={pick} />)
          ) : (
            <span className="g7-gap">None declared</span>
          )}
        </div>
        <div className="g7-col focal">
          <span className="g7-label">Selected dataset</span>
          <Node e={focal} pick={pick} focal />
        </div>
        <div className="g7-col">
          <span className="g7-label">
            <GitBranch size={12} /> Downstream
          </span>
          {down.length ? (
            down.map((l) => <Node key={l.id} e={l} pick={pick} />)
          ) : (
            <span className="g7-gap">None declared</span>
          )}
        </div>
      </div>
      <Declared d={focal} />
    </div>
  );
}
function Relations({ focal, links, pick }: { focal?: Evidence; links: Evidence[]; pick: Pick }) {
  const groups = useMemo(() => {
    const map = new Map<string, Evidence[]>();
    for (const l of links)
      map.set(f(l, 'relation') || 'RELATED', [
        ...(map.get(f(l, 'relation') || 'RELATED') || []),
        l,
      ]);
    return [...map.entries()];
  }, [links]);
  return (
    <div className="g7-relations">
      {focal && (
        <div className="g7-col focal">
          <span className="g7-label">
            <Network size={12} /> Selected dataset
          </span>
          <Node e={focal} pick={pick} focal />
        </div>
      )}
      <div className="g7-relation-groups">
        {groups.map(([relation, items]) => (
          <div key={relation} className="g7-col">
            <span className="g7-label">{relation.replaceAll('_', ' ').toLowerCase()}</span>
            {items.map((l) => (
              <Node key={l.id} e={l} pick={pick} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
