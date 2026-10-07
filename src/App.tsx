import { useEffect, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  BookOpen,
  Box,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Command,
  FlaskConical,
  GitCompareArrows,
  Layers3,
  Menu,
  MessageSquare,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Unplug,
  X,
} from 'lucide-react';
import type { Benchmark, Mission, Mode, RuntimeStatus, Source } from '../shared/types';
import { benchmarks } from '../shared/benchmarks';
import { api } from './api';
import { ErrorNote, EvidenceCard, NovaMark, Pill, Result, Spinner } from './ui';
import { CompareView } from './Compare';
import { Connections, Registry } from './Settings';

type View = 'missions' | 'compare' | 'connections' | 'registry';
const nav = [
  { id: 'missions', label: 'Mission control', icon: MessageSquare },
  { id: 'compare', label: 'AURA comparison', icon: GitCompareArrows },
  { id: 'connections', label: 'Connections', icon: Unplug },
  { id: 'registry', label: 'Tool registry', icon: Layers3 },
] as const;
const icons = [Search, Box, GitCompareArrows, BookOpen, ShieldCheck];
const viewNames: Record<View, string> = {
  missions: 'Mission control',
  compare: 'AURA comparison',
  connections: 'Connections',
  registry: 'Tool registry',
};
export default function App() {
  const [view, setView] = useState<View>('missions');
  const [status, setStatus] = useState<RuntimeStatus | null>(null);
  const [source, setSource] = useState<Source>('synthetic');
  const [mode, setMode] = useState<Mode>('ASK');
  const [prompt, setPrompt] = useState('');
  const [history, setHistory] = useState<Mission[]>([]);
  const [active, setActive] = useState<Mission | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [help, setHelp] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const refresh = async () => {
    try {
      setStatus(await api<RuntimeStatus>('/status'));
    } catch {
      setError('The NOVA runtime is unavailable. Check that the local server is running.');
    }
  };
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const runtime = await api<RuntimeStatus>('/status');
        const missions = await api<Mission[]>('/missions');
        if (alive) {
          setStatus(runtime);
          setHistory(missions);
        }
      } catch {
        if (alive)
          setError(
            'The NOVA runtime is unavailable. Start the local server and refresh this page.',
          );
      }
    })();
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    if (!help) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const trapFocus = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const elements = document.querySelectorAll<HTMLElement>(
        '.modal button:not(:disabled), .modal a[href], .modal input, .modal select, .modal textarea',
      );
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener('keydown', trapFocus);
    return () => {
      document.removeEventListener('keydown', trapFocus);
      previousFocus?.focus();
    };
  }, [help]);
  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setView('missions');
        inputRef.current?.focus();
      }
      if (e.key === 'Escape') {
        setHelp(false);
        setMenuOpen(false);
      }
    };
    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  }, []);
  const navigate = (next: View) => {
    setView(next);
    setMenuOpen(false);
    setError('');
  };
  const addMission = (mission: Mission) =>
    setHistory((h) => [mission, ...h.filter((m) => m.id !== mission.id)].slice(0, 50));
  const run = async (text = prompt, selectedMode = mode) => {
    if (loading || text.trim().length < 3) return;
    setLoading(true);
    setError('');
    setPrompt(text);
    setMode(selectedMode);
    try {
      const mission = await api<Mission>('/missions', { prompt: text, source, mode: selectedMode });
      setActive(mission);
      addMission(mission);
      setPrompt('');
      setTimeout(
        () => resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
        30,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Mission failed.');
    } finally {
      setLoading(false);
    }
  };
  const selectBenchmark = (b: Benchmark) => {
    setPrompt(b.prompt);
    setMode(b.mode);
    inputRef.current?.focus();
  };
  return (
    <div className="app-shell">
      {menuOpen && (
        <button
          className="sidebar-scrim"
          aria-label="Close navigation"
          onClick={() => setMenuOpen(false)}
        />
      )}
      <aside className={`sidebar ${menuOpen ? 'is-open' : ''}`}>
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            navigate('missions');
          }}
        >
          <NovaMark />
          <span>
            NOVA<small>ENGINEERING COMPANION</small>
          </span>
        </a>
        <button
          className="new-mission button"
          onClick={() => {
            navigate('missions');
            setActive(null);
            setPrompt('');
            inputRef.current?.focus();
          }}
        >
          <Plus size={17} /> New mission <span>⌘ K</span>
        </button>
        <span className="nav-label">WORKSPACE</span>
        <nav aria-label="Main navigation">
          {nav.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              aria-current={view === id ? 'page' : undefined}
              className={view === id ? 'active' : ''}
              onClick={() => navigate(id)}
            >
              <Icon size={18} />
              <span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="recent-head">
          <span className="nav-label">RECENT MISSIONS</span>
          <span>{history.length}</span>
        </div>
        <div className="recent-list">
          {history.length ? (
            history.slice(0, 6).map((m) => (
              <button
                key={m.id}
                className={active?.id === m.id && view === 'missions' ? 'selected' : ''}
                onClick={() => {
                  setActive(m);
                  setSource(m.source);
                  navigate('missions');
                }}
              >
                <MessageSquare size={14} />
                <span>{m.prompt}</span>
              </button>
            ))
          ) : (
            <p>Your missions will appear here.</p>
          )}
        </div>
        <div className="sidebar-bottom">
          <div className="boundary-note">
            <ShieldCheck size={17} />
            <div>
              <strong>Evidence first. Always.</strong>
              <p>Private runtime · read-only access</p>
            </div>
          </div>
          <button className="operator" onClick={() => setHelp(true)}>
            <span className="avatar">N</span>
            <span>
              <strong>My workspace</strong>
              <small>Local operator</small>
            </span>
            <CircleHelp size={17} />
          </button>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button mobile-menu"
              aria-label="Open navigation"
              onClick={() => setMenuOpen(true)}
            >
              <Menu size={21} />
            </button>
            <span>Workspace</span>
            <ChevronRight size={13} />
            <strong>{viewNames[view]}</strong>
          </div>
          <div className="topbar-right">
            <span className="private-label">
              <ShieldCheck size={14} /> Private by design
            </span>
            <button className="environment-badge" onClick={() => navigate('connections')}>
              <span className={`status-dot ${source === 'live' ? 'amber' : ''}`} />
              {source === 'synthetic'
                ? 'Synthetic workspace'
                : status?.liveReady
                  ? 'Platform configured'
                  : 'Platform setup needed'}
              <ChevronDown size={12} />
            </button>
          </div>
        </header>
        <main id="main-content">
          {view === 'missions' && (
            <div className={`mission-layout ${active ? 'has-result' : ''}`}>
              <section className="mission-main">
                {!active && (
                  <>
                    <div className="hero">
                      <div className="eyebrow">
                        <span /> ENGINEERING, CONNECTED
                      </div>
                      <h1>
                        From a question
                        <br />
                        to a <em>clear next step.</em>
                      </h1>
                      <p>
                        Explore your engineering data, trace the evidence,
                        <br className="desktop-break" /> and move your work forward with NOVA.
                      </p>
                      <div className="hero-tags">
                        <span>
                          <ShieldCheck size={14} /> Governed tools
                        </span>
                        <span>
                          <BookOpen size={14} /> Traceable answers
                        </span>
                        <span>
                          <GitCompareArrows size={14} /> AURA comparison
                        </span>
                      </div>
                    </div>
                    <div className="starter-heading">
                      <h2>Start with an engineering mission</h2>
                      <span>
                        5 guided examples <ArrowDown size={13} />
                      </span>
                    </div>
                    <div className="starter-grid">
                      {benchmarks.slice(0, 3).map((b, i) => {
                        const Icon = icons[i];
                        return (
                          <button
                            className="starter-card"
                            key={b.id}
                            onClick={() => selectBenchmark(b)}
                          >
                            <div className={`card-icon color-${i}`}>
                              <Icon size={21} />
                            </div>
                            <strong>{b.title}</strong>
                            <p>{b.description}</p>
                            <span className="card-mode">
                              {b.mode.toLowerCase()} <ArrowUp size={15} />
                            </span>
                          </button>
                        );
                      })}
                    </div>
                    <div className="more-starters">
                      {benchmarks.slice(3).map((b, i) => {
                        const Icon = icons[i + 3];
                        return (
                          <button key={b.id} onClick={() => selectBenchmark(b)}>
                            <Icon size={15} />
                            {b.title}
                            <ArrowRight size={13} />
                          </button>
                        );
                      })}
                    </div>
                  </>
                )}
                {active && (
                  <div ref={resultRef} className="conversation">
                    <div className="question">
                      <div>
                        <span className="tiny-label">YOUR MISSION</span>
                        <Pill>
                          {active.source === 'synthetic' ? 'Synthetic data' : 'Platform data'}
                        </Pill>
                      </div>
                      <p>{active.prompt}</p>
                    </div>
                    <Result mission={active} />
                    {active.status === 'blocked' && source === 'live' && (
                      <button className="button secondary" onClick={() => navigate('connections')}>
                        <Settings2 size={16} /> Open connection setup
                      </button>
                    )}
                  </div>
                )}
                <div className="composer-area">
                  <div className="composer">
                    <div className="composer-top">
                      <div className="mode-picker" role="group" aria-label="Mission mode">
                        {(['ASK', 'INVESTIGATE', 'ACT'] as Mode[]).map((m) => (
                          <button
                            key={m}
                            className={mode === m ? 'selected' : ''}
                            aria-pressed={mode === m}
                            onClick={() => setMode(m)}
                          >
                            {m === 'ASK' ? (
                              <MessageSquare size={13} />
                            ) : m === 'INVESTIGATE' ? (
                              <Search size={13} />
                            ) : (
                              <ShieldCheck size={13} />
                            )}{' '}
                            {m[0] + m.slice(1).toLowerCase()}
                          </button>
                        ))}
                      </div>
                      <label className="source-select">
                        <span className="sr-only">Data source</span>
                        <select
                          aria-label="Data source"
                          value={source}
                          onChange={(e) => setSource(e.target.value as Source)}
                        >
                          <option value="synthetic">Synthetic workspace</option>
                          <option value="live">My 3DEXPERIENCE</option>
                        </select>
                      </label>
                    </div>
                    <textarea
                      ref={inputRef}
                      value={prompt}
                      maxLength={2000}
                      onChange={(e) => setPrompt(e.target.value)}
                      aria-label="Your engineering mission"
                      placeholder={
                        mode === 'ACT'
                          ? 'Describe the review you want to prepare…'
                          : 'Ask a question about your engineering data…'
                      }
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          void run();
                        }
                      }}
                    />
                    <div className="composer-bottom">
                      <span>
                        {mode === 'ACT' ? (
                          <>
                            <ShieldCheck size={13} /> Prepare a local draft · no submission
                          </>
                        ) : (
                          <>
                            <FlaskConical size={13} />
                            {source === 'synthetic'
                              ? 'Sample data. No platform connection.'
                              : 'Uses verified private read bindings.'}
                          </>
                        )}
                      </span>
                      <button
                        className="send-button"
                        disabled={loading || prompt.trim().length < 3 || !status}
                        onClick={() => void run()}
                        aria-label="Run mission"
                      >
                        {loading ? <Spinner /> : <ArrowUp size={20} />}
                      </button>
                    </div>
                  </div>
                  {loading && (
                    <div className="running-note" role="status">
                      <Spinner /> Retrieving evidence and checking scope…
                    </div>
                  )}
                  {error && <ErrorNote message={error} />}
                  <div className="composer-caption">
                    <span>
                      Enter to send <span className="caption-dot">·</span> Shift + Enter for a new
                      line
                    </span>
                    <span>Check engineering conclusions against source evidence.</span>
                  </div>
                </div>
              </section>
              {active ? (
                <aside className="evidence-rail">
                  <div className="rail-heading">
                    <div>
                      <span className="tiny-label">MISSION CONTEXT</span>
                      <h2>Source evidence</h2>
                    </div>
                    <span className="count-badge">{active.evidence.length}</span>
                  </div>
                  <p className="rail-intro">
                    Inspect the records behind the answer. Source text is treated as evidence.
                  </p>
                  {active.evidence.length ? (
                    active.evidence.map((e) => <EvidenceCard key={e.id} record={e} />)
                  ) : (
                    <div className="empty-evidence">
                      <FilePlaceholder />
                      <p>No evidence retrieved yet.</p>
                      <small>
                        {active.status === 'blocked'
                          ? 'Resolve the reported blocker to continue.'
                          : 'Add the missing mission details.'}
                      </small>
                    </div>
                  )}
                  <div className="rail-note">
                    <ShieldCheck size={17} />
                    <p>
                      {active.source === 'synthetic'
                        ? 'All records in this mission are synthetic fixtures.'
                        : 'Only allowlisted fields from the private platform response are shown.'}
                    </p>
                  </div>
                </aside>
              ) : null}
            </div>
          )}
          {view === 'compare' && (
            <CompareView source={source} setSource={setSource} onMission={addMission} />
          )}
          {view === 'connections' && (
            <Connections
              status={status}
              refresh={refresh}
              source={source}
              setSource={setSource}
              onStart={() => navigate('missions')}
            />
          )}
          {view === 'registry' && <Registry />}
        </main>
        <footer className="workspace-footer">
          <span>
            NOVA <span className="footer-version">v0.2</span>
          </span>
          <span>An open architecture for engineering intelligence.</span>
          <button onClick={() => setHelp(true)}>
            Workspace guide <ArrowRight size={12} />
          </button>
        </footer>
      </div>
      {help && (
        <div className="modal-backdrop" onClick={() => setHelp(false)}>
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="help-title"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              autoFocus
              className="icon-button modal-close"
              aria-label="Close guide"
              onClick={() => setHelp(false)}
            >
              <X size={20} />
            </button>
            <NovaMark />
            <h2 id="help-title">A clear path from intent to evidence.</h2>
            <p>
              Ask retrieves facts. Investigate follows evidence across records. Act prepares a local
              review draft. No mode can change your platform in this version.
            </p>
            <ul className="guide-list">
              <li>
                <Check size={16} /> Start with a synthetic mission to explore the workflow.
              </li>
              <li>
                <Check size={16} /> Configure private API bindings in Connections for live reads.
              </li>
              <li>
                <Check size={16} /> Run the same mission in AURA and record what you can observe.
              </li>
            </ul>
            <div className="notice">
              Mission history and observations live in this local server session. Export anything
              you want to retain. Restarting the server clears them.
            </div>
            <button
              className="button secondary"
              onClick={async () => {
                try {
                  await api('/session/clear', {});
                  setHistory([]);
                  setActive(null);
                  setHelp(false);
                } catch (e) {
                  setError((e as Error).message);
                  setHelp(false);
                }
              }}
            >
              Clear this session
            </button>
          </section>
        </div>
      )}
    </div>
  );
}
function FilePlaceholder() {
  return <BookOpen size={28} strokeWidth={1.3} />;
}
