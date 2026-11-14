import { DockerCliClient } from './clients/docker-cli.js';
import { HttpQueryClient } from './clients/observability-http.js';
import { ServiceAdminHttpClient } from './clients/service-admin-http.js';
import { ToxiproxyHttpClient } from './clients/toxiproxy-http.js';
import type { EngineConfig } from './config.js';
import { Engine } from './engine/engine.js';
import { FileLedgerStore } from './engine/ledger.js';
import { createDrivers } from './faults/drivers.js';
import { loadHauntings, type LoadResult } from './haunting/loader.js';

export * from './haunting/types.js';
export * from './haunting/loader.js';
export * from './clients/types.js';
export * from './engine/engine.js';
export * from './engine/ledger.js';
export * from './faults/drivers.js';
export * from './scoring/index.js';
export { loadConfig, type EngineConfig } from './config.js';
export { DockerCliClient, type ExecFn } from './clients/docker-cli.js';
export { HttpQueryClient, parseInstantResult } from './clients/observability-http.js';
export { ServiceAdminHttpClient } from './clients/service-admin-http.js';
export { ToxiproxyHttpClient } from './clients/toxiproxy-http.js';
export { assertSandboxUrl, JsonHttp, HttpError as SandboxHttpError, type FetchLike } from './clients/http.js';

/** Builds an engine wired to the real sandbox described by `config`. Call init() before use. */
export async function createSandboxEngine(config: EngineConfig): Promise<{ engine: Engine; invalid: LoadResult['invalid'] }> {
  const { hauntings, invalid } = await loadHauntings(config.hauntingsDir);
  const drivers = createDrivers({
    toxiproxy: new ToxiproxyHttpClient(config.toxiproxyUrl),
    docker: new DockerCliClient(config.composeProject),
    admin: new ServiceAdminHttpClient(config.serviceAdminUrls),
  });
  const engine = new Engine({
    hauntings,
    drivers,
    queries: new HttpQueryClient({ prometheus: config.prometheusUrl, loki: config.lokiUrl }),
    store: new FileLedgerStore(config.ledgerPath),
  });
  return { engine, invalid };
}
