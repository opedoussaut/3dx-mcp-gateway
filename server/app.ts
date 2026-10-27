import express from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { loadConfig, runtimeStatus, type Config } from './config';
import { Gateway, GatewayError } from './gateway';
import { MissionRunner } from './missions';
import { IteropConnector } from './iterop/connector';
import { iteropStatus, loadIteropConfig } from './iterop/config';
import { Orchestrator } from './iterop/orchestrator';
import { EngineError, SyntheticEngine } from './iterop/simulator';
import { labOperations, neverCalled } from './iterop/drive';
import { SPEC } from './iterop/operations';
import {
  createLiveEngine,
  labLiveStatus,
  loadLabLiveConfig,
  probeLive,
  type LabLiveConfig,
} from './iterop/lab-live';
import type { Comparison, Mission } from '../shared/types';
import { benchmarks } from '../shared/benchmarks';
import corpus from '../docs/blueprint/benchmarks/fixtures/synthetic-engineering-corpus.json';
import registry from '../docs/blueprint/registry/api-registry.json';
import iteropFixture from '../docs/blueprint/benchmarks/fixtures/synthetic-iterop.json';

const missionInput = z
  .object({
    prompt: z.string().trim().min(3).max(2000),
    source: z.enum(['synthetic', 'live']),
    mode: z.enum(['ASK', 'INVESTIGATE', 'ACT']),
    domain: z.enum(['ENGINEERING', 'ITEROP']).default('ENGINEERING'),
  })
  .strict();
const score = z.number().int().min(0).max(2).nullable();
const observationInput = z
  .object({
    benchmarkId: z.enum(['B01', 'B02', 'B03', 'B04', 'B05']),
    missionId: z.uuid(),
    aura: z
      .object({
        answer: z.string().trim().min(1).max(20_000),
        citations: z.array(z.string().max(1000)).max(30),
        elapsedSeconds: z.number().positive().max(86400).nullable(),
        release: z.string().trim().min(1).max(100),
        competency: z.string().trim().min(1).max(200),
        sameContext: z.boolean(),
        scores: z.object({ correctness: score, evidence: score, completeness: score }).strict(),
      })
      .strict(),
  })
  .strict();
const labRunInput = z
  .object({
    prompt: z.string().trim().min(3).max(1000),
    approval: z.enum(['each', 'all']).default('each'),
    source: z.enum(['synthetic', 'live']).default('synthetic'),
  })
  .strict();
const labApproveInput = z.object({ stepId: z.uuid(), all: z.boolean().default(false) }).strict();
const labReviewInput = z
  .object({
    taskId: z.string().min(1).max(200),
    decision: z.string().min(1).max(40),
    comment: z.string().max(1000).default(''),
  })
  .strict();
type Lab = { engine: SyntheticEngine; orchestrator: Orchestrator; live?: Orchestrator };
type Session = {
  lab?: Lab;
  missions: Mission[];
  comparisons: Comparison[];
  count: number;
  window: number;
  busy: boolean;
  seen: number;
};
export function createApp(
  config: Config = loadConfig(),
  gateway = new Gateway(config),
  iterop = new IteropConnector(loadIteropConfig()),
  labLive: LabLiveConfig = loadLabLiveConfig(),
  labFetch: typeof fetch = fetch,
) {
  const app = express();
  const sessions = new Map<string, Session>();
  const runner = new MissionRunner(gateway, undefined, iterop);
  const status = () => ({
    ...runtimeStatus(config),
    apps: { ITEROP: iteropStatus(iterop.config) },
  });
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    if (!['localhost', '127.0.0.1', '[::1]'].includes(req.hostname))
      return res.status(403).json({ error: 'HOST_REJECTED' });
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'X-Frame-Options': 'DENY',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    });
    next();
  });
  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (req.headers['sec-fetch-site'] === 'cross-site')
      return res.status(403).json({ error: 'CROSS_SITE_REJECTED' });
    if (req.method !== 'GET') {
      if (
        req.headers.origin !== `http://${req.headers.host}` ||
        !['workspace', 'mcp'].includes(String(req.headers['x-nova-client'])) ||
        !req.is('application/json')
      )
        return res.status(403).json({ error: 'ORIGIN_REJECTED' });
    }
    const cookie = req.headers.cookie
      ?.split(';')
      .map((v) => v.trim())
      .find((v) => v.startsWith('nova-session='))
      ?.slice(13);
    let id = cookie && sessions.has(cookie) ? cookie : undefined;
    if (!id) {
      id = randomUUID();
      if (sessions.size >= 100) sessions.delete(sessions.keys().next().value!);
      sessions.set(id, {
        missions: [],
        comparisons: [],
        count: 0,
        window: Date.now(),
        busy: false,
        seen: Date.now(),
      });
      res.cookie('nova-session', id, { httpOnly: true, sameSite: 'strict', maxAge: 8 * 3600_000 });
    }
    const session = sessions.get(id)!;
    session.seen = Date.now();
    for (const [key, value] of sessions)
      if (Date.now() - value.seen > 8 * 3600_000) sessions.delete(key);
    if (Date.now() - session.window > 60_000) {
      session.count = 0;
      session.window = Date.now();
    }
    if (++session.count > 90)
      return res.status(429).json({ error: 'Too many requests. Try again shortly.' });
    res.locals.session = session;
    next();
  });
  app.use(express.json({ limit: '64kb' }));
  app.get('/api/status', (_req, res) => res.json(status()));
  app.get('/api/benchmarks', (_req, res) => res.json(benchmarks));
  // SYNTHETIC illustration only: no P0 operation returns process steps. A live flow would need
  // the reviewed P1 operation getProcessInfo, which is not admitted.
  app.get('/api/iterop/flows', (_req, res) => {
    const { notice, placements, ...flows } = iteropFixture.flows;
    res.json({ source: 'synthetic', illustration: true, notice, flows, placements });
  });
  // ── Process orchestration lab. Synthetic engine by default; the live engine exists only when a
  // reviewed sandbox contract, gateway origin, API key and Openness Agent are configured. ──
  const liveEngine = createLiveEngine(labLive, labFetch);
  // One sandbox identity, one operator: live runs are shared by the NOVA page and Claude (MCP),
  // so a run Claude prepares can be reviewed and approved in the page. Simulated runs stay per session.
  const liveOrchestrator = liveEngine && new Orchestrator(liveEngine);
  const lab = (session: Session) => {
    if (!session.lab) {
      const engine = new SyntheticEngine();
      session.lab = {
        engine,
        orchestrator: new Orchestrator(engine),
        live: liveOrchestrator,
      };
    }
    return session.lab;
  };
  const fromClaude = (req: express.Request) => req.headers['x-nova-client'] === 'mcp';
  const labState = (l: Lab, source: 'synthetic' | 'live' = 'synthetic') => ({
    source,
    specRelease: SPEC.release,
    operations: Object.values(labOperations),
    neverCalled,
    runs: source === 'live' ? (l.live?.runs ?? []) : l.orchestrator.runs,
    reviewerQueue: source === 'live' ? [] : l.engine.reviewerQueue(),
    live: labLiveStatus(labLive),
  });
  const labError = (res: express.Response, e: unknown) => {
    if (e instanceof EngineError)
      return res
        .status(e.status >= 400 && e.status < 500 ? e.status : 500)
        .json({ error: e.message });
    throw e;
  };
  const owner = (l: Lab, runId: string) =>
    l.live?.runs.some((r) => r.id === runId)
      ? { orchestrator: l.live, source: 'live' as const }
      : { orchestrator: l.orchestrator, source: 'synthetic' as const };
  app.get('/api/lab', (req, res) =>
    res.json(
      labState(
        lab(res.locals.session as Session),
        req.query.source === 'live' ? 'live' : 'synthetic',
      ),
    ),
  );
  app.post('/api/lab/runs', async (req, res) => {
    const parsed = labRunInput.safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({ error: 'Write a command of 3–1,000 characters.' });
    const l = lab(res.locals.session as Session);
    const source = parsed.data.source;
    if (source === 'live' && !l.live)
      return res.status(409).json({
        error: `Live process control is not configured. No request was made. ${labLive.blockers.join(' ')}`,
      });
    try {
      const orchestrator = source === 'live' ? l.live! : l.orchestrator;
      // A Claude client never pre-approves sandbox writes: each one stops as a prepared request.
      const claude = fromClaude(req);
      const approval = claude && source === 'live' ? 'each' : parsed.data.approval;
      const run = await orchestrator.start(
        parsed.data.prompt,
        approval,
        claude ? 'claude' : 'portal',
      );
      res.json({ run, state: labState(l, source) });
    } catch (e) {
      labError(res, e);
    }
  });
  app.post('/api/lab/runs/:id/approve', async (req, res) => {
    const parsed = labApproveInput.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Name the step to approve.' });
    const l = lab(res.locals.session as Session);
    const { orchestrator, source } = owner(l, req.params.id);
    if (fromClaude(req) && source === 'live' && labLive.claudeApproval !== 'client')
      return res.status(403).json({
        error:
          'Sandbox writes are approved by a person in NOVA, not by the Claude client. Open the run in NOVA and press Approve.',
        approveIn: `/lab?source=live&run=${encodeURIComponent(req.params.id)}`,
      });
    try {
      const run = await orchestrator.approve(req.params.id, parsed.data.stepId, parsed.data.all);
      res.json({ run, state: labState(l, source) });
    } catch (e) {
      labError(res, e);
    }
  });
  app.get('/api/lab/runs/:id', (req, res) => {
    const l = lab(res.locals.session as Session);
    const { orchestrator, source } = owner(l, req.params.id);
    try {
      res.json({ run: orchestrator.find(req.params.id), state: labState(l, source) });
    } catch (e) {
      labError(res, e);
    }
  });
  app.post('/api/lab/runs/:id/cancel', (req, res) => {
    const l = lab(res.locals.session as Session);
    const { orchestrator, source } = owner(l, req.params.id);
    try {
      const run = orchestrator.cancel(req.params.id);
      res.json({ run, state: labState(l, source) });
    } catch (e) {
      labError(res, e);
    }
  });
  // Read-only live check of the sandbox models. Makes no write.
  app.post('/api/lab/probe', async (_req, res) => {
    if (!liveEngine)
      return res.status(409).json({
        error: `Live process control is not configured. No request was made. ${labLive.blockers.join(' ')}`,
      });
    res.json(await probeLive(liveEngine));
  });
  // SIMULATED reviewer action in the process application. Not an API NOVA can call on a platform.
  app.post('/api/lab/review', (req, res) => {
    const parsed = labReviewInput.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Choose a task and a decision.' });
    const l = lab(res.locals.session as Session);
    try {
      const task = l.engine.reviewerQueue().find((t) => t.id === parsed.data.taskId);
      if (!task || !task.decisions.includes(parsed.data.decision))
        return res.status(400).json({ error: 'Choose one of the task’s decisions.' });
      l.engine.signAsReviewer(parsed.data.taskId, parsed.data.decision, parsed.data.comment);
      res.json({ state: labState(l) });
    } catch (e) {
      labError(res, e);
    }
  });
  app.get('/api/registry', (_req, res) =>
    res.json(
      registry.tools.map((t) => ({
        id: t.id,
        name: t.semantic_mcp_tool,
        group: t.capability_group,
        kind: t.kind,
        classification: t.classification,
        risk: t.risk_level,
        enabled:
          t.kind === 'LOCAL' ||
          (runtimeStatus(config).liveReady &&
            runtimeStatus(config).allowedTools.includes(t.semantic_mcp_tool as never)),
        status:
          t.kind === 'LOCAL'
            ? 'Implemented locally'
            : config.contract?.operations[
                  t.semantic_mcp_tool as keyof NonNullable<Config['contract']>['operations']
                ] && !config.blockers.length
              ? 'Private binding admitted'
              : 'Pending contract verification',
      })),
    ),
  );
  app.get('/api/missions', (_req, res) => res.json((res.locals.session as Session).missions));
  app.post('/api/missions', async (req, res) => {
    const parsed = missionInput.safeParse(req.body);
    if (!parsed.success)
      return res
        .status(400)
        .json({ error: 'Provide a mission of 3–2,000 characters, a source and a valid mode.' });
    const session = res.locals.session as Session;
    if (session.busy)
      return res.status(409).json({ error: 'A mission is already running in this session.' });
    session.busy = true;
    try {
      const result = await runner.run(
        parsed.data.prompt,
        parsed.data.source,
        parsed.data.mode,
        parsed.data.domain,
      );
      session.missions.unshift(result);
      session.missions = session.missions.slice(0, 50);
      res.json(result);
    } finally {
      session.busy = false;
    }
  });
  app.post('/api/connection/test', async (_req, res) => {
    const status = runtimeStatus(config);
    if (!status.liveReady || !status.allowedTools.includes('get_current_user'))
      return res.status(409).json({
        error:
          'A complete private configuration and a verified get_current_user binding are required. No request was made.',
      });
    try {
      const result = await gateway.call('get_current_user', {}, 'live');
      if (!result.evidence.length)
        return res.status(502).json({ error: 'The identity operation returned no evidence.' });
      res.json({
        ok: true,
        checkedAt: new Date().toISOString(),
        message:
          'The reviewed identity read succeeded. Other operation permissions must still be verified.',
      });
    } catch (e) {
      res
        .status(502)
        .json({ error: e instanceof GatewayError ? e.message : 'Connection test failed.' });
    }
  });
  app.post('/api/apps/:app/test', async (req, res) => {
    const name = req.params.app;
    if (name !== 'ITEROP') return res.status(404).json({ error: 'Unknown application.' });
    const connector = iterop;
    const contract = connector.config.contract;
    if (connector.config.blockers.length || !contract)
      return res.status(409).json({
        error:
          'This application needs its private origin, credential and reviewed contract. No request was made.',
      });
    try {
      const result = await connector.call(contract.probe.operation, {}, 'live');
      res.json({
        ok: true,
        checkedAt: new Date().toISOString(),
        records: result.records.length,
        coverage: result.coverage,
        message: `The reviewed ${contract.probe.operation} read succeeded. Other operations must still be verified individually.`,
      });
    } catch (e) {
      res
        .status(502)
        .json({ error: e instanceof GatewayError ? e.message : 'Connection test failed.' });
    }
  });
  app.get('/api/benchmark-context', (_req, res) => {
    const { negative_cases: _excluded, ...context } = corpus;
    res.set('Content-Disposition', 'attachment; filename="nova-synthetic-context.json"').json({
      ...context,
      note: 'Synthetic source facts and review policy. Provide identical accessible context to each system; no expected answers or scoring assertions included.',
    });
  });
  app.post('/api/comparisons', (req, res) => {
    const parsed = observationInput.safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({
        error: 'Add the AURA answer, release and competency; use valid optional measurements.',
      });
    const session = res.locals.session as Session;
    const nova = session.missions.find((m) => m.id === parsed.data.missionId);
    const benchmark = benchmarks.find((b) => b.id === parsed.data.benchmarkId)!;
    if (!nova || nova.prompt !== benchmark.prompt || nova.mode !== benchmark.mode)
      return res.status(400).json({ error: 'Run the exact selected benchmark mission first.' });
    const result: Comparison = {
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      benchmarkId: parsed.data.benchmarkId,
      nova,
      aura: parsed.data.aura,
      comparability: parsed.data.aura.sameContext
        ? 'Operator declares matched prompt, corpus, permissions and scope; independent verification pending. Single observation, no superiority claim.'
        : 'Unmatched context. Descriptive observation only; performance ranking is not valid.',
      auraMetrics: { toolCalls: null, tokens: null, costUsd: null, visibility: 'NOT_OBSERVABLE' },
    };
    session.comparisons.unshift(result);
    session.comparisons = session.comparisons.slice(0, 20);
    res.status(201).json(result);
  });
  app.get('/api/comparisons', (_req, res) => res.json((res.locals.session as Session).comparisons));
  app.post('/api/session/clear', (_req, res) => {
    const s = res.locals.session as Session;
    if (s.busy)
      return res
        .status(409)
        .json({ error: 'Wait for the active mission before clearing the session.' });
    s.missions = [];
    s.comparisons = [];
    s.lab = undefined;
    res.json({ ok: true });
  });
  app.use('/api', (_req, res) => res.status(404).json({ error: 'API route not found.' }));
  app.use(
    (err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      res
        .status((err as { status?: number }).status === 413 ? 413 : 400)
        .json({ error: 'The request could not be processed.' });
    },
  );
  return app;
}
