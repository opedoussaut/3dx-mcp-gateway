import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { get } from 'node:http';
import { createApp } from '../server/app';
import { loadConfig } from '../server/config';
import { benchmarks } from '../shared/benchmarks';

test('HTTP workflow isolates sessions, validates origins and preserves unknown AURA metrics', async () => {
  const server = createApp(loadConfig({})).listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  let cookie = '';
  const request = async (path: string, data?: unknown, extra: Record<string, string> = {}) => {
    const res = await fetch(origin + '/api' + path, {
      method: data === undefined ? 'GET' : 'POST',
      headers: {
        Origin: origin,
        'X-Nova-Client': 'workspace',
        'Content-Type': 'application/json',
        Cookie: cookie,
        ...extra,
      },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    });
    cookie ||= res.headers.get('set-cookie')?.split(';')[0] || '';
    return res;
  };
  try {
    const status = await (await request('/status')).json();
    assert.equal(status.liveReady, false);
    assert.equal(status.apps.ITEROP.liveReady, false);
    assert.equal(status.apps.DATASET_CATALOG.liveReady, false);
    const process = await (
      await request('/missions', {
        prompt: 'Show the tasks assigned to me',
        source: 'synthetic',
        mode: 'ASK',
        domain: 'ITEROP',
      })
    ).json();
    assert.equal(process.domain, 'ITEROP');
    assert.equal(process.status, 'completed');
    assert.equal(
      (
        await request('/missions', {
          prompt: 'Show my tasks',
          source: 'synthetic',
          mode: 'ASK',
          domain: 'OTHER',
        })
      ).status,
      400,
    );
    assert.equal((await request('/apps/ITEROP/test', {})).status, 409);
    assert.equal((await request('/apps/DATASET_CATALOG/test', {})).status, 409);
    assert.equal((await request('/apps/UNKNOWN/test', {})).status, 404);
    await request('/session/clear', {});
    const b = benchmarks[0];
    const mission = await (
      await request('/missions', { prompt: b.prompt, source: 'synthetic', mode: b.mode })
    ).json();
    assert.equal(mission.status, 'completed');
    assert.equal((await (await request('/missions')).json()).length, 1);
    assert.equal(
      (
        await request(
          '/missions',
          { prompt: b.prompt, source: 'synthetic', mode: b.mode },
          { Origin: 'https://attacker.example' },
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await request(
          '/missions',
          { prompt: b.prompt, source: 'synthetic', mode: b.mode },
          { 'X-Nova-Client': '' },
        )
      ).status,
      403,
    );
    const rejectedHost = await new Promise<number | undefined>((resolve, reject) => {
      get(origin + '/api/status', { headers: { Host: 'attacker.example' } }, (res) => {
        res.resume();
        resolve(res.statusCode);
      }).on('error', reject);
    });
    assert.equal(rejectedHost, 403);
    assert.equal(
      (await request('/missions', { prompt: 'x', source: 'anything', mode: 'ACT' })).status,
      400,
    );
    assert.equal((await request('/connection/test', {})).status, 409);
    assert.equal((await (await fetch(origin + '/api/missions')).json()).length, 0);
    const aura = {
      answer: 'TEST OBSERVATION, NOT A REAL AURA RUN',
      citations: [],
      elapsedSeconds: null,
      release: 'test',
      competency: 'test',
      sameContext: false,
      scores: { correctness: null, evidence: null, completeness: null },
    };
    const recorded = await request('/comparisons', {
      benchmarkId: b.id,
      missionId: mission.id,
      aura,
    });
    assert.equal(recorded.status, 201);
    const comparison = await recorded.json();
    assert.equal(comparison.auraMetrics.tokens, null);
    assert.equal(comparison.auraMetrics.costUsd, null);
    assert.match(comparison.comparability, /Unmatched/);
    assert.equal(
      (await request('/comparisons', { benchmarkId: 'B02', missionId: mission.id, aura })).status,
      400,
    );
    const context = await (await request('/benchmark-context')).json();
    assert.equal(context.negative_cases, undefined);
    assert.ok(context.objects.length);
    await request('/session/clear', {});
    assert.equal((await (await request('/missions')).json()).length, 0);
    assert.equal((await (await request('/comparisons')).json()).length, 0);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  }
});
