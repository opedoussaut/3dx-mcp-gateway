import { Check, Copy, Download, FileText, LoaderCircle, ShieldCheck, Sparkles } from 'lucide-react';
import { useState } from 'react';
import type { Evidence, Mission } from '../shared/types';
import { downloadJson, duration } from './api';

export function NovaMark({ small = false }: { small?: boolean }) {
  return (
    <span className={`nova-mark ${small ? 'small' : ''}`} aria-hidden="true">
      <Sparkles size={small ? 17 : 23} strokeWidth={1.7} />
    </span>
  );
}
export function Pill({
  children,
  tone = 'neutral',
}: {
  children: React.ReactNode;
  tone?: 'neutral' | 'green' | 'orange';
}) {
  return <span className={`pill ${tone}`}>{children}</span>;
}
export function Spinner() {
  return <LoaderCircle size={17} className="spin" aria-hidden="true" />;
}
export function ErrorNote({ message }: { message: string }) {
  return (
    <div className="error-note" role="alert">
      {message}
    </div>
  );
}
export function CopyButton({ text, label = 'Copy prompt' }: { text: string; label?: string }) {
  const [state, setState] = useState('');
  return (
    <button
      className="button secondary small-button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setState('Copied');
        } catch {
          setState('Copy unavailable');
        }
        setTimeout(() => setState(''), 2500);
      }}
    >
      {state === 'Copied' ? <Check size={14} /> : <Copy size={14} />} {state || label}
    </button>
  );
}
export function EvidenceCard({ record }: { record: Evidence }) {
  return (
    <details className="evidence-card">
      <summary>
        <span className="evidence-icon">
          <FileText size={16} />
        </span>
        <span>
          <strong>{record.title}</strong>
          <small>{record.id}</small>
        </span>
      </summary>
      <dl>
        {Object.entries(record.fields).map(([key, value]) => (
          <div key={key}>
            <dt>{key}</dt>
            <dd>{value === null ? 'Unknown' : String(value)}</dd>
          </div>
        ))}
      </dl>
      <div className="evidence-foot">
        {record.source === 'synthetic' ? 'Synthetic fixture' : 'Platform read'} ·{' '}
        {new Date(record.retrievedAt).toLocaleTimeString()}
      </div>
    </details>
  );
}
export function Result({ mission, compact = false }: { mission: Mission; compact?: boolean }) {
  const good = mission.status === 'completed' || mission.status === 'prepared';
  return (
    <div className={`result ${compact ? 'compact-result' : ''}`}>
      <div className="result-heading">
        <div className="assistant-name">
          <NovaMark small />
          <strong>NOVA</strong>
          <span>{mission.mode.toLowerCase()}</span>
        </div>
        <Pill tone={good ? 'green' : 'orange'}>{mission.status.replaceAll('_', ' ')}</Pill>
      </div>
      <h2>{mission.title}</h2>
      <p className="answer">{mission.answer}</p>
      {!!mission.findings.length && (
        <ul className="findings">
          {mission.findings.map((finding, i) => (
            <li key={i}>
              <span className="finding-dot" />
              <span>{finding}</span>
            </li>
          ))}
        </ul>
      )}
      {mission.draft && (
        <div className="draft-card">
          <div>
            <FileText size={20} />
            <strong>Component review draft</strong>
            <Pill>Local only</Pill>
          </div>
          <p>
            {mission.draft.object} · {mission.draft.evidenceRefs.length} evidence references
          </p>
          <button
            className="button secondary"
            onClick={() => downloadJson(`nova-draft-${mission.draft!.id}.json`, mission.draft)}
          >
            <Download size={15} /> Export draft
          </button>
          <small>The digest detects changes. It is not an approval or a commit token.</small>
        </div>
      )}
      <div className="result-footer">
        <span>
          <ShieldCheck size={14} /> {mission.metrics.writes} platform writes
        </span>
        <span>{duration(mission.metrics.elapsedMs)} runtime</span>
        <span>{mission.metrics.toolCalls} tool calls</span>
        <button
          className="text-button"
          onClick={() => downloadJson(`nova-mission-${mission.id}.json`, mission)}
        >
          <Download size={13} /> Export
        </button>
      </div>
      {!compact && (
        <details className="trace">
          <summary>
            How NOVA reached this result <span>{mission.trace.length} steps</span>
          </summary>
          <ol>
            {mission.trace.map((step, i) => (
              <li key={i}>
                <span className="trace-number">{i + 1}</span>
                <div>
                  <strong>{step.label}</strong>
                  <p>{step.detail}</p>
                </div>
                <small>{duration(step.durationMs)}</small>
              </li>
            ))}
          </ol>
        </details>
      )}
    </div>
  );
}
