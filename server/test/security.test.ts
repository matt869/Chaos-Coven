import type { AddressInfo } from 'node:net';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import fc from 'fast-check';
import { afterEach, describe, expect, it } from 'vitest';
import { DrillStore } from '../src/drills/drills.js';
import { createApp } from '../src/http/app.js';
import { publicError } from '../src/http/security.js';
import { setup } from './support.js';

let close: (() => void) | undefined;
afterEach(() => close?.());

describe('publicError', () => {
  it('removes internal URLs, paths, container ids and addresses', () => {
    const raw =
      'docker inspect 3f2a9c1e7b4d5a6f failed: HTTP 500 from http://127.0.0.1:8083/__admin/config/db.pool_max at /opt/witching-hour/server/dist/main.js from 10.0.0.4:5432';
    const out = publicError(raw);
    expect(out).not.toMatch(/127\.0\.0\.1|8083|\/opt\/|3f2a9c1e7b4d5a6f|10\.0\.0\.4|main\.js/);
    expect(out.length).toBeLessThanOrEqual(160);
  });

  it('never lets a URL, IPv4 address or long hex id through', () => {
    const noise = fc.stringMatching(/^[a-z ]{0,20}$/);
    const secret = fc.oneof(
      fc.webUrl(),
      fc.ipV4().map((ip) => `${ip}:${8000 + (ip.length % 100)}`),
      fc.stringMatching(/^[0-9a-f]{16,64}$/),
    );
    fc.assert(
      fc.property(noise, secret, noise, (a, s, b) => {
        const out = publicError(`${a} ${s} ${b}`);
        expect(out.includes(s)).toBe(false);
      }),
      { numRuns: 500 },
    );
  });
});

describe('security headers', () => {
  it('sets CSP and hardening headers on pages, long caching on assets, no-store on the API', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'wh-web-'));
    await mkdir(join(dir, 'assets'));
    await writeFile(join(dir, 'index.html'), '<!doctype html><title>x</title>');
    await writeFile(join(dir, 'assets', 'app-abc123.js'), 'console.log(1)');
    const ctx = await setup();
    const server = createApp({ sessions: ctx.sessions, drills: new DrillStore(undefined), grafanaUrl: '/grafana', staticDirs: { web: dir } });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    close = () => server.close();
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const page = await fetch(`${base}/`);
    expect(page.headers.get('content-security-policy')).toMatch(/default-src 'self'/);
    expect(page.headers.get('content-security-policy')).toMatch(/frame-ancestors 'self'/);
    expect(page.headers.get('x-content-type-options')).toBe('nosniff');
    expect(page.headers.get('x-frame-options')).toBe('SAMEORIGIN');
    expect(page.headers.get('referrer-policy')).toBe('no-referrer');
    expect(page.headers.get('x-powered-by')).toBeNull();

    const asset = await fetch(`${base}/assets/app-abc123.js`);
    expect(asset.headers.get('cache-control')).toMatch(/immutable/);

    const api = await fetch(`${base}/api/hauntings`);
    expect(api.headers.get('cache-control')).toBe('no-store');
    expect(api.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('shows players a friendly message when the sandbox is down, not internals', async () => {
    const ctx = await setup();
    ctx.sandbox.failNext('docker.setState');
    await expect(ctx.sessions.start('the-vanishing')).rejects.toMatchObject({ message: expect.not.stringMatching(/injected|docker|http:/) });
  });
});
