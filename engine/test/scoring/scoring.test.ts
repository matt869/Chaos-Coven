import { describe, expect, it } from 'vitest';
import { scoreRun, type RunRecord } from '../../src/scoring/index.js';
import { loadRepoHaunting } from '../support/setup.js';

const h = loadRepoHaunting('the-vanishing');
const START = 1_700_000_000_000;
const sec = (n: number) => START + n * 1000;

function run(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    hauntingId: 'the-vanishing',
    startedAt: START,
    detectedAt: sec(120),
    diagnosis: { component: 'worker', summary: 'The worker is stopped so nothing consumes the orders queue.' },
    fixVerified: true,
    actions: [{ at: sec(150), command: 'haunt restart worker' }],
    ...overrides,
  };
}

describe('scoreRun on the-vanishing', () => {
  it('gives a perfect run 100', () => {
    const s = scoreRun(h, run());
    expect(s.total).toBe(100);
    expect(s.detection.points).toBe(30);
    expect(s.rootCause).toMatchObject({ points: 30, componentCorrect: true, keywordGroupsMatched: 2 });
    expect(s.fix.points).toBe(40);
    expect(s.penalties.items).toEqual([]);
  });

  it('decays detection points linearly after par and hits 0 at 4x par', () => {
    expect(scoreRun(h, run({ detectedAt: sec(300) })).detection.points).toBe(30);
    expect(scoreRun(h, run({ detectedAt: sec(750) })).detection.points).toBe(15);
    expect(scoreRun(h, run({ detectedAt: sec(1200) })).detection.points).toBe(0);
    expect(scoreRun(h, run({ detectedAt: undefined })).detection).toMatchObject({ points: 0, seconds: null });
  });

  it('gives no root-cause points for the wrong component, even with the right words', () => {
    const s = scoreRun(h, run({ diagnosis: { component: 'storefront', summary: 'worker stopped, queue backlog' } }));
    expect(s.rootCause).toMatchObject({ points: 0, componentCorrect: false });
  });

  it('gives partial keyword credit', () => {
    const s = scoreRun(h, run({ diagnosis: { component: 'Worker', summary: 'it crashed' } }));
    expect(s.rootCause).toMatchObject({ points: 20, keywordGroupsMatched: 1, keywordGroupsRequired: 2 });
  });

  it('only awards fix points when the fix was verified', () => {
    expect(scoreRun(h, run({ fixVerified: false })).fix.points).toBe(0);
  });

  it('penalizes each harmful action every time, whatever the spacing or case', () => {
    const s = scoreRun(
      h,
      run({
        actions: [
          { at: sec(10), command: 'haunt restart storefront' },
          { at: sec(20), command: '  HAUNT  purge-queue   orders' },
          { at: sec(30), command: 'haunt restart storefront' },
        ],
      }),
    );
    expect(s.penalties.points).toBe(10 + 30 + 10);
    expect(s.penalties.items.map((i) => i.penalty)).toEqual([10, 30, 10]);
    expect(s.total).toBe(50);
  });

  it('never goes below 0', () => {
    const actions = Array.from({ length: 10 }, (_, i) => ({ at: sec(i), command: 'haunt purge-queue orders' }));
    expect(scoreRun(h, run({ actions, fixVerified: false })).total).toBe(0);
  });

  it('refuses to score a run against the wrong haunting', () => {
    expect(() => scoreRun(h, run({ hauntingId: 'other' }))).toThrow(/scored against/);
  });
});
