import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDrivers, Engine, loadHauntings, MemoryLedgerStore, type Scalar } from '@witching-hour/engine';
import { FakeSandbox } from '@witching-hour/engine/testing';
import { StaticNarrator, type Narrator } from '../src/narrator/bedrock.js';
import { SessionManager, type Timers } from '../src/session/session.js';
import type { LogLine, Observability, SandboxControl } from '../src/terminal/executor.js';

export const HAUNTINGS_DIR = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../hauntings');

/** Player actions against the engine's in-memory fake sandbox. */
export class FakeControl implements SandboxControl {
  purged = 0;
  queue = 0;
  constructor(readonly sandbox: FakeSandbox) {}
  async status() {
    return [...this.sandbox.containers.values()].map((c) => ({ service: c.service, name: c.name, state: c.state, health: c.health }));
  }
  async restart(service: string) {
    const n = [...this.sandbox.containers.values()].filter((c) => c.service === service).length;
    this.sandbox.playerRestart(service);
    return n;
  }
  async scaleWorker(replicas: number) {
    while ([...this.sandbox.containers.values()].filter((c) => c.service === 'worker').length < replicas) this.sandbox.playerScaleUp('worker');
  }
  async purgeOrders() {
    this.purged++;
    const n = this.queue;
    this.queue = 0;
    return n;
  }
  configGet(service: string, key: string) {
    return this.sandbox.adminClient().getConfig(service, key);
  }
  configSet(service: string, key: string, value: Scalar) {
    return this.sandbox.adminClient().setConfig(service, key, value);
  }
}

export class FakeObservability implements Observability {
  lines: Record<string, LogLine[]> = {};
  series: Record<string, { labels: Record<string, string>; value: string }[]> = {};
  async logs(service: string, _minutes: number, grep?: string) {
    return (this.lines[service] ?? []).filter((l) => grep === undefined || l.line.includes(grep));
  }
  async promql(expr: string) {
    return this.series[expr] ?? [];
  }
  async queueDepth() {
    return null;
  }
}

/** Manual timers: tests fire them explicitly. */
export class ManualTimers implements Timers {
  pending = new Map<number, { fn: () => void; ms: number }>();
  private next = 1;
  setTimeout(fn: () => void, ms: number) {
    const id = this.next++;
    this.pending.set(id, { fn, ms });
    return id;
  }
  clearTimeout(h: unknown) {
    this.pending.delete(h as number);
  }
  /** Fires every timer due within `ms`, in order. */
  fireUpTo(ms: number) {
    const due = [...this.pending].filter(([, t]) => t.ms <= ms).sort((a, b) => a[1].ms - b[1].ms);
    for (const [id, t] of due) {
      this.pending.delete(id);
      t.fn();
    }
  }
}

export async function setup(opts: { narrator?: Narrator; now?: { t: number }; idleMinutes?: number } = {}) {
  const { hauntings, invalid } = await loadHauntings(HAUNTINGS_DIR);
  if (invalid.length > 0) throw new Error(`invalid hauntings: ${JSON.stringify(invalid)}`);
  const sandbox = new FakeSandbox();
  const engine = new Engine({ hauntings, drivers: createDrivers(sandbox.clients()), queries: sandbox.queryClient(), store: new MemoryLedgerStore() });
  const control = new FakeControl(sandbox);
  const observability = new FakeObservability();
  const timers = new ManualTimers();
  const now = opts.now ?? { t: 1_700_000_000_000 };
  const sessions = new SessionManager({
    engine,
    narrator: opts.narrator ?? new StaticNarrator(),
    exec: { control, observability },
    clock: () => now.t,
    timers,
    idleMinutes: opts.idleMinutes,
  });
  return { sandbox, engine, control, observability, timers, sessions, now };
}
