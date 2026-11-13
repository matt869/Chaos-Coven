// Property 3: any two hauntings applied together revert cleanly.
import fc from 'fast-check';
import { afterEach, describe, expect, it } from 'vitest';
import { hauntingPairArb } from '../support/arbitraries.js';
import type { FakeSandbox } from '../support/fake-sandbox.js';
import { fakeEngine } from '../support/setup.js';

let sandboxes: FakeSandbox[] = [];
afterEach(() => {
  for (const s of sandboxes) s.dispose();
  sandboxes = [];
});

describe('property 3: two hauntings applied together revert cleanly', () => {
  it('reverting both in any order restores the baseline, even when they share resources', async () => {
    await fc.assert(
      fc.asyncProperty(
        hauntingPairArb,
        fc.boolean(),
        fc.boolean(),
        fc.nat({ max: 3 }),
        fc.nat({ max: 3 }),
        async ([a, b], applyAFirst, revertAFirst, stepsA, stepsB) => {
          const { engine, sandbox } = fakeEngine([a, b]);
          sandboxes.push(sandbox);
          const baseline = sandbox.snapshot();
          const probeBaseline = await engine.probe();

          const applyOrder = applyAFirst ? [a, b] : [b, a];
          for (const h of applyOrder) await engine.apply(h.id);
          // Escalations interleave with the other haunting already active.
          if (Math.min(stepsA, a.escalation.length) > 0) await engine.escalate(a.id, Math.min(stepsA, a.escalation.length));
          if (Math.min(stepsB, b.escalation.length) > 0) await engine.escalate(b.id, Math.min(stepsB, b.escalation.length));

          const revertOrder = revertAFirst ? [a, b] : [b, a];
          for (const h of revertOrder) await engine.revert(h.id);

          const result = await engine.waitForBaseline(probeBaseline, { timeoutMs: 2_000, intervalMs: 2 });
          expect(result.ok).toBe(true);
          sandbox.settle();
          expect(sandbox.snapshot()).toBe(baseline);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('reverting one haunting leaves exactly the state of the other applied alone', async () => {
    await fc.assert(
      fc.asyncProperty(hauntingPairArb, fc.boolean(), async ([a, b], applyAFirst) => {
        const both = fakeEngine([a, b]);
        const onlyB = fakeEngine([a, b]);
        sandboxes.push(both.sandbox, onlyB.sandbox);

        for (const h of applyAFirst ? [a, b] : [b, a]) await both.engine.apply(h.id);
        await both.engine.revert(a.id);
        await onlyB.engine.apply(b.id);

        both.sandbox.settle();
        onlyB.sandbox.settle();
        expect(both.sandbox.snapshot()).toBe(onlyB.sandbox.snapshot());
      }),
      { numRuns: 200 },
    );
  });
});
