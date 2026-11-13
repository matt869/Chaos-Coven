import type { QuerySource } from '../haunting/types.js';
import { JsonHttp, type HttpOptions } from './http.js';
import type { QueryClient } from './types.js';

interface QueryResponse {
  status: 'success' | 'error';
  error?: string;
  data?: {
    resultType: 'vector' | 'scalar' | 'matrix' | 'streams' | 'string';
    result: unknown;
  };
}

/**
 * Reduces an instant query response to one number. Prometheus and Loki use the same
 * response shape for metric queries.
 */
export function parseInstantResult(source: QuerySource, query: string, body: QueryResponse): number | null {
  if (body.status !== 'success' || body.data === undefined) {
    throw new Error(`${source} query failed: ${body.error ?? 'unknown error'} (${query})`);
  }
  const { resultType, result } = body.data;
  if (resultType === 'scalar') return toNumber((result as [number, string])[1]);
  if (resultType !== 'vector') {
    throw new Error(
      `${source} query must return an instant vector or scalar, got ${resultType}. ` +
        `For logs, use a metric query such as sum(count_over_time(...)). (${query})`,
    );
  }
  const series = result as { metric: Record<string, string>; value: [number, string] }[];
  if (series.length === 0) return null;
  if (series.length > 1) {
    throw new Error(`${source} query returned ${series.length} series. Wrap it in sum() or similar. (${query})`);
  }
  return toNumber(series[0]!.value[1]);
}

function toNumber(raw: string): number {
  // Prometheus encodes special values as strings: "NaN", "+Inf", "-Inf".
  if (raw === '+Inf') return Infinity;
  if (raw === '-Inf') return -Infinity;
  return Number(raw);
}

export class HttpQueryClient implements QueryClient {
  private readonly prometheus: JsonHttp;
  private readonly loki: JsonHttp;

  constructor(urls: { prometheus: string; loki: string }, opts?: HttpOptions) {
    this.prometheus = new JsonHttp(urls.prometheus, opts);
    this.loki = new JsonHttp(urls.loki, opts);
  }

  async query(source: QuerySource, query: string): Promise<number | null> {
    const qs = `?query=${encodeURIComponent(query)}`;
    const body =
      source === 'prometheus'
        ? await this.prometheus.request<QueryResponse>('GET', `/api/v1/query${qs}`)
        : await this.loki.request<QueryResponse>('GET', `/loki/api/v1/query${qs}`);
    return parseInstantResult(source, query, body!);
  }
}
