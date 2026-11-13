import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { FaultSpec } from '../haunting/types.js';

/**
 * The ledger is how the engine keeps every fault reversible, even when hauntings
 * overlap.
 *
 * Each sandbox resource a fault touches gets one entry. The entry stores the
 * resource's original state, captured before the first fault touched it, and a stack
 * of claims, one per haunting that wants the resource faulted. The top claim decides
 * the resource's current state. When a haunting is reverted its claims are removed:
 * if other claims remain, the new top is applied, and if none remain, the original is
 * restored and the entry is deleted.
 *
 * An entry with no claims means "restore still pending" (an earlier restore failed).
 * The engine retries it on the next revert.
 */
export interface LedgerClaim {
  hauntingId: string;
  fault: FaultSpec;
}

export interface LedgerEntry {
  resourceKey: string;
  /** The claim that created the entry. Restore uses it to address the resource. */
  owner: LedgerClaim;
  original: unknown;
  claims: LedgerClaim[];
}

export interface ActiveHaunting {
  hauntingId: string;
  appliedAt: number;
  /** Highest escalation step applied, 0 if none. */
  step: number;
}

export interface LedgerState {
  version: 1;
  entries: LedgerEntry[];
  active: ActiveHaunting[];
}

export const emptyLedger = (): LedgerState => ({ version: 1, entries: [], active: [] });

/**
 * Adds or replaces `hauntingId`'s claim on the entry. A replaced claim keeps its
 * position in the stack, so re-applying a haunting never changes which claim is on top.
 */
export function upsertClaim(entry: LedgerEntry, claim: LedgerClaim): void {
  const i = entry.claims.findIndex((c) => c.hauntingId === claim.hauntingId);
  if (i === -1) entry.claims.push(claim);
  else entry.claims[i] = claim;
}

export function topClaim(entry: LedgerEntry): LedgerClaim | undefined {
  return entry.claims[entry.claims.length - 1];
}

/** Removes every claim held by `hauntingId`. Returns the entries that changed. */
export function removeClaims(state: LedgerState, hauntingId: string): LedgerEntry[] {
  const touched: LedgerEntry[] = [];
  for (const entry of state.entries) {
    const before = entry.claims.length;
    entry.claims = entry.claims.filter((c) => c.hauntingId !== hauntingId);
    if (entry.claims.length !== before) touched.push(entry);
  }
  return touched;
}

export interface LedgerStore {
  load(): Promise<LedgerState | null>;
  save(state: LedgerState): Promise<void>;
}

export class MemoryLedgerStore implements LedgerStore {
  private saved: string | null = null;

  async load(): Promise<LedgerState | null> {
    return this.saved === null ? null : (JSON.parse(this.saved) as LedgerState);
  }

  async save(state: LedgerState): Promise<void> {
    this.saved = JSON.stringify(state);
  }
}

/** Saves the ledger as JSON so a restarted engine can revert faults left by a crash. */
export class FileLedgerStore implements LedgerStore {
  constructor(private readonly path: string) {}

  async load(): Promise<LedgerState | null> {
    try {
      const state = JSON.parse(await readFile(this.path, 'utf8')) as LedgerState;
      if (state.version !== 1) throw new Error(`Unsupported ledger version in ${this.path}`);
      return state;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  async save(state: LedgerState): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    await writeFile(tmp, JSON.stringify(state, null, 2), 'utf8');
    await rename(tmp, this.path);
  }
}
