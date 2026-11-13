// In-memory stand-in for the Docker Compose sandbox. It implements the same client
// interfaces as the real Toxiproxy, Docker, service-admin and Prometheus/Loki clients,
// so the engine runs unchanged against it.
//
// Containers that start are "starting" for `settleMs` before they report "healthy",
// like a real healthcheck, so "back to baseline within a timeout" is tested for real.

import type {
  ContainerHealth,
  ContainerInfo,
  ContainerState,
  DockerClient,
  QueryClient,
  SandboxClients,
  ServiceAdminClient,
  ToggleState,
  Toxic,
  ToxiproxyClient,
} from '../../src/clients/types.js';
import { stableStringify } from '../../src/engine/compare.js';
import type { QuerySource, Scalar } from '../../src/haunting/types.js';

export interface Topology {
  containers: Record<string, number>;
  proxies: string[];
  /** Config keys per app service. `null` means the key starts unset. */
  config: Record<string, Record<string, Scalar | null>>;
  toggles: string[];
}

export const DEFAULT_TOPOLOGY: Topology = {
  containers: { storefront: 1, cart: 1, payments: 1, worker: 2, postgres: 1, queue: 1 },
  proxies: [
    'storefront_cart',
    'storefront_payments',
    'storefront_queue',
    'worker_queue',
    'worker_postgres',
    'cart_postgres',
    'payments_postgres',
  ],
  config: {
    storefront: { 'checkout.timeout_ms': 2000, 'feature.new_cart': false, 'cache.ttl_s': null },
    cart: { 'pool.max_connections': 20, 'cache.ttl_s': null },
    payments: { 'retry.max_attempts': 3, 'provider.region': 'eu', 'cache.ttl_s': null },
    worker: { concurrency: 4, 'cache.ttl_s': null },
  },
  toggles: ['memory-leak', 'consumer-stall', 'slow-gc'],
};

interface FakeContainer {
  id: string;
  name: string;
  service: string;
  state: ContainerState;
  health: ContainerHealth;
  timer?: ReturnType<typeof setTimeout>;
}

export type FailurePoint =
  | 'toxiproxy.upsert'
  | 'toxiproxy.delete'
  | 'docker.setState'
  | 'admin.setConfig'
  | 'admin.unsetConfig'
  | 'admin.setToggle';

export class FakeSandbox {
  readonly toxics = new Map<string, Map<string, Toxic>>();
  readonly containers = new Map<string, FakeContainer>();
  readonly config = new Map<string, Map<string, Scalar>>();
  readonly toggles = new Map<string, Map<string, ToggleState>>();
  private readonly queryResults = new Map<string, number | null | Error>();
  /** Failure points that throw on their next N calls. */
  private readonly failures = new Map<FailurePoint, number>();
  /** Every state-changing call, in order. */
  readonly calls: string[] = [];

  constructor(
    readonly topology: Topology = DEFAULT_TOPOLOGY,
    private readonly settleMs = 2,
  ) {
    for (const proxy of topology.proxies) this.toxics.set(proxy, new Map());
    for (const [service, n] of Object.entries(topology.containers)) {
      for (let i = 1; i <= n; i++) {
        const id = `${service}-${i}`;
        this.containers.set(id, { id, name: `sandbox-${service}-${i}`, service, state: 'running', health: 'healthy' });
      }
    }
    for (const [service, keys] of Object.entries(topology.config)) {
      const m = new Map<string, Scalar>();
      for (const [k, v] of Object.entries(keys)) if (v !== null) m.set(k, v);
      this.config.set(service, m);
      this.toggles.set(service, new Map(topology.toggles.map((t) => [t, { enabled: false, settings: {} }])));
    }
  }

  failNext(point: FailurePoint, times = 1): void {
    this.failures.set(point, times);
  }

  private maybeFail(point: FailurePoint): void {
    const n = this.failures.get(point) ?? 0;
    if (n > 0) {
      this.failures.set(point, n - 1);
      throw new Error(`injected failure at ${point}`);
    }
  }

  setQuery(source: QuerySource, query: string, value: number | null | Error): void {
    this.queryResults.set(`${source}|${query}`, value);
  }

  /** Full sandbox state, including health, as a stable string. */
  snapshot(): string {
    return stableStringify({
      toxics: Object.fromEntries([...this.toxics].map(([p, m]) => [p, Object.fromEntries(m)])),
      containers: [...this.containers.values()].map(({ id, service, state, health }) => ({ id, service, state, health })),
      config: Object.fromEntries([...this.config].map(([s, m]) => [s, Object.fromEntries(m)])),
      toggles: Object.fromEntries([...this.toggles].map(([s, m]) => [s, Object.fromEntries(m)])),
    });
  }

  /** Finishes every pending healthcheck now. */
  settle(): void {
    for (const c of this.containers.values()) {
      if (c.timer !== undefined) clearTimeout(c.timer);
      c.timer = undefined;
      if (c.health === 'starting') c.health = 'healthy';
    }
  }

  dispose(): void {
    for (const c of this.containers.values()) if (c.timer !== undefined) clearTimeout(c.timer);
  }

  /** What a player's `haunt restart <service>` would do. */
  playerRestart(service: string): void {
    for (const c of this.containers.values()) {
      if (c.service === service) this.transition(c, 'running', true);
    }
  }

  /** What a player's `haunt scale <service> n` would do when scaling up. */
  playerScaleUp(service: string): string {
    const n = [...this.containers.values()].filter((c) => c.service === service).length + 1;
    const id = `${service}-${n}`;
    const c: FakeContainer = { id, name: `sandbox-${service}-${n}`, service, state: 'stopped', health: 'none' };
    this.containers.set(id, c);
    this.transition(c, 'running');
    return id;
  }

  private transition(c: FakeContainer, target: ContainerState, forceRestart = false): void {
    const from = c.state;
    c.state = target;
    if (target === 'stopped') {
      if (c.timer !== undefined) clearTimeout(c.timer);
      c.timer = undefined;
      c.health = 'none';
      return;
    }
    if (from === 'stopped' || forceRestart) {
      // A (re)started container runs its healthcheck again. If it is paused straight
      // away (docker start + pause), the check cannot finish until it is unpaused.
      c.health = 'starting';
      if (c.timer !== undefined) clearTimeout(c.timer);
      c.timer = undefined;
    }
    if (c.state === 'running' && c.health === 'starting' && c.timer === undefined) {
      c.timer = setTimeout(() => {
        c.timer = undefined;
        if (c.state === 'running' && c.health === 'starting') c.health = 'healthy';
      }, this.settleMs);
    }
  }

  clients(): SandboxClients {
    return { toxiproxy: this.toxiproxyClient(), docker: this.dockerClient(), admin: this.adminClient() };
  }

  toxiproxyClient(): ToxiproxyClient {
    const proxy = (name: string) => {
      const m = this.toxics.get(name);
      if (m === undefined) throw new Error(`proxy not found: ${name}`);
      return m;
    };
    return {
      getToxic: async (p, name) => {
        const t = proxy(p).get(name);
        return t === undefined ? null : structuredClone(t);
      },
      upsertToxic: async (p, toxic) => {
        this.maybeFail('toxiproxy.upsert');
        this.calls.push(`toxiproxy.upsert ${p} ${toxic.name}`);
        proxy(p).set(toxic.name, structuredClone(toxic));
      },
      deleteToxic: async (p, name) => {
        this.maybeFail('toxiproxy.delete');
        this.calls.push(`toxiproxy.delete ${p} ${name}`);
        proxy(p).delete(name);
      },
    };
  }

  dockerClient(): DockerClient {
    return {
      listContainers: async (service): Promise<ContainerInfo[]> =>
        [...this.containers.values()]
          .filter((c) => c.service === service)
          .map(({ id, name, state, health }) => ({ id, name, state, health })),
      setState: async (id, state) => {
        this.maybeFail('docker.setState');
        const c = this.containers.get(id);
        if (c === undefined) throw new Error(`container not found: ${id}`);
        if (c.state === state) return;
        this.calls.push(`docker.setState ${id} ${state}`);
        this.transition(c, state);
      },
    };
  }

  adminClient(): ServiceAdminClient {
    const cfg = (service: string) => {
      const m = this.config.get(service);
      if (m === undefined) throw new Error(`no admin endpoint for ${service}`);
      return m;
    };
    const tog = (service: string, toggle: string) => {
      const m = this.toggles.get(service);
      if (m === undefined) throw new Error(`no admin endpoint for ${service}`);
      if (!m.has(toggle)) throw new Error(`unknown toggle ${toggle} on ${service}`);
      return m;
    };
    return {
      getConfig: async (s, k) => cfg(s).get(k) ?? null,
      setConfig: async (s, k, v) => {
        this.maybeFail('admin.setConfig');
        this.calls.push(`admin.setConfig ${s} ${k}`);
        cfg(s).set(k, v);
      },
      unsetConfig: async (s, k) => {
        this.maybeFail('admin.unsetConfig');
        this.calls.push(`admin.unsetConfig ${s} ${k}`);
        cfg(s).delete(k);
      },
      getToggle: async (s, t) => structuredClone(tog(s, t).get(t)!),
      setToggle: async (s, t, state) => {
        this.maybeFail('admin.setToggle');
        this.calls.push(`admin.setToggle ${s} ${t}`);
        tog(s, t).set(t, structuredClone(state));
      },
    };
  }

  queryClient(): QueryClient {
    return {
      query: async (source, query) => {
        const r = this.queryResults.get(`${source}|${query}`);
        if (r instanceof Error) throw r;
        return r ?? null;
      },
    };
  }
}
