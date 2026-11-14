import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { ConfigStore, DEFAULT_CONFIG, type ConfigBackend, type Scalar } from '../src/common/config.js';
import { LIMITS, Toggles } from '../src/common/debug.js';
import { HttpError, Router } from '../src/common/http.js';
import { Limiter, TimeoutError } from '../src/common/limiter.js';
import { createLogger } from '../src/common/log.js';
import { Metrics } from '../src/common/metrics.js';
import { DEFAULT_TOPOLOGY } from '@witching-hour/engine/testing';

const quietLog = createLogger('test', undefined, () => undefined);

function memoryBackend(): ConfigBackend & { rows: Map<string, Scalar> } {
  const rows = new Map<string, Scalar>();
  return {
    rows,
    load: async (s) => Object.fromEntries([...rows].filter(([k]) => k.startsWith(`${s}|`)).map(([k, v]) => [k.split('|')[1]!, v])),
    set: async (s, k, v) => void rows.set(`${s}|${k}`, v),
    unset: async (s, k) => void rows.delete(`${s}|${k}`),
  };
}

describe('Router', () => {
  it('matches params and reports the pattern, not the raw path', async () => {
    const r = new Router().on('GET', '/cart/:id', ({ params }) => ({ status: 200, body: params }));
    const { pattern, response } = await r.handle('GET', '/cart/42', undefined);
    expect(pattern).toBe('/cart/:id');
    expect(response.body).toEqual({ id: '42' });
  });

  it('turns errors into status codes', async () => {
    const r = new Router()
      .on('GET', '/teapot', () => {
        throw new HttpError(418, 'short and stout');
      })
      .on('GET', '/boom', () => {
        throw new Error('kaboom');
      });
    expect((await r.handle('GET', '/teapot', undefined)).response.status).toBe(418);
    expect((await r.handle('GET', '/boom', undefined)).response.status).toBe(500);
    expect((await r.handle('GET', '/nope', undefined)).response.status).toBe(404);
  });
});

describe('Limiter', () => {
  it('times out waiters with the message players search logs for', async () => {
    const l = new Limiter(1);
    const hold = l.run(() => new Promise((r) => setTimeout(r, 100)), 1000);
    await expect(l.run(async () => 1, 10)).rejects.toThrow(TimeoutError);
    await expect(l.run(async () => 1, 10)).rejects.toThrow(/timeout acquiring db connection/);
    await hold;
  });

  it('lets waiters through when resized up', async () => {
    const l = new Limiter(1);
    let release!: () => void;
    const hold = l.run(() => new Promise<void>((r) => (release = r)), 1000);
    const waiting = l.run(async () => 'done', 1000);
    expect(l.stats).toEqual({ inUse: 1, waiting: 1 });
    l.resize(2);
    await expect(waiting).resolves.toBe('done');
    release();
    await hold;
  });

  // Shrinking the limit cannot stop work already running, so the guarantee is about
  // admission: a task only starts while fewer tasks than the current limit are running.
  it('never starts a task while at or above its current limit, even while resized', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 5 }),
        fc.array(
          fc.tuple(
            fc.integer({ min: 0, max: 10 }),
            fc.integer({ min: 0, max: 5 }),
            fc.option(fc.integer({ min: 1, max: 5 }), { nil: undefined }),
          ),
          { minLength: 1, maxLength: 30 },
        ),
        async (initial, tasks) => {
          let running = 0;
          let violated = false;
          const l = new Limiter(initial);
          await Promise.all(
            tasks.map(async ([startAt, ms, resizeTo]) => {
              // Each task arrives at its own moment, so resizes and admissions interleave.
              await new Promise((r) => setTimeout(r, startAt));
              if (resizeTo !== undefined) l.resize(resizeTo);
              await l.run(async () => {
                if (running >= l.size) violated = true;
                running++;
                await new Promise((r) => setTimeout(r, ms));
                running--;
              }, 5000);
            }),
          );
          expect(violated).toBe(false);
          expect(l.stats).toEqual({ inUse: 0, waiting: 0 });
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe('ConfigStore', () => {
  it('returns defaults, overrides and null for unset keys', async () => {
    const store = new ConfigStore('payments', memoryBackend());
    await store.refresh();
    expect(store.get('db.pool_max')).toBe(10);
    expect(store.get('cache.ttl_s')).toBeNull();
    await store.set('db.pool_max', 1);
    expect(store.get('db.pool_max')).toBe(1);
    await store.unset('db.pool_max');
    expect(store.get('db.pool_max')).toBe(10);
  });

  it('persists overrides in the backend, so a restart keeps them', async () => {
    const backend = memoryBackend();
    await new ConfigStore('payments', backend).set('db.pool_max', 1);
    const restarted = new ConfigStore('payments', backend);
    await restarted.refresh();
    expect(restarted.get('db.pool_max')).toBe(1);
  });

  it('notifies listeners of changes seen on refresh', async () => {
    const backend = memoryBackend();
    const store = new ConfigStore('payments', backend);
    await store.refresh();
    const seen: string[] = [];
    store.onChange((k) => seen.push(k));
    await backend.set('payments', 'db.pool_max', 2);
    await store.refresh();
    expect(seen).toEqual(['db.pool_max']);
  });

  it('exports numeric config as witching_config_value', async () => {
    const metrics = new Metrics('payments');
    const store = new ConfigStore('payments', memoryBackend(), metrics);
    await store.set('db.pool_max', 1);
    expect(await metrics.registry.metrics()).toMatch(/witching_config_value\{service="payments",key="db.pool_max"\} 1/);
  });

  it('matches the engine fake sandbox baseline, so tests and the real sandbox agree', () => {
    expect(DEFAULT_CONFIG).toEqual(DEFAULT_TOPOLOGY.config);
  });
});

describe('Toggles', () => {
  it('reports unknown toggles as 404', () => {
    expect(() => new Toggles(quietLog).get('nope')).toThrow(HttpError);
  });

  it('caps the memory leak whatever the haunting asks for', () => {
    const t = new Toggles(quietLog);
    t.leakTick(1000, 10_000);
    expect(t.leakedMb).toBe(LIMITS.leakMaxMb);
  });

  it('frees leaked memory when the leak is turned off', () => {
    const t = new Toggles(quietLog);
    t.set('memory-leak', { enabled: true, settings: { mb_per_minute: 6 } });
    t.leakTick(5, 100);
    expect(t.leakedMb).toBe(5);
    t.set('memory-leak', { enabled: false, settings: {} });
    expect(t.leakedMb).toBe(0);
    t.stop();
  });

  it('round-trips state', () => {
    const t = new Toggles(quietLog);
    t.set('consumer-stall', { enabled: true, settings: { note: 'x' } });
    expect(t.get('consumer-stall')).toEqual({ enabled: true, settings: { note: 'x' } });
    expect(t.enabled('consumer-stall')).toBe(true);
    t.stop();
  });
});

describe('Metrics', () => {
  it('uses the metric names the hauntings query', async () => {
    const m = new Metrics('worker');
    m.observeRequest('/x', 200, 0.01);
    m.jobsProcessed.inc({ service: 'worker' });
    m.queueDepth.set({ queue: 'orders' }, 3);
    const text = await m.registry.metrics();
    for (const name of [
      'http_requests_total',
      'http_request_duration_seconds_bucket',
      'witching_worker_jobs_processed_total',
      'witching_queue_depth',
      'process_resident_memory_bytes',
      'nodejs_heap_size_used_bytes',
    ]) {
      expect(text).toContain(name);
    }
  });
});
