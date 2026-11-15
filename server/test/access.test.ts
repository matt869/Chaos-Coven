import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { DrillStore } from '../src/drills/drills.js';
import { COOKIE, createAccessGate, readCookie, safeNext, tokenFor } from '../src/http/access.js';
import { createApp } from '../src/http/app.js';
import { setup } from './support.js';

const CODE = 'moonlit-cauldron-42';
let close: (() => void) | undefined;
afterEach(() => close?.());

async function start() {
  const ctx = await setup();
  let now = 1_800_000_000_000;
  const server = createApp({
    sessions: ctx.sessions,
    drills: new DrillStore(undefined),
    grafanaUrl: '/grafana',
    access: createAccessGate(CODE, () => now),
    mcp: async (_req, res) => void res.writeHead(200).end('mcp-reached'),
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  close = () => server.close();
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const login = (code: string, next = '/') =>
    fetch(`${base}/access`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ code, next }).toString() });
  return { ctx, base, login, advance: (ms: number) => (now += ms) };
}

describe('access gate', () => {
  it('locks pages, API and Grafana until the code is entered', async () => {
    const { base } = await start();
    const page = await fetch(`${base}/daemonwatch/`, { redirect: 'manual' });
    expect(page.status).toBe(303);
    expect(page.headers.get('location')).toBe('/access?next=%2Fdaemonwatch%2F');
    expect((await fetch(`${base}/api/hauntings`)).status).toBe(401);
    expect((await fetch(`${base}/grafana/`, { redirect: 'manual' })).status).toBe(303);
    expect((await fetch(`${base}/api/health`)).status).toBe(200);
    expect(await (await fetch(`${base}/access`)).text()).toMatch(/<label for="code">Access code<\/label>/);
  });

  it('issues an HttpOnly cookie for the right code and then lets requests through', async () => {
    const { base, login } = await start();
    const res = await login(CODE, '/daemonwatch/');
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/daemonwatch/');
    const cookie = res.headers.get('set-cookie')!;
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
    const value = readCookie(cookie, COOKIE)!;
    expect(value).toBe(tokenFor(CODE));
    expect(value).not.toContain(CODE);
    const api = await fetch(`${base}/api/hauntings`, { headers: { cookie: `${COOKIE}=${value}` } });
    expect(api.status).toBe(200);
  });

  it('marks the cookie Secure when it came over HTTPS through the tunnel', async () => {
    const { base } = await start();
    const res = await fetch(`${base}/access`, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-forwarded-proto': 'https' },
      body: `code=${CODE}`,
    });
    expect(res.headers.get('set-cookie')).toMatch(/; Secure/);
  });

  it('rejects wrong codes and forged cookies', async () => {
    const { base, login } = await start();
    const wrong = await login('nope-nope-nope');
    expect(wrong.status).toBe(401);
    expect(wrong.headers.get('set-cookie')).toBeNull();
    const forged = await fetch(`${base}/api/hauntings`, { headers: { cookie: `${COOKIE}=${tokenFor('another-code-123')}` } });
    expect(forged.status).toBe(401);
  });

  it('stops guessing after 10 wrong codes for 10 minutes', async () => {
    const { login, advance } = await start();
    for (let i = 0; i < 10; i++) expect((await login(`wrong-code-${i}`)).status).toBe(401);
    expect((await login(CODE)).status).toBe(429);
    advance(10 * 60 * 1000 + 1);
    expect((await login(CODE)).status).toBe(303);
  });

  it('locks the terminal WebSocket without the cookie', async () => {
    const { base, ctx } = await start();
    const view = await ctx.sessions.start('the-vanishing');
    const ws = new WebSocket(`${base.replace('http', 'ws')}/api/sessions/${view.id}/terminal`);
    const outcome = await new Promise((r) => {
      ws.once('open', () => r('open'));
      ws.once('error', () => r('refused'));
    });
    expect(outcome).toBe('refused');
    await ctx.sessions.end(view.id);
  });

  it('leaves /mcp to its own loopback guard', async () => {
    const { base } = await start();
    expect(await (await fetch(`${base}/mcp`, { method: 'POST' })).text()).toBe('mcp-reached');
  });

  it('refuses a too-short code', () => {
    expect(() => createAccessGate('short')).toThrow(/at least 8/);
  });
});

describe('safeNext', () => {
  it.each([
    ['/daemonwatch/', '/daemonwatch/'],
    ['/?x=1', '/?x=1'],
    ['//evil.example', '/'],
    ['https://evil.example', '/'],
    ['/access', '/'],
    ['javascript:alert(1)', '/'],
    [null, '/'],
  ])('%s -> %s', (input, expected) => {
    expect(safeNext(input)).toBe(expected);
  });
});
