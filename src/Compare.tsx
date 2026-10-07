import { useEffect, useState } from 'react';
import {
  ArrowRight,
  Check,
  Download,
  FlaskConical,
  GitCompareArrows,
  Info,
  Play,
  Save,
  Sparkles,
} from 'lucide-react';
import { benchmarks } from '../shared/benchmarks';
import type { AuraObservation, Comparison, Mission, Source } from '../shared/types';
import { api, downloadJson, duration } from './api';
import { CopyButton, ErrorNote, NovaMark, Pill, Result, Spinner } from './ui';

const emptyAura = (): AuraObservation => ({
  answer: '',
  citations: [],
  elapsedSeconds: null,
  release: '',
  competency: '',
  sameContext: false,
  scores: { correctness: null, evidence: null, completeness: null },
});
export function CompareView({
  source,
  setSource,
  onMission,
}: {
  source: Source;
  setSource: (source: Source) => void;
  onMission: (mission: Mission) => void;
}) {
  const [selected, setSelected] = useState(benchmarks[0].id);
  const [nova, setNova] = useState<Mission | null>(null);
  const [aura, setAura] = useState<AuraObservation>(emptyAura);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState<Comparison | null>(null);
  const [records, setRecords] = useState<Comparison[]>([]);
  const benchmark = benchmarks.find((b) => b.id === selected)!;
  useEffect(() => {
    api<Comparison[]>('/comparisons')
      .then(setRecords)
      .catch(() => setError('Could not load saved observations.'));
  }, []);
  useEffect(() => {
    setNova(null);
    setAura(emptyAura());
    setSaved(null);
    setError('');
  }, [selected, source]);
  const patch = (next: Partial<AuraObservation>) => {
    setAura((a) => ({ ...a, ...next }));
    setSaved(null);
  };
  const run = async () => {
    setBusy(true);
    setError('');
    setSaved(null);
    try {
      const result = await api<Mission>('/missions', {
        prompt: benchmark.prompt,
        mode: benchmark.mode,
        source,
      });
      setNova(result);
      onMission(result);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const save = async () => {
    if (!nova) return;
    setSaving(true);
    setError('');
    try {
      const result = await api<Comparison>('/comparisons', {
        benchmarkId: selected,
        missionId: nova.id,
        aura,
      });
      setSaved(result);
      setRecords((r) => [result, ...r].slice(0, 20));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="page compare-page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">
            <GitCompareArrows size={14} /> BENCHMARK LAB
          </div>
          <h1>Same mission. Clear evidence.</h1>
          <p>Compare NOVA and AURA on work that matters. Measure what you can observe.</p>
        </div>
        <Pill tone="orange">Observation workspace</Pill>
      </div>
      <div className="benchmark-layout">
        <aside className="benchmark-menu">
          <span className="tiny-label">MISSION LIBRARY</span>
          {benchmarks.map((b) => (
            <button
              key={b.id}
              disabled={busy || saving}
              className={selected === b.id ? 'selected' : ''}
              onClick={() => setSelected(b.id)}
            >
              <span>{b.id}</span>
              <div>
                <strong>{b.title}</strong>
                <small>{b.mode.toLowerCase()}</small>
              </div>
              <ArrowRight size={14} />
            </button>
          ))}
          <div className="benchmark-tip">
            <FlaskConical size={21} />
            <strong>A fair comparison starts here.</strong>
            <p>
              Use the same prompt, accessible corpus, permissions and configuration. One observation
              cannot establish overall superiority.
            </p>
            <a className="text-button" href="/api/benchmark-context" download>
              <Download size={14} /> Synthetic context pack
            </a>
          </div>
        </aside>
        <section className="benchmark-workspace">
          <div className="benchmark-brief">
            <div>
              <Pill>{benchmark.id}</Pill>
              <label className="source-select">
                <span className="sr-only">Benchmark data source</span>
                <select
                  disabled={busy || saving}
                  aria-label="Benchmark data source"
                  value={source}
                  onChange={(e) => setSource(e.target.value as Source)}
                >
                  <option value="synthetic">Synthetic workspace</option>
                  <option value="live">My engineering platform</option>
                </select>
              </label>
              <CopyButton text={benchmark.prompt} />
            </div>
            <h2>{benchmark.title}</h2>
            <p>{benchmark.prompt}</p>
          </div>
          <div className="comparison-panes">
            <section className="comparison-pane nova-pane">
              <div className="pane-heading">
                <div>
                  <NovaMark small />
                  <h2>NOVA</h2>
                  <Pill>Measured locally</Pill>
                </div>
                <button
                  className="button primary small-button"
                  disabled={busy || saving}
                  onClick={() => void run()}
                >
                  {busy ? <Spinner /> : <Play size={13} />} {nova ? 'Run again' : 'Run mission'}
                </button>
              </div>
              {nova ? (
                <Result mission={nova} compact />
              ) : (
                <div className="comparison-empty">
                  <Sparkles size={30} strokeWidth={1.3} />
                  <h3>Your engineering companion</h3>
                  <p>
                    Run the selected mission to capture the answer, source evidence and runtime
                    measurements.
                  </p>
                  <span>
                    {busy
                      ? 'Mission in progress…'
                      : source === 'synthetic'
                        ? 'Synthetic corpus · no platform calls'
                        : 'Verified private read bindings required'}
                  </span>
                </div>
              )}
            </section>
            <section className="comparison-pane aura-pane">
              <div className="pane-heading">
                <div>
                  <span className="aura-mark">
                    <Sparkles size={17} />
                  </span>
                  <h2>AURA</h2>
                  <Pill>Manual observation</Pill>
                </div>
              </div>
              <div className="aura-form">
                <p className="field-help">
                  Run this prompt in your AURA environment, then record the visible result here.
                </p>
                <label>
                  AURA response
                  <textarea
                    rows={7}
                    maxLength={20000}
                    aria-label="AURA response"
                    placeholder="Paste the answer exactly as AURA returned it…"
                    value={aura.answer}
                    onChange={(e) => patch({ answer: e.target.value })}
                  />
                </label>
                <div className="form-grid">
                  <label>
                    Release
                    <input
                      placeholder="e.g. R2026x FD04"
                      aria-label="AURA release"
                      maxLength={100}
                      value={aura.release}
                      onChange={(e) => patch({ release: e.target.value })}
                    />
                  </label>
                  <label>
                    Competency
                    <input
                      placeholder="Competency used"
                      aria-label="AURA competency"
                      maxLength={200}
                      value={aura.competency}
                      onChange={(e) => patch({ competency: e.target.value })}
                    />
                  </label>
                </div>
                <div className="form-grid">
                  <label>
                    Observed time <span>seconds</span>
                    <input
                      type="number"
                      min="0.001"
                      step="any"
                      max="86400"
                      aria-label="AURA elapsed seconds"
                      placeholder="Not measured"
                      value={aura.elapsedSeconds ?? ''}
                      onChange={(e) =>
                        patch({
                          elapsedSeconds: e.target.value === '' ? null : Number(e.target.value),
                        })
                      }
                    />
                  </label>
                  <label>
                    Source references <span>one per line</span>
                    <textarea
                      rows={2}
                      aria-label="AURA source references"
                      placeholder="Visible citations or record IDs"
                      value={aura.citations.join('\n')}
                      onChange={(e) =>
                        patch({ citations: e.target.value ? e.target.value.split('\n') : [] })
                      }
                    />
                  </label>
                </div>
              </div>
            </section>
          </div>
          <div className="measurement-panel">
            <div className="section-title">
              <h2>What the observation tells us</h2>
              <Pill>No inferred metrics</Pill>
            </div>
            <table className="metrics-table">
              <thead>
                <tr>
                  <th>MEASURE</th>
                  <th>NOVA</th>
                  <th>AURA</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th>Answer latency</th>
                  <td>
                    {nova ? duration(nova.metrics.elapsedMs) : 'Not run'}{' '}
                    <small>{nova && 'server runtime'}</small>
                  </td>
                  <td>
                    {aura.elapsedSeconds === null ? 'Not measured' : `${aura.elapsedSeconds} s`}{' '}
                    <small>{aura.elapsedSeconds !== null && 'operator observed'}</small>
                  </td>
                </tr>
                <tr>
                  <th>Tool calls</th>
                  <td>{nova?.metrics.toolCalls ?? 'Not run'}</td>
                  <td className="muted">Not observable</td>
                </tr>
                <tr>
                  <th>Input / output tokens</th>
                  <td>
                    {nova
                      ? `${nova.metrics.inputTokens ?? 'Unknown'} / ${nova.metrics.outputTokens ?? 'Unknown'}`
                      : 'Not run'}
                  </td>
                  <td className="muted">Not observable</td>
                </tr>
                <tr>
                  <th>Total compute cost</th>
                  <td className="muted">Not measured</td>
                  <td className="muted">Not observable</td>
                </tr>
                <tr>
                  <th>Platform writes</th>
                  <td>{nova?.metrics.writes ?? 'Not run'}</td>
                  <td className="muted">Not independently verified</td>
                </tr>
              </tbody>
            </table>
            <p className="measurement-note">
              <Info size={14} /> Local runtime and manually timed interaction use different timing
              boundaries. Model tokens, infrastructure cost and AURA blue tokens are distinct
              quantities.
            </p>
            <details className="rubric">
              <summary>
                Optional human assessment{' '}
                <span>0 = unsupported · 1 = partial · 2 = meets criterion</span>
              </summary>
              <p>
                Score the AURA answer against the supplied task and evidence. These are operator
                judgements, not automated quality measurements.
              </p>
              <div className="rubric-grid">
                {(['correctness', 'evidence', 'completeness'] as const).map((key) => (
                  <label key={key}>
                    {key}
                    <select
                      aria-label={`AURA ${key} score`}
                      value={aura.scores[key] ?? ''}
                      onChange={(e) =>
                        patch({
                          scores: {
                            ...aura.scores,
                            [key]: e.target.value === '' ? null : Number(e.target.value),
                          },
                        })
                      }
                    >
                      <option value="">Not assessed</option>
                      <option value="0">0 — Unsupported</option>
                      <option value="1">1 — Partial</option>
                      <option value="2">2 — Meets criterion</option>
                    </select>
                  </label>
                ))}
              </div>
            </details>
            <label className="context-check">
              <input
                type="checkbox"
                checked={aura.sameContext}
                onChange={(e) => patch({ sameContext: e.target.checked })}
              />
              <span>
                I confirm that both runs used the same prompt, accessible corpus, permissions and
                configuration scope.
                <small>
                  Leave unchecked to record an unmatched observation without a performance ranking.
                </small>
              </span>
            </label>
            <div className="comparison-actions">
              <span>
                {saved ? (
                  <>
                    <Check size={15} /> Observation saved for this session
                  </>
                ) : (
                  'Export observations to retain them after the server restarts.'
                )}
              </span>
              <div>
                {saved && (
                  <button
                    className="button secondary"
                    onClick={() => downloadJson(`nova-aura-${saved.id}.json`, saved)}
                  >
                    <Download size={15} /> Export JSON
                  </button>
                )}
                <button
                  className="button primary"
                  disabled={
                    !nova ||
                    !aura.answer.trim() ||
                    !aura.release.trim() ||
                    !aura.competency.trim() ||
                    busy ||
                    saving
                  }
                  onClick={() => void save()}
                >
                  {saving ? <Spinner /> : <Save size={15} />} Save observation
                </button>
              </div>
            </div>
            {saved && <div className="notice">{saved.comparability}</div>}
            {error && <ErrorNote message={error} />}
          </div>
          {!!records.length && (
            <div className="saved-observations">
              <h2>
                Recorded observations <span>{records.length}</span>
              </h2>
              {records.map((r) => (
                <div key={r.id}>
                  <span>
                    <strong>{r.benchmarkId}</strong> {new Date(r.createdAt).toLocaleString()}{' '}
                    <Pill>{r.nova.source}</Pill>
                  </span>
                  <button
                    className="text-button"
                    onClick={() => downloadJson(`nova-aura-${r.id}.json`, r)}
                  >
                    <Download size={14} /> Export observation
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
