import express from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { loadConfig, runtimeStatus, type Config } from './config';
import { Gateway, GatewayError } from './gateway';
import { MissionRunner } from './missions';
import { AppConnector } from './apps/connector';
import { appStatus, loadAppConfig } from './apps/config';
import type { AppDomain } from '../shared/types';
import type { Comparison, Mission } from '../shared/types';
import { benchmarks } from '../shared/benchmarks';
import corpus from '../docs/blueprint/benchmarks/fixtures/synthetic-engineering-corpus.json';
import registry from '../docs/blueprint/registry/api-registry.json';

const missionInput = z
  .object({
    prompt: z.string().trim().min(3).max(2000),
    source: z.enum(['synthetic', 'live']),
    mode: z.enum(['ASK', 'INVESTIGATE', 'ACT']),
    domain: z.enum(['ENGINEERING', 'ITEROP', 'DATASET_CATALOG']).default('ENGINEERING'),
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
type Session = {
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
  apps: Record<AppDomain, AppConnector> = {
    ITEROP: new AppConnector(loadAppConfig('ITEROP')),
    DATASET_CATALOG: new AppConnector(loadAppConfig('DATASET_CATALOG')),
  },
) {
  const app = express();
  const sessions = new Map<string, Session>();
  const runner = new MissionRunner(gateway, undefined, apps);
  const status = () => ({
    ...runtimeStatus(config),
    apps: {
      ITEROP: appStatus(apps.ITEROP.config),
      DATASET_CATALOG: appStatus(apps.DATASET_CATALOG.config),
    },
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
        req.headers['x-nova-client'] !== 'workspace' ||
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
    if (name !== 'ITEROP' && name !== 'DATASET_CATALOG')
      return res.status(404).json({ error: 'Unknown application.' });
    const connector = apps[name];
    const contract = connector.config.contract;
    if (connector.config.blockers.length || !contract)
      return res.status(409).json({
        error:
          'This application needs its private origin, credential and reviewed contract. No request was made.',
      });
    try {
      const result = await connector.call(
        contract.probe.operation,
        contract.probe.query ? { query: contract.probe.query } : {},
        'live',
      );
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
