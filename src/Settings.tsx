import { useEffect, useState } from 'react';
import {
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronRight,
  Circle,
  Code2,
  ExternalLink,
  FlaskConical,
  KeyRound,
  Layers3,
  LockKeyhole,
  PlugZap,
  RefreshCw,
  Search,
  ShieldCheck,
  Unplug,
} from 'lucide-react';
import type { AppStatus, RuntimeStatus, Source } from '../shared/types';
import { api } from './api';
import { CopyButton, ErrorNote, Pill, Spinner } from './ui';

const configTemplate =
  '# Keep this in your private .env, outside version control.\nNOVA_TENANT_ORIGIN=https://your-tenant.example\nNOVA_RELEASE=your-exact-release\nNOVA_SECURITY_CONTEXT=your-authorized-context\nNOVA_CONTRACT_FILE=.private/verified-contract.json\nNOVA_AUTH_MODE=bearer\nNOVA_ACCESS_TOKEN=\n';
export function Connections({
  status,
  refresh,
  source,
  setSource,
  onStart,
}: {
  status: RuntimeStatus | null;
  refresh: () => Promise<void>;
  source: Source;
  setSource: (source: Source) => void;
  onStart: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const test = async () => {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await api<{ message: string }>('/connection/test', {});
      setMessage(result.message);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const checks = [
    {
      title: 'Tenant origin',
      detail: 'One fixed HTTPS origin in the private runtime.',
      done: status?.configured,
    },
    {
      title: 'Release-specific public contracts',
      detail: 'Reviewed schemas, permissions, licensing and authentication.',
      done: status?.contractValid,
    },
    {
      title: 'Private authentication',
      detail: 'Credentials stay on the server and out of prompts.',
      done: status?.credentialsPresent,
    },
    {
      title: 'Authorized security context',
      detail: 'Every read uses the configured context.',
      done: status?.securityContextPresent,
    },
  ];
  return (
    <div className="page connection-page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">
            <Unplug size={14} /> CONNECT YOUR WORK
          </div>
          <h1>Your platform. Your boundary.</h1>
          <p>
            Each source connects independently — its own origin, credential, reviewed contract and
            permissions. Nothing live runs until an approved contract is installed.
          </p>
        </div>
        <button className="button secondary" onClick={() => void refresh()}>
          <RefreshCw size={15} /> Refresh status
        </button>
      </div>
      <section className="app-connections" aria-label="Application connections">
        {status?.apps && <AppConnection status={status.apps.ITEROP} />}
      </section>
      <h2 className="section-kicker">Engineering items</h2>
      <div className="connection-options">
        <button
          className={`connection-option ${source === 'synthetic' ? 'selected' : ''}`}
          onClick={() => setSource('synthetic')}
        >
          <div className="connection-option-top">
            <span className="connection-icon synthetic">
              <FlaskConical size={24} />
            </span>
            <span className="radio-indicator">{source === 'synthetic' && <Check size={12} />}</span>
          </div>
          <h2>Synthetic workspace</h2>
          <p>A ready-to-use engineering corpus for exploring missions and testing the workflow.</p>
          <Pill tone="green">
            <span className="status-dot" /> Ready now
          </Pill>
        </button>
        <button
          className={`connection-option ${source === 'live' ? 'selected' : ''}`}
          onClick={() => setSource('live')}
        >
          <div className="connection-option-top">
            <span className="connection-icon platform">
              <Layers3 size={24} />
            </span>
            <span className="radio-indicator">{source === 'live' && <Check size={12} />}</span>
          </div>
          <h2>Engineering platform</h2>
          <p>
            Your tenant, your permissions, and only the public read operations you have verified.
          </p>
          <Pill tone={status?.liveReady ? 'green' : 'orange'}>
            {status?.liveReady ? 'Private bindings configured' : 'Private setup required'}
          </Pill>
        </button>
      </div>
      <div className="connection-detail">
        <section className="setup-panel">
          <div className="section-title">
            <div>
              <h2>Connection readiness</h2>
              <p>
                {status?.release
                  ? `Configured release: ${status.release}`
                  : 'No tenant release configured'}
              </p>
            </div>
            <LockKeyhole size={21} />
          </div>
          <div className="setup-checks">
            {checks.map((check, i) => (
              <div key={check.title}>
                <span className={check.done ? 'check-done' : 'check-pending'}>
                  {check.done ? <CheckCircle2 size={20} /> : <span>{i + 1}</span>}
                </span>
                <div>
                  <strong>{check.title}</strong>
                  <p>{check.detail}</p>
                </div>
                <Pill tone={check.done ? 'green' : 'neutral'}>
                  {check.done ? 'Configured' : 'Needed'}
                </Pill>
              </div>
            ))}
          </div>
          <div className="connection-test">
            <button
              className="button primary"
              disabled={
                busy || !status?.liveReady || !status.allowedTools.includes('get_current_user')
              }
              onClick={() => void test()}
            >
              {busy ? <Spinner /> : <PlugZap size={16} />} Test verified connection
            </button>
            <p>Requires a reviewed identity-read binding. The test makes one read request.</p>
          </div>
          {message && (
            <div className="success-note" role="status">
              <CheckCircle2 size={16} />
              {message}
            </div>
          )}
          {error && <ErrorNote message={error} />}
        </section>
        <section className="private-setup">
          <span className="tiny-label">PRIVATE RUNTIME SETUP</span>
          <h2>Keep access where it belongs.</h2>
          <p>
            Configure the runtime on your machine. The interface never asks you to paste credentials
            into a mission.
          </p>
          <ol>
            <li>
              <strong>Review the API contracts</strong>
              <p>
                Use the official guides for your exact release. Map only supported read operations.
              </p>
            </li>
            <li>
              <strong>Configure your private environment</strong>
              <p>
                Copy <code>.env.example</code> to <code>.env</code> and complete the private
                contract file.
              </p>
            </li>
            <li>
              <strong>Restart NOVA and test</strong>
              <p>The runtime reads configuration at startup. Refresh this page after restarting.</p>
            </li>
          </ol>
          <details className="config-details">
            <summary>
              <Code2 size={15} /> Environment template
              <ChevronRight size={14} />
            </summary>
            <pre>{configTemplate}</pre>
            <CopyButton text={configTemplate} label="Copy template" />
          </details>
          <a
            className="text-button"
            href="https://github.com/opedoussaut/3dx-mcp-gateway/blob/main/docs/CONNECTING.md"
            target="_blank"
            rel="noreferrer"
          >
            Read the connection guide <ExternalLink size={13} />
          </a>
        </section>
      </div>
      {status && status.blockers.length > 0 && (
        <details className="blocker-details">
          <summary>{status.blockers.length} configuration items still needed</summary>
          <ul>
            {status.blockers.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </details>
      )}
      <div className="provider-panel">
        <span className="connection-icon">
          <KeyRound size={21} />
        </span>
        <div>
          <h3>Intelligence routing</h3>
          <p>
            {status?.provider || 'Checking runtime…'} ·{' '}
            {status?.modelReady
              ? 'Optional local intent classification enabled.'
              : 'Known missions use deterministic routing. No model subscription required.'}
          </p>
        </div>
        <Pill>{status?.modelReady ? 'Local model configured' : 'No model egress'}</Pill>
      </div>
      <div className="connection-bottom">
        <span>
          <ShieldCheck size={15} /> Live writes are disabled in every mode.
        </span>
        <button className="button primary" onClick={onStart}>
          Open mission control <ArrowRight size={16} />
        </button>
      </div>
    </div>
  );
}

type ToolRow = {
  id: string;
  name: string;
  group: string;
  kind: string;
  classification: string;
  risk: string;
  enabled: boolean;
  status: string;
};
export function Registry() {
  const [rows, setRows] = useState<ToolRow[]>([]);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [error, setError] = useState('');
  useEffect(() => {
    api<ToolRow[]>('/registry')
      .then(setRows)
      .catch(() => setError('Could not load the tool registry.'));
  }, []);
  const filtered = rows.filter(
    (r) =>
      `${r.name} ${r.group} ${r.id}`.toLowerCase().includes(search.toLowerCase()) &&
      (filter === 'all' || (filter === 'local' ? r.kind === 'LOCAL' : r.kind !== 'LOCAL')),
  );
  return (
    <div className="page registry-page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">
            <Layers3 size={14} /> SEMANTIC GATEWAY
          </div>
          <h1>Every tool has a boundary.</h1>
          <p>
            Purpose-built capabilities with explicit evidence, permissions and release requirements.
          </p>
        </div>
        <Pill tone="green">
          <ShieldCheck size={13} /> Deny by default
        </Pill>
      </div>
      <div className="registry-stats">
        <div>
          <strong>{rows.length || '—'}</strong>
          <span>Candidate capabilities</span>
        </div>
        <div>
          <strong>{rows.filter((r) => r.kind === 'LOCAL').length}</strong>
          <span>Local utilities implemented</span>
        </div>
        <div>
          <strong>{rows.filter((r) => r.enabled && r.kind !== 'LOCAL').length}</strong>
          <span>Live bindings admitted</span>
        </div>
        <div>
          <strong>0</strong>
          <span>Write tools exposed</span>
        </div>
      </div>
      <div className="registry-controls">
        <div role="group" aria-label="Tool type" className="filter-tabs">
          {['all', 'local', 'platform'].map((f) => (
            <button
              aria-pressed={filter === f}
              className={filter === f ? 'active' : ''}
              key={f}
              onClick={() => setFilter(f)}
            >
              {f[0].toUpperCase() + f.slice(1)} tools
            </button>
          ))}
        </div>
        <label className="search-input">
          <Search size={16} />
          <input
            aria-label="Search tools"
            placeholder="Search capabilities…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
      </div>
      <div className="registry-table-wrap">
        <table className="registry-table">
          <thead>
            <tr>
              <th>CAPABILITY</th>
              <th>DOMAIN</th>
              <th>PUBLIC API EVIDENCE</th>
              <th>RISK</th>
              <th>RUNTIME STATUS</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.id}>
                <td>
                  <span>{r.id}</span>
                  <strong>{r.name}</strong>
                </td>
                <td>{r.group.toLowerCase().replaceAll('_', ' ')}</td>
                <td>
                  {r.kind === 'LOCAL'
                    ? 'NOVA local utility'
                    : r.classification.replaceAll('_', ' ').toLowerCase()}
                </td>
                <td>
                  <Pill>{r.risk}</Pill>
                </td>
                <td>
                  <span className={`table-status ${r.enabled ? 'ready' : ''}`}>
                    {r.enabled ? <CheckCircle2 size={14} /> : <Circle size={12} />} {r.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!filtered.length && (
          <div className="empty-state">
            {rows.length ? 'No tools match your search.' : error || 'Loading capabilities…'}
          </div>
        )}
      </div>
      <div className="notice">
        <ShieldCheck size={17} />
        <p>
          Registry classifications record the public research baseline. Private bindings are
          admitted only after release-specific operator review. The synthetic adapters run
          separately and do not count as verified platform integrations.
        </p>
      </div>
    </div>
  );
}

function AppConnection({ status }: { status: AppStatus }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const test = async () => {
    setBusy(true);
    setMessage('');
    setError('');
    try {
      setMessage((await api<{ message: string }>(`/apps/${status.app}/test`, {})).message);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const checks = [
    ['Service origin', status.configured],
    ['Approved credential', status.credentialsPresent],
    ['Reviewed contract', status.contractValid],
  ] as const;
  return (
    <article className="app-connection" aria-label={`${status.label} connection`}>
      <header>
        <div>
          <h2>{status.label}</h2>
          <small>
            Operator diagnostic · ITEROP Business Process API v2 · documented in{' '}
            {status.specRelease}
          </small>
        </div>
        <Pill tone={status.liveReady ? 'green' : 'amber'}>
          {status.liveReady ? 'Live read admitted' : 'Live access blocked'}
        </Pill>
      </header>
      <ul className="app-checks">
        {checks.map(([label, done]) => (
          <li key={label} className={done ? 'done' : ''}>
            {done ? <CheckCircle2 size={15} /> : <Circle size={15} />} {label}
          </li>
        ))}
      </ul>
      <p className="app-finding">{status.accessFinding}</p>
      <details className="app-ops">
        <summary>
          {status.candidateOperations.length} candidate read operations ·{' '}
          {status.allowedOperations.length} admitted
        </summary>
        <ul>
          {status.candidateOperations.map((o) => (
            <li key={o.name}>
              <code>
                {o.operationId} · {o.method} {o.path}
              </code>
              <span>
                {o.name} — {o.description}
              </span>
              <Pill tone={o.status === 'ADMITTED' ? 'green' : 'neutral'}>{o.status}</Pill>
            </li>
          ))}
        </ul>
      </details>
      <div className="connection-test">
        <button
          className="button secondary"
          disabled={busy || !status.liveReady}
          onClick={() => void test()}
        >
          {busy ? <Spinner /> : <PlugZap size={16} />} Test {status.label} read
        </button>
        <p>
          Runs the contract's single probe read. Disabled until an approved contract is admitted.
        </p>
      </div>
      {message && (
        <div className="success-note" role="status">
          <CheckCircle2 size={16} /> {message}
        </div>
      )}
      {error && <ErrorNote message={error} />}
    </article>
  );
}
