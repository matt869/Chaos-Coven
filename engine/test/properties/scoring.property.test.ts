// Property 4: adding a harmful action never increases a score.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { scoreRun, type PlayerAction, type RunRecord } from '../../src/scoring/index.js';
import { SERVICES, type Haunting } from '../../src/haunting/types.js';
import { hauntingArb } from '../support/arbitraries.js';
import { loadRepoHaunting } from '../support/setup.js';

const START = 1_700_000_000_000;

const commandArb = fc.oneof(
  fc.constantFrom('haunt restart worker', 'haunt logs worker', 'haunt status', 'haunt scale worker 2'),
  fc.string({ maxLength: 30 }),
);

function runArb(h: Haunting): fc.Arbitrary<RunRecord> {
  return fc.record(
    {
      hauntingId: fc.constant(h.id),
      startedAt: fc.constant(START),
      detectedAt: fc.integer({ min: START - 10_000, max: START + 4 * 3600 * 1000 }),
      diagnosis: fc.record({
        component: fc.constantFrom(...SERVICES),
        summary: fc.oneof(fc.constant(h.rootCause.summary), fc.string({ maxLength: 60 })),
      }),
      fixVerified: fc.boolean(),
      actions: fc.array(
        fc.record({ at: fc.integer({ min: START, max: START + 3600_000 }), command: commandArb }),
        { maxLength: 15 },
      ),
    },
    { requiredKeys: ['hauntingId', 'startedAt', 'fixVerified', 'actions'] },
  );
}

/** A run, plus a harmful action of that haunting and a position to insert it at. */
const scenarioArb = fc
  .oneof(
    hauntingArb('h-score').filter((h) => h.harmfulActions.length > 0),
    fc.constant(loadRepoHaunting('the-vanishing')),
  )
  .chain((h) =>
    fc.tuple(
      fc.constant(h),
      runArb(h),
      fc.constantFrom(...h.harmfulActions),
      fc.nat(),
      fc.integer({ min: START, max: START + 3600_000 }),
      // Players do not type commands in a consistent case or spacing.
      fc.constantFrom((s: string) => s, (s: string) => s.toUpperCase(), (s: string) => `  ${s.replace(/ /g, '   ')} `),
    ),
  );

describe('property 4: harmful actions never increase a score', () => {
  it('inserting a harmful action anywhere never raises the total', () => {
    fc.assert(
      fc.property(scenarioArb, ([h, run, harmful, pos, at, spell]) => {
        const before = scoreRun(h, run);
        const actions = [...run.actions];
        const action: PlayerAction = { at, command: spell(harmful.action) };
        actions.splice(pos % (actions.length + 1), 0, action);
        const after = scoreRun(h, { ...run, actions });

        expect(after.total).toBeLessThanOrEqual(before.total);
        expect(after.penalties.points).toBe(before.penalties.points + harmful.penalty);
      }),
      { numRuns: 500 },
    );
  });

  it('scores always stay within 0-100 and are deterministic', () => {
    fc.assert(
      fc.property(
        fc.oneof(hauntingArb('h-score'), fc.constant(loadRepoHaunting('the-vanishing'))).chain((h) =>
          fc.tuple(fc.constant(h), runArb(h)),
        ),
        ([h, run]) => {
          const a = scoreRun(h, run);
          expect(a.total).toBeGreaterThanOrEqual(0);
          expect(a.total).toBeLessThanOrEqual(100);
          expect(Number.isInteger(a.total)).toBe(true);
          expect(scoreRun(h, structuredClone(run))).toEqual(a);
        },
      ),
      { numRuns: 500 },
    );
  });

  it('detecting earlier never scores lower, all else equal', () => {
    fc.assert(
      fc.property(
        hauntingArb('h-score').chain((h) => fc.tuple(fc.constant(h), runArb(h))),
        fc.integer({ min: 0, max: 4 * 3600 * 1000 }),
        fc.integer({ min: 0, max: 4 * 3600 * 1000 }),
        ([h, run], t1, t2) => {
          const [early, late] = t1 <= t2 ? [t1, t2] : [t2, t1];
          const sEarly = scoreRun(h, { ...run, detectedAt: START + early });
          const sLate = scoreRun(h, { ...run, detectedAt: START + late });
          expect(sEarly.total).toBeGreaterThanOrEqual(sLate.total);
        },
      ),
      { numRuns: 300 },
    );
  });
});
