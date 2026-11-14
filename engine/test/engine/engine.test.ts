import { afterEach, describe, expect, it } from 'vitest';
import { HauntingNotActiveError, RevertError, UnknownHauntingError } from '../../src/engine/engine.js';
import { MemoryLedgerStore } from '../../src/engine/ledger.js';
import { toxicName } from '../../src/faults/drivers.js';
import type { Haunting } from '../../src/haunting/types.js';
import { FakeSandbox } from '../../src/testing/fake-sandbox.js';
import { fakeEngine, loadRepoHaunting } from '../support/setup.js';

let sandboxes: FakeSandbox[] = [];
afterEach(() => {
  for (const s of sandboxes) s.dispose();
  sandboxes = [];
});

function vanishing(): Haunting {
  return loadRepoHaunting('the-vanishing');
}

function configHaunting(id: string, value: number): Haunting {
  return {
    ...vanishing(),
    id,
    target: 'cart',
    fault: { type: 'config', params: { service: 'cart', key: 'pool.max_connections', value } },
    escalation: [],
  };
}

function setup(hauntings: Haunting[] = [vanishing()], opts: Parameters<typeof fakeEngine>[1] = {}) {
  const r = fakeEngine(hauntings, { clock: () => 1000, ...opts });
  sandboxes.push(r.sandbox);
  return r;
}

const workerStates = (s: FakeSandbox) =>
  [...s.containers.values()].filter((c) => c.service === 'worker').map((c) => c.state);

describe('list', () => {
  it('summarizes hauntings and their state', async () => {
    const { engine } = setup();
    expect(engine.list()).toEqual([
      {
        id: 'the-vanishing',
        name: 'The Vanishing',
        difficulty: 'easy',
        target: 'worker',
        faultType: 'docker',
        escalationSteps: 2,
        active: false,
        step: 0,
      },
    ]);
    await engine.apply('the-vanishing');
    await engine.escalate('the-vanishing', 1);
    expect(engine.list()[0]).toMatchObject({ active: true, step: 1 });
  });
});

describe('apply', () => {
  it('stops the worker and returns the page for the player', async () => {
    const { engine, sandbox } = setup();
    const r = await engine.apply('the-vanishing');
    expect(r).toMatchObject({ id: 'the-vanishing', alreadyActive: false, appliedAt: 1000 });
    expect(r.page.alert).toMatch(/orders never get confirmed/);
    expect(workerStates(sandbox)).toEqual(['stopped', 'stopped']);
    // Nothing else was touched.
    expect(sandbox.calls.every((c) => c.includes('worker'))).toBe(true);
  });

  it('applying again reports alreadyActive and changes nothing', async () => {
    const { engine, sandbox } = setup();
    await engine.apply('the-vanishing');
    const calls = sandbox.calls.length;
    expect((await engine.apply('the-vanishing')).alreadyActive).toBe(true);
    expect(sandbox.calls.length).toBe(calls);
  });

  it('rejects unknown hauntings', async () => {
    const { engine } = setup();
    await expect(engine.apply('nope')).rejects.toThrow(UnknownHauntingError);
  });

  it('rolls back when the sandbox rejects the fault', async () => {
    const { engine, sandbox } = setup();
    const before = sandbox.snapshot();
    sandbox.failNext('docker.setState');
    await expect(engine.apply('the-vanishing')).rejects.toThrow(/injected failure/);
    sandbox.settle();
    expect(sandbox.snapshot()).toBe(before);
    expect(engine.list()[0]!.active).toBe(false);
  });
});

describe('escalate', () => {
  it('applies steps cumulatively and only once', async () => {
    const { engine, sandbox } = setup();
    await engine.apply('the-vanishing');
    const r = await engine.escalate('the-vanishing', 2);
    expect(r.applied.map((a) => a.step)).toEqual([1, 2]);
    const h = vanishing();
    const toxic = h.escalation[1]!.faults[0]!;
    expect(toxic.type).toBe('toxiproxy');
    const name = toxicName('the-vanishing', toxic as Extract<typeof toxic, { type: 'toxiproxy' }>);
    expect(sandbox.toxics.get('storefront_queue')!.get(name)?.attributes).toEqual({ latency: 1500, jitter: 250 });

    expect((await engine.escalate('the-vanishing', 1)).applied).toEqual([]);
    expect((await engine.escalate('the-vanishing', 2)).applied).toEqual([]);
  });

  it('requires the haunting to be active and the step to exist', async () => {
    const { engine } = setup();
    await expect(engine.escalate('the-vanishing', 1)).rejects.toThrow(HauntingNotActiveError);
    await engine.apply('the-vanishing');
    await expect(engine.escalate('the-vanishing', 3)).rejects.toThrow(RangeError);
    await expect(engine.escalate('the-vanishing', 0)).rejects.toThrow(RangeError);
  });
});

describe('revert', () => {
  it('restarts the worker and removes escalation toxics', async () => {
    const { engine, sandbox } = setup();
    const before = sandbox.snapshot();
    await engine.apply('the-vanishing');
    await engine.escalate('the-vanishing', 2);
    const r = await engine.revert('the-vanishing');
    expect(r.reverted).toBe(true);
    expect(r.restored).toHaveLength(2);
    expect(r.restored).toEqual(
      expect.arrayContaining(['docker:worker', expect.stringMatching(/^toxiproxy:storefront_queue:/)]),
    );
    sandbox.settle();
    expect(sandbox.snapshot()).toBe(before);
  });

  it('is a no-op for inactive hauntings and rejects unknown ones', async () => {
    const { engine } = setup();
    expect(await engine.revert('the-vanishing')).toEqual({ id: 'the-vanishing', reverted: false, restored: [], handedOver: [] });
    await expect(engine.revert('nope')).rejects.toThrow(UnknownHauntingError);
  });

  it('hands a shared resource to the other active haunting instead of restoring it', async () => {
    const { engine, sandbox } = setup([configHaunting('h-a', 1), configHaunting('h-b', 2)]);
    await engine.apply('h-a');
    await engine.apply('h-b');
    expect(sandbox.config.get('cart')!.get('pool.max_connections')).toBe(2);

    const r = await engine.revert('h-b');
    expect(r.handedOver).toEqual(['config:cart:pool.max_connections']);
    expect(sandbox.config.get('cart')!.get('pool.max_connections')).toBe(1);

    await engine.revert('h-a');
    expect(sandbox.config.get('cart')!.get('pool.max_connections')).toBe(20);
  });

  it('keeps a failed restore in the ledger and retries it on the next revert', async () => {
    const { engine, sandbox } = setup();
    await engine.apply('the-vanishing');
    sandbox.failNext('docker.setState');
    await expect(engine.revert('the-vanishing')).rejects.toThrow(RevertError);
    expect(workerStates(sandbox)).toContain('stopped');

    await engine.revertAll();
    expect(workerStates(sandbox)).toEqual(['running', 'running']);
  });

  it('revertAll reverts every active haunting', async () => {
    const { engine, sandbox } = setup([vanishing(), configHaunting('h-a', 1)]);
    const before = sandbox.snapshot();
    await engine.apply('the-vanishing');
    await engine.apply('h-a');
    const results = await engine.revertAll();
    expect(results.map((r) => r.id).sort()).toEqual(['h-a', 'the-vanishing']);
    sandbox.settle();
    expect(sandbox.snapshot()).toBe(before);
  });
});

describe('crash recovery', () => {
  it('init() reverts faults a crashed engine left behind', async () => {
    const store = new MemoryLedgerStore();
    const sandbox = new FakeSandbox();
    sandboxes.push(sandbox);
    const before = sandbox.snapshot();

    const crashed = fakeEngine([vanishing()], { sandbox, store }).engine;
    await crashed.apply('the-vanishing');
    await crashed.escalate('the-vanishing', 2);
    // The process dies here. A new engine starts with the same ledger.

    const restarted = fakeEngine([vanishing()], { sandbox, store }).engine;
    expect(await restarted.init()).toEqual(['the-vanishing']);
    sandbox.settle();
    expect(sandbox.snapshot()).toBe(before);
    expect(restarted.list()[0]!.active).toBe(false);
  });

  it('init() can revert a haunting whose file no longer exists', async () => {
    const store = new MemoryLedgerStore();
    const sandbox = new FakeSandbox();
    sandboxes.push(sandbox);
    const before = sandbox.snapshot();
    await fakeEngine([vanishing()], { sandbox, store }).engine.apply('the-vanishing');

    const restarted = fakeEngine([], { sandbox, store }).engine;
    await restarted.init();
    sandbox.settle();
    expect(sandbox.snapshot()).toBe(before);
  });
});

describe('verify', () => {
  it('passes with evidence when every check passes', async () => {
    const { engine, sandbox } = setup();
    sandbox.setQuery('prometheus', 'sum(up{job="worker"})', 2);
    sandbox.setQuery('prometheus', 'sum(rate(witching_worker_jobs_processed_total[1m]))', 4.2);
    sandbox.setQuery('prometheus', 'sum(deriv(witching_queue_depth{queue="orders"}[2m]))', -1.5);
    const r = await engine.verify('the-vanishing');
    expect(r.pass).toBe(true);
    expect(r.checks.map((c) => [c.id, c.observed, c.pass])).toEqual([
      ['worker-up', 2, true],
      ['worker-consuming', 4.2, true],
      ['queue-draining', -1.5, true],
    ]);
  });

  it('uses emptyValue for missing series and fails checks that cannot be evaluated', async () => {
    const { engine, sandbox } = setup();
    // worker-up and worker-consuming return no series, so they fall back to 0.
    sandbox.setQuery('prometheus', 'sum(deriv(witching_queue_depth{queue="orders"}[2m]))', new Error('prometheus down'));
    const r = await engine.verify('the-vanishing');
    expect(r.pass).toBe(false);
    expect(r.checks[0]).toMatchObject({ id: 'worker-up', observed: 0, pass: false });
    expect(r.checks[2]).toMatchObject({ id: 'queue-draining', observed: null, pass: false, error: 'prometheus down' });
  });
});

describe('signals', () => {
  it('evaluates each signal and reports whether it currently matches', async () => {
    const { engine, sandbox } = setup();
    sandbox.setQuery('prometheus', 'sum(witching_queue_depth{queue="orders"})', 850);
    const r = await engine.signals('the-vanishing');
    const byId = Object.fromEntries(r.signals.map((s) => [s.id, s]));
    expect(byId['queue-depth-rising']).toMatchObject({ kind: 'symptom', observed: 850, pass: true });
    expect(byId['worker-logs-silent']).toMatchObject({ kind: 'cause', source: 'loki', observed: 0, pass: true });
    expect(byId['storefront-errors-normal']).toMatchObject({ kind: 'red-herring', pass: true });
    expect(byId['checkout-latency-high']).toMatchObject({ observed: null, pass: false });
  });
});

describe('probe and waitForBaseline', () => {
  it('times out when the sandbox does not return to baseline', async () => {
    const { engine } = setup();
    const baseline = await engine.probe();
    await engine.apply('the-vanishing');
    const r = await engine.waitForBaseline(baseline, { timeoutMs: 20, intervalMs: 5 });
    expect(r.ok).toBe(false);
  });

  it('waits for restarted containers to become healthy', async () => {
    const sandbox = new FakeSandbox(undefined, 30);
    const { engine } = setup([vanishing()], { sandbox });
    const baseline = await engine.probe();
    await engine.apply('the-vanishing');
    await engine.revert('the-vanishing');
    expect(await engine.probe()).not.toEqual(baseline);
    const r = await engine.waitForBaseline(baseline, { timeoutMs: 1000, intervalMs: 5 });
    expect(r.ok).toBe(true);
    expect(r.elapsedMs).toBeGreaterThan(0);
  });
});
