import { SyntheticEngine } from '../../server/iterop/simulator';
import { labContractSchema, type LabLiveConfig } from '../../server/iterop/lab-live';

export const ORIGIN = 'https://sandbox-apigateway.example.test';
export const contract = {
  schemaVersion: 1,
  purpose: 'NOVA_ORCHESTRATION_LAB',
  tenantClass: 'SANDBOX',
  dataPolicy: 'SYNTHETIC_ONLY',
  specRelease: 'R2026x-FD04',
  specSha256: '90212fe7b2a1740e39952178faa06422d177c71ff65e7ddb3ce908d294f6326e',
  apiVersion: '2.0.0',
  gatewayBasePath: '/api/businessprocess/v2',
  processKeys: { 'syn-cooling-chain': 'tenantCoolingChain' },
  driveApproval: {
    approvedBy: 'Sandbox owner',
    approvedOn: '2026-10-08',
    operations: ['startProcess', 'completeTask'],
  },
  reviewedBy: 'NOVA lab',
  verifiedAt: '2026-10-08',
};
export const config = (over: Partial<typeof contract> = {}): LabLiveConfig => ({
  origin: ORIGIN,
  apiKey: 'test-api-key',
  agent: Buffer.from('agent-id:agent-secret').toString('base64'),
  contract: labContractSchema.parse({ ...contract, ...over }),
  claudeApproval: 'portal',
  blockers: [],
});
export type Call = { url: URL; method: string; headers: Record<string, string>; body?: unknown };
export const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });

/**
 * A gateway double backed by the synthetic engine: translates documented FD04 calls under the
 * gateway base path, records every request, and sets a session cookie on the first call.
 */
export function gatewayDouble(opts: { expectedFields?: boolean } = {}) {
  const engine = new SyntheticEngine();
  const calls: Call[] = [];
  const toLab = (k: string) => (k === 'tenantCoolingChain' ? 'syn-cooling-chain' : k);
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const headers = init?.headers as Record<string, string>;
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, method: init?.method ?? 'GET', headers, body });
    const cookie: Record<string, string> =
      calls.length === 1 ? { 'Set-Cookie': 'GWSESSION=abc; Path=/; HttpOnly' } : {};
    const path = url.pathname.replace('/api/businessprocess/v2', '');
    let m: RegExpMatchArray | null;
    try {
      if (path === '/repository/processes/startable/list') {
        const list = engine.getAllStartableProcesses();
        return json(
          {
            responses: list.responses.map((p) => ({
              ...p,
              key: p.key === 'syn-cooling-chain' ? 'tenantCoolingChain' : p.key,
            })),
          },
          200,
          cookie,
        );
      }
      if ((m = path.match(/^\/repository\/processes\/([^/]+)\/basic$/)))
        return json(engine.getBasicProcessInfo(toLab(decodeURIComponent(m[1]))), 200, cookie);
      if ((m = path.match(/^\/repository\/processes\/([^/]+)$/)) && init?.method === 'GET') {
        const { definition } = await import('../../server/iterop/chain');
        const d = definition(toLab(decodeURIComponent(m[1])))!;
        return json({
          key: m[1],
          name: d.name,
          humanTasks: [...d.tasks, ...(d.rework ? [d.rework] : [])].map((t) => ({
            id: t.id,
            name: t.name,
            outputs:
              opts.expectedFields === false ? [] : t.expectedFields.map((f) => ({ id: f.id })),
          })),
          variables: Object.fromEntries(
            d.startVariables.map((v) => [v.id, { id: v.id, type: v.type }]),
          ),
        });
      }
      if (path === '/runtime/tasks') return json(engine.getTasksByUser(), 200, cookie);
      if ((m = path.match(/^\/runtime\/tasks\/([^/]+)$/)) && init?.method === 'GET')
        return json(engine.getTaskInstanceInformations(decodeURIComponent(m[1])));
      if ((m = path.match(/^\/runtime\/instances\/([^/]+)$/)))
        return json(engine.getInstanceInfo(decodeURIComponent(m[1])));
      if ((m = path.match(/^\/runtime\/processes\/([^/]+)$/)) && init?.method === 'POST') {
        engine.startProcess(toLab(decodeURIComponent(m[1])), body);
        return new Response(null, { status: 201 });
      }
      if ((m = path.match(/^\/runtime\/tasks\/([^/]+)$/)) && init?.method === 'POST') {
        engine.completeTask(decodeURIComponent(m[1]), body);
        return new Response(null, { status: 200 });
      }
    } catch (e) {
      const status = (e as { status?: number }).status ?? 500;
      return json({ code: status, message: (e as Error).message }, status);
    }
    return json({ code: 404, message: 'unknown route' }, 404);
  };
  return { engine, calls, fetcher };
}
