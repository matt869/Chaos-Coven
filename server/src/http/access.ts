import { createHmac, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * Optional access code for hosting without Cloudflare Access (for example a Cloudflare
 * Quick Tunnel, which has no login of its own). When WH_ACCESS_CODE is set, every page,
 * API call, terminal WebSocket and the Grafana proxy needs a cookie that is only issued
 * after entering the code. Unset, nothing changes (local play).
 */
export const COOKIE = 'wh_access';
const MAX_AGE_SECONDS = 12 * 60 * 60;
const MAX_FAILURES = 10;
const FAILURE_WINDOW_MS = 10 * 60 * 1000;

export interface AccessGate {
  /** True when the request may continue. Otherwise it has already been answered. */
  check(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<boolean>;
  /** For WebSocket upgrades: true when the cookie is valid. */
  allowsUpgrade(req: IncomingMessage): boolean;
}

/** The cookie value: an HMAC of a fixed label, keyed with the code. Changing the code logs everyone out. */
export function tokenFor(code: string): string {
  return createHmac('sha256', code).update('witching-hour-access-v1').digest('hex');
}

export function readCookie(header: string | undefined, name: string): string | undefined {
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i !== -1 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return undefined;
}

function sameSecret(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Only relative, same-site paths are allowed as a post-login destination. */
export function safeNext(next: string | null | undefined): string {
  return next && /^\/(?!\/)[\w\-./?=&%#]*$/.test(next) && !next.startsWith('/access') ? next : '/';
}

const page = (message: string, next: string) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark light"><title>Witching Hour: access code</title>
<style>
body{margin:0;min-height:100vh;display:grid;place-items:center;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;background:#0e0b16;color:#ece7f6}
@media (prefers-color-scheme: light){body{background:#f8f6fc;color:#1d1530}}
form{width:min(360px,90vw);display:grid;gap:12px}
h1{margin:0;font-size:1.4rem}
label{font-weight:600}
input{font:inherit;padding:10px;border-radius:8px;border:1px solid #3a2f52;background:transparent;color:inherit}
button{font:inherit;padding:10px;border-radius:8px;border:0;background:#c084fc;color:#1a0b2e;font-weight:600;cursor:pointer}
:focus-visible{outline:3px solid #c084fc;outline-offset:2px}
.msg{color:#f87171;min-height:1.2em;margin:0}
</style></head><body>
<form method="post" action="/access">
<h1>Witching Hour</h1>
<p>This shift is invite-only. Enter the access code you were given.</p>
<label for="code">Access code</label>
<input id="code" name="code" type="password" autocomplete="current-password" required autofocus>
<input type="hidden" name="next" value="${next.replace(/[^\w\-./?=&%#]/g, '')}">
<button type="submit">Start my shift</button>
<p class="msg" role="alert">${message}</p>
</form></body></html>`;

export function createAccessGate(code: string, clock: () => number = Date.now): AccessGate {
  if (code.length < 8) throw new Error('WH_ACCESS_CODE must be at least 8 characters');
  const token = tokenFor(code);
  const failures = new Map<string, number[]>();

  const authorized = (req: IncomingMessage) => sameSecret(readCookie(req.headers.cookie, COOKIE) ?? '', token);
  const clientId = (req: IncomingMessage) => String(req.headers['cf-connecting-ip'] ?? req.socket.remoteAddress ?? 'unknown');
  const recentFailures = (id: string) => (failures.get(id) ?? []).filter((t) => clock() - t < FAILURE_WINDOW_MS);
  const isHttps = (req: IncomingMessage) => req.headers['x-forwarded-proto'] === 'https' || String(req.headers['cf-visitor'] ?? '').includes('https');

  const html = (res: ServerResponse, status: number, body: string) => {
    res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(body);
  };

  return {
    allowsUpgrade: authorized,

    async check(req, res, pathname) {
      if (pathname === '/api/health') return true;
      const url = new URL(req.url ?? '/', 'http://localhost');

      if (pathname === '/access') {
        if (req.method !== 'POST') {
          html(res, 200, page('', safeNext(url.searchParams.get('next'))));
          return false;
        }
        const id = clientId(req);
        if (recentFailures(id).length >= MAX_FAILURES) {
          html(res, 429, page('Too many wrong codes. Wait 10 minutes and try again.', '/'));
          return false;
        }
        let raw = '';
        for await (const chunk of req) {
          raw += chunk;
          if (raw.length > 2048) break;
        }
        const form = new URLSearchParams(raw);
        const next = safeNext(form.get('next'));
        if (!sameSecret(form.get('code') ?? '', code)) {
          failures.set(id, [...recentFailures(id), clock()]);
          html(res, 401, page('That code is not right.', next));
          return false;
        }
        failures.delete(id);
        const secure = isHttps(req) ? '; Secure' : '';
        res.writeHead(303, {
          location: next,
          'set-cookie': `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE_SECONDS}${secure}`,
          'cache-control': 'no-store',
        });
        res.end();
        return false;
      }

      if (authorized(req)) return true;
      if (pathname.startsWith('/api/')) {
        res.writeHead(401, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'access code required' }));
      } else {
        res.writeHead(303, { location: `/access?next=${encodeURIComponent(safeNext(url.pathname + url.search))}`, 'cache-control': 'no-store' });
        res.end();
      }
      return false;
    },
  };
}
