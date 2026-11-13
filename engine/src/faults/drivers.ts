import type { ContainerState, SandboxClients, Toxic, ToggleState } from '../clients/types.js';
import type {
  ConfigFault,
  DebugEndpointFault,
  DockerFault,
  FaultSpec,
  FaultType,
  Scalar,
  ToxiproxyFault,
} from '../haunting/types.js';

/**
 * One driver per fault type. Each fault touches one resource (a toxic, a service's
 * containers, a config key, a debug toggle). The engine's ledger uses these methods to
 * make every fault reversible:
 *
 *   capture  reads the resource's current state before the first fault touches it
 *   apply    puts the fault's desired state on the resource (idempotent)
 *   restore  puts a captured state back (idempotent)
 *   probe    reads current state for the "back to baseline" health check
 *
 * Captured states are plain JSON so the ledger can be saved to disk.
 */
export interface FaultDriver<F extends FaultSpec = FaultSpec, S = unknown> {
  resourceKey(fault: F, hauntingId: string): string;
  capture(fault: F, hauntingId: string): Promise<S>;
  apply(fault: F, hauntingId: string): Promise<void>;
  restore(fault: F, hauntingId: string, original: S): Promise<void>;
  probe(fault: F, hauntingId: string): Promise<unknown>;
}

export type Drivers = { [T in FaultType]: FaultDriver<Extract<FaultSpec, { type: T }>> };

export function toxicName(hauntingId: string, fault: ToxiproxyFault): string {
  const p = fault.params;
  return `wh_${hauntingId}_${p.proxy}_${p.toxic}_${p.stream ?? 'downstream'}`;
}

export function toxiproxyDriver(c: SandboxClients): FaultDriver<ToxiproxyFault, Toxic | null> {
  const desired = (f: ToxiproxyFault, hid: string): Toxic => {
    const p = f.params;
    return {
      name: toxicName(hid, f),
      type: p.toxic,
      stream: p.stream ?? 'downstream',
      toxicity: p.toxicity ?? 1,
      attributes: p.toxic === 'latency' ? { latency: p.latency, jitter: p.jitter ?? 0 } : { timeout: p.timeout },
    };
  };
  const read = (f: ToxiproxyFault, hid: string) => c.toxiproxy.getToxic(f.params.proxy, toxicName(hid, f));
  return {
    resourceKey: (f, hid) => `toxiproxy:${f.params.proxy}:${toxicName(hid, f)}`,
    capture: read,
    apply: (f, hid) => c.toxiproxy.upsertToxic(f.params.proxy, desired(f, hid)),
    restore: (f, hid, original) =>
      original === null
        ? c.toxiproxy.deleteToxic(f.params.proxy, toxicName(hid, f))
        : c.toxiproxy.upsertToxic(f.params.proxy, original),
    probe: read,
  };
}

/** Docker faults act on every container of the compose service. */
export function dockerDriver(c: SandboxClients): FaultDriver<DockerFault, Record<string, ContainerState>> {
  return {
    resourceKey: (f) => `docker:${f.params.service}`,
    async capture(f) {
      const containers = await c.docker.listContainers(f.params.service);
      return Object.fromEntries(containers.map((ct) => [ct.id, ct.state]));
    },
    async apply(f) {
      const target: ContainerState = f.params.action === 'stop' ? 'stopped' : 'paused';
      const containers = await c.docker.listContainers(f.params.service);
      if (containers.length === 0) throw new Error(`No sandbox containers found for service "${f.params.service}"`);
      for (const ct of containers) await c.docker.setState(ct.id, target);
    },
    async restore(f, _hid, original) {
      // Only containers that existed at capture time are restored. Containers the
      // player added while fixing (for example by scaling up) are left as they are.
      const existing = new Set((await c.docker.listContainers(f.params.service)).map((ct) => ct.id));
      for (const [id, state] of Object.entries(original)) {
        if (existing.has(id)) await c.docker.setState(id, state);
      }
    },
    async probe(f) {
      const containers = await c.docker.listContainers(f.params.service);
      return containers.map(({ id, state, health }) => ({ id, state, health }));
    },
  };
}

export function configDriver(c: SandboxClients): FaultDriver<ConfigFault, Scalar | null> {
  const read = (f: ConfigFault) => c.admin.getConfig(f.params.service, f.params.key);
  return {
    resourceKey: (f) => `config:${f.params.service}:${f.params.key}`,
    capture: read,
    apply: (f) => c.admin.setConfig(f.params.service, f.params.key, f.params.value),
    restore: (f, _hid, original) =>
      original === null
        ? c.admin.unsetConfig(f.params.service, f.params.key)
        : c.admin.setConfig(f.params.service, f.params.key, original),
    probe: read,
  };
}

export function debugEndpointDriver(c: SandboxClients): FaultDriver<DebugEndpointFault, ToggleState> {
  const read = (f: DebugEndpointFault) => c.admin.getToggle(f.params.service, f.params.toggle);
  return {
    resourceKey: (f) => `debug:${f.params.service}:${f.params.toggle}`,
    capture: read,
    apply: (f) =>
      c.admin.setToggle(f.params.service, f.params.toggle, { enabled: true, settings: { ...(f.params.settings ?? {}) } }),
    restore: (f, _hid, original) => c.admin.setToggle(f.params.service, f.params.toggle, original),
    probe: read,
  };
}

export function createDrivers(clients: SandboxClients): Drivers {
  return {
    toxiproxy: toxiproxyDriver(clients),
    docker: dockerDriver(clients),
    config: configDriver(clients),
    'debug-endpoint': debugEndpointDriver(clients),
  } as Drivers;
}

export function driverFor(drivers: Drivers, fault: FaultSpec): FaultDriver {
  return drivers[fault.type] as unknown as FaultDriver;
}
