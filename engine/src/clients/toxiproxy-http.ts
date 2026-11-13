import { JsonHttp, segment, type HttpOptions } from './http.js';
import type { Toxic, ToxiproxyClient } from './types.js';

/** Client for the Toxiproxy HTTP API (default port 8474). */
export class ToxiproxyHttpClient implements ToxiproxyClient {
  private readonly http: JsonHttp;

  constructor(baseUrl: string, opts?: HttpOptions) {
    this.http = new JsonHttp(baseUrl, opts);
  }

  async getToxic(proxy: string, name: string): Promise<Toxic | null> {
    const raw = await this.http.request<Toxic>(
      'GET',
      `/proxies/${segment(proxy, 'proxy')}/toxics/${segment(name, 'toxic name')}`,
      undefined,
      { allow404: true },
    );
    if (raw === null) return null;
    return {
      name: raw.name,
      type: raw.type,
      stream: raw.stream,
      toxicity: raw.toxicity,
      attributes: { ...raw.attributes },
    };
  }

  async upsertToxic(proxy: string, toxic: Toxic): Promise<void> {
    const p = segment(proxy, 'proxy');
    const n = segment(toxic.name, 'toxic name');
    const existing = await this.getToxic(proxy, toxic.name);
    if (existing === null) {
      await this.http.request('POST', `/proxies/${p}/toxics`, toxic);
    } else {
      // Toxiproxy cannot change a toxic's type or stream in place, so recreate it.
      if (existing.type !== toxic.type || existing.stream !== toxic.stream) {
        await this.deleteToxic(proxy, toxic.name);
        await this.http.request('POST', `/proxies/${p}/toxics`, toxic);
      } else {
        await this.http.request('POST', `/proxies/${p}/toxics/${n}`, {
          toxicity: toxic.toxicity,
          attributes: toxic.attributes,
        });
      }
    }
  }

  async deleteToxic(proxy: string, name: string): Promise<void> {
    await this.http.request(
      'DELETE',
      `/proxies/${segment(proxy, 'proxy')}/toxics/${segment(name, 'toxic name')}`,
      undefined,
      { allow404: true },
    );
  }
}
