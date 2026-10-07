import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  ArrowUp,
  CalendarClock,
  CheckCircle2,
  Circle,
  CircleDashed,
  FileText,
  Flag,
  FlaskConical,
  ListChecks,
  Lock,
  Radio,
  ScanSearch,
  Settings2,
  ShieldCheck,
  Sparkles,
  Stamp,
  Workflow,
  Wrench,
} from 'lucide-react';
import type {
  Evidence,
  FlowIllustrations,
  FlowStage,
  Mission,
  Mode,
  Provenance,
  RuntimeStatus,
  Source,
} from '../shared/types';
import { api } from './api';
import { ErrorNote, EvidenceCard, Result, SourceTag, Spinner } from './ui';

type Ask = { prompt: string; mode: Mode };
type Listing = { records: Evidence[]; provenance: Provenance; mission: Mission } | null;
const modeLabel: Record<Mode, string> = { ASK: 'Ask', INVESTIGATE: 'Investigate', ACT: 'Prepare' };
const starters: Ask[] = [
  { prompt: 'What should I work on first?', mode: 'INVESTIGATE' },
  { prompt: 'Show my overdue tasks.', mode: 'ASK' },
  { prompt: 'Which processes can I start?', mode: 'ASK' },
  { prompt: 'Explain the contractor access form process.', mode: 'ASK' },
  { prompt: 'Quelles sont mes tâches en cours ?', mode: 'ASK' },
];
const LOAD_PROCESSES = 'Which processes can I start?';
const LOAD_TASKS = 'What are my current tasks?';
const f = (e: Evidence | undefined, k: string) =>
  e && e.fields[k] !== undefined && e.fields[k] !== null ? String(e.fields[k]) : undefined;
const today = () => new Date().toISOString().slice(0, 10);
const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const titleCase = (s?: string) => (s ? s[0] + s.slice(1).toLowerCase() : undefined);
const key = (e: Evidence) => `${e.kind}:${e.id}`;

/** A mission's records of one kind, only when they are the full list the operation returned. */
function fullList(m: Mission, kind: string, operationId: string) {
  const p = m.provenance?.find((x) => x.operationId === operationId && x.outcome === 'ok');
  const records = m.evidence.filter((e) => e.kind === kind);
  return p && records.length === p.records ? { records, provenance: p, mission: m } : null;
}
function urgency(t: Evidence) {
  const due = f(t, 'dueDate');
  if (!due) return { tone: 'none', label: 'No due date' };
  const d = days(today(), due);
  if (d < 0) return { tone: 'late', label: `${-d} ${d === -1 ? 'day' : 'days'} overdue` };
  if (d === 0) return { tone: 'today', label: 'Due today' };
  return { tone: 'ok', label: d === 1 ? 'Due tomorrow' : `Due in ${d} days` };
}
function suggestions(e: Evidence | null): Ask[] {
  if (!e) return starters;
  if (e.kind === 'process.task')
    return [
      { prompt: `Why does “${e.title}” need my attention?`, mode: 'INVESTIGATE' },
      ...(f(e, 'processName')
        ? [
            {
              prompt: `Explain the ${f(e, 'processName')!.toLowerCase()} process.`,
              mode: 'ASK' as Mode,
            },
          ]
        : []),
      { prompt: 'What should I work on first?', mode: 'INVESTIGATE' },
    ];
  return [
    { prompt: `Explain the ${e.title.toLowerCase()} process.`, mode: 'ASK' },
    { prompt: `Prepare to launch the ${e.title.toLowerCase()} process.`, mode: 'ACT' },
  ];
}
const stageIcon: Record<FlowStage['kind'], typeof Flag> = {
  start: Flag,
  review: ScanSearch,
  approval: Stamp,
  action: Wrench,
  end: CheckCircle2,
};

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
  const liveGate = source === 'live' && !app?.liveReady;
  const [mode, setMode] = useState<Mode>('ASK');
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<'provenance' | 'evidence' | 'trace'>('provenance');
  const [listTab, setListTab] = useState<'tasks' | 'processes'>('tasks');
  const [flows, setFlows] = useState<FlowIllustrations | null>(null);
  const busy = useRef(false);
  const touched = useRef(false);
  const detailsRef = useRef<HTMLElement>(null);
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
  const selectedRecord = known.find((e) => key(e) === selected) || null;
  const flowFor = (processKey?: string) =>
    source === 'synthetic' && processKey ? flows?.flows[processKey] : undefined;

  useEffect(() => {
    api<FlowIllustrations>('/iterop/flows')
      .then(setFlows)
      .catch(() => setFlows(null));
  }, []);
  const run = async (text: string, nextMode: Mode = mode, select = true) => {
    if (busy.current || text.trim().length < 3) return;
    busy.current = true;
    if (select) touched.current = true;
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
      if (select) setSelected(single && !mission.draft ? key(single) : null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Mission failed.');
    } finally {
      busy.current = false;
      setLoading(false);
    }
  };
  // Synthetic only: populate the lists once, then open the most urgent task. Live never auto-requests.
  useEffect(() => {
    if (!status || source !== 'synthetic' || processes || tasks || busy.current) return;
    (async () => {
      await run(LOAD_PROCESSES, 'ASK', false);
      await run(LOAD_TASKS, 'ASK', false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, source]);
  useEffect(() => {
    if (!touched.current && !selected && tasks?.records.length && source === 'synthetic')
      setSelected(key(tasks.records[0]));
  }, [tasks, selected, source]);
  const choose = (e: Evidence) => {
    touched.current = true;
    setSelected(selected === key(e) ? null : key(e));
    // Keep the answer, evidence and provenance about the object the user is looking at.
    const origin = [tasks, processes].find((l) => l?.records.some((r) => key(r) === key(e)));
    if (origin && !active?.evidence.some((r) => key(r) === key(e))) setActive(origin.mission);
  };
  const showEvidence = () => {
    setTab('provenance');
    detailsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };
  const processOf = (t: Evidence) => processes?.records.find((p) => p.id === f(t, 'processKey'));
  const tasksIn = (p: Evidence) =>
    (tasks?.records || []).filter((t) => f(t, 'processKey') === p.id);
  const evidenceCount = active?.evidence.length || 0;

  return (
    <div className="gen7">
      <header className="g7-context">
        <div className="g7-context-title">
          <span className="g7-app-icon">
            <Workflow size={20} strokeWidth={1.7} />
          </span>
          <div>
            <h1>Business Process</h1>
            <p>Your work, in context — read-only and traceable</p>
          </div>
        </div>
        <div className="g7-context-controls">
          <div className="g7-segment" role="group" aria-label="Business Process source">
            <button
              aria-pressed={source === 'synthetic'}
              className={source === 'synthetic' ? 'on' : ''}
              onClick={() => {
                setSource('synthetic');
                setSelected(null);
                setActive(null);
                touched.current = false;
              }}
            >
              <FlaskConical size={14} /> Synthetic
            </button>
            <button
              aria-pressed={source === 'live'}
              className={source === 'live' ? 'on' : ''}
              aria-describedby="live-state"
              onClick={() => {
                setSource('live');
                setSelected(null);
                setActive(null);
              }}
            >
              {app?.liveReady ? <Radio size={14} /> : <Lock size={14} />} Live
            </button>
          </div>
          <button
            id="live-state"
            className={`g7-health ${app?.liveReady ? 'ready' : 'pending'}`}
            onClick={openConnections}
          >
            <span className="g7-dot" />
            {app?.liveReady ? 'Live read approved' : 'Live access not approved'}
          </button>
          <span className="g7-chip">
            <ShieldCheck size={13} /> Read-only
          </span>
        </div>
      </header>

      <div className="g7-switch" role="tablist" aria-label="Lists">
        {(['tasks', 'processes'] as const).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={listTab === t}
            className={listTab === t ? 'on' : ''}
            onClick={() => setListTab(t)}
          >
            {t === 'tasks' ? 'My tasks' : 'Processes'}
            {(t === 'tasks' ? tasks : processes) && (
              <span>{(t === 'tasks' ? tasks : processes)!.records.length}</span>
            )}
          </button>
        ))}
      </div>

      <div className="g7-grid">
        <aside className="g7-rail" aria-label="Your tasks and processes">
          <RailList
            title="My tasks"
            className={listTab === 'tasks' ? 'is-current' : ''}
            icon={<ListChecks size={13} />}
            listing={tasks}
            locked={liveGate}
            empty="Nothing assigned to you right now."
            onLoad={() => void run(LOAD_TASKS, 'ASK', false)}
            onLocked={openConnections}
            disabled={loading || !status}
            selected={selected}
            choose={choose}
            render={(t) => {
              const u = urgency(t);
              return (
                <>
                  <strong>{t.title}</strong>
                  <span className={`g7-due ${u.tone}`}>
                    <CalendarClock size={12} /> {u.label}
                  </span>
                </>
              );
            }}
          />
          <RailList
            title="Available processes"
            className={listTab === 'processes' ? 'is-current' : ''}
            icon={<Workflow size={13} />}
            listing={processes}
            locked={liveGate}
            empty="No process is available for you to start."
            onLoad={() => void run(LOAD_PROCESSES, 'ASK', false)}
            onLocked={openConnections}
            disabled={loading || !status}
            selected={selected}
            choose={choose}
            render={(p) => (
              <>
                <strong>{p.title}</strong>
                <span className="g7-meta">{f(p, 'category') || 'Uncategorised'}</span>
              </>
            )}
          />
        </aside>

        <section className="g7-canvas" aria-label="Business Process canvas">
          <div className="g7-canvas-bar">
            <span className="g7-label">
              {liveGate
                ? 'Live connection'
                : selectedRecord
                  ? selectedRecord.kind === 'process.task'
                    ? 'Task in context'
                    : 'Process details'
                  : active
                    ? 'Answer'
                    : 'Overview'}
            </span>
            <span className="g7-canvas-tools">
              {!liveGate && evidenceCount > 0 && (
                <button className="g7-evidence-chip" onClick={showEvidence}>
                  <FileText size={13} /> Evidence<span className="g7-wide-only"> available</span> ·{' '}
                  {evidenceCount}
                </button>
              )}
              <SourceTag source={source} />
            </span>
          </div>
          <div className="g7-canvas-body">
            {liveGate ? (
              <LiveGate status={app} openConnections={openConnections} />
            ) : selectedRecord?.kind === 'process.task' ? (
              <TaskScene
                task={selectedRecord}
                process={processOf(selectedRecord)}
                flow={flowFor(f(selectedRecord, 'processKey'))}
                siblings={(tasks?.records || []).filter(
                  (t) => f(t, 'processKey') === f(selectedRecord, 'processKey'),
                )}
                notice={flows?.notice}
                source={source}
                onOpen={(e) => choose(e)}
                onAsk={(a) => void run(a.prompt, a.mode)}
                onEvidence={showEvidence}
                loading={loading}
              />
            ) : selectedRecord ? (
              <ProcessScene
                process={selectedRecord}
                flow={flowFor(selectedRecord.id)}
                tasks={tasksIn(selectedRecord)}
                notice={flows?.notice}
                source={source}
                onOpen={(e) => choose(e)}
                onAsk={(a) => void run(a.prompt, a.mode)}
                loading={loading}
              />
            ) : active ? (
              <AnswerScene mission={active} flowFor={flowFor} choose={choose} />
            ) : (
              <div className="g7-empty">
                <Workflow size={30} strokeWidth={1.2} />
                <p>Select a task or a process, or ask NOVA. The process becomes the canvas.</p>
              </div>
            )}
          </div>
        </section>

        <aside className="g7-copilot" aria-label="NOVA Intelligence">
          <div className="g7-copilot-head">
            <span className="g7-label">
              <Sparkles size={12} /> NOVA Intelligence
            </span>
            <SourceTag source={source} />
          </div>
          {selectedRecord && !liveGate && (
            <div className="g7-context-pill" aria-label="Current context">
              {selectedRecord.kind === 'process.task' ? (
                <ListChecks size={13} />
              ) : (
                <Workflow size={13} />
              )}
              <span>{selectedRecord.title}</span>
            </div>
          )}
          {liveGate ? (
            <p className="g7-gate-note">
              <Lock size={14} /> Live questions are unavailable until access is approved. NOVA makes
              no request and never substitutes synthetic data.
            </p>
          ) : (
            <>
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
                      ? 'Describe the draft to prepare — nothing is sent…'
                      : selectedRecord
                        ? `Ask about “${selectedRecord.title}”…`
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
                      ? 'Draft only · never submitted'
                      : 'Read-only · only your own work'}
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
                {suggestions(selectedRecord).map((s) => (
                  <button
                    key={s.prompt}
                    onClick={() => void run(s.prompt, s.mode)}
                    disabled={loading || !status}
                  >
                    <Sparkles size={12} aria-hidden="true" /> <span>{s.prompt}</span>
                  </button>
                ))}
              </div>
            </>
          )}
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
          <section
            ref={detailsRef}
            className="g7-details"
            aria-label="Evidence, provenance and trace"
          >
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
              {tab === 'provenance' && <ProvenanceView mission={active} />}
              {tab === 'evidence' &&
                (active.evidence.length ? (
                  <div className="g7-evidence-grid">
                    {active.evidence.map((e) => (
                      <EvidenceCard key={key(e)} record={e} />
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
  className,
  icon,
  listing,
  locked,
  empty,
  onLoad,
  onLocked,
  disabled,
  selected,
  choose,
  render,
}: {
  title: string;
  className: string;
  icon: React.ReactNode;
  listing: Listing;
  locked: boolean;
  empty: string;
  onLoad: () => void;
  onLocked: () => void;
  disabled: boolean;
  selected: string | null;
  choose: (e: Evidence) => void;
  render: (e: Evidence) => React.ReactNode;
}) {
  return (
    <section className={`g7-list ${className}`} aria-label={title}>
      <div className="g7-list-head">
        <h2 className="g7-label">
          {icon} {title}
        </h2>
        {listing && !locked && <span className="g7-count">{listing.records.length}</span>}
      </div>
      {locked ? (
        <button className="g7-load locked" onClick={onLocked}>
          <Lock size={14} /> Not connected — view requirements
        </button>
      ) : !listing ? (
        <button className="g7-load" onClick={onLoad} disabled={disabled}>
          Load {title.toLowerCase()} <ArrowRight size={13} />
        </button>
      ) : listing.records.length ? (
        <ul>
          {listing.records.map((e) => (
            <li key={e.id}>
              <button
                aria-pressed={selected === key(e)}
                className={selected === key(e) ? 'is-selected' : ''}
                onClick={() => choose(e)}
              >
                {render(e)}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="g7-muted">{empty}</p>
      )}
      {listing && !locked && (
        <small className="g7-list-source">
          {listing.provenance.source === 'synthetic' ? 'Synthetic' : 'Live'} · updated{' '}
          {clock(listing.provenance.at)}
        </small>
      )}
    </section>
  );
}

/** The process as the hero: an original, simplified stage flow. Never implies progress it does not know. */
function Flow({
  stages,
  here,
  counts,
  notice,
  compact = false,
}: {
  stages: FlowStage[];
  here?: string;
  counts?: Record<string, number>;
  notice?: string;
  compact?: boolean;
}) {
  return (
    <figure className={`g7-flow ${compact ? 'compact' : ''}`}>
      <ol aria-label="Process stages">
        {stages.map((s, i) => {
          const Icon = stageIcon[s.kind];
          const n = counts?.[s.id] || 0;
          return (
            <li
              key={s.id}
              className={`k-${s.kind} ${here === s.id ? 'is-here' : ''} ${n ? 'has-tasks' : ''}`}
              aria-current={here === s.id ? 'step' : undefined}
            >
              {i > 0 && <span className="g7-flow-link" aria-hidden="true" />}
              <span className="g7-flow-node">
                <Icon size={compact ? 13 : 18} strokeWidth={1.7} />
                {n > 0 && !compact && <b className="g7-flow-badge">{n}</b>}
              </span>
              {!compact && (
                <span className="g7-flow-text">
                  <strong>{s.label}</strong>
                  {here === s.id ? (
                    <em>You are here</em>
                  ) : n > 0 ? (
                    <em>{n === 1 ? 'Your task' : `${n} of your tasks`}</em>
                  ) : null}
                </span>
              )}
            </li>
          );
        })}
      </ol>
      {!compact && notice && (
        <figcaption>
          <span className="source-tag synthetic">SYNTHETIC</span> Illustrative stages — not returned
          by the read operations used here.
        </figcaption>
      )}
    </figure>
  );
}
function FlowUnavailable({ source }: { source: Source }) {
  return (
    <div className="g7-flow-missing">
      <CircleDashed size={16} />
      <span>
        {source === 'live'
          ? 'The process flow is not available yet — it needs an additional reviewed read. NOVA does not draw stages it cannot evidence.'
          : 'No stage illustration exists for this process.'}
      </span>
    </div>
  );
}

function TaskScene({
  task,
  process,
  flow,
  siblings,
  notice,
  source,
  onOpen,
  onAsk,
  onEvidence,
  loading,
}: {
  task: Evidence;
  process?: Evidence;
  flow?: FlowStage[];
  siblings: Evidence[];
  notice?: string;
  source: Source;
  onOpen: (e: Evidence) => void;
  onAsk: (a: Ask) => void;
  onEvidence: () => void;
  loading: boolean;
}) {
  const u = urgency(task);
  const counts = siblings.reduce<Record<string, number>>((a, t) => {
    const s = f(t, 'step');
    if (s) a[s] = (a[s] || 0) + 1;
    return a;
  }, {});
  return (
    <div className="g7-scene">
      <header className="g7-scene-head">
        <div>
          <span className="g7-eyebrow">
            {process?.title || f(task, 'processName') || 'Process'}
          </span>
          <h2>{task.title}</h2>
          <div className="g7-status-row">
            <span className={`g7-state-chip ${u.tone}`}>
              <CalendarClock size={13} /> {u.label}
            </span>
            <span className="g7-state-chip">{titleCase(f(task, 'priority')) || 'No'} priority</span>
            <span className="g7-state-chip">
              {titleCase(f(task, 'status')) || 'Status unknown'}
            </span>
          </div>
        </div>
        <div className="g7-scene-actions">
          <button
            className="button primary"
            disabled={loading}
            onClick={() =>
              onAsk({ prompt: `Why does “${task.title}” need my attention?`, mode: 'INVESTIGATE' })
            }
          >
            <Sparkles size={15} /> Why does this need me?
          </button>
        </div>
      </header>
      {flow ? (
        <Flow stages={flow} here={f(task, 'step')} counts={counts} notice={notice} />
      ) : (
        <FlowUnavailable source={source} />
      )}
      <div className="g7-band">
        <section className="g7-tile">
          <span className="g7-label">Timeline</span>
          <MiniTimeline task={task} />
        </section>
        <section className="g7-tile">
          <span className="g7-label">Process</span>
          {process ? (
            <button className="g7-tile-link" onClick={() => onOpen(process)}>
              <Workflow size={15} /> {process.title} <ArrowRight size={13} />
            </button>
          ) : (
            <p>{f(task, 'processName') || 'Not declared'}</p>
          )}
          <small>
            {siblings.length > 1
              ? `${siblings.length} of your tasks are in this process`
              : 'Your only task in this process'}
          </small>
        </section>
        <section className="g7-tile">
          <span className="g7-label">Evidence</span>
          <button className="g7-tile-link" onClick={onEvidence}>
            <FileText size={15} /> Source, scope and trace <ArrowRight size={13} />
          </button>
          <small>
            <ShieldCheck size={12} /> Read-only · your own task list
          </small>
        </section>
      </div>
      <p className="g7-boundary">
        <Lock size={13} /> Completing or reassigning tasks stays in your process tool.
      </p>
    </div>
  );
}

function ProcessScene({
  process,
  flow,
  tasks,
  notice,
  source,
  onOpen,
  onAsk,
  loading,
}: {
  process: Evidence;
  flow?: FlowStage[];
  tasks: Evidence[];
  notice?: string;
  source: Source;
  onOpen: (e: Evidence) => void;
  onAsk: (a: Ask) => void;
  loading: boolean;
}) {
  const counts = tasks.reduce<Record<string, number>>((a, t) => {
    const s = f(t, 'step');
    if (s) a[s] = (a[s] || 0) + 1;
    return a;
  }, {});
  const focus = tasks.find((t) => f(t, 'step'));
  return (
    <div className="g7-scene">
      <header className="g7-scene-head">
        <div>
          <span className="g7-eyebrow">
            {f(process, 'category') || 'Process'}
            {f(process, 'version') ? ` · version ${f(process, 'version')}` : ''}
          </span>
          <h2>{process.title}</h2>
          <p className="g7-description">
            {f(process, 'description') || 'Ask NOVA to explain this process.'}
          </p>
        </div>
        <div className="g7-scene-actions">
          <button
            className="button primary"
            disabled={loading}
            onClick={() =>
              onAsk({ prompt: `Explain the ${process.title.toLowerCase()} process.`, mode: 'ASK' })
            }
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
      </header>
      {flow ? (
        <Flow
          stages={flow}
          here={focus ? f(focus, 'step') : undefined}
          counts={counts}
          notice={notice}
        />
      ) : (
        <FlowUnavailable source={source} />
      )}
      <div className="g7-band">
        <section className="g7-tile wide">
          <span className="g7-label">Your tasks here</span>
          {tasks.length ? (
            <ul className="g7-tile-list">
              {tasks.map((t) => {
                const u = urgency(t);
                return (
                  <li key={t.id}>
                    <button onClick={() => onOpen(t)}>
                      <span>{t.title}</span>
                      <span className={`g7-due ${u.tone}`}>{u.label}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p>None of your current tasks belong to this process.</p>
          )}
        </section>
        <section className="g7-tile">
          <span className="g7-label">Not available yet</span>
          <p>Inputs, step details and variables need an additional reviewed read.</p>
          <small>
            <Lock size={12} /> Starting a process stays in your process tool.
          </small>
        </section>
      </div>
    </div>
  );
}

function MiniTimeline({ task }: { task: Evidence }) {
  const created = f(task, 'createdAt');
  const due = f(task, 'dueDate');
  const now = today();
  if (!created && !due) return <p>No dates declared.</p>;
  const start = created || now;
  const end = due && due > now ? due : now;
  const span = Math.max(1, days(start, end));
  const pos = (d: string) => `${Math.min(100, Math.max(0, (days(start, d) / span) * 100))}%`;
  return (
    <div className="g7-mini-time" aria-label="Task timeline">
      <div className="g7-mini-track">
        {due && (
          <span
            className={`g7-mini-span ${due < now ? 'late' : ''}`}
            style={{
              left: pos(due < now ? due : start),
              right: `calc(100% - ${pos(due < now ? now : due)})`,
            }}
          />
        )}
        {created && <i style={{ left: pos(created) }} title={`Created ${created}`} />}
        <i className="now" style={{ left: pos(now) }} title="Today" />
        {due && (
          <i
            className={due < now ? 'late' : 'due'}
            style={{ left: pos(due) }}
            title={`Due ${due}`}
          />
        )}
      </div>
      <div className="g7-mini-labels">
        {created && <span>Created {created.slice(5)}</span>}
        <span className={due && due < now ? 'late' : ''}>
          {due ? `Due ${due.slice(5)}` : 'No due date'}
        </span>
        <span className="now">Today {now.slice(5)}</span>
      </div>
    </div>
  );
}

function AnswerScene({
  mission,
  flowFor,
  choose,
}: {
  mission: Mission;
  flowFor: (k?: string) => FlowStage[] | undefined;
  choose: (e: Evidence) => void;
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
        {tasks.map((t, i) => {
          const u = urgency(t);
          const flow = flowFor(f(t, 'processKey'));
          return (
            <li key={t.id}>
              <span className="g7-agenda-rank">{String(i + 1).padStart(2, '0')}</span>
              <button onClick={() => choose(t)}>
                <span className="g7-obj-head">
                  <strong>{t.title}</strong>
                  <span className={`g7-due ${u.tone}`}>{u.label}</span>
                </span>
                <span className="g7-meta">
                  {f(t, 'processName') || 'Process not declared'} ·{' '}
                  {titleCase(f(t, 'priority')) || 'No'} priority
                </span>
                {flow && <Flow stages={flow} here={f(t, 'step')} compact />}
              </button>
            </li>
          );
        })}
      </ol>
    );
  return (
    <div className="g7-cards">
      {mission.evidence.map((d) => {
        const flow = flowFor(d.id);
        return (
          <button key={d.id} onClick={() => choose(d)} className="g7-card">
            <span className="g7-eyebrow">{f(d, 'category') || 'Process'}</span>
            <strong>{d.title}</strong>
            <p>{f(d, 'description') || 'No description returned.'}</p>
            {flow && <Flow stages={flow} compact />}
            {mission.draft?.object === d.id && (
              <span className="g7-draft">PREPARED — NOT SUBMITTED</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function LiveGate({
  status,
  openConnections,
}: {
  status?: RuntimeStatus['apps']['ITEROP'];
  openConnections: () => void;
}) {
  const checks: [string, boolean][] = [
    ['Approved API route and service address', Boolean(status?.configured)],
    ['Read-only credential on this machine', Boolean(status?.credentialsPresent)],
    ['Reviewed contract for your release', Boolean(status?.contractValid)],
  ];
  return (
    <div className="g7-gate">
      <span className="g7-gate-icon">
        <Lock size={22} />
      </span>
      <h2>Live access is not approved yet</h2>
      <p>
        Selecting Live does not connect anything. NOVA reads your real processes and tasks only
        after these are in place. Until then it makes no request — and it never substitutes
        synthetic data.
      </p>
      <ul>
        {checks.map(([label, done]) => (
          <li key={label} className={done ? 'done' : ''}>
            {done ? <CheckCircle2 size={16} /> : <Circle size={16} />} {label}
          </li>
        ))}
      </ul>
      <button className="button primary" onClick={openConnections}>
        <Settings2 size={16} /> View connection requirements
      </button>
    </div>
  );
}

function ProvenanceView({ mission }: { mission: Mission }) {
  if (!mission.provenance?.length)
    return (
      <p className="g7-muted">
        No upstream operation was attempted — the request stopped at NOVA’s policy layer.
      </p>
    );
  return (
    <>
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
                <td>{clock(p.at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="g7-prov-cards" aria-label="Provenance">
        {mission.provenance.map((p, i) => (
          <li key={i}>
            <div>
              <code>{p.operationId}</code>
              <span className={`g7-outcome o-${p.outcome}`}>{p.outcome.replace('_', ' ')}</span>
            </div>
            <code className="g7-prov-path">
              {p.method} {p.path}
            </code>
            <dl>
              <dt>Source</dt>
              <dd>
                <SourceTag source={p.source} />
              </dd>
              <dt>Scope</dt>
              <dd>{p.scope}</dd>
              <dt>Result</dt>
              <dd>
                {p.records} records · {p.coverage || 'no'} coverage
              </dd>
              <dt>Spec · time</dt>
              <dd>
                {p.specRelease} · {clock(p.at)}
              </dd>
            </dl>
          </li>
        ))}
      </ul>
    </>
  );
}
