import { describe, expect, it } from 'vitest';
import { assertSandboxUrl, JsonHttp, segment, type FetchLike } from '../../src/clients/http.js';
import { HttpQueryClient, parseInstantResult } from '../../src/clients/observability-http.js';
import { ServiceAdminHttpClient } from '../../src/clients/service-admin-http.js';
import { ToxiproxyHttpClient } from '../../src/clients/toxiproxy-http.js';

interface Call {
  method: string;
  url: string;
  body?: unknown;
}

/** A fetch stub that records calls and answers from a route table keyed by "METHOD path". */
function stubFetch(routes: Record<string, { status?: number; body?: unknown }>): { fetch: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  const fetch: FetchLike = async (input, init) => {
    const url = new URL(input);
    const method = init?.method ?? 'GET';
    calls.push({ method, url: url.pathname + url.search, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const route = routes[`${method} ${url.pathname}`];
    const status = route?.status ?? (route ? 200 : 404);
    const text = route?.body === undefined ? null : JSON.stringify(route.body);
    return new Response(status === 204 ? null : text, { status });
  };
  return { fetch, calls };
}

describe('assertSandboxUrl', () => {
  it.each(['http://localhost:8474', 'http://127.0.0.1:9090', 'http://[::1]:3100', 'http://toxiproxy:8474'])(
    'allows %s',
    (url) => expect(() => assertSandboxUrl(url)).not.toThrow(),
  );

  it.each(['http://example.com', 'http://10.0.0.5:8474', 'https://api.prod.internal', 'file:///etc/passwd', 'nope'])(
    'rejects %s',
    (url) => expect(() => assertSandboxUrl(url)).toThrow(),
  );
});

describe('segment', () => {
  it('rejects path traversal and separators', () => {
    expect(() => segment('../admin', 'x')).toThrow();
    expect(() => segment('a/b', 'x')).toThrow();
    expect(segment('wh_the-vanishing_x', 'x')).toBe('wh_the-vanishing_x');
  });
});

describe('JsonHttp', () => {
  it('throws on HTTP errors and returns null for allowed 404s', async () => {
    const { fetch } = stubFetch({ 'GET /boom': { status: 500, body: { error: 'x' } } });
    const http = new JsonHttp('http://localhost:1', { fetch });
    await expect(http.request('GET', '/boom')).rejects.toThrow(/HTTP 500/);
    await expect(http.request('GET', '/missing', undefined, { allow404: true })).resolves.toBeNull();
    await expect(http.request('GET', '/missing')).rejects.toThrow(/HTTP 404/);
  });
});

describe('ToxiproxyHttpClient', () => {
  const toxic = { name: 't1', type: 'latency' as const, stream: 'downstream' as const, toxicity: 1, attributes: { latency: 100, jitter: 0 } };

  it('creates a toxic when it does not exist', async () => {
    const { fetch, calls } = stubFetch({ 'POST /proxies/p1/toxics': { body: toxic } });
    await new ToxiproxyHttpClient('http://localhost:8474', { fetch }).upsertToxic('p1', toxic);
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual(['GET /proxies/p1/toxics/t1', 'POST /proxies/p1/toxics']);
    expect(calls[1]!.body).toEqual(toxic);
  });

  it('updates an existing toxic in place', async () => {
    const { fetch, calls } = stubFetch({
      'GET /proxies/p1/toxics/t1': { body: toxic },
      'POST /proxies/p1/toxics/t1': { body: toxic },
    });
    await new ToxiproxyHttpClient('http://localhost:8474', { fetch }).upsertToxic('p1', {
      ...toxic,
      attributes: { latency: 500, jitter: 0 },
    });
    expect(calls[1]).toEqual({
      method: 'POST',
      url: '/proxies/p1/toxics/t1',
      body: { toxicity: 1, attributes: { latency: 500, jitter: 0 } },
    });
  });

  it('recreates a toxic whose stream changed', async () => {
    const { fetch, calls } = stubFetch({
      'GET /proxies/p1/toxics/t1': { body: toxic },
      'DELETE /proxies/p1/toxics/t1': { status: 204 },
      'POST /proxies/p1/toxics': { body: toxic },
    });
    await new ToxiproxyHttpClient('http://localhost:8474', { fetch }).upsertToxic('p1', { ...toxic, stream: 'upstream' });
    expect(calls.map((c) => c.method)).toEqual(['GET', 'DELETE', 'POST']);
  });

  it('treats deleting a missing toxic as success', async () => {
    const { fetch } = stubFetch({});
    await expect(new ToxiproxyHttpClient('http://localhost:8474', { fetch }).deleteToxic('p1', 't1')).resolves.toBeUndefined();
  });

  it('returns null for a missing toxic', async () => {
    const { fetch } = stubFetch({});
    await expect(new ToxiproxyHttpClient('http://localhost:8474', { fetch }).getToxic('p1', 't1')).resolves.toBeNull();
  });
});

describe('ServiceAdminHttpClient', () => {
  it('reads, writes and unsets config', async () => {
    const { fetch, calls } = stubFetch({
      'GET /__admin/config/pool.size': { body: { value: 10 } },
      'PUT /__admin/config/pool.size': { status: 204 },
    });
    const c = new ServiceAdminHttpClient({ cart: 'http://localhost:8082' }, { fetch });
    expect(await c.getConfig('cart', 'pool.size')).toBe(10);
    expect(await c.getConfig('cart', 'unset.key')).toBeNull();
    await c.setConfig('cart', 'pool.size', 2);
    await c.unsetConfig('cart', 'pool.size');
    expect(calls.slice(2).map((x) => `${x.method} ${x.url} ${JSON.stringify(x.body)}`)).toEqual([
      'PUT /__admin/config/pool.size {"value":2}',
      'DELETE /__admin/config/pool.size undefined',
    ]);
  });

  it('reads and writes debug toggles', async () => {
    const { fetch, calls } = stubFetch({
      'GET /__debug/memory-leak': { body: { enabled: true, settings: { mb: 5 } } },
      'PUT /__debug/memory-leak': { status: 204 },
    });
    const c = new ServiceAdminHttpClient({ worker: 'http://localhost:8084' }, { fetch });
    expect(await c.getToggle('worker', 'memory-leak')).toEqual({ enabled: true, settings: { mb: 5 } });
    await c.setToggle('worker', 'memory-leak', { enabled: false, settings: {} });
    expect(calls[1]!.body).toEqual({ enabled: false, settings: {} });
  });

  it('refuses services with no configured URL', async () => {
    const c = new ServiceAdminHttpClient({});
    await expect(c.getConfig('postgres', 'x')).rejects.toThrow(/No admin URL/);
  });

  it('refuses non-sandbox URLs at construction', () => {
    expect(() => new ServiceAdminHttpClient({ cart: 'https://cart.example.com' })).toThrow(/non-sandbox/);
  });
});

describe('parseInstantResult', () => {
  const ok = (resultType: string, result: unknown) => ({ status: 'success' as const, data: { resultType: resultType as 'vector', result } });

  it('reads a single-series vector', () => {
    expect(parseInstantResult('prometheus', 'q', ok('vector', [{ metric: {}, value: [1, '42.5'] }]))).toBe(42.5);
  });

  it('returns null for an empty vector', () => {
    expect(parseInstantResult('prometheus', 'q', ok('vector', []))).toBeNull();
  });

  it('reads scalars and special values', () => {
    expect(parseInstantResult('prometheus', 'q', ok('scalar', [1, '+Inf']))).toBe(Infinity);
    expect(Number.isNaN(parseInstantResult('prometheus', 'q', ok('scalar', [1, 'NaN'])))).toBe(true);
  });

  it('rejects multi-series results and log streams', () => {
    const two = [
      { metric: { a: '1' }, value: [1, '1'] },
      { metric: { a: '2' }, value: [1, '2'] },
    ];
    expect(() => parseInstantResult('prometheus', 'q', ok('vector', two))).toThrow(/Wrap it in sum/);
    expect(() => parseInstantResult('loki', 'q', ok('streams', []))).toThrow(/metric query/);
  });

  it('surfaces query errors', () => {
    expect(() => parseInstantResult('loki', 'q', { status: 'error', error: 'parse error' })).toThrow(/parse error/);
  });
});

describe('HttpQueryClient', () => {
  it('sends Prometheus and Loki queries to their own APIs', async () => {
    const body = { status: 'success', data: { resultType: 'vector', result: [{ metric: {}, value: [1, '3'] }] } };
    const { fetch, calls } = stubFetch({ 'GET /api/v1/query': { body }, 'GET /loki/api/v1/query': { body } });
    const q = new HttpQueryClient({ prometheus: 'http://localhost:9090', loki: 'http://localhost:3100' }, { fetch });
    expect(await q.query('prometheus', 'sum(up{job="worker"})')).toBe(3);
    expect(await q.query('loki', 'sum(count_over_time({service="worker"}[2m]))')).toBe(3);
    expect(calls[0]!.url).toBe(`/api/v1/query?query=${encodeURIComponent('sum(up{job="worker"})')}`);
    expect(calls[1]!.url.startsWith('/loki/api/v1/query?query=')).toBe(true);
  });
});
