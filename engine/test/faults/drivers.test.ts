import { afterEach, describe, expect, it } from 'vitest';
import { createDrivers, toxicName } from '../../src/faults/drivers.js';
import type { ConfigFault, DebugEndpointFault, DockerFault, ToxiproxyFault } from '../../src/haunting/types.js';
import { FakeSandbox } from '../../src/testing/fake-sandbox.js';

let sandbox: FakeSandbox;
afterEach(() => sandbox?.dispose());

function setup() {
  sandbox = new FakeSandbox();
  return createDrivers(sandbox.clients());
}

describe('toxiproxy driver', () => {
  const fault: ToxiproxyFault = { type: 'toxiproxy', params: { proxy: 'storefront_queue', toxic: 'latency', latency: 1500, jitter: 250 } };

  it('adds a toxic named after the haunting and removes it on restore', async () => {
    const d = setup().toxiproxy;
    const original = await d.capture(fault, 'h1');
    expect(original).toBeNull();
    await d.apply(fault, 'h1');
    const name = toxicName('h1', fault);
    expect(sandbox.toxics.get('storefront_queue')!.get(name)).toEqual({
      name,
      type: 'latency',
      stream: 'downstream',
      toxicity: 1,
      attributes: { latency: 1500, jitter: 250 },
    });
    await d.restore(fault, 'h1', original);
    expect(sandbox.toxics.get('storefront_queue')!.size).toBe(0);
  });

  it('gives different hauntings different toxics on the same proxy', () => {
    const d = setup().toxiproxy;
    expect(d.resourceKey(fault, 'h1')).not.toBe(d.resourceKey(fault, 'h2'));
  });

  it('builds timeout toxics', async () => {
    const d = setup().toxiproxy;
    const t: ToxiproxyFault = { type: 'toxiproxy', params: { proxy: 'worker_postgres', toxic: 'timeout', timeout: 0, stream: 'upstream' } };
    await d.apply(t, 'h1');
    expect(await d.probe(t, 'h1')).toMatchObject({ type: 'timeout', stream: 'upstream', attributes: { timeout: 0 } });
  });
});

describe('docker driver', () => {
  const stop: DockerFault = { type: 'docker', params: { service: 'worker', action: 'stop' } };

  it('stops every container of the service and restores each one', async () => {
    const d = setup().docker;
    const original = await d.capture(stop, 'h1');
    expect(original).toEqual({ 'worker-1': 'running', 'worker-2': 'running' });
    await d.apply(stop, 'h1');
    expect([...sandbox.containers.values()].filter((c) => c.service === 'worker').map((c) => c.state)).toEqual(['stopped', 'stopped']);
    await d.restore(stop, 'h1', original);
    expect([...sandbox.containers.values()].filter((c) => c.service === 'worker').map((c) => c.state)).toEqual(['running', 'running']);
  });

  it('pauses containers', async () => {
    const d = setup().docker;
    await d.apply({ type: 'docker', params: { service: 'queue', action: 'pause' } }, 'h1');
    expect(sandbox.containers.get('queue-1')!.state).toBe('paused');
  });

  it('leaves containers the player added alone on restore', async () => {
    const d = setup().docker;
    const original = await d.capture(stop, 'h1');
    await d.apply(stop, 'h1');
    const extra = sandbox.playerScaleUp('worker');
    await d.restore(stop, 'h1', original);
    expect(sandbox.containers.get(extra)!.state).toBe('running');
    expect(sandbox.calls.filter((c) => c.includes(extra))).toEqual([]);
  });

  it('reports health in probes', async () => {
    const d = setup().docker;
    expect(await d.probe(stop, 'h1')).toEqual([
      { id: 'worker-1', state: 'running', health: 'healthy' },
      { id: 'worker-2', state: 'running', health: 'healthy' },
    ]);
  });
});

describe('config driver', () => {
  it('sets a value and restores the original', async () => {
    const d = setup().config;
    const f: ConfigFault = { type: 'config', params: { service: 'cart', key: 'pool.max_connections', value: 1 } };
    const original = await d.capture(f, 'h1');
    await d.apply(f, 'h1');
    expect(sandbox.config.get('cart')!.get('pool.max_connections')).toBe(1);
    await d.restore(f, 'h1', original);
    expect(sandbox.config.get('cart')!.get('pool.max_connections')).toBe(20);
  });

  it('unsets a key that was unset before', async () => {
    const d = setup().config;
    const f: ConfigFault = { type: 'config', params: { service: 'worker', key: 'cache.ttl_s', value: 0 } };
    const original = await d.capture(f, 'h1');
    expect(original).toBeNull();
    await d.apply(f, 'h1');
    await d.restore(f, 'h1', original);
    expect(sandbox.config.get('worker')!.has('cache.ttl_s')).toBe(false);
  });
});

describe('debug-endpoint driver', () => {
  it('enables a toggle with settings and restores the original', async () => {
    const d = setup()['debug-endpoint'];
    const f: DebugEndpointFault = { type: 'debug-endpoint', params: { service: 'payments', toggle: 'memory-leak', settings: { size_mb: 5 } } };
    const original = await d.capture(f, 'h1');
    await d.apply(f, 'h1');
    expect(sandbox.toggles.get('payments')!.get('memory-leak')).toEqual({ enabled: true, settings: { size_mb: 5 } });
    await d.restore(f, 'h1', original);
    expect(sandbox.toggles.get('payments')!.get('memory-leak')).toEqual({ enabled: false, settings: {} });
  });
});
