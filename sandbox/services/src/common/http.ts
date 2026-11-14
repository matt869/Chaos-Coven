import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Metrics } from './metrics.js';

export interface Request {
  method: string;
  path: string;
  params: Record<string, string>;
  body: unknown;
}

export interface Response {
  status: number;
  body?: unknown;
  /** Defaults to application/json. */
  contentType?: string;
}

export type Handler = (req: Request) => Promise<Response> | Response;

interface Route {
  method: string;
  pattern: string;
  regex: RegExp;
  keys: string[];
  handler: Handler;
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** A tiny router: `/cart/:id` style patterns, JSON in and out. */
export class Router {
  private readonly routes: Route[] = [];

  on(method: string, pattern: string, handler: Handler): this {
    const keys: string[] = [];
    const regex = new RegExp(
      '^' +
        pattern.replace(/:([a-zA-Z_]+)/g, (_m, k: string) => {
          keys.push(k);
          return '([^/]+)';
        }) +
        '$',
    );
    this.routes.push({ method, pattern, regex, keys, handler });
    return this;
  }

  /** Finds the route for a request. `pattern` is the metrics label, so ids never explode cardinality. */
  match(method: string, path: string): { route: Route; params: Record<string, string> } | undefined {
    for (const route of this.routes) {
      if (route.method !== method) continue;
      const m = route.regex.exec(path);
      if (m === null) continue;
      const params = Object.fromEntries(route.keys.map((k, i) => [k, decodeURIComponent(m[i + 1]!)]));
      return { route, params };
    }
    return undefined;
  }

  async handle(method: string, path: string, body: unknown): Promise<{ pattern: string; response: Response }> {
    const found = this.match(method, path);
    if (found === undefined) return { pattern: 'unmatched', response: { status: 404, body: { error: 'not found' } } };
    try {
      const response = await found.route.handler({ method, path, params: found.params, body });
      return { pattern: found.route.pattern, response };
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      return { pattern: found.route.pattern, response: { status, body: { error: (err as Error).message } } };
    }
  }
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 64 * 1024) throw new HttpError(413, 'body too large');
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) return undefined;
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'invalid JSON');
  }
}

export function serve(router: Router, metrics: Metrics, port: number): Server {
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const started = process.hrtime.bigint();
    const path = (req.url ?? '/').split('?')[0]!;
    const method = req.method ?? 'GET';
    void (async () => {
      let pattern = 'unmatched';
      let response: Response;
      try {
        const body = method === 'GET' || method === 'DELETE' ? undefined : await readBody(req);
        ({ pattern, response } = await router.handle(method, path, body));
      } catch (err) {
        response = { status: err instanceof HttpError ? err.status : 500, body: { error: (err as Error).message } };
      }
      const contentType = response.contentType ?? 'application/json';
      const payload =
        response.body === undefined ? '' : contentType === 'application/json' ? JSON.stringify(response.body) : String(response.body);
      res.writeHead(response.status, { 'content-type': contentType });
      res.end(payload);
      if (!pattern.startsWith('/__') && pattern !== '/metrics' && pattern !== '/healthz') {
        const seconds = Number(process.hrtime.bigint() - started) / 1e9;
        metrics.observeRequest(pattern, response.status, seconds);
      }
    })();
  });
  server.listen(port);
  return server;
}

/** fetch with a timeout, for service-to-service calls. */
export async function callJson<T>(url: string, init: { method?: string; body?: unknown; timeoutMs: number }): Promise<T> {
  const res = await fetch(url, {
    method: init.method ?? 'GET',
    headers: init.body === undefined ? undefined : { 'content-type': 'application/json' },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: AbortSignal.timeout(init.timeoutMs),
  });
  const text = await res.text();
  if (!res.ok) throw new HttpError(res.status >= 500 ? 502 : res.status, `${url} returned ${res.status}: ${text.slice(0, 200)}`);
  return JSON.parse(text) as T;
}
