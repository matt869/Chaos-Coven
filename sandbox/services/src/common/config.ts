import { HttpError, type Router } from './http.js';
import type { Logger } from './log.js';
import type { Metrics } from './metrics.js';

export type Scalar = string | number | boolean;

/**
 * Baseline config per service. Keys set to null start unset. This must match the
 * engine's fake sandbox topology (engine/src/testing/fake-sandbox.ts).
 */
export const DEFAULT_CONFIG: Record<string, Record<string, Scalar | null>> = {
  storefront: { 'checkout.timeout_ms': 2000, 'feature.new_cart': false, 'cache.ttl_s': null },
  cart: { 'pool.max_connections': 20, 'cache.ttl_s': null },
  payments: { 'db.pool_max': 10, 'retry.max_attempts': 3, 'provider.region': 'eu', 'cache.ttl_s': null },
  worker: { concurrency: 4, 'cache.ttl_s': null },
};

/** Where overrides live. Postgres in the sandbox, so a restart does not clear them. */
export interface ConfigBackend {
  load(service: string): Promise<Record<string, Scalar>>;
  set(service: string, key: string, value: Scalar): Promise<void>;
  unset(service: string, key: string): Promise<void>;
}

export class ConfigStore {
  private overrides: Record<string, Scalar> = {};
  private listeners: ((key: string) => void)[] = [];

  constructor(
    readonly service: string,
    private readonly backend: ConfigBackend,
    private readonly metrics?: Metrics,
  ) {}

  get(key: string): Scalar | null {
    if (key in this.overrides) return this.overrides[key]!;
    return DEFAULT_CONFIG[this.service]?.[key] ?? null;
  }

  number(key: string, fallback: number): number {
    const v = this.get(key);
    return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  }

  onChange(fn: (key: string) => void): void {
    this.listeners.push(fn);
  }

  async refresh(): Promise<void> {
    const before = this.overrides;
    this.overrides = await this.backend.load(this.service);
    const keys = new Set([...Object.keys(before), ...Object.keys(this.overrides)]);
    for (const k of keys) if (before[k] !== this.overrides[k]) this.emit(k);
    this.export();
  }

  async set(key: string, value: Scalar): Promise<void> {
    await this.backend.set(this.service, key, value);
    this.overrides = { ...this.overrides, [key]: value };
    this.emit(key);
    this.export();
  }

  async unset(key: string): Promise<void> {
    await this.backend.unset(this.service, key);
    const { [key]: _removed, ...rest } = this.overrides;
    this.overrides = rest;
    this.emit(key);
    this.export();
  }

  private emit(key: string): void {
    for (const fn of this.listeners) fn(key);
  }

  private export(): void {
    if (this.metrics === undefined) return;
    const keys = new Set([...Object.keys(DEFAULT_CONFIG[this.service] ?? {}), ...Object.keys(this.overrides)]);
    for (const k of keys) {
      const v = this.get(k);
      if (typeof v === 'number') this.metrics.configValue.set({ service: this.service, key: k }, v);
      else if (typeof v === 'boolean') this.metrics.configValue.set({ service: this.service, key: k }, v ? 1 : 0);
    }
  }
}

const KEY = /^[a-z0-9]+([._][a-z0-9]+)*$/;

/** The /__admin/config endpoints the engine's config driver uses. */
export function mountConfigAdmin(router: Router, store: ConfigStore, log: Logger): void {
  router
    .on('GET', '/__admin/config/:key', ({ params }) => {
      const value = store.get(params.key!);
      return value === null ? { status: 404, body: { error: 'unset' } } : { status: 200, body: { value } };
    })
    .on('PUT', '/__admin/config/:key', async ({ params, body }) => {
      const key = params.key!;
      if (!KEY.test(key)) throw new HttpError(400, 'invalid key');
      const value = (body as { value?: unknown } | undefined)?.value;
      if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
        throw new HttpError(400, 'value must be a string, number or boolean');
      }
      await store.set(key, value);
      log.info('config changed', { key, value });
      return { status: 204 };
    })
    .on('DELETE', '/__admin/config/:key', async ({ params }) => {
      await store.unset(params.key!);
      log.info('config reset to default', { key: params.key });
      return { status: 204 };
    });
}
