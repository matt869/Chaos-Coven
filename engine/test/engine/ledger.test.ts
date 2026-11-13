import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compare, stableStringify } from '../../src/engine/compare.js';
import {
  emptyLedger,
  FileLedgerStore,
  MemoryLedgerStore,
  removeClaims,
  topClaim,
  upsertClaim,
  type LedgerEntry,
} from '../../src/engine/ledger.js';
import type { FaultSpec } from '../../src/haunting/types.js';

const stop: FaultSpec = { type: 'docker', params: { service: 'worker', action: 'stop' } };
const pause: FaultSpec = { type: 'docker', params: { service: 'worker', action: 'pause' } };

function entry(): LedgerEntry {
  return { resourceKey: 'docker:worker', owner: { hauntingId: 'a', fault: stop }, original: {}, claims: [] };
}

describe('claims', () => {
  it('puts the newest haunting on top', () => {
    const e = entry();
    upsertClaim(e, { hauntingId: 'a', fault: stop });
    upsertClaim(e, { hauntingId: 'b', fault: pause });
    expect(topClaim(e)?.hauntingId).toBe('b');
  });

  it('replacing a claim keeps its position', () => {
    const e = entry();
    upsertClaim(e, { hauntingId: 'a', fault: stop });
    upsertClaim(e, { hauntingId: 'b', fault: pause });
    upsertClaim(e, { hauntingId: 'a', fault: pause });
    expect(e.claims.map((c) => c.hauntingId)).toEqual(['a', 'b']);
  });

  it('removeClaims returns only entries that changed', () => {
    const state = emptyLedger();
    const e1 = entry();
    const e2 = { ...entry(), resourceKey: 'other', claims: [] };
    upsertClaim(e1, { hauntingId: 'a', fault: stop });
    upsertClaim(e2, { hauntingId: 'b', fault: stop });
    state.entries.push(e1, e2);
    expect(removeClaims(state, 'a')).toEqual([e1]);
    expect(e1.claims).toEqual([]);
    expect(e2.claims.length).toBe(1);
  });
});

describe('ledger stores', () => {
  it('memory store round-trips and returns copies', async () => {
    const s = new MemoryLedgerStore();
    expect(await s.load()).toBeNull();
    const state = emptyLedger();
    state.active.push({ hauntingId: 'a', appliedAt: 1, step: 0 });
    await s.save(state);
    state.active = [];
    expect((await s.load())!.active.length).toBe(1);
  });

  it('file store round-trips, creates its directory and handles a missing file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'wh-ledger-'));
    const s = new FileLedgerStore(join(dir, 'nested', 'ledger.json'));
    expect(await s.load()).toBeNull();
    const state = emptyLedger();
    const e = entry();
    upsertClaim(e, { hauntingId: 'a', fault: stop });
    state.entries.push(e);
    await s.save(state);
    expect(await s.load()).toEqual(state);
  });

  it('file store rejects unknown versions', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'wh-ledger-'));
    await writeFile(join(dir, 'l.json'), JSON.stringify({ version: 99 }));
    await expect(new FileLedgerStore(join(dir, 'l.json')).load()).rejects.toThrow(/Unsupported ledger version/);
  });
});

describe('compare', () => {
  it.each([
    [5, '>', 4, true],
    [4, '>', 4, false],
    [4, '>=', 4, true],
    [3, '<', 4, true],
    [4, '<=', 4, true],
    [0, '==', 0, true],
    [1, '!=', 0, true],
  ] as const)('%d %s %d is %s', (observed, op, value, expected) => {
    expect(compare(observed, { op, value })).toBe(expected);
  });

  it('never passes on a missing or NaN value', () => {
    expect(compare(null, { op: '!=', value: 1 })).toBe(false);
    expect(compare(NaN, { op: '!=', value: 1 })).toBe(false);
  });
});

describe('stableStringify', () => {
  it('ignores key order', () => {
    expect(stableStringify({ b: 1, a: { d: 2, c: 3 } })).toBe(stableStringify({ a: { c: 3, d: 2 }, b: 1 }));
  });
});
