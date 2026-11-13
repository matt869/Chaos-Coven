export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
    body: string,
  ) {
    super(`HTTP ${status} from ${url}${body ? `: ${body.slice(0, 300)}` : ''}`);
    this.name = 'HttpError';
  }
}

export interface HttpOptions {
  fetch?: FetchLike;
  timeoutMs?: number;
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/**
 * Sandbox-safety guard: the engine may only reach the sandbox. That is loopback
 * (published ports on this machine) or a single-label host name (a compose service
 * on the sandbox network, when the engine runs inside it). Anything with a dot, such
 * as a real domain or a public IP, is rejected.
 */
export function assertSandboxUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`Invalid sandbox URL: ${raw}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Sandbox URL must be http(s): ${raw}`);
  }
  const host = url.hostname;
  const singleLabel = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/i.test(host);
  if (!LOOPBACK.has(host) && !singleLabel) {
    throw new Error(`Refusing non-sandbox host "${host}". Only loopback or compose service names are allowed.`);
  }
  return url;
}

export class JsonHttp {
  private readonly base: URL;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;

  constructor(baseUrl: string, opts: HttpOptions = {}) {
    this.base = assertSandboxUrl(baseUrl);
    this.fetchImpl = opts.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.timeoutMs = opts.timeoutMs ?? 5_000;
  }

  /** Returns parsed JSON, or null for 404 when `allow404` is set. */
  async request<T>(
    method: string,
    path: string,
    body?: unknown,
    { allow404 = false }: { allow404?: boolean } = {},
  ): Promise<T | null> {
    const url = new URL(path, this.base).toString();
    const init: RequestInit = { method, signal: AbortSignal.timeout(this.timeoutMs) };
    if (body !== undefined) {
      init.headers = { 'content-type': 'application/json' };
      init.body = JSON.stringify(body);
    }
    const res = await this.fetchImpl(url, init);
    if (res.status === 404 && allow404) return null;
    const text = await res.text();
    if (!res.ok) throw new HttpError(res.status, url, text);
    return (text === '' ? undefined : JSON.parse(text)) as T;
  }
}

/** Encodes one URL path segment after checking it is a plain identifier. */
export function segment(value: string, what: string): string {
  if (!/^[A-Za-z0-9_.-]+$/.test(value)) throw new Error(`Invalid ${what}: ${JSON.stringify(value)}`);
  return encodeURIComponent(value);
}
