// Interfaces for everything the engine talks to. Real implementations live next to
// this file; tests use the in-memory fake sandbox in test/support.

import type { QuerySource, Scalar } from '../haunting/types.js';

export interface Toxic {
  name: string;
  type: 'latency' | 'timeout';
  stream: 'upstream' | 'downstream';
  toxicity: number;
  attributes: Record<string, number>;
}

export interface ToxiproxyClient {
  getToxic(proxy: string, name: string): Promise<Toxic | null>;
  /** Creates the toxic, or updates it if one with the same name exists. */
  upsertToxic(proxy: string, toxic: Toxic): Promise<void>;
  /** Removes the toxic. Does nothing if it does not exist. */
  deleteToxic(proxy: string, name: string): Promise<void>;
}

export type ContainerState = 'running' | 'paused' | 'stopped';
export type ContainerHealth = 'healthy' | 'starting' | 'unhealthy' | 'none';

export interface ContainerInfo {
  id: string;
  name: string;
  state: ContainerState;
  health: ContainerHealth;
}

export interface DockerClient {
  /** Containers of one compose service in the sandbox project only. */
  listContainers(service: string): Promise<ContainerInfo[]>;
  /** Moves a sandbox container to `state`. Does nothing if it is already there. */
  setState(containerId: string, state: ContainerState): Promise<void>;
}

export interface ToggleState {
  enabled: boolean;
  settings: Record<string, Scalar>;
}

export interface ServiceAdminClient {
  /** Returns null when the key is unset. */
  getConfig(service: string, key: string): Promise<Scalar | null>;
  setConfig(service: string, key: string, value: Scalar): Promise<void>;
  unsetConfig(service: string, key: string): Promise<void>;
  getToggle(service: string, toggle: string): Promise<ToggleState>;
  setToggle(service: string, toggle: string, state: ToggleState): Promise<void>;
}

export interface QueryClient {
  /**
   * Runs an instant query and returns its single value, or null when it returns no series.
   * Throws if the query returns more than one series.
   */
  query(source: QuerySource, query: string): Promise<number | null>;
}

export interface SandboxClients {
  toxiproxy: ToxiproxyClient;
  docker: DockerClient;
  admin: ServiceAdminClient;
}
