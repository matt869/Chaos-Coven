import type { Scalar } from '../haunting/types.js';
import { JsonHttp, segment, type HttpOptions } from './http.js';
import type { ServiceAdminClient, ToggleState } from './types.js';

/**
 * Talks to the admin endpoints every sandbox app service exposes:
 *
 *   GET    /__admin/config/:key   -> { "value": <scalar> }   (404 when unset)
 *   PUT    /__admin/config/:key   <- { "value": <scalar> }
 *   DELETE /__admin/config/:key
 *   GET    /__debug/:toggle       -> { "enabled": bool, "settings": {...} }
 *   PUT    /__debug/:toggle       <- { "enabled": bool, "settings": {...} }
 *
 * These endpoints are the contract between the engine and sandbox/ services.
 */
export class ServiceAdminHttpClient implements ServiceAdminClient {
  private readonly clients = new Map<string, JsonHttp>();

  constructor(baseUrls: Record<string, string>, opts?: HttpOptions) {
    for (const [service, url] of Object.entries(baseUrls)) this.clients.set(service, new JsonHttp(url, opts));
  }

  private client(service: string): JsonHttp {
    const c = this.clients.get(service);
    if (c === undefined) throw new Error(`No admin URL configured for service "${service}"`);
    return c;
  }

  async getConfig(service: string, key: string): Promise<Scalar | null> {
    const res = await this.client(service).request<{ value: Scalar }>(
      'GET',
      `/__admin/config/${segment(key, 'config key')}`,
      undefined,
      { allow404: true },
    );
    return res === null ? null : res.value;
  }

  async setConfig(service: string, key: string, value: Scalar): Promise<void> {
    await this.client(service).request('PUT', `/__admin/config/${segment(key, 'config key')}`, { value });
  }

  async unsetConfig(service: string, key: string): Promise<void> {
    await this.client(service).request('DELETE', `/__admin/config/${segment(key, 'config key')}`, undefined, {
      allow404: true,
    });
  }

  async getToggle(service: string, toggle: string): Promise<ToggleState> {
    const res = await this.client(service).request<ToggleState>('GET', `/__debug/${segment(toggle, 'toggle')}`);
    return { enabled: res?.enabled === true, settings: { ...(res?.settings ?? {}) } };
  }

  async setToggle(service: string, toggle: string, state: ToggleState): Promise<void> {
    await this.client(service).request('PUT', `/__debug/${segment(toggle, 'toggle')}`, state);
  }
}
