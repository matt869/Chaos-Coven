// Property 1: for any haunting h, apply(h) then revert(h) returns all health probes
// to baseline within a timeout.
import fc from 'fast-check';
import { afterEach, describe, expect, it } from 'vitest';
import { SERVICES } from '../../src/haunting/types.js';
import { hauntingArb } from '../support/arbitraries.js';
import type { FakeSandbox } from '../support/fake-sandbox.js';
import { fakeEngine, loadRepoHaunting } from '../support/setup.js';

const BASELINE_TIMEOUT_MS = 2_000;

let sandboxes: FakeSandbox[] = [];
afterEach(() => {
  for (const s of sandboxes) s.dispose();
  sandboxes = [];
});

describe('property 1: apply then revert returns to baseline', () => {
  it('holds for any generated haunting, escalation depth and player restart', async () => {
    await fc.assert(
      fc.asyncProperty(
        hauntingArb('h-one'),
        fc.nat({ max: 3 }),
        fc.option(fc.constantFrom(...SERVICES), { nil: undefined }),
        async (h, steps, restartedByPlayer) => {
          const { engine, sandbox } = fakeEngine([h]);
          sandboxes.push(sandbox);
          const fullBaseline = sandbox.snapshot();
          const baseline = await engine.probe();

          await engine.apply(h.id);
          const reach = Math.min(steps, h.escalation.length);
          if (reach > 0) await engine.escalate(h.id, reach);
          // The player may restart a service while investigating. Revert must still work.
          if (restartedByPlayer !== undefined) sandbox.playerRestart(restartedByPlayer);
          await engine.revert(h.id);

          const result = await engine.waitForBaseline(baseline, { timeoutMs: BASELINE_TIMEOUT_MS, intervalMs: 2 });
          expect(result.ok, `not back to baseline after ${result.elapsedMs}ms`).toBe(true);

          // Nothing outside the haunting's own resources changed either.
          sandbox.settle();
          expect(sandbox.snapshot()).toBe(fullBaseline);
        },
      ),
      { numRuns: 150 },
    );
  });

  it('holds for the-vanishing, including after the player scales the worker up', async () => {
    const h = loadRepoHaunting('the-vanishing');
    await fc.assert(
      fc.asyncProperty(fc.nat({ max: 2 }), fc.boolean(), async (steps, scaleUp) => {
        const { engine, sandbox } = fakeEngine([h]);
        sandboxes.push(sandbox);
        const baseline = await engine.probe();

        await engine.apply(h.id);
        if (steps > 0) await engine.escalate(h.id, steps);
        let extra: string | undefined;
        if (scaleUp) extra = sandbox.playerScaleUp('worker');
        await engine.revert(h.id);

        // The scaled-up container is the player's, so the baseline ignores it.
        if (extra !== undefined) sandbox.containers.delete(extra);
        const result = await engine.waitForBaseline(baseline, { timeoutMs: BASELINE_TIMEOUT_MS, intervalMs: 2 });
        expect(result.ok).toBe(true);
      }),
      { numRuns: 30 },
    );
  });
});
