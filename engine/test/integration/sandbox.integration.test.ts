// Property 1 against the real Docker Compose sandbox, using the real Docker,
// Toxiproxy and admin clients. Skipped unless WH_SANDBOX=1, because it needs
// `docker compose up` in sandbox/ first. Run with:
//
//   WH_SANDBOX=1 npx vitest run test/integration
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config.js';
import { createSandboxEngine } from '../../src/index.js';

const enabled = process.env.WH_SANDBOX === '1';

describe.skipIf(!enabled)('real sandbox', () => {
  it('apply then revert returns every haunting to baseline', async () => {
    const { engine } = await createSandboxEngine({ ...loadConfig(), ledgerPath: '.witching/integration-ledger.json' });
    await engine.init();
    const ids = engine.list().map((h) => h.id);

    await fc.assert(
      fc.asyncProperty(fc.constantFrom(...ids), fc.nat({ max: 3 }), async (id, steps) => {
        const baseline = await engine.probe([id]);
        await engine.apply(id);
        const max = engine.get(id).escalation.length;
        if (Math.min(steps, max) > 0) await engine.escalate(id, Math.min(steps, max));
        await engine.revert(id);
        const r = await engine.waitForBaseline(baseline, { ids: [id], timeoutMs: 90_000, intervalMs: 1_000 });
        expect(r.ok, `${id} not back to baseline after ${r.elapsedMs}ms`).toBe(true);
      }),
      { numRuns: 5, endOnFailure: true },
    );
  }, 15 * 60_000);
});
