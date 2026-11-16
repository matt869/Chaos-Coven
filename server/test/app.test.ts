import type { AddressInfo } from 'node:net';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { DrillStore, validateDrill } from '../src/drills/drills.js';
import { createApp } from '../src/http/app.js';
import { setup } from './support.js';

let close: (() => void) | undefined;
afterEach(() => close?.());

async function start() {
  const ctx = await setup();
  const drills = new DrillStore(join(await mkdtemp(join(tmpdir(), 'wh-drills-')), 'drills.json'));
  const server = createApp({ sessions: ctx.sessions, drills, grafanaUrl: 'http://127.0.0.1:3000' });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  close = () => server.close();
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const api = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(base + path, {
      method,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as Record<string, any> };
  };
  return { ...ctx, drills, base, api };
}

describe('HTTP API', () => {
  it('lists hauntings without spoilers', async () => {
    const { api } = await start();
    const { body } = await api('GET', '/api/hauntings');
    expect((body as unknown as { id: string }[]).map((h) => h.id).sort()).toEqual(['possessed-config', 'slow-whisper', 'the-vanishing']);
    expect(JSON.stringify(body)).not.toMatch(/target|faultType|rootCause/);
  });

  it('plays a session over HTTP', async () => {
    const { api } = await start();
    const s = await api('POST', '/api/sessions', { hauntingId: 'the-vanishing', player: 'sam' });
    expect(s.status).toBe(201);
    const id = s.body.id as string;
    expect((await api('POST', `/api/sessions/${id}/command`, { line: 'haunt status' })).body.ok).toBe(true);
    expect((await api('POST', `/api/sessions/${id}/diagnose`, { component: 'worker', summary: 'stopped worker' })).status).toBe(200);
    expect((await api('POST', `/api/sessions/${id}/verify`)).body.pass).toBe(false);
    expect((await api('GET', `/api/sessions/${id}/postmortem`)).status).toBe(409);
    const pm = await api('POST', `/api/sessions/${id}/end`);
    expect(pm.body.hauntingId).toBe('the-vanishing');
    expect((await api('GET', `/api/sessions/${id}/postmortem`)).status).toBe(200);
  });

  it('returns clear errors', async () => {
    const { api } = await start();
    expect((await api('POST', '/api/sessions', {})).status).toBe(400);
    expect((await api('POST', '/api/sessions', { hauntingId: 'nope' })).status).toBe(404);
    expect((await api('GET', '/api/sessions/nope')).status).toBe(404);
    expect((await api('GET', '/api/unknown')).status).toBe(404);
  });

  it('runs the terminal over a WebSocket', async () => {
    const { api, base } = await start();
    const id = (await api('POST', '/api/sessions', { hauntingId: 'the-vanishing' })).body.id as string;
    const ws = new WebSocket(`${base.replace('http', 'ws')}/api/sessions/${id}/terminal`);
    await new Promise((r) => ws.once('open', r));
    const reply = new Promise<Record<string, unknown>>((r) => ws.once('message', (d) => r(JSON.parse(String(d)))));
    ws.send(JSON.stringify({ type: 'command', line: 'haunt restart worker; rm -rf /' }));
    expect(await reply).toMatchObject({ type: 'output', ok: false });
    ws.close();
    await api('POST', `/api/sessions/${id}/end`);
  });

  it('schedules a drill, runs it for a player and records the result', async () => {
    const { api } = await start();
    const created = await api('POST', '/api/drills', {
      hauntingId: 'the-vanishing',
      team: 'Payments squad',
      players: ['sam', 'ana'],
      scheduledFor: '2026-12-01T10:00:00Z',
    });
    expect(created.status).toBe(201);
    const drillId = created.body.id as string;
    expect((await api('POST', `/api/drills/${drillId}/start`, { player: 'mallory' })).status).toBe(400);
    const s = await api('POST', `/api/drills/${drillId}/start`, { player: 'sam' });
    await api('POST', `/api/sessions/${s.body.id}/end`);
    await new Promise((r) => setTimeout(r, 20));
    const drill = await api('GET', `/api/drills/${drillId}`);
    expect(drill.body.results).toMatchObject([{ player: 'sam', maxScore: 100 }]);
    expect((await api('DELETE', `/api/drills/${drillId}`)).body.status).toBe('cancelled');
    expect((await api('POST', `/api/drills/${drillId}/start`, { player: 'ana' })).status).toBe(409);
  });
});

describe('public play without an access code', () => {
  // Through Caddy or a tunnel, every request carries a forwarding header.
  const visitor = (base: string) => {
    let cookie = '';
    const call = async (method: string, path: string, body?: unknown) => {
      const headers: Record<string, string> = { 'x-forwarded-for': '203.0.113.7', 'x-forwarded-proto': 'https' };
      if (body !== undefined) headers['content-type'] = 'application/json';
      if (cookie) headers.cookie = cookie;
      const res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
      const set = res.headers.get('set-cookie');
      if (set) cookie = set.split(';')[0]!;
      return { status: res.status, body: (await res.json()) as Record<string, any>, setCookie: set };
    };
    return { call, cookie: () => cookie };
  };

  it('gives the shift only to the browser that started it', async () => {
    const { base } = await start();
    const alice = visitor(base);
    const bob = visitor(base);

    const s = await alice.call('POST', '/api/sessions', { hauntingId: 'the-vanishing' });
    expect(s.status).toBe(201);
    expect(s.setCookie).toMatch(/^wh_shift=[0-9a-f]{64}; Path=\/api\/sessions; HttpOnly; SameSite=Strict; Secure$/);
    const id = s.body.id as string;

    // Alice can play and pick the shift up again after a reload.
    expect((await alice.call('GET', '/api/sessions/active')).body.id).toBe(id);
    expect((await alice.call('POST', `/api/sessions/${id}/command`, { line: 'haunt status' })).body.ok).toBe(true);

    // Bob sees nothing, can't touch it, and is told someone is on call.
    expect((await bob.call('GET', '/api/sessions/active')).body).toBeNull();
    for (const [method, path, body] of [
      ['GET', `/api/sessions/${id}`],
      ['POST', `/api/sessions/${id}/command`, { line: 'haunt status' }],
      ['POST', `/api/sessions/${id}/hint`],
      ['POST', `/api/sessions/${id}/diagnose`, { component: 'worker', summary: 'x' }],
      ['POST', `/api/sessions/${id}/verify`],
      ['POST', `/api/sessions/${id}/end`],
      ['GET', `/api/sessions/${id}/postmortem`],
    ] as const) {
      expect((await bob.call(method, path, body)).status, `${method} ${path}`).toBe(403);
    }
    const busy = await bob.call('POST', '/api/sessions', { hauntingId: 'slow-whisper' });
    expect(busy.status).toBe(409);
    expect(busy.body.error).toMatch(/Someone else is on call right now/);

    // A guessed cookie doesn't work either.
    const mallory = await fetch(`${base}/api/sessions/${id}`, { headers: { 'x-forwarded-for': '203.0.113.9', cookie: `wh_shift=${'0'.repeat(64)}` } });
    expect(mallory.status).toBe(403);

    expect((await alice.call('POST', `/api/sessions/${id}/end`)).status).toBe(200);
    expect((await alice.call('GET', `/api/sessions/${id}/postmortem`)).status).toBe(200);
    // Once it's over, Bob can take the pager.
    expect((await bob.call('POST', '/api/sessions', { hauntingId: 'slow-whisper' })).status).toBe(201);
  });

  it("refuses another visitor's terminal WebSocket", async () => {
    const { base } = await start();
    const alice = visitor(base);
    const id = (await alice.call('POST', '/api/sessions', { hauntingId: 'the-vanishing' })).body.id as string;
    const open = (headers: Record<string, string>) =>
      new Promise<boolean>((r) => {
        const ws = new WebSocket(`${base.replace('http', 'ws')}/api/sessions/${id}/terminal`, { headers });
        ws.once('open', () => (ws.close(), r(true)));
        ws.once('error', () => r(false));
      });
    expect(await open({ 'x-forwarded-for': '203.0.113.8' })).toBe(false);
    expect(await open({ 'x-forwarded-for': '203.0.113.7', cookie: alice.cookie() })).toBe(true);
    await alice.call('POST', `/api/sessions/${id}/end`);
  });
});

describe('Grafana proxy', () => {
  it('forwards /grafana/* to Grafana on the same origin', async () => {
    const { createServer } = await import('node:http');
    const seen: string[] = [];
    const grafana = createServer((req, res) => {
      seen.push(`${req.method} ${req.url}`);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"database":"ok"}');
    });
    await new Promise<void>((r) => grafana.listen(0, '127.0.0.1', r));
    const ctx = await setup();
    const server = createApp({
      sessions: ctx.sessions,
      drills: new DrillStore(undefined),
      grafanaUrl: '/grafana',
      grafanaUpstream: `http://127.0.0.1:${(grafana.address() as AddressInfo).port}`,
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    close = () => {
      server.close();
      grafana.close();
    };
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const res = await fetch(`${base}/grafana/api/health?x=1`);
    expect(await res.json()).toEqual({ database: 'ok' });
    expect(seen).toEqual(['GET /grafana/api/health?x=1']);
    expect(((await fetch(`${base}/api/config`).then((r) => r.json())) as { grafanaUrl: string }).grafanaUrl).toBe('/grafana');
  });

  it('answers 502 when Grafana is down', async () => {
    const ctx = await setup();
    const server = createApp({ sessions: ctx.sessions, drills: new DrillStore(undefined), grafanaUrl: '/grafana', grafanaUpstream: 'http://127.0.0.1:9' });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    close = () => server.close();
    const res = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/grafana/`);
    expect(res.status).toBe(502);
  });
});

describe('validateDrill', () => {
  const known = ['the-vanishing'];
  const good = { hauntingId: 'the-vanishing', team: 'Team', players: ['a'], scheduledFor: '2026-12-01T10:00:00Z' };
  it('accepts a valid drill', () => expect(validateDrill(good, known).players).toEqual(['a']));
  it.each([
    ['unknown haunting', { ...good, hauntingId: 'x' }],
    ['no players', { ...good, players: [] }],
    ['duplicate players', { ...good, players: ['a', 'a'] }],
    ['bad date', { ...good, scheduledFor: 'tomorrow-ish' }],
    ['markup in team name', { ...good, team: '<script>' }],
  ])('rejects %s', (_why, input) => expect(() => validateDrill(input, known)).toThrow());
});
