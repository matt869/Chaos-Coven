import { createServer } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { formatHeader, sign } from '../src/proxy-auth.mjs';
import { createBackend, gameServerUrl, routePath } from '../src/server.mjs';

const SECRET = 'test-secret-0123456789';
const NOW = 1_800_000_000;
const DRILL = '00000000-0000-4000-8000-000000000001';
let servers = [];
afterEach(() => {
  for (const s of servers) s.close();
  servers = [];
});

const listen = (s) =>
  new Promise((r) => {
    servers.push(s);
    s.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${s.address().port}`));
  });

async function start() {
  const seen = [];
  const game = createServer(async (req, res) => {
    let body = '';
    for await (const c of req) body += c;
    seen.push({ method: req.method, url: req.url, body });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ forwarded: req.url }));
  });
  const target = await listen(game);
  const base = await listen(createBackend({ secret: SECRET, target, now: () => NOW }));
  const call = (method, path, body = '', opts = {}) => {
    const ts = opts.ts ?? NOW;
    const secret = opts.secret ?? SECRET;
    return fetch(base + path, {
      method,
      headers: { 'content-type': 'application/json', 'x-crew-proxy': formatHeader(ts, sign(secret, ts, method, path, body)) },
      body: body === '' ? undefined : body,
    });
  };
  return { base, call, seen };
}

describe('Daemonwatch backend', () => {
  it('answers /health without a signature', async () => {
    const { base } = await start();
    expect((await fetch(`${base}/health`)).status).toBe(200);
  });

  it('forwards signed drill calls to the game server', async () => {
    const { call, seen } = await start();
    const body = JSON.stringify({ player: 'sam' });
    expect((await call('POST', `/api/drills/${DRILL}/start`, body)).status).toBe(200);
    expect(seen).toEqual([{ method: 'POST', url: `/api/drills/${DRILL}/start`, body }]);
  });

  it('accepts the gateway prefix and strips it when forwarding', async () => {
    const { call, seen } = await start();
    expect((await call('GET', '/apps/daemonwatch/api/drills')).status).toBe(200);
    expect(seen[0].url).toBe('/api/drills');
  });

  it('rejects unsigned, mis-signed and stale requests before forwarding', async () => {
    const { call, base, seen } = await start();
    expect((await fetch(`${base}/api/drills`)).status).toBe(401);
    expect((await call('GET', '/api/drills', '', { secret: 'wrong-secret-0123456789' })).status).toBe(401);
    expect((await call('GET', '/api/drills', '', { ts: NOW - 61 })).status).toBe(401);
    expect(seen).toEqual([]);
  });

  it('only forwards the drills API', async () => {
    const { call, seen } = await start();
    expect((await call('POST', '/api/sessions')).status).toBe(404);
    expect((await call('DELETE', '/api/hauntings')).status).toBe(404);
    expect((await call('GET', '/api/drills/not-a-uuid')).status).toBe(404);
    expect(seen).toEqual([]);
  });

  it('only talks to a game server on this machine', () => {
    expect(gameServerUrl({})).toBe('http://127.0.0.1:4000');
    expect(() => gameServerUrl({ DAEMONWATCH_GAME_SERVER_URL: 'http://example.com:4000' })).toThrow(/loopback/);
    expect(routePath('/apps/daemonwatch/api/drills')).toBe('/api/drills');
  });
});
