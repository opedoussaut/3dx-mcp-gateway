import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUp,
  Ban,
  Check,
  CircleDashed,
  Cpu,
  Droplets,
  FileCheck2,
  Gauge,
  Inbox,
  LoaderCircle,
  Lock,
  RotateCcw,
  Send,
  ShieldCheck,
  Stamp,
  Thermometer,
  UserCheck,
  Waypoints,
  X,
} from 'lucide-react';
import type { OrchestrationRun, OrchestrationStage, OrchestrationStep } from '../shared/types';
import { api } from './api';
import { ErrorNote, SourceTag } from './ui';

type Queue = {
  id: string;
  name: string;
  process: { identificator: string; instanceId: string; name: string };
  decisions: string[];
}[];
export type LabState = {
  source: 'synthetic' | 'live';
  live: {
    ready: boolean;
    blockers: string[];
    drive: string[];
    settings: {
      gateway: string | null;
      apiKey: boolean;
      agent: boolean;
      contract: boolean;
      processes: string[];
    };
  };
  specRelease: string;
  operations: {
    operationId: string;
    method: string;
    path: string;
    kind: 'read' | 'drive';
    note: string;
  }[];
  neverCalled: string[];
  runs: OrchestrationRun[];
  reviewerQueue: Queue;
};
export type Reply = { run?: OrchestrationRun; state: LabState };
export type Probe = {
  checkedAt: string;
  outcome: 'PASS' | 'PARTIAL' | 'DENIED' | 'FAIL';
  checks: { name: string; ok: boolean; detail: string }[];
};

const examples = [
  'Configure the cooling chain for 1.2 MW IT load, 32 °C facility water, 16 racks, N+1',
  'Facility water is now 38 °C — what needs to be recalculated?',
  'Check my inbox and handle any rework',
  'Register a candidate requirement: secondary supply must stay at or below 40 °C, source: public liquid-cooling guideline section 4',
  'What tasks are waiting for me?',
  'Reassign the sign-off task to another engineer',
];
const statusText: Record<OrchestrationRun['status'], string> = {
  awaiting_approval: 'Prepared — not submitted',
  awaiting_signoff: 'Waiting for reviewer',
  completed: 'Completed',
  needs_input: 'Needs input',
  blocked: 'Blocked',
  failed: 'Failed',
  cancelled: 'Cancelled',
};
const statusTone: Record<OrchestrationRun['status'], string> = {
  awaiting_approval: 'amber',
  awaiting_signoff: 'blue',
  completed: 'green',
  needs_input: 'amber',
  blocked: 'red',
  failed: 'red',
  cancelled: 'neutral',
};
const kindLabel: Record<OrchestrationStep['kind'], string> = {
  read: 'READ',
  drive: 'WRITE',
  compute: 'TOOL',
  human: 'HUMAN',
};
const stageIcon: Record<string, typeof Cpu> = {
  start: Thermometer,
  coolantSelection: Droplets,
  cduSizing: Cpu,
  loopConfiguration: Waypoints,
  systemCheck: Gauge,
  engineeringSignoff: Stamp,
  requirementReview: Stamp,
};
const json = (v: unknown) => JSON.stringify(v, null, 2);

export function OrchestratorView() {
  const [state, setState] = useState<LabState | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [prompt, setPrompt] = useState('');
  const [approval, setApproval] = useState<'each' | 'all'>('each');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [source, setSource] = useState<'synthetic' | 'live'>('synthetic');
  const [probe, setProbe] = useState<Probe | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    api<LabState>(`/lab?source=${source}`)
      .then((s) => {
        setState(s);
        setActiveId(s.runs[0]?.id ?? null);
      })
      .catch(() => setError('The NOVA runtime is unavailable.'));
  }, [source]);
  const live = source === 'live';
  const liveReady = Boolean(state?.live.ready);
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
  const active = useMemo(
    () => state?.runs.find((r) => r.id === activeId) ?? null,
    [state, activeId],
  );
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
  const pending = active?.steps.find((s) => s.status === 'awaiting_approval');
  return (
    <div className="gen7 lab">
      <header className="lab-head">
        <div className="lab-title">
          <span className="g7-app-icon" aria-hidden="true">
            <Waypoints size={21} />
          </span>
          <div>
            <h1>Process orchestration</h1>
            <p>
              Tell NOVA what to run. It reads the process, runs the tools and prepares every write
              for your approval.
            </p>
          </div>
        </div>
        <div className="lab-head-tags">
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
              disabled={!liveReady && !live}
              title={liveReady ? undefined : 'Configure the sandbox connection first'}
              onClick={() => setSource('live')}
            >
              Sandbox (live)
            </button>
          </div>
          <SourceTag source={source} />
          <span className="lab-engine">
            <ShieldCheck size={14} />{' '}
            {live
              ? 'Sandbox tenant through the API Gateway · every write needs your approval'
              : 'Simulated process engine · no platform request'}
          </span>
        </div>
      </header>
      {!liveReady && state && (
        <p className="lab-fine lab-live-note">
          Sandbox (live) is off: {state.live.blockers[0]} See docs/iterop/LAB-ORCHESTRATION.md.
        </p>
      )}
      {live && (
        <section className="lab-card lab-probe" aria-label="Connection test">
          <div className="lab-canvas-head">
            <h2 className="g7-label">Sandbox connection</h2>
            <button className="button secondary" disabled={busy} onClick={testConnection}>
              Test connection (read-only)
            </button>
          </div>
          {probe ? (
            <>
              <p className="lab-summary">
                <span
                  className={`lab-status ${probe.outcome === 'PASS' ? 'green' : probe.outcome === 'PARTIAL' ? 'amber' : 'red'}`}
                >
                  {probe.outcome}
                </span>{' '}
                Checked the lab models without writing anything.
              </p>
              <ul className="lab-findings">
                {probe.checks.map((c) => (
                  <li key={c.name}>
                    {c.ok ? '✔' : '✖'} {c.name} — {c.detail}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="g7-muted">
              Checks that the agent can see the lab processes and that each imported model declares
              the tasks and fields NOVA will write. No write is made.
            </p>
          )}
        </section>
      )}

      <section className="lab-composer" aria-label="New command">
        <label htmlFor="lab-prompt" className="g7-label">
          Command
        </label>
        <div className="lab-input">
          <textarea
            id="lab-prompt"
            ref={inputRef}
            rows={2}
            maxLength={1000}
            value={prompt}
            placeholder="Configure the cooling chain for 1.2 MW, 32 °C facility water, 16 racks…"
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
            aria-label="Run command"
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

      <div className="lab-grid">
        <div className="lab-main">
          {active ? (
            <>
              {active.stages.length > 0 && <ChainCanvas run={active} />}
              <Trace run={active} />
            </>
          ) : (
            <Empty />
          )}
        </div>
        <aside className="lab-side" aria-label="NOVA">
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
          {state && !live && (
            <Reviewer
              queue={state.reviewerQueue}
              busy={busy}
              sign={(taskId, decision, comment) =>
                call('/lab/review', { taskId, decision, comment })
              }
            />
          )}
          {state && state.runs.length > 0 && (
            <section className="lab-card lab-runs-card">
              <h2 className="g7-label">Runs in this session</h2>
              <ul className="lab-runs">
                {state.runs.map((r) => (
                  <li key={r.id}>
                    <button
                      className={r.id === activeId ? 'on' : ''}
                      aria-current={r.id === activeId ? 'true' : undefined}
                      onClick={() => setActiveId(r.id)}
                    >
                      <span className={`lab-dot ${statusTone[r.status]}`} aria-hidden="true" />
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
          {state && <Boundary state={state} />}
        </aside>
      </div>
    </div>
  );
}

function Empty() {
  return (
    <section className="lab-card lab-empty">
      <Waypoints size={28} aria-hidden="true" />
      <h2>No run yet</h2>
      <p>
        Pick an example or write a command. NOVA plans the process calls, runs reads and tools at
        once, and stops before each write until you approve it.
      </p>
    </section>
  );
}

export function ChainCanvas({ run }: { run: OrchestrationRun }) {
  const reworked = run.findings.some((f) => f.startsWith('Reviewer:'));
  return (
    <section className="lab-card lab-canvas" aria-label="Process chain">
      <div className="lab-canvas-head">
        <div>
          <h2 className="g7-label">{run.processName}</h2>
          <p className="lab-ident">
            {run.identificator}
            {run.instanceId && <span> · instance {run.instanceId}</span>}
          </p>
        </div>
        {reworked && (
          <span className="lab-loop">
            <RotateCcw size={13} /> Returned by reviewer · reworked
          </span>
        )}
      </div>
      <ol className="lab-chain">
        {run.stages.map((s, i) => (
          <Node key={s.id} stage={s} run={run} last={i === run.stages.length - 1} />
        ))}
      </ol>
      <p className="lab-legend">
        <span>
          <i className="auto" /> NOVA + tool
        </span>
        <span>
          <i className="human" /> Human in the process application
        </span>
      </p>
    </section>
  );
}

function Node({
  stage,
  run,
  last,
}: {
  stage: OrchestrationStage;
  run: OrchestrationRun;
  last: boolean;
}) {
  const state = run.stageState[stage.id] ?? 'pending';
  const Icon = stageIcon[stage.id] ?? FileCheck2;
  const label =
    state === 'done'
      ? 'Done'
      : state === 'awaiting'
        ? 'Awaiting approval'
        : state === 'active'
          ? 'In progress'
          : state === 'human'
            ? 'With reviewer'
            : state === 'failed'
              ? 'Failed'
              : 'Pending';
  return (
    <li className={`lab-node ${stage.kind} ${state}`}>
      <div className="lab-node-icon" aria-hidden="true">
        {state === 'done' ? <Check size={16} /> : <Icon size={16} />}
      </div>
      <div className="lab-node-body">
        <strong>{stage.label}</strong>
        <span className="lab-node-state">{label}</span>
        {run.stageNotes[stage.id] && (
          <span className="lab-node-note">{run.stageNotes[stage.id]}</span>
        )}
      </div>
      {!last && <span className="lab-link" aria-hidden="true" />}
    </li>
  );
}

export function Trace({ run }: { run: OrchestrationRun }) {
  const sent = run.steps.filter((s) => s.status === 'done' && s.kind !== 'compute').length;
  return (
    <section className="lab-card lab-trace-card" aria-label="Process trace">
      <div className="lab-canvas-head">
        <h2 className="g7-label">Process trace</h2>
        <span className="g7-muted">
          {run.steps.length
            ? `${sent} call${sent === 1 ? '' : 's'} to the ${run.source} engine · ${run.steps.length} planned steps`
            : 'No call planned'}
        </span>
      </div>
      {run.steps.length ? (
        <ol className="lab-trace">
          {run.steps.map((s, i) => (
            <li key={s.id} className={`lab-step ${s.status}`}>
              <details>
                <summary>
                  <span className="lab-step-n">{i + 1}</span>
                  <span className={`lab-kind ${s.kind}`}>{kindLabel[s.kind]}</span>
                  <span className="lab-step-main">
                    <span className="lab-step-title">{s.title}</span>
                    {s.operationId && (
                      <code>
                        {s.method} {s.path} · {s.operationId}
                      </code>
                    )}
                  </span>
                  <span className="lab-step-status">
                    <StepIcon status={s.status} />
                    <span>{s.outcome ?? s.status.replaceAll('_', ' ')}</span>
                  </span>
                </summary>
                {(s.request !== undefined || s.response !== undefined) && (
                  <div className="lab-step-body">
                    {s.request !== undefined && (
                      <div>
                        <span className="g7-label">Request</span>
                        <pre tabIndex={0}>{json(s.request)}</pre>
                      </div>
                    )}
                    {s.response !== undefined && (
                      <div>
                        <span className="g7-label">Response</span>
                        <pre tabIndex={0}>{json(s.response)}</pre>
                      </div>
                    )}
                  </div>
                )}
              </details>
            </li>
          ))}
        </ol>
      ) : (
        <p className="g7-muted">Nothing was sent to the process engine for this command.</p>
      )}
    </section>
  );
}

function StepIcon({ status }: { status: OrchestrationStep['status'] }) {
  if (status === 'done') return <Check size={14} aria-hidden="true" />;
  if (status === 'awaiting_approval') return <Lock size={14} aria-hidden="true" />;
  if (status === 'blocked') return <UserCheck size={14} aria-hidden="true" />;
  if (status === 'failed') return <X size={14} aria-hidden="true" />;
  if (status === 'skipped') return <Ban size={14} aria-hidden="true" />;
  return <CircleDashed size={14} aria-hidden="true" />;
}

export function RunCard({
  run,
  pending,
  busy,
  approve,
  cancel,
}: {
  run: OrchestrationRun;
  pending?: OrchestrationStep;
  busy: boolean;
  approve: (all: boolean) => void;
  cancel: () => void;
}) {
  const request = pending?.request as { path: string; body: unknown } | undefined;
  return (
    <section className="lab-card lab-run" aria-live="polite">
      <div className="lab-run-head">
        <span className={`lab-status ${statusTone[run.status]}`}>{statusText[run.status]}</span>
        <SourceTag source={run.source} />
      </div>
      <blockquote>{run.prompt}</blockquote>
      <p className="lab-summary">{run.summary}</p>
      {run.missing.length > 0 && (
        <ul className="lab-missing">
          {run.missing.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      )}
      {run.findings.length > 0 && (
        <ul className="lab-findings">
          {run.findings.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
      )}
      {pending && request && (
        <div className="lab-approval">
          <div className="lab-approval-head">
            <Lock size={14} aria-hidden="true" />
            <strong>Prepared — not submitted</strong>
          </div>
          <p>
            {pending.title}
            <code>
              {pending.method} {request.path}
            </code>
          </p>
          <pre tabIndex={0} aria-label="Request body">
            {json(request.body)}
          </pre>
          <div className="lab-approval-actions">
            <button className="button" disabled={busy} onClick={() => approve(false)}>
              <Send size={15} /> Approve and send
            </button>
            <button className="button secondary" disabled={busy} onClick={() => approve(true)}>
              Approve all remaining writes
            </button>
            <button className="lab-text-button" disabled={busy} onClick={cancel}>
              Cancel run
            </button>
          </div>
          <p className="lab-fine">
            {run.source === 'live'
              ? 'Approving sends this request to the sandbox tenant through the API Gateway.'
              : 'Sent to the synthetic engine only. Approval here is not an authorization for a live platform.'}
          </p>
        </div>
      )}
      {run.changes.some((c) => c.changed) && (
        <div className="lab-block">
          <h3 className="g7-label">What changed</h3>
          <table className="lab-table">
            <thead>
              <tr>
                <th scope="col">Output</th>
                <th scope="col">Before</th>
                <th scope="col">After</th>
              </tr>
            </thead>
            <tbody>
              {run.changes
                .filter(
                  (c) =>
                    c.changed && !c.field.endsWith('findings') && !c.field.endsWith('rationale'),
                )
                .map((c) => (
                  <tr key={c.field}>
                    <th scope="row">{c.label}</th>
                    <td>{c.before}</td>
                    <td className="changed">{c.after}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
      {run.outputs.length > 0 && (
        <div className="lab-block">
          <h3 className="g7-label">Outputs written to the process</h3>
          <dl className="lab-outputs">
            {run.outputs
              .filter((o) => !o.field.endsWith('rationale'))
              .map((o) => (
                <div key={o.field} className={o.field.endsWith('findings') ? 'wide' : ''}>
                  <dt>{o.label}</dt>
                  <dd>{o.value}</dd>
                </div>
              ))}
          </dl>
          <p className="lab-fine">
            Illustrative lab formulas and invented limits, not engineering values. In a real
            deployment the approved configurators and system models produce every number.
          </p>
        </div>
      )}
      {run.records.length > 0 && (
        <div className="lab-block">
          <h3 className="g7-label">Returned records</h3>
          <ul className="lab-records">
            {run.records.map((r) => (
              <li key={r.id}>
                <strong>{r.title}</strong>
                <span>{r.detail}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

export function Reviewer({
  queue,
  busy,
  sign,
}: {
  queue: Queue;
  busy: boolean;
  sign: (taskId: string, decision: string, comment: string) => void;
}) {
  const [comments, setComments] = useState<Record<string, string>>({});
  return (
    <section className="lab-card lab-reviewer" aria-label="Simulated reviewer">
      <div className="lab-reviewer-head">
        <Inbox size={15} aria-hidden="true" />
        <h2 className="g7-label">Process application · reviewer</h2>
        <span className="lab-sim">SIMULATED</span>
      </div>
      <p className="lab-fine">
        Stands in for the engineer signing in the process application. NOVA cannot sign; a rejection
        is handed back to your inbox as a rework task.
      </p>
      {queue.length === 0 ? (
        <p className="g7-muted">No task is waiting for a signature.</p>
      ) : (
        <ul className="lab-queue">
          {queue.map((t) => (
            <li key={t.id}>
              <strong>{t.name}</strong>
              <span className="lab-ident">{t.process.identificator}</span>
              <label className="g7-label" htmlFor={`c-${t.id}`}>
                Reviewer comment
              </label>
              <input
                id={`c-${t.id}`}
                value={comments[t.id] ?? ''}
                maxLength={1000}
                placeholder="Use plain water instead of glycol and go 2N"
                onChange={(e) => setComments({ ...comments, [t.id]: e.target.value })}
              />
              <div className="lab-queue-actions">
                {t.decisions.map((d) => (
                  <button
                    key={d}
                    className={`button ${/reject/i.test(d) ? 'secondary' : ''}`}
                    disabled={busy}
                    onClick={() => sign(t.id, d, comments[t.id] ?? '')}
                  >
                    {d} as reviewer
                  </button>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Boundary({ state }: { state: LabState }) {
  const reads = state.operations.filter((o) => o.kind === 'read');
  const writes = state.operations.filter((o) => o.kind === 'drive');
  return (
    <details className="lab-card lab-boundary">
      <summary>
        <ShieldCheck size={15} aria-hidden="true" /> Control boundary · {state.specRelease}
      </summary>
      <h3 className="g7-label">Read · automatic</h3>
      <ul>
        {reads.map((o) => (
          <li key={o.operationId}>
            <code>{o.operationId}</code>
          </li>
        ))}
      </ul>
      <h3 className="g7-label">Write · after your approval</h3>
      <ul>
        {writes.map((o) => (
          <li key={o.operationId}>
            <code>{o.operationId}</code> <span>{o.note}</span>
          </li>
        ))}
      </ul>
      <h3 className="g7-label">Human only</h3>
      <p>Signature tasks. FD04 documents them as only doable in the user interface.</p>
      <h3 className="g7-label">Never called</h3>
      <p>
        {state.neverCalled.map((n, i) => (
          <span key={n}>
            {i > 0 && ', '}
            <code>{n}</code>
          </span>
        ))}
      </p>
      <p className="lab-fine">
        Live control needs a reviewed drive contract, a sanctioned credential and an approval path.
        None exists yet, so the lab has no live transport.
      </p>
    </details>
  );
}
