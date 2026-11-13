import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertSandboxUrl } from './clients/http.js';

const ENGINE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export interface EngineConfig {
  hauntingsDir: string;
  composeProject: string;
  toxiproxyUrl: string;
  prometheusUrl: string;
  lokiUrl: string;
  serviceAdminUrls: Record<string, string>;
  ledgerPath: string;
}

const DEFAULT_ADMIN_URLS: Record<string, string> = {
  storefront: 'http://127.0.0.1:8081',
  cart: 'http://127.0.0.1:8082',
  payments: 'http://127.0.0.1:8083',
  worker: 'http://127.0.0.1:8084',
};

/** Reads engine settings from WH_* environment variables. Every URL must point at the sandbox. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): EngineConfig {
  const adminUrls = env.WH_SERVICE_ADMIN_URLS
    ? (JSON.parse(env.WH_SERVICE_ADMIN_URLS) as Record<string, string>)
    : DEFAULT_ADMIN_URLS;

  const config: EngineConfig = {
    hauntingsDir: resolve(env.WH_HAUNTINGS_DIR ?? resolve(ENGINE_ROOT, '../hauntings')),
    composeProject: env.WH_COMPOSE_PROJECT ?? 'witching-hour-sandbox',
    toxiproxyUrl: env.WH_TOXIPROXY_URL ?? 'http://127.0.0.1:8474',
    prometheusUrl: env.WH_PROMETHEUS_URL ?? 'http://127.0.0.1:9090',
    lokiUrl: env.WH_LOKI_URL ?? 'http://127.0.0.1:3100',
    serviceAdminUrls: adminUrls,
    ledgerPath: resolve(env.WH_LEDGER_PATH ?? resolve(ENGINE_ROOT, '.witching/ledger.json')),
  };

  for (const url of [config.toxiproxyUrl, config.prometheusUrl, config.lokiUrl, ...Object.values(adminUrls)]) {
    assertSandboxUrl(url);
  }
  return config;
}
