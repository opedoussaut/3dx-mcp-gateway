import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUp, Check, LoaderCircle, Minus, Plug, ShieldCheck, Waypoints } from 'lucide-react';
import type { OrchestrationRun } from '../shared/types';
import { api } from './api';
import { ErrorNote, SourceTag } from './ui';
import {
  ChainCanvas,
  Reviewer,
  RunCard,
  Trace,
  type LabState,
  type Probe,
  type Reply,
} from './Orchestrator';

/**
 * ITEROP orchestration lab — a single-purpose page to test reading and driving business
 * processes from a prompt. Same server, engines and approval gates as the portal's
 * Orchestration view; nothing here bypasses them.
 */
const examples = [
  'Which processes can I start?',
  'What tasks are waiting for me?',
  'Configure the cooling chain for 1.2 MW IT load, 32 °C facility water, 16 racks, N+1',
  'Check my inbox and handle any rework',
  'Facility water is now 38 °C — what needs to be recalculated?',
  'What is the status?',
];

export default function LabApp() {
  const [source, setSource] = useState<'synthetic' | 'live'>('synthetic');
  const [state, setState] = useState<LabState | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [prompt, setPrompt] = useState('');
  const [approval, setApproval] = useState<'each' | 'all'>('each');
  const [probe, setProbe] = useState<Probe | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    api<LabState>(`/lab?source=${source}`)
      .then((s) => {
        setState(s);
        setActiveId(s.runs[0]?.id ?? null);
      })
      .catch(() => setError('The local NOVA server is not running. Start it with npm run dev.'));
  }, [source]);
  const active = useMemo(
    () => state?.runs.find((r) => r.id === activeId) ?? null,
    [state, activeId],
  );
  const pending = active?.steps.find((s) => s.status === 'awaiting_approval');
  const live = source === 'live';
  const settings = state?.live.settings;
  const call = async (path: string, body: unknown) => {
    setBusy(true);
    setError('');
    try {
      const reply = await api<Reply>(path, body);
      setState(reply.state);
      if (reply.run) setActiveId(reply.run.id);
      return reply;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The request failed.');
    } finally {
      setBusy(false);
    }
  };
  const run = async (text = prompt) => {
    if (busy || text.trim().length < 3) return;
    const reply = await call('/lab/runs', { prompt: text.trim(), approval, source });
    if (reply) setPrompt('');
  };
  const testConnection = async () => {
    setBusy(true);
    setError('');
    try {
      setProbe(await api<Probe>('/lab/probe', {}));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The connection test failed.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="gen7 lab lab-standalone">
      <header className="lab-head">
        <div className="lab-title">
          <span className="g7-app-icon" aria-hidden="true">
            <Waypoints size={21} />
          </span>
          <div>
            <h1>ITEROP orchestration lab</h1>
            <p>Read and drive business processes from a prompt. Every write waits for you.</p>
          </div>
        </div>
        <SourceTag source={source} />
      </header>

      <section className="lab-card" aria-label="Connection">
        <div className="lab-canvas-head">
          <h2 className="g7-label">
            <Plug size={14} aria-hidden="true" /> Connection
          </h2>
          <div className="lab-segment" role="radiogroup" aria-label="Process engine">
            <button
              role="radio"
              aria-checked={!live}
              className={!live ? 'on' : ''}
              onClick={() => setSource('synthetic')}
            >
              Simulated
            </button>
            <button
              role="radio"
              aria-checked={live}
              className={live ? 'on' : ''}
              disabled={!state?.live.ready && !live}
              onClick={() => setSource('live')}
            >
              Sandbox (live)
            </button>
          </div>
        </div>
        {settings && (
          <ul className="lab-settings" aria-label="Sandbox settings">
            <Setting
              ok={Boolean(settings.gateway)}
              label="Gateway"
              value={settings.gateway ?? 'NOVA_LAB_GATEWAY_ORIGIN not set'}
            />
            <Setting
              ok={settings.apiKey}
              label="API key"
              value={settings.apiKey ? 'set' : 'NOVA_LAB_API_KEY not set'}
            />
            <Setting
              ok={settings.agent}
              label="Openness Agent"
              value={settings.agent ? 'set' : 'NOVA_LAB_AGENT_ID / SECRET not set'}
            />
            <Setting
              ok={settings.contract}
              label="Lab contract"
              value={
                settings.contract
                  ? `processes: ${settings.processes.join(', ')}`
                  : '.private/lab-contract.json missing or rejected'
              }
            />
          </ul>
        )}
        <div className="lab-connection-foot">
          <p className="lab-fine">
            {live
              ? 'Sandbox tenant through the API Gateway. Synthetic test processes only.'
              : state?.live.ready
                ? 'Simulated engine. Switch to Sandbox (live) to use your tenant.'
                : 'Simulated engine, no platform request. Sandbox (live) unlocks when all four settings are green — restart the server after editing .env.'}
          </p>
          {state?.live.ready && (
            <button className="button secondary" disabled={busy} onClick={testConnection}>
              <ShieldCheck size={15} /> Test connection (read-only)
            </button>
          )}
        </div>
        {probe && (
          <div className="lab-block">
            <p className="lab-summary">
              <span
                className={`lab-status ${probe.outcome === 'PASS' ? 'green' : probe.outcome === 'PARTIAL' ? 'amber' : 'red'}`}
              >
                {probe.outcome}
              </span>{' '}
              No write was made.
            </p>
            <ul className="lab-findings">
              {probe.checks.map((c) => (
                <li key={c.name}>
                  {c.ok ? '✔' : '✖'} {c.name} — {c.detail}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section className="lab-composer" aria-label="Prompt">
        <label htmlFor="lab-prompt" className="g7-label">
          Prompt
        </label>
        <div className="lab-input">
          <textarea
            id="lab-prompt"
            ref={inputRef}
            rows={2}
            maxLength={1000}
            value={prompt}
            placeholder="What tasks are waiting for me?"
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                run();
              }
            }}
          />
          <button
            className="lab-send"
            aria-label="Run prompt"
            disabled={busy || prompt.trim().length < 3}
            onClick={() => run()}
          >
            {busy ? <LoaderCircle size={18} className="spin" /> : <ArrowUp size={18} />}
          </button>
        </div>
        <div className="lab-composer-foot">
          <div className="lab-segment" role="radiogroup" aria-label="Write approval">
            <button
              role="radio"
              aria-checked={approval === 'each'}
              className={approval === 'each' ? 'on' : ''}
              onClick={() => setApproval('each')}
            >
              Approve each write
            </button>
            <button
              role="radio"
              aria-checked={approval === 'all'}
              className={approval === 'all' ? 'on' : ''}
              onClick={() => setApproval('all')}
            >
              Approve all writes of the run
            </button>
          </div>
          <div className="lab-examples">
            {examples.map((x) => (
              <button
                key={x}
                className="lab-example"
                onClick={() => {
                  setPrompt(x);
                  inputRef.current?.focus();
                }}
              >
                {x}
              </button>
            ))}
          </div>
        </div>
      </section>
      {error && <ErrorNote message={error} />}

      {active && (
        <RunCard
          run={active}
          pending={pending}
          busy={busy}
          approve={(all) =>
            pending && call(`/lab/runs/${active.id}/approve`, { stepId: pending.id, all })
          }
          cancel={() => call(`/lab/runs/${active.id}/cancel`, {})}
        />
      )}
      {active && active.stages.length > 0 && <ChainCanvas run={active} />}
      {active && <Trace run={active} />}
      {state && !live && state.reviewerQueue.length > 0 && (
        <Reviewer
          queue={state.reviewerQueue}
          busy={busy}
          sign={(taskId, decision, comment) => call('/lab/review', { taskId, decision, comment })}
        />
      )}
      {state && state.runs.length > 1 && (
        <section className="lab-card lab-runs-card">
          <h2 className="g7-label">Earlier runs</h2>
          <ul className="lab-runs">
            {state.runs.map((r: OrchestrationRun) => (
              <li key={r.id}>
                <button
                  className={r.id === activeId ? 'on' : ''}
                  aria-current={r.id === activeId ? 'true' : undefined}
                  onClick={() => setActiveId(r.id)}
                >
                  <span className="lab-run-text">
                    <strong>{r.identificator ?? `Run ${r.number}`}</strong>
                    <small>{r.prompt}</small>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      <footer className="lab-fine lab-foot">
        NOVA · local lab on 127.0.0.1 · <a href="/">Open the full workspace</a>
      </footer>
    </div>
  );
}

function Setting({ ok, label, value }: { ok: boolean; label: string; value: string }) {
  return (
    <li className={ok ? 'ok' : 'missing'}>
      {ok ? <Check size={14} aria-hidden="true" /> : <Minus size={14} aria-hidden="true" />}
      <strong>{label}</strong>
      <span>{value}</span>
    </li>
  );
}
