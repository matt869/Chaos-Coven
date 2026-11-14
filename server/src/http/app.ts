import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import { validateDrill, type DrillStore } from '../drills/drills.js';
import { SessionError, type SessionManager } from '../session/session.js';

export interface AppOptions {
  sessions: SessionManager;
  drills: DrillStore;
  /** Shown to the player for the embedded dashboard. */
  grafanaUrl: string;
  /** Built UIs to serve, if present: the player UI at /, Daemonwatch at /daemonwatch/. */
  staticDirs?: { web?: string; daemonwatch?: string };
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

type Json = Record<string, unknown> | unknown[] | null;
type Handler = (params: Record<string, string>, body: unknown) => Promise<{ status?: number; body: Json }>;

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 32 * 1024) throw new HttpError(413, 'request body too large');
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'invalid JSON');
  }
}

export function createApp(opts: AppOptions): Server {
  const { sessions, drills } = opts;
  const routes: { method: string; regex: RegExp; keys: string[]; handler: Handler }[] = [];
  const on = (method: string, pattern: string, handler: Handler) => {
    const keys: string[] = [];
    const regex = new RegExp('^' + pattern.replace(/:([a-zA-Z]+)/g, (_m, k: string) => (keys.push(k), '([^/]+)')) + '$');
    routes.push({ method, regex, keys, handler });
  };
  const str = (v: unknown) => (typeof v === 'string' ? v : undefined);

  on('GET', '/api/health', async () => ({ body: { ok: true } }));
  on('GET', '/api/config', async () => ({ body: { grafanaUrl: opts.grafanaUrl } }));
  on('GET', '/api/hauntings', async () => ({ body: sessions.hauntings() }));

  on('POST', '/api/sessions', async (_p, body) => {
    const b = body as { hauntingId?: unknown; player?: unknown };
    const hauntingId = str(b.hauntingId);
    if (hauntingId === undefined) throw new HttpError(400, 'hauntingId is required');
    return { status: 201, body: { ...(await sessions.start(hauntingId, { player: str(b.player)?.slice(0, 40) })) } };
  });
  on('GET', '/api/sessions/active', async () => ({ body: (sessions.active() as unknown as Json) ?? null }));
  on('GET', '/api/sessions/:id', async ({ id }) => ({ body: { ...sessions.view(id!) } }));
  on('POST', '/api/sessions/:id/command', async ({ id }, body) => {
    const line = str((body as { line?: unknown }).line);
    if (line === undefined) throw new HttpError(400, 'line is required');
    return { body: await sessions.command(id!, line) };
  });
  on('POST', '/api/sessions/:id/hint', async ({ id }) => ({ body: { hint: await sessions.hint(id!) } }));
  on('POST', '/api/sessions/:id/diagnose', async ({ id }, body) => {
    const b = body as { component?: unknown; summary?: unknown };
    return { body: { ...sessions.diagnose(id!, { component: str(b.component) ?? '', summary: str(b.summary) ?? '' }) } };
  });
  on('POST', '/api/sessions/:id/verify', async ({ id }) => ({ body: { ...(await sessions.verify(id!)) } }));
  on('POST', '/api/sessions/:id/end', async ({ id }) => ({ body: { ...(await sessions.end(id!, 'player')) } }));
  on('GET', '/api/sessions/:id/postmortem', async ({ id }) => ({ body: { ...sessions.postmortem(id!) } }));

  on('GET', '/api/drills', async () => ({ body: await drills.list() }));
  on('POST', '/api/drills', async (_p, body) => {
    let input;
    try {
      input = validateDrill(body, sessions.hauntings().map((h) => h.id));
    } catch (err) {
      throw new HttpError(400, (err as Error).message);
    }
    return { status: 201, body: { ...(await drills.create(input)) } };
  });
  on('GET', '/api/drills/:id', async ({ id }) => {
    const d = await drills.get(id!);
    if (d === undefined) throw new HttpError(404, 'unknown drill');
    return { body: { ...d } };
  });
  on('DELETE', '/api/drills/:id', async ({ id }) => {
    const d = await drills.cancel(id!);
    if (d === undefined) throw new HttpError(404, 'unknown drill');
    return { body: { ...d } };
  });
  on('POST', '/api/drills/:id/start', async ({ id }, body) => {
    const d = await drills.get(id!);
    if (d === undefined) throw new HttpError(404, 'unknown drill');
    if (d.status === 'cancelled') throw new HttpError(409, 'this drill was cancelled');
    const player = str((body as { player?: unknown }).player);
    if (player === undefined || !d.players.includes(player)) throw new HttpError(400, 'player is not part of this drill');
    return { status: 201, body: { ...(await sessions.start(d.hauntingId, { player, drillId: d.id })) } };
  });

  // Record drill results when a drill session ends.
  sessions.onEvent((e) => {
    if (e.type !== 'ended') return;
    const pm = e.postmortem;
    const view = sessions.view(pm.sessionId);
    if (view.drillId === undefined || pm.player === undefined) return;
    void drills.addResult(view.drillId, {
      player: pm.player,
      sessionId: pm.sessionId,
      score: pm.score.total,
      maxScore: pm.score.max,
      detectionSeconds: pm.score.detection.seconds,
      rootCauseCorrect: pm.score.rootCause.componentCorrect,
      fixVerified: pm.score.fix.verified,
      harmfulActions: pm.score.penalties.items.length,
      endedAt: new Date(pm.endedAt).toISOString(),
    });
  });

  const serveStatic = async (res: ServerResponse, root: string, rel: string): Promise<boolean> => {
    const base = resolve(root);
    let file = resolve(join(base, normalize(rel)));
    if (!file.startsWith(base)) return false;
    let info = await stat(file).catch(() => undefined);
    if (info?.isDirectory()) {
      file = join(file, 'index.html');
      info = await stat(file).catch(() => undefined);
    }
    if (info === undefined) {
      // Single-page app: unknown paths get index.html.
      file = join(base, 'index.html');
      info = await stat(file).catch(() => undefined);
      if (info === undefined) return false;
    }
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
    createReadStream(file).pipe(res);
    return true;
  };

  const server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const method = req.method ?? 'GET';
      const send = (status: number, body: Json) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
      };
      try {
        if (url.pathname.startsWith('/api/')) {
          for (const r of routes) {
            if (r.method !== method) continue;
            const m = r.regex.exec(url.pathname);
            if (m === null) continue;
            const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1]!)]));
            const body = method === 'GET' || method === 'DELETE' ? {} : await readJson(req);
            const result = await r.handler(params, body);
            return send(result.status ?? 200, result.body);
          }
          return send(404, { error: 'not found' });
        }
        const dirs = opts.staticDirs ?? {};
        if (url.pathname.startsWith('/daemonwatch') && dirs.daemonwatch) {
          if (await serveStatic(res, dirs.daemonwatch, url.pathname.slice('/daemonwatch'.length) || '/')) return;
        } else if (dirs.web && (await serveStatic(res, dirs.web, url.pathname))) {
          return;
        }
        send(404, { error: 'not found' });
      } catch (err) {
        const status = err instanceof HttpError || err instanceof SessionError ? err.status : 500;
        send(status, { error: status === 500 ? 'internal error' : (err as Error).message });
        if (status === 500) process.stderr.write(`[server] ${(err as Error).stack ?? String(err)}\n`);
      }
    })();
  });

  // Terminal: /api/sessions/:id/terminal. The client sends {type:"command", line};
  // the server answers {type:"output", ok, text} and pushes {type:"narration"|"ended"} events.
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4 * 1024 });
  server.on('upgrade', (req, socket, head) => {
    const m = /^\/api\/sessions\/([^/]+)\/terminal$/.exec(new URL(req.url ?? '/', 'http://localhost').pathname);
    if (m === null) return socket.destroy();
    const id = decodeURIComponent(m[1]!);
    try {
      sessions.view(id);
    } catch {
      return socket.destroy();
    }
    wss.handleUpgrade(req, socket, head, (ws) => attachTerminal(ws, id, sessions));
  });
  server.on('close', () => wss.close());
  return server;
}

function attachTerminal(ws: WebSocket, sessionId: string, sessions: SessionManager): void {
  const send = (msg: Record<string, unknown>) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  };
  const off = sessions.onEvent((e) => {
    if (e.sessionId !== sessionId) return;
    if (e.type === 'narration') send({ type: 'narration', text: e.text });
    else send({ type: 'ended' });
  });
  let busy = Promise.resolve();
  ws.on('message', (data) => {
    let line: string | undefined;
    try {
      const msg = JSON.parse(String(data)) as { type?: string; line?: unknown };
      if (msg.type === 'command' && typeof msg.line === 'string') line = msg.line;
    } catch {
      /* ignored */
    }
    if (line === undefined) return send({ type: 'output', ok: false, text: 'bad message' });
    const l = line;
    // Commands run one at a time, in order.
    busy = busy.then(async () => {
      try {
        const r = await sessions.command(sessionId, l);
        send({ type: 'output', ok: r.ok, text: r.output });
      } catch (err) {
        send({ type: 'output', ok: false, text: (err as Error).message });
      }
    });
  });
  ws.on('close', off);
}
