// Property 2: apply(h) twice has the same effect as applying it once.
import fc from 'fast-check';
import { afterEach, describe, expect, it } from 'vitest';
import { hauntingArb } from '../support/arbitraries.js';
import type { FakeSandbox } from '../support/fake-sandbox.js';
import { fakeEngine } from '../support/setup.js';

let sandboxes: FakeSandbox[] = [];
afterEach(() => {
  for (const s of sandboxes) s.dispose();
  sandboxes = [];
});

describe('property 2: apply is idempotent', () => {
  it('applying twice leaves the sandbox exactly as applying once', async () => {
    await fc.assert(
      fc.asyncProperty(hauntingArb('h-idem'), fc.nat({ max: 3 }), async (h, steps) => {
        const once = fakeEngine([h]);
        const twice = fakeEngine([h]);
        sandboxes.push(once.sandbox, twice.sandbox);
        const reach = Math.min(steps, h.escalation.length);

        await once.engine.apply(h.id);
        if (reach > 0) await once.engine.escalate(h.id, reach);

        await twice.engine.apply(h.id);
        if (reach > 0) await twice.engine.escalate(h.id, reach);
        const second = await twice.engine.apply(h.id);
        if (reach > 0) await twice.engine.escalate(h.id, reach);

        expect(second.alreadyActive).toBe(true);
        once.sandbox.settle();
        twice.sandbox.settle();
        expect(twice.sandbox.snapshot()).toBe(once.sandbox.snapshot());
        expect(twice.engine.list()).toEqual(once.engine.list());
      }),
      { numRuns: 150 },
    );
  });

  it('a haunting applied twice still reverts to baseline in one revert', async () => {
    await fc.assert(
      fc.asyncProperty(hauntingArb('h-idem'), async (h) => {
        const { engine, sandbox } = fakeEngine([h]);
        sandboxes.push(sandbox);
        const baseline = sandbox.snapshot();

        await engine.apply(h.id);
        await engine.apply(h.id);
        await engine.revert(h.id);

        sandbox.settle();
        expect(sandbox.snapshot()).toBe(baseline);
        // Reverting again is also a no-op.
        const again = await engine.revert(h.id);
        expect(again.reverted).toBe(false);
        expect(sandbox.snapshot()).toBe(baseline);
      }),
      { numRuns: 150 },
    );
  });
});
