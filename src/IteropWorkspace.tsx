import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  ArrowUp,
  CalendarClock,
  CircleDashed,
  FileText,
  FlaskConical,
  Inbox,
  ListChecks,
  Lock,
  Radio,
  Settings2,
  ShieldCheck,
  Sparkles,
  Target,
  Workflow,
} from 'lucide-react';
import type { Evidence, Mission, Mode, Provenance, RuntimeStatus, Source } from '../shared/types';
import { api } from './api';
import { ErrorNote, EvidenceCard, Result, SourceTag, Spinner } from './ui';

type Ask = { prompt: string; mode: Mode };
const modeLabel: Record<Mode, string> = { ASK: 'Ask', INVESTIGATE: 'Investigate', ACT: 'Prepare' };
const starters: Ask[] = [
  { prompt: 'Which processes can I start?', mode: 'ASK' },
  { prompt: 'What are my current tasks?', mode: 'ASK' },
  { prompt: 'What should I work on first?', mode: 'INVESTIGATE' },
  { prompt: 'Show my overdue tasks.', mode: 'ASK' },
  { prompt: 'Explain the contractor access form process.', mode: 'ASK' },
  { prompt: 'Quels processus puis-je lancer ?', mode: 'ASK' },
];
const LOAD_PROCESSES = 'Which processes can I start?';
const LOAD_TASKS = 'What are my current tasks?';
const f = (e: Evidence | undefined, k: string) =>
  e && e.fields[k] !== undefined && e.fields[k] !== null ? String(e.fields[k]) : undefined;
const today = () => new Date().toISOString().slice(0, 10);
const time = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

/** A mission's records of one kind, only when they are the full list returned by the operation. */
function fullList(m: Mission, kind: string, operationId: string) {
  const p = m.provenance?.find((x) => x.operationId === operationId && x.outcome === 'ok');
  const records = m.evidence.filter((e) => e.kind === kind);
  return p && records.length === p.records ? { records, provenance: p } : null;
}
type Listing = { records: Evidence[]; provenance: Provenance } | null;

function followUps(e: Evidence): Ask[] {
  if (e.kind === 'process.task')
    return [
      { prompt: `Why does ${e.id} need my attention?`, mode: 'INVESTIGATE' },
      ...(f(e, 'processKey')
        ? [{ prompt: `Explain the process key ${f(e, 'processKey')}.`, mode: 'ASK' as Mode }]
        : []),
    ];
  return [
    { prompt: `Explain the process key ${e.id}.`, mode: 'ASK' },
    { prompt: `Prepare to launch the ${e.title.toLowerCase()} process.`, mode: 'ACT' },
  ];
}

export function IteropWorkspace({
  status,
  source,
  setSource,
  active,
  setActive,
  history,
  onMission,
  openConnections,
}: {
  status: RuntimeStatus | null;
  source: Source;
  setSource: (s: Source) => void;
  active: Mission | null;
  setActive: (m: Mission | null) => void;
  history: Mission[];
  onMission: (m: Mission) => void;
  openConnections: () => void;
}) {
  const app = status?.apps?.ITEROP;
  const [mode, setMode] = useState<Mode>('ASK');
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<'evidence' | 'provenance' | 'trace'>('provenance');
  const busy = useRef(false);
  const mine = history.filter((m) => m.domain === 'ITEROP' && m.source === source);
  const processes: Listing = useMemo(() => {
    for (const m of mine) {
      const l = fullList(m, 'process.definition', 'getAllStartableProcesses');
      if (l && m.intent === 'process.startable') return l;
    }
    return null;
  }, [mine]);
  const tasks: Listing = useMemo(() => {
    for (const m of mine) {
      const l = fullList(m, 'process.task', 'getTasksByUser');
      if (l) return l;
    }
    return null;
  }, [mine]);
  const known = [
    ...(active?.evidence || []),
    ...(processes?.records || []),
    ...(tasks?.records || []),
  ];
  const selectedRecord = known.find((e) => `${e.kind}:${e.id}` === selected) || null;

  const run = async (text: string, nextMode: Mode = mode, select = true) => {
    if (busy.current || text.trim().length < 3) return;
    busy.current = true;
    setLoading(true);
    setError('');
    setMode(nextMode);
    try {
      const mission = await api<Mission>('/missions', {
        prompt: text,
        source,
        mode: nextMode,
        domain: 'ITEROP',
      });
      onMission(mission);
      setActive(mission);
      setPrompt('');
      const single = mission.evidence.length === 1 ? mission.evidence[0] : null;
      if (select) setSelected(single && !mission.draft ? `${single.kind}:${single.id}` : null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Mission failed.');
    } finally {
      busy.current = false;
      setLoading(false);
    }
  };
  // Synthetic only: populate the context rail once. Live never auto-requests.
  useEffect(() => {
    if (!status || source !== 'synthetic' || processes || tasks || busy.current) return;
    (async () => {
      await run(LOAD_PROCESSES, 'ASK', false);
      await run(LOAD_TASKS, 'ASK', false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, source]);
  const pick = (e: Evidence) => ({
    'aria-pressed': selected === `${e.kind}:${e.id}`,
    onClick: () => setSelected(selected === `${e.kind}:${e.id}` ? null : `${e.kind}:${e.id}`),
  });
  const processOf = (t: Evidence) => processes?.records.find((p) => p.id === f(t, 'processKey'));

  return (
    <div className="gen7">
      <header className="g7-context">
        <div className="g7-context-title">
          <span className="g7-app-icon">
            <Workflow size={20} strokeWidth={1.7} />
          </span>
          <div>
            <h1>Business Process</h1>
            <p>Your processes and tasks — read-only, cited, scoped to you</p>
          </div>
        </div>
        <div className="g7-context-controls">
          <div className="g7-segment" role="group" aria-label="Business Process source">
            {(['synthetic', 'live'] as Source[]).map((s) => (
              <button
                key={s}
                aria-pressed={source === s}
                className={source === s ? 'on' : ''}
                onClick={() => {
                  setSource(s);
                  setSelected(null);
                  setActive(null);
                }}
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
            {app?.liveReady ? 'Live read admitted' : 'Live access not approved'}
          </button>
          <span className="g7-chip">
            <ShieldCheck size={13} /> Read-only
          </span>
        </div>
      </header>

      <div className="g7-grid">
        <aside className="g7-rail" aria-label="Processes and tasks">
          <RailList
            title="Available to start"
            icon={<Workflow size={13} />}
            listing={processes}
            empty="No startable processes returned."
            onLoad={() => void run(LOAD_PROCESSES, 'ASK', false)}
            disabled={loading || !status}
            selected={selected}
            pick={pick}
            render={(p) => (
              <>
                <strong>{p.title}</strong>
                <span className="g7-meta">
                  <span>{f(p, 'category') || 'Uncategorised'}</span>
                  {f(p, 'version') && <span>v{f(p, 'version')}</span>}
                </span>
              </>
            )}
          />
          <RailList
            title="My tasks"
            icon={<ListChecks size={13} />}
            listing={tasks}
            empty="Your task list is empty."
            onLoad={() => void run(LOAD_TASKS, 'ASK', false)}
            disabled={loading || !status}
            selected={selected}
            pick={pick}
            render={(t) => (
              <>
                <strong>{t.title}</strong>
                <Due date={f(t, 'dueDate')} compact />
              </>
            )}
          />
        </aside>

        <section className="g7-canvas" aria-label="Business Process canvas">
          <div className="g7-canvas-bar">
            <span className="g7-label">
              {selectedRecord
                ? selectedRecord.kind === 'process.task'
                  ? 'Task'
                  : 'Process'
                : active
                  ? 'Result'
                  : 'Context'}
            </span>
            {(selectedRecord || active) && (
              <SourceTag source={(selectedRecord || active)!.source} />
            )}
          </div>
          <div className="g7-canvas-body">
            {selectedRecord ? (
              selectedRecord.kind === 'process.task' ? (
                <TaskContext
                  task={selectedRecord}
                  process={processOf(selectedRecord)}
                  onAsk={(a) => void run(a.prompt, a.mode)}
                  onOpenProcess={(p) => setSelected(`process.definition:${p.id}`)}
                  loading={loading}
                />
              ) : (
                <ProcessContext
                  process={selectedRecord}
                  tasks={(tasks?.records || []).filter(
                    (t) => f(t, 'processKey') === selectedRecord.id,
                  )}
                  onAsk={(a) => void run(a.prompt, a.mode)}
                  onOpenTask={(t) => setSelected(`process.task:${t.id}`)}
                  loading={loading}
                />
              )
            ) : active ? (
              <MissionCanvas mission={active} pick={pick} />
            ) : (
              <div className="g7-empty">
                <Workflow size={30} strokeWidth={1.2} />
                <p>
                  Select a process or task on the left, or ask NOVA a question. The answer and its
                  evidence appear here.
                </p>
                <small>
                  {source === 'synthetic'
                    ? 'Synthetic workspace — invented records, no platform connection.'
                    : 'Live mode reads only through an approved, reviewed contract.'}
                </small>
              </div>
            )}
          </div>
        </section>

        <aside className="g7-copilot" aria-label="NOVA Intelligence">
          <div className="g7-copilot-head">
            <span className="g7-label">
              <Sparkles size={12} /> NOVA Intelligence
            </span>
            <span className="g7-chip subtle">{source === 'synthetic' ? 'SYNTHETIC' : 'LIVE'}</span>
          </div>
          {selectedRecord && (
            <div className="g7-context-pill" aria-label="Current context">
              <Target size={13} /> <span>{selectedRecord.title}</span>{' '}
              <code>{selectedRecord.id}</code>
            </div>
          )}
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
              value={prompt}
              maxLength={2000}
              aria-label="Ask NOVA about Business Process"
              placeholder={
                mode === 'ACT'
                  ? 'Describe the start draft to prepare — nothing is sent…'
                  : 'Ask about your processes and tasks…'
              }
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void run(prompt);
                }
              }}
            />
            <div className="g7-composer-foot">
              <span>
                {mode === 'ACT'
                  ? 'Local draft only · never submitted'
                  : 'Read-only · your scope only'}
              </span>
              <button
                className="g7-send"
                aria-label="Ask NOVA"
                disabled={loading || prompt.trim().length < 3 || !status}
                onClick={() => void run(prompt)}
              >
                {loading ? <Spinner /> : <ArrowUp size={18} />}
              </button>
            </div>
          </div>
          <div className="g7-followups" aria-label="Suggested questions">
            {(selectedRecord ? followUps(selectedRecord) : starters).map((s) => (
              <button
                key={s.prompt}
                onClick={() => void run(s.prompt, s.mode)}
                disabled={loading || !status}
              >
                <span className="g7-starter-mode">{modeLabel[s.mode]}</span> {s.prompt}
              </button>
            ))}
          </div>
          {loading && (
            <div className="running-note" role="status">
              <Spinner /> Reading through the governed connector…
            </div>
          )}
          {error && <ErrorNote message={error} />}
          {active && (
            <div className="g7-answer">
              <Result mission={active} compact />
              {active.status === 'blocked' && active.source === 'live' && (
                <button className="button secondary" onClick={openConnections}>
                  <Settings2 size={16} /> Review access requirements
                </button>
              )}
            </div>
          )}
        </aside>

        {active && (
          <section className="g7-details" aria-label="Evidence, provenance and trace">
            <div className="g7-tabs" role="tablist" aria-label="Details">
              {(['provenance', 'evidence', 'trace'] as const).map((t) => (
                <button
                  key={t}
                  role="tab"
                  id={`tab-${t}`}
                  aria-selected={tab === t}
                  aria-controls={`panel-${t}`}
                  className={tab === t ? 'on' : ''}
                  onClick={() => setTab(t)}
                >
                  {t === 'provenance'
                    ? `Provenance · ${active.provenance?.length || 0}`
                    : t === 'evidence'
                      ? `Evidence · ${active.evidence.length}`
                      : `Trace · ${active.trace.length}`}
                </button>
              ))}
            </div>
            <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
              {tab === 'provenance' && <ProvenanceTable mission={active} />}
              {tab === 'evidence' &&
                (active.evidence.length ? (
                  <div className="g7-evidence-grid">
                    {active.evidence.map((e) => (
                      <EvidenceCard key={`${e.kind}:${e.id}`} record={e} />
                    ))}
                  </div>
                ) : (
                  <p className="g7-muted">No records were returned for this question.</p>
                ))}
              {tab === 'trace' && (
                <ol className="g7-trace">
                  {active.trace.map((s, i) => (
                    <li key={i}>
                      <span className={`g7-trace-kind k-${s.kind}`}>{s.kind}</span>
                      <strong>{s.label}</strong>
                      <span>{s.detail}</span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function RailList({
  title,
  icon,
  listing,
  empty,
  onLoad,
  disabled,
  selected,
  pick,
  render,
}: {
  title: string;
  icon: React.ReactNode;
  listing: Listing;
  empty: string;
  onLoad: () => void;
  disabled: boolean;
  selected: string | null;
  pick: (e: Evidence) => { 'aria-pressed': boolean; onClick: () => void };
  render: (e: Evidence) => React.ReactNode;
}) {
  return (
    <section className="g7-list" aria-label={title}>
      <div className="g7-list-head">
        <h2 className="g7-label">
          {icon} {title}
        </h2>
        {listing && <span className="g7-count">{listing.records.length}</span>}
      </div>
      {!listing ? (
        <button className="g7-load" onClick={onLoad} disabled={disabled}>
          <Inbox size={14} /> Load {title.toLowerCase()} <ArrowRight size={13} />
        </button>
      ) : listing.records.length ? (
        <ul>
          {listing.records.map((e) => (
            <li key={e.id}>
              <button
                {...pick(e)}
                className={selected === `${e.kind}:${e.id}` ? 'is-selected' : ''}
              >
                {render(e)}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="g7-muted">{empty}</p>
      )}
      {listing && (
        <small className="g7-list-source">
          {listing.provenance.operationId} · {listing.provenance.source.toUpperCase()} ·{' '}
          {time(listing.provenance.at)}
        </small>
      )}
    </section>
  );
}

function Due({ date, compact = false }: { date?: string; compact?: boolean }) {
  if (!date) return <span className="g7-due none">No due date</span>;
  const now = today();
  const tone = date < now ? 'late' : date === now ? 'today' : 'ok';
  return (
    <span className={`g7-due ${tone}`}>
      <CalendarClock size={13} />{' '}
      {tone === 'late' ? 'Past due · ' : tone === 'today' ? 'Due today · ' : compact ? '' : 'Due '}
      {date}
    </span>
  );
}

function TaskTimeline({ task }: { task: Evidence }) {
  const created = f(task, 'createdAt');
  const due = f(task, 'dueDate');
  const now = today();
  // Merge markers that share a date so labels never overlap.
  const raw = [
    { label: 'Created', date: created },
    { label: 'Today', date: now, today: true },
    { label: 'Due', date: due },
  ].filter((p) => p.date) as { label: string; date: string; today?: boolean }[];
  const points = raw.reduce<typeof raw>((acc, p) => {
    const same = acc.find((a) => a.date === p.date);
    if (same) {
      same.label = `${same.label} · ${p.label}`;
      same.today ||= p.today;
    } else acc.push({ ...p });
    return acc;
  }, []);
  points.sort((a, b) => a.date.localeCompare(b.date));
  const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
  const span =
    points.length > 1 ? Math.max(1, days(points[0].date, points[points.length - 1].date)) : 1;
  return (
    <div className="g7-tasktime" aria-label="Task timeline">
      <div className="g7-track">
        {points.map((p) => (
          <span
            key={p.label}
            className={`g7-mark ${p.today ? 'today' : ''} ${p.label.includes('Due') && due! < now ? 'late' : ''}`}
            style={{
              left: `${points.length > 1 ? (days(points[0].date, p.date) / span) * 100 : 50}%`,
            }}
          >
            <i />
            <b>{p.label}</b>
            <small>{p.date}</small>
          </span>
        ))}
      </div>
      {!due && <p className="g7-gap">No due date is declared — urgency cannot be computed.</p>}
    </div>
  );
}

function TaskContext({
  task,
  process,
  onAsk,
  onOpenProcess,
  loading,
}: {
  task: Evidence;
  process?: Evidence;
  onAsk: (a: Ask) => void;
  onOpenProcess: (p: Evidence) => void;
  loading: boolean;
}) {
  return (
    <article className="g7-object">
      <header>
        <span className="g7-object-icon">
          <ListChecks size={20} />
        </span>
        <div>
          <span className="g7-label">Task · {f(task, 'status') || 'status not declared'}</span>
          <h2>{task.title}</h2>
          <span className="g7-meta">
            <code>{task.id}</code>
            <span className={`g7-priority p-${(f(task, 'priority') || 'none').toLowerCase()}`}>
              {f(task, 'priority') || 'No priority'}
            </span>
            <Due date={f(task, 'dueDate')} />
          </span>
        </div>
      </header>
      <TaskTimeline task={task} />
      <dl className="g7-facts">
        <div>
          <dt>Process</dt>
          <dd>
            {process ? (
              <button className="g7-link" onClick={() => onOpenProcess(process)}>
                {process.title} <ArrowRight size={12} />
              </button>
            ) : (
              f(task, 'processName') || f(task, 'processKey') || 'Not declared'
            )}
          </dd>
        </div>
        <div>
          <dt>Instance</dt>
          <dd>{f(task, 'processInstanceId') || 'Not declared'}</dd>
        </div>
        <div>
          <dt>Created</dt>
          <dd>{f(task, 'createdAt') || 'Not declared'}</dd>
        </div>
        <div>
          <dt>Scope</dt>
          <dd>Your own task list (getTasksByUser, no user parameter)</dd>
        </div>
      </dl>
      <div className="g7-actions">
        <button
          className="button primary"
          disabled={loading}
          onClick={() =>
            onAsk({ prompt: `Why does ${task.id} need my attention?`, mode: 'INVESTIGATE' })
          }
        >
          <Sparkles size={15} /> Why does this need my attention?
        </button>
        <span className="g7-not-here">
          <Lock size={13} /> Completing or reassigning tasks is not available in NOVA.
        </span>
      </div>
    </article>
  );
}

function ProcessContext({
  process,
  tasks,
  onAsk,
  onOpenTask,
  loading,
}: {
  process: Evidence;
  tasks: Evidence[];
  onAsk: (a: Ask) => void;
  onOpenTask: (t: Evidence) => void;
  loading: boolean;
}) {
  const summarized = process.kind === 'process.definition' && f(process, 'description');
  return (
    <article className="g7-object">
      <header>
        <span className="g7-object-icon">
          <Workflow size={20} />
        </span>
        <div>
          <span className="g7-label">
            Process definition{f(process, 'category') ? ` · ${f(process, 'category')}` : ''}
          </span>
          <h2>{process.title}</h2>
          <span className="g7-meta">
            <code>{process.id}</code>
            {f(process, 'version') && <span>Version {f(process, 'version')}</span>}
          </span>
        </div>
      </header>
      <p className="g7-description">
        {summarized || 'No description returned yet. Ask NOVA to explain this process.'}
      </p>
      <div className="g7-related">
        <span className="g7-label">Your tasks in this process</span>
        {tasks.length ? (
          <ul>
            {tasks.map((t) => (
              <li key={t.id}>
                <button onClick={() => onOpenTask(t)}>
                  <strong>{t.title}</strong>
                  <Due date={f(t, 'dueDate')} compact />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="g7-muted">None in your current task list.</p>
        )}
      </div>
      <div className="g7-unavailable">
        <CircleDashed size={14} /> Inputs, steps and variables need <code>getProcessInfo</code> — a
        P1 operation not yet admitted.
      </div>
      <div className="g7-actions">
        <button
          className="button primary"
          disabled={loading}
          onClick={() => onAsk({ prompt: `Explain the process key ${process.id}.`, mode: 'ASK' })}
        >
          <Sparkles size={15} /> Explain this process
        </button>
        <button
          className="button secondary"
          disabled={loading}
          onClick={() =>
            onAsk({
              prompt: `Prepare to launch the ${process.title.toLowerCase()} process.`,
              mode: 'ACT',
            })
          }
        >
          <FileText size={15} /> Prepare a start draft
        </button>
      </div>
    </article>
  );
}

function MissionCanvas({
  mission,
  pick,
}: {
  mission: Mission;
  pick: (e: Evidence) => { 'aria-pressed': boolean; onClick: () => void };
}) {
  if (!mission.evidence.length)
    return (
      <div className={`g7-state ${mission.status}`}>
        {mission.status === 'blocked' ? (
          <Lock size={26} strokeWidth={1.5} />
        ) : (
          <CircleDashed size={26} strokeWidth={1.5} />
        )}
        <strong>{mission.title}</strong>
        <p>{mission.answer}</p>
      </div>
    );
  const tasks = mission.evidence.filter((e) => e.kind === 'process.task');
  if (tasks.length)
    return (
      <ol className="g7-agenda" aria-label="Tasks">
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
                <span>{f(t, 'processName') || f(t, 'processKey') || 'Process not declared'}</span>
              </span>
              <Due date={f(t, 'dueDate')} />
            </button>
          </li>
        ))}
      </ol>
    );
  return (
    <div className="g7-cards">
      {mission.evidence.map((d) => (
        <button key={d.id} {...pick(d)} className="g7-card">
          <span className="g7-card-icon">
            <Workflow size={18} />
          </span>
          <strong>{d.title}</strong>
          <p>{f(d, 'description') || 'No description returned.'}</p>
          <span className="g7-meta">
            <span>{f(d, 'category') || 'Uncategorised'}</span>
            {f(d, 'version') && <span>v{f(d, 'version')}</span>}
            <code>{d.id}</code>
          </span>
          {mission.draft?.object === d.id && (
            <span className="g7-draft">PREPARED — NOT SUBMITTED</span>
          )}
        </button>
      ))}
    </div>
  );
}

function ProvenanceTable({ mission }: { mission: Mission }) {
  if (!mission.provenance?.length)
    return (
      <p className="g7-muted">
        No upstream operation was attempted — the request stopped at NOVA’s policy layer.
      </p>
    );
  return (
    <div className="g7-table-wrap" tabIndex={0} role="region" aria-label="Provenance table">
      <table className="g7-table">
        <thead>
          <tr>
            <th>Operation</th>
            <th>Documented call</th>
            <th>Source</th>
            <th>Scope</th>
            <th>Outcome</th>
            <th>Coverage</th>
            <th>Time</th>
          </tr>
        </thead>
        <tbody>
          {mission.provenance.map((p, i) => (
            <tr key={i}>
              <td>
                <code>{p.operationId}</code>
                <small>{p.operation}</small>
              </td>
              <td>
                <code>
                  {p.method} {p.path}
                </code>
                <small>{p.specRelease} · API v2</small>
              </td>
              <td>
                <SourceTag source={p.source} />
              </td>
              <td>{p.scope}</td>
              <td>
                <span className={`g7-outcome o-${p.outcome}`}>{p.outcome.replace('_', ' ')}</span>
                <small>{p.records} records</small>
              </td>
              <td>{p.coverage || '—'}</td>
              <td>{time(p.at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
