import {
  ArrowRight,
  Ban,
  BadgeCheck,
  Calculator,
  CheckCircle2,
  CircleDashed,
  ClipboardCheck,
  Eye,
  FileLock2,
  Fingerprint,
  History,
  KeyRound,
  ListChecks,
  Lock,
  MessageSquareText,
  PenLine,
  RotateCcw,
  Route,
  ServerCog,
  ShieldCheck,
  UserCheck,
  Workflow,
} from 'lucide-react';
import type { ReactNode } from 'react';

/**
 * "How it works" — a plain-language explanation of the lab for non-specialists.
 * Static copy only: it describes what the code does, and dates what was proven live.
 */
const flow = [
  {
    icon: MessageSquareText,
    who: 'You',
    title: 'Ask in plain English',
    text: '“Configure the cooling chain for 1.2 MW, 32 °C water, 16 racks, N+1.”',
  },
  {
    icon: Route,
    who: 'Claude + NOVA',
    title: 'Understands and plans',
    text: 'Claude understands the request; NOVA reads the process in ITEROP and lays out the steps.',
  },
  {
    icon: Calculator,
    who: 'NOVA',
    title: 'Does the calculations',
    text: 'Runs the engineering tools for each step and prepares the answers.',
  },
  {
    icon: UserCheck,
    who: 'You',
    title: 'Approve each change',
    text: 'Nothing is written to ITEROP until you press Approve.',
  },
  {
    icon: PenLine,
    who: 'Engineer',
    title: 'Signs off in ITEROP',
    text: 'A qualified engineer reviews and signs. NOVA cannot sign.',
  },
];

const roles = [
  {
    icon: MessageSquareText,
    name: 'You — the operator',
    text: 'State what you need, approve or refuse each change NOVA prepares.',
  },
  {
    icon: Workflow,
    name: 'Claude + NOVA — the orchestrator',
    text: 'Claude, signed in with your own account, understands the request. NOVA turns it into process steps, runs the tools, enforces the rules and keeps the trace.',
  },
  {
    icon: ClipboardCheck,
    name: 'ITEROP — the system of record',
    text: 'Holds the official process, its tasks, who did what and when.',
  },
  {
    icon: PenLine,
    name: 'Engineer — the authority',
    text: 'Accepts or rejects the result. A rejection returns to NOVA as rework.',
  },
];

const can = [
  'See which processes it may start, which tasks are waiting and where a run stands',
  'Start a process and fill in its own tasks — only after your approval',
  'Pick up a run where it stopped, and redo the work when an engineer rejects it',
  'Tell you clearly when it is blocked or missing information, instead of guessing',
];
const never = [
  'Sign or approve on an engineer’s behalf',
  'Reassign, stop, delete or deploy processes, or change anyone’s rights',
  'Touch a process that is not on its approved list',
  'Use your personal login, password or browser session',
];

const security: { icon: typeof Lock; title: string; text: string }[] = [
  {
    icon: Fingerprint,
    title: 'Its own identity, with minimal rights',
    text: 'NOVA works under a dedicated non-administrator account that may only run the lab processes. The platform itself refuses this kind of access for administrator accounts. Everything it does appears in ITEROP under that name.',
  },
  {
    icon: KeyRound,
    title: 'Only through the official front door',
    text: 'All traffic goes over HTTPS through the platform’s API Gateway, with an API key and a registered agent. No screen scraping, no borrowed browser cookies, no hidden or undocumented addresses.',
  },
  {
    icon: ListChecks,
    title: 'A short allow-list, checked by code',
    text: 'NOVA can call only a handful of operations from the published API specification — read, start, complete. Operations such as delete, reassign, deploy or change rights are not implemented: NOVA has no way to call them.',
  },
  {
    icon: UserCheck,
    title: 'A person approves every change',
    text: 'Each write is shown as “prepared — not submitted” until you approve it. Sign-off tasks stay human in ITEROP: NOVA has no way to sign.',
  },
  {
    icon: ShieldCheck,
    title: 'Rules sit outside the AI',
    text: 'What NOVA is allowed to do is decided by fixed server rules and a reviewed lab contract, not by Claude or the wording of a request. Claude chooses among NOVA’s actions; it cannot add new ones, pick the engine or approve sandbox writes.',
  },
  {
    icon: FileLock2,
    title: 'Secrets stay on this computer',
    text: 'The API key and agent secret live in a local file that is never published, never sent to the browser or to Claude, and never pasted in a chat. This page only shows whether each one is set.',
  },
  {
    icon: ServerCog,
    title: 'Not exposed to the network',
    text: 'The lab runs on this machine only (127.0.0.1). Nobody else on the network can reach it.',
  },
  {
    icon: Ban,
    title: 'Fails safe',
    text: 'If access is refused, NOVA stops and says so — it never tries another identity or route. Unexpected answers from the platform are rejected rather than guessed at.',
  },
  {
    icon: History,
    title: 'Traceable and revocable',
    text: 'Every call is listed in the run trace, and ITEROP keeps its own history. Disabling the agent or the API key in the platform cuts NOVA off immediately.',
  },
  {
    icon: Lock,
    title: 'Test data only',
    text: 'The lab uses an invented cooling process on a sandbox tenant that can be wiped at any time. No customer or production data is involved.',
  },
];

const proven: { done: boolean; text: string }[] = [
  {
    done: true,
    text: 'Connected to a sandbox tenant through the API Gateway — read-only test PASS',
  },
  { done: true, text: 'Listed the processes NOVA is allowed to start' },
  {
    done: true,
    text: 'Started a real process instance (COOL-001) from a prompt — visible in ITEROP, started by NOVA’s own account',
  },
  {
    done: true,
    text: 'Every change held for approval; the full flow, including rework, runs on the simulated engine',
  },
  {
    done: false,
    text: 'Next: complete all steps of a live run and have an engineer sign it in ITEROP',
  },
  {
    done: true,
    text: 'Claude connected through MCP: it reads and prepares sandbox work, while each write still waits for a person in NOVA (tested against a gateway simulation)',
  },
  {
    done: false,
    text: 'Next: the first live run driven from Claude Desktop, signed off in ITEROP',
  },
];

export default function LabExplainer({ tryIt }: { tryIt: () => void }) {
  return (
    <div className="lab-explain">
      <section className="lab-card lab-explain-hero" aria-labelledby="ex-oneline">
        <p className="g7-label">In one sentence</p>
        <h2 id="ex-oneline">
          You describe the engineering work in plain English. NOVA carries it through the official
          business process in ITEROP — and a person stays in control of every change.
        </h2>
        <div className="lab-explain-keys">
          <Key icon={<MessageSquareText size={18} />} title="One request">
            replaces a sequence of manual forms and hand-offs
          </Key>
          <Key icon={<UserCheck size={18} />} title="Nothing is sent">
            to ITEROP without a person’s approval
          </Key>
          <Key icon={<PenLine size={18} />} title="Sign-off stays human">
            the engineer decides, NOVA never signs
          </Key>
        </div>
      </section>

      <section className="lab-card" aria-labelledby="ex-flow">
        <h2 id="ex-flow" className="lab-explain-h">
          How a request flows
        </h2>
        <ol className="lab-flow">
          {flow.map((s, i) => (
            <li key={s.title}>
              <span className="lab-flow-icon" aria-hidden="true">
                <s.icon size={20} />
              </span>
              <span className="lab-flow-who">
                {i + 1} · {s.who}
              </span>
              <strong>{s.title}</strong>
              <span className="lab-flow-text">{s.text}</span>
              {i < flow.length - 1 && (
                <ArrowRight className="lab-flow-arrow" size={16} aria-hidden="true" />
              )}
            </li>
          ))}
        </ol>
        <p className="lab-flow-loop">
          <RotateCcw size={15} aria-hidden="true" />
          If the engineer rejects the result, ITEROP sends a rework task back. NOVA reads the
          engineer’s comment, recalculates and resubmits — again only with your approval.
        </p>
      </section>

      <section className="lab-card" aria-labelledby="ex-arch">
        <h2 id="ex-arch" className="lab-explain-h">
          Architecture at a glance
        </h2>
        <a className="lab-arch" href="/architecture.svg" target="_blank" rel="noreferrer">
          <img
            src="/architecture.svg"
            width={1200}
            height={720}
            alt="Claude, signed in with your account, calls NOVA's MCP server. It calls the local NOVA server, which plans the steps, applies the rules and holds every write for your approval. NOVA reaches the sandbox ITEROP through the API Gateway with an API key and its own robot account; an engineer signs off in ITEROP Play. Signing, reassigning, stopping, deleting, deploying and changing rights are never possible."
          />
        </a>
        <p className="lab-fine">Open the diagram full size in a new tab.</p>
      </section>

      <section className="lab-card" aria-labelledby="ex-roles">
        <h2 id="ex-roles" className="lab-explain-h">
          Who does what
        </h2>
        <ul className="lab-roles">
          {roles.map((r) => (
            <li key={r.name}>
              <r.icon size={18} aria-hidden="true" />
              <strong>{r.name}</strong>
              <span>{r.text}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="lab-card" aria-labelledby="ex-bounds">
        <h2 id="ex-bounds" className="lab-explain-h">
          What NOVA can — and can never — do
        </h2>
        <div className="lab-bounds">
          <div>
            <h3 className="lab-bounds-can">
              <CheckCircle2 size={16} aria-hidden="true" /> Can
            </h3>
            <ul>
              {can.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="lab-bounds-never">
              <Ban size={16} aria-hidden="true" /> Can never
            </h3>
            <ul>
              {never.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section className="lab-card" aria-labelledby="ex-claude">
        <h2 id="ex-claude" className="lab-explain-h">
          Where Claude fits
        </h2>
        <p className="lab-explain-lead">
          You talk to Claude with your own Claude account (for example Claude Desktop). NOVA plugs
          into Claude as a connector (MCP) and gives it a small set of process actions: list
          processes and tasks, configure the cooling chain, change an input, continue a run, handle
          rework. Claude decides which action answers your request and explains the result in plain
          language.
        </p>
        <ul className="lab-roles">
          <li>
            <MessageSquareText size={18} aria-hidden="true" />
            <strong>Claude brings the intelligence</strong>
            <span>
              It understands free-form requests in any language, asks for missing values, chains
              several actions and summarises what happened.
            </span>
          </li>
          <li>
            <ShieldCheck size={18} aria-hidden="true" />
            <strong>NOVA keeps control</strong>
            <span>
              Claude can only use NOVA’s actions. Each write stops as “prepared”; by default it is
              approved by a person on this page, never by Claude. The run appears here with a link
              Claude gives you.
            </span>
          </li>
        </ul>
      </section>

      <section className="lab-card" aria-labelledby="ex-secure">
        <h2 id="ex-secure" className="lab-explain-h">
          Why it is secure
        </h2>
        <p className="lab-explain-lead">
          NOVA is treated like a new team member with a badge that opens only a few doors: its own
          identity, the minimum rights, the official entrance, and a supervisor who approves each
          action.
        </p>
        <ul className="lab-secure">
          {security.map((s) => (
            <li key={s.title}>
              <s.icon size={18} aria-hidden="true" />
              <strong>{s.title}</strong>
              <span>{s.text}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="lab-card" aria-labelledby="ex-example">
        <h2 id="ex-example" className="lab-explain-h">
          The test process
        </h2>
        <p className="lab-explain-lead">
          A neutral “liquid cooling configuration” chain for a group of server racks, modelled in
          ITEROP: operating envelope → select coolant → size coolant distribution units → configure
          the secondary loop → check system limits → engineering sign-off, with a rework loop. The
          calculations are deliberately simple and illustrative — they show the orchestration, not
          certified engineering values.
        </p>
      </section>

      <section className="lab-card" aria-labelledby="ex-proven">
        <h2 id="ex-proven" className="lab-explain-h">
          What has been proven
        </h2>
        <ul className="lab-proven">
          {proven.map((p) => (
            <li key={p.text} className={p.done ? 'done' : 'next'}>
              {p.done ? (
                <BadgeCheck size={17} aria-label="Done" />
              ) : (
                <CircleDashed size={17} aria-label="Not yet" />
              )}
              <span>{p.text}</span>
            </li>
          ))}
        </ul>
        <p className="lab-fine">
          Status as of 8 October 2026. Typed directly on this page, requests are read by fixed,
          auditable rules. Through Claude, the language understanding is Claude’s; the actions it
          can take, and the approvals, stay NOVA’s.
        </p>
      </section>

      <section className="lab-card lab-explain-try" aria-labelledby="ex-try">
        <div>
          <h2 id="ex-try" className="lab-explain-h">
            See it for yourself
          </h2>
          <p className="lab-explain-lead">
            The simulated engine runs the whole flow on this computer, with no platform access.
          </p>
        </div>
        <button className="button" onClick={tryIt}>
          <Eye size={15} /> Try an example
        </button>
      </section>
    </div>
  );
}

function Key({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="lab-explain-key">
      <span aria-hidden="true">{icon}</span>
      <strong>{title}</strong>
      <small>{children}</small>
    </div>
  );
}
