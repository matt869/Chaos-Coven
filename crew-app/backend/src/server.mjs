// Daemonwatch backend: a small, dependency-free proxy from the Crew gateway to the
// Witching Hour game server's drills API. Every request except /health must carry a
// valid X-Crew-Proxy signature (see proxy-auth.mjs).

import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HEADER, verifyProxyRequest } from './proxy-auth.mjs';

const APP_NAME = 'daemonwatch';
const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const MAX_BODY = 32 * 1024;
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

/** Calls the backend may forward. Anything else is 404. */
const ROUTES = [
  { method: 'GET', pattern: /^\/api\/hauntings$/ },
  { method: 'GET', pattern: /^\/api\/drills$/ },
  { method: 'POST', pattern: /^\/api\/drills$/ },
  { method: 'GET', pattern: /^\/api\/drills\/[0-9a-f-]{36}$/ },
  { method: 'DELETE', pattern: /^\/api\/drills\/[0-9a-f-]{36}$/ },
  { method: 'POST', pattern: /^\/api\/drills\/[0-9a-f-]{36}\/start$/ },
];

/** The app secret: CREW_APP_SECRET, else the .app_secret file Crew writes for the app. */
export function loadSecret(env = process.env) {
  if (env.CREW_APP_SECRET) return env.CREW_APP_SECRET;
  for (const file of [join(APP_ROOT, '.app_secret'), join(homedir(), '.kiro', 'crew', 'apps', APP_NAME, '.app_secret')]) {
    if (existsSync(file)) return readFileSync(file, 'utf8').trim();
  }
  return '';
}

/** The game server must be on this machine: it binds 127.0.0.1. */
export function gameServerUrl(env = process.env) {
  const url = new URL(env.DAEMONWATCH_GAME_SERVER_URL || 'http://127.0.0.1:4000');
  if (url.protocol !== 'http:' || !LOOPBACK_HOSTS.has(url.hostname)) {
    throw new Error(`DAEMONWATCH_GAME_SERVER_URL must be a loopback http URL, got ${url.href}`);
  }
  return url.origin;
}

/**
 * The gateway serves this backend at /apps/daemonwatch/api/*. Accept the path with or
 * without that prefix; the signature is always checked over the path exactly as received.
 */
export function routePath(path) {
  const prefix = `/apps/${APP_NAME}`;
  return path.startsWith(`${prefix}/api/`) ? path.slice(prefix.length) : path;
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw Object.assign(new Error('body too large'), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/**
 * @param {{ secret: string, target: string, fetch?: typeof fetch, now?: () => number }} opts
 */
export function createBackend({ secret, target, fetch: fetchImpl = fetch, now = () => Math.floor(Date.now() / 1000) }) {
  return createServer(async (req, res) => {
    const send = (status, body) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    try {
      const pathWithQuery = req.url ?? '/';
      const [path] = pathWithQuery.split('?');
      if (req.method === 'GET' && path === '/health') return send(200, { ok: true, app: APP_NAME });

      const body = await readBody(req);
      const auth = verifyProxyRequest({
        secret,
        header: req.headers[HEADER],
        method: req.method ?? 'GET',
        pathWithQuery,
        body,
        nowSeconds: now(),
      });
      if (!auth.ok) return send(401, { error: auth.reason });

      const apiPath = routePath(path);
      if (!ROUTES.some((r) => r.method === req.method && r.pattern.test(apiPath))) return send(404, { error: 'not found' });

      const upstream = await fetchImpl(`${target}${apiPath}`, {
        method: req.method,
        headers: body.length > 0 ? { 'content-type': 'application/json' } : undefined,
        body: body.length > 0 ? body : undefined,
        signal: AbortSignal.timeout(30_000),
      });
      res.writeHead(upstream.status, { 'content-type': upstream.headers.get('content-type') ?? 'application/json' });
      res.end(Buffer.from(await upstream.arrayBuffer()));
    } catch (err) {
      send(err.status ?? 502, { error: err.status ? err.message : 'game server unavailable. Is it running? (npm run dev:server)' });
    }
  });
}

const isMain = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const secret = loadSecret();
  if (!secret) process.stderr.write('[daemonwatch] no app secret found: every proxied request will be rejected\n');
  const port = Number(process.env.PORT || 4410);
  createBackend({ secret, target: gameServerUrl() }).listen(port, '127.0.0.1', () => {
    process.stderr.write(`[daemonwatch] backend on http://127.0.0.1:${port}, forwarding to ${gameServerUrl()}\n`);
  });
}
