import { JsonHttp, type FetchLike } from '@witching-hour/engine';
import type { LogLine, Observability } from './executor.js';

interface PromResponse {
  status: string;
  error?: string;
  data?: { resultType: string; result: unknown };
}

/** Read-only Prometheus and Loki access for the player terminal. */
export class HttpObservability implements Observability {
  private readonly prometheus: JsonHttp;
  private readonly loki: JsonHttp;

  constructor(urls: { prometheus: string; loki: string }, opts: { fetch?: FetchLike } = {}) {
    this.prometheus = new JsonHttp(urls.prometheus, opts);
    this.loki = new JsonHttp(urls.loki, opts);
  }

  async logs(service: string, minutes: number, grep?: string, limit = 50): Promise<LogLine[]> {
    // service and grep were validated by the parser (identifier characters only).
    const selector = `{service="${service}"}${grep === undefined ? '' : ` |= "${grep}"`}`;
    const end = BigInt(Date.now()) * 1_000_000n;
    const start = end - BigInt(minutes) * 60n * 1_000_000_000n;
    const qs = new URLSearchParams({ query: selector, start: String(start), end: String(end), limit: String(limit), direction: 'backward' });
    const body = await this.loki.request<{ data?: { result?: { values: [string, string][] }[] } }>('GET', `/loki/api/v1/query_range?${qs}`);
    const lines = (body?.data?.result ?? []).flatMap((s) => s.values);
    return lines
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .slice(-limit)
      .map(([ns, line]) => ({ ts: new Date(Number(BigInt(ns) / 1_000_000n)).toISOString(), line }));
  }

  async promql(expr: string): Promise<{ labels: Record<string, string>; value: string }[]> {
    const body = await this.prometheus.request<PromResponse>('GET', `/api/v1/query?query=${encodeURIComponent(expr)}`);
    if (body?.status !== 'success' || body.data === undefined) throw new Error(body?.error ?? 'query failed');
    const { resultType, result } = body.data;
    if (resultType === 'scalar') return [{ labels: {}, value: (result as [number, string])[1] }];
    if (resultType !== 'vector') throw new Error(`only instant queries are supported (got ${resultType})`);
    return (result as { metric: Record<string, string>; value: [number, string] }[]).slice(0, 50).map((r) => ({ labels: r.metric, value: r.value[1] }));
  }

  async queueDepth(): Promise<number | null> {
    const rows = await this.promql('sum(witching_queue_depth{queue="orders"})');
    return rows[0] === undefined ? null : Number(rows[0].value);
  }
}
