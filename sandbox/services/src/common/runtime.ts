import { createClient } from 'redis';
import { ConfigStore, mountConfigAdmin } from './config.js';
import { createPool, postgresConfigBackend, type Pool } from './db.js';
import { mountDebugAdmin, Toggles } from './debug.js';
import { Router, serve } from './http.js';
import { createLogger, type Logger } from './log.js';
import { Metrics } from './metrics.js';

/** Addresses of everything a role talks to. Data paths go through Toxiproxy so hauntings can disturb them. */
export interface Env {
  port: number;
  lokiUrl?: string;
  /** Direct connection, for config only. */
  configDbUrl: string;
  dataDbUrl?: string;
  redisUrl?: string;
  cartUrl: string;
  paymentsUrl: string;
  storefrontUrl: string;
  trafficRps: number;
}

export function readEnv(e: NodeJS.ProcessEnv = process.env): Env {
  return {
    port: Number(e.PORT ?? 8080),
    lokiUrl: e.LOKI_URL,
    configDbUrl: e.CONFIG_DB_URL ?? 'postgres://shop:shop@postgres:5432/shop',
    dataDbUrl: e.DATA_DB_URL,
    redisUrl: e.REDIS_URL,
    cartUrl: e.CART_URL ?? 'http://toxiproxy:21001',
    paymentsUrl: e.PAYMENTS_URL ?? 'http://toxiproxy:21002',
    storefrontUrl: e.STOREFRONT_URL ?? 'http://storefront:8080',
    trafficRps: Number(e.TRAFFIC_RPS ?? 5),
  };
}

export interface Runtime {
  service: string;
  env: Env;
  router: Router;
  metrics: Metrics;
  log: Logger;
  config: ConfigStore;
  toggles: Toggles;
  dataDb(): Pool;
  redis(): Promise<ReturnType<typeof createClient>>;
}

export async function startRuntime(service: string, env: Env): Promise<Runtime> {
  const metrics = new Metrics(service);
  const log = createLogger(service, env.lokiUrl);
  const router = new Router();
  const configPool = createPool(env.configDbUrl, 2);
  const config = new ConfigStore(service, postgresConfigBackend(configPool), metrics);
  const toggles = new Toggles(log);

  // Postgres may still be starting. Retry instead of crash-looping.
  for (let attempt = 1; ; attempt++) {
    try {
      await config.refresh();
      break;
    } catch (err) {
      if (attempt >= 30) throw err;
      log.warn('waiting for config database', { attempt, error: (err as Error).message });
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  setInterval(() => void config.refresh().catch(() => undefined), 2000).unref();

  router
    .on('GET', '/healthz', () => ({ status: 200, body: { ok: true, service } }))
    .on('GET', '/metrics', async () => ({
      status: 200,
      body: await metrics.registry.metrics(),
      contentType: metrics.registry.contentType,
    }));
  mountConfigAdmin(router, config, log);
  mountDebugAdmin(router, toggles);

  let pool: Pool | undefined;
  let redis: ReturnType<typeof createClient> | undefined;
  const rt: Runtime = {
    service,
    env,
    router,
    metrics,
    log,
    config,
    toggles,
    dataDb() {
      if (env.dataDbUrl === undefined) throw new Error(`${service} has no DATA_DB_URL`);
      pool ??= createPool(env.dataDbUrl, 32);
      return pool;
    },
    async redis() {
      if (env.redisUrl === undefined) throw new Error(`${service} has no REDIS_URL`);
      if (redis === undefined) {
        redis = createClient({ url: env.redisUrl, socket: { reconnectStrategy: (n) => Math.min(n * 200, 2000) } });
        redis.on('error', (err: Error) => log.warn('queue connection error', { error: err.message }));
        await redis.connect();
      }
      return redis;
    },
  };

  serve(router, metrics, env.port);
  log.info('started', { port: env.port });
  return rt;
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
