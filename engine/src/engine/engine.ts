import type { QueryClient } from '../clients/types.js';
import { driverFor, type Drivers } from '../faults/drivers.js';
import type { Comparison, FaultSpec, Haunting, QueryDefinition, SignalDefinition } from '../haunting/types.js';
import { compare, stableStringify } from './compare.js';
import {
  emptyLedger,
  MemoryLedgerStore,
  removeClaims,
  topClaim,
  upsertClaim,
  type LedgerClaim,
  type LedgerEntry,
  type LedgerState,
  type LedgerStore,
} from './ledger.js';

export class UnknownHauntingError extends Error {
  constructor(readonly hauntingId: string) {
    super(`Unknown haunting "${hauntingId}"`);
    this.name = 'UnknownHauntingError';
  }
}

export class HauntingNotActiveError extends Error {
  constructor(readonly hauntingId: string) {
    super(`Haunting "${hauntingId}" is not active. Apply it first.`);
    this.name = 'HauntingNotActiveError';
  }
}

export class RevertError extends Error {
  constructor(
    readonly hauntingId: string,
    readonly failures: { resourceKey: string; error: string }[],
  ) {
    super(
      `Could not fully revert "${hauntingId}". These resources will be retried on the next revert: ` +
        failures.map((f) => `${f.resourceKey} (${f.error})`).join('; '),
    );
    this.name = 'RevertError';
  }
}

export interface HauntingSummary {
  id: string;
  name: string;
  difficulty: Haunting['difficulty'];
  target: Haunting['target'];
  faultType: FaultSpec['type'];
  escalationSteps: number;
  active: boolean;
  step: number;
}

export interface ApplyResult {
  id: string;
  alreadyActive: boolean;
  appliedAt: number;
  page: Haunting['page'];
}

export interface EscalateResult {
  id: string;
  step: number;
  /** Narration for each step newly applied by this call, in order. */
  applied: { step: number; narration: string }[];
}

export interface RevertResult {
  id: string;
  reverted: boolean;
  /** Resources put back to their original state. */
  restored: string[];
  /** Resources still held by another active haunting, so set to that haunting's fault instead. */
  handedOver: string[];
}

export interface QueryEvaluation {
  id: string;
  description: string;
  source: QueryDefinition['source'];
  query: string;
  expect: Comparison;
  observed: number | null;
  pass: boolean;
  error?: string;
}

export interface VerifyResult {
  id: string;
  pass: boolean;
  checkedAt: number;
  checks: QueryEvaluation[];
}

export interface SignalsResult {
  id: string;
  evaluatedAt: number;
  signals: (QueryEvaluation & { kind: SignalDefinition['kind'] })[];
}

export type Snapshot = Record<string, unknown>;

export interface EngineOptions {
  hauntings: Haunting[];
  drivers: Drivers;
  queries: QueryClient;
  store?: LedgerStore;
  clock?: () => number;
}

/**
 * The haunting engine. It applies, escalates, verifies and reverts hauntings in the
 * sandbox. Calls that change the sandbox run one at a time, in the order they arrive.
 */
export class Engine {
  private readonly hauntings: Map<string, Haunting>;
  private readonly drivers: Drivers;
  private readonly queries: QueryClient;
  private readonly store: LedgerStore;
  private readonly clock: () => number;
  private state: LedgerState = emptyLedger();
  private queue: Promise<unknown> = Promise.resolve();

  constructor(opts: EngineOptions) {
    this.hauntings = new Map(opts.hauntings.map((h) => [h.id, h]));
    this.drivers = opts.drivers;
    this.queries = opts.queries;
    this.store = opts.store ?? new MemoryLedgerStore();
    this.clock = opts.clock ?? Date.now;
  }

  /**
   * Loads the saved ledger and reverts anything a previous run left behind (for
   * example after a crash). Returns the ids of the hauntings it reverted.
   */
  init(): Promise<string[]> {
    return this.exclusive(async () => {
      this.state = (await this.store.load()) ?? emptyLedger();
      const leftover = this.leftoverIds();
      for (const id of leftover) await this.revertUnlocked(id);
      await this.restorePendingUnlocked();
      return leftover;
    });
  }

  list(): HauntingSummary[] {
    return [...this.hauntings.values()].map((h) => {
      const active = this.activeRecord(h.id);
      return {
        id: h.id,
        name: h.name,
        difficulty: h.difficulty,
        target: h.target,
        faultType: h.fault.type,
        escalationSteps: h.escalation.length,
        active: active !== undefined,
        step: active?.step ?? 0,
      };
    });
  }

  get(id: string): Haunting {
    const h = this.hauntings.get(id);
    if (h === undefined) throw new UnknownHauntingError(id);
    return h;
  }

  /** Applies the haunting's base fault. Applying an active haunting again changes nothing. */
  async apply(id: string): Promise<ApplyResult> {
    const h = this.get(id);
    return this.exclusive(async () => {
      const existing = this.activeRecord(id);
      // Already active: change nothing. Re-claiming the base fault here would undo any
      // escalation step that changed the same resource.
      if (existing !== undefined) {
        return { id, alreadyActive: true, appliedAt: existing.appliedAt, page: h.page };
      }
      const record = { hauntingId: id, appliedAt: this.clock(), step: 0 };
      this.state.active.push(record);
      try {
        await this.claimUnlocked(id, h.fault);
      } catch (err) {
        // Leave nothing half-applied. If this revert also fails, the ledger keeps the
        // entry and the next revert retries it.
        await this.revertUnlocked(id).catch(() => undefined);
        throw err;
      }
      return { id, alreadyActive: false, appliedAt: record.appliedAt, page: h.page };
    });
  }

  /**
   * Applies escalation steps up to and including `step`, skipping steps already
   * applied. Escalating to a step already reached changes nothing.
   */
  async escalate(id: string, step: number): Promise<EscalateResult> {
    const h = this.get(id);
    if (!Number.isInteger(step) || step < 1 || step > h.escalation.length) {
      throw new RangeError(`Haunting "${id}" has escalation steps 1-${h.escalation.length}, got ${step}`);
    }
    return this.exclusive(async () => {
      const record = this.activeRecord(id);
      if (record === undefined) throw new HauntingNotActiveError(id);
      const applied: EscalateResult['applied'] = [];
      for (const s of h.escalation) {
        if (s.step <= record.step || s.step > step) continue;
        for (const fault of s.faults) await this.claimUnlocked(id, fault);
        record.step = s.step;
        await this.save();
        applied.push({ step: s.step, narration: s.narration });
      }
      return { id, step: record.step, applied };
    });
  }

  /**
   * Removes every fault the haunting added. Each resource goes back to its original
   * state, or to another active haunting's fault if one still holds it. Reverting a
   * haunting that is not active changes nothing.
   */
  async revert(id: string): Promise<RevertResult> {
    if (!this.hauntings.has(id) && !this.leftoverIds().includes(id)) throw new UnknownHauntingError(id);
    return this.exclusive(() => this.revertUnlocked(id));
  }

  /** Reverts every active haunting. Use on shutdown. */
  revertAll(): Promise<RevertResult[]> {
    return this.exclusive(async () => {
      const results: RevertResult[] = [];
      const errors: Error[] = [];
      for (const id of this.leftoverIds()) {
        try {
          results.push(await this.revertUnlocked(id));
        } catch (err) {
          errors.push(err as Error);
        }
      }
      try {
        await this.restorePendingUnlocked();
      } catch (err) {
        errors.push(err as Error);
      }
      if (errors.length > 0) throw new AggregateError(errors, errors.map((e) => e.message).join('\n'));
      return results;
    });
  }

  /** Runs the haunting's verify checks. Passes only when every check passes. */
  async verify(id: string): Promise<VerifyResult> {
    const h = this.get(id);
    const checks = await Promise.all(h.verify.map((c) => this.evaluate(c)));
    return { id, pass: checks.every((c) => c.pass), checkedAt: this.clock(), checks };
  }

  /** Evaluates the haunting's expected signals against live Prometheus and Loki data. */
  async signals(id: string): Promise<SignalsResult> {
    const h = this.get(id);
    const signals = await Promise.all(
      h.signals.map(async (s) => ({ ...(await this.evaluate(s)), kind: s.kind })),
    );
    return { id, evaluatedAt: this.clock(), signals };
  }

  /**
   * Reads the current state of every resource the given hauntings can touch (all
   * hauntings by default), including container health. Compare against a snapshot
   * taken before apply to check the sandbox is back to baseline.
   */
  async probe(ids: string[] = [...this.hauntings.keys()]): Promise<Snapshot> {
    const snapshot: Snapshot = {};
    for (const id of ids) {
      const h = this.get(id);
      for (const fault of [h.fault, ...h.escalation.flatMap((s) => s.faults)]) {
        const driver = driverFor(this.drivers, fault);
        const key = driver.resourceKey(fault, id);
        if (!(key in snapshot)) snapshot[key] = await driver.probe(fault, id);
      }
    }
    return snapshot;
  }

  /** Probes until the sandbox matches `baseline` or `timeoutMs` passes. */
  async waitForBaseline(
    baseline: Snapshot,
    { timeoutMs = 30_000, intervalMs = 500, ids }: { timeoutMs?: number; intervalMs?: number; ids?: string[] } = {},
  ): Promise<{ ok: boolean; elapsedMs: number; snapshot: Snapshot }> {
    const started = Date.now();
    const target = stableStringify(baseline);
    for (;;) {
      const snapshot = await this.probe(ids);
      const elapsedMs = Date.now() - started;
      if (stableStringify(snapshot) === target) return { ok: true, elapsedMs, snapshot };
      if (elapsedMs >= timeoutMs) return { ok: false, elapsedMs, snapshot };
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }

  // ---- internals ----

  private activeRecord(id: string) {
    return this.state.active.find((a) => a.hauntingId === id);
  }

  /** Hauntings that are active or still hold claims in the ledger. */
  private leftoverIds(): string[] {
    const ids = new Set(this.state.active.map((a) => a.hauntingId));
    for (const e of this.state.entries) for (const c of e.claims) ids.add(c.hauntingId);
    return [...ids];
  }

  private async claimUnlocked(hauntingId: string, fault: FaultSpec): Promise<void> {
    const driver = driverFor(this.drivers, fault);
    const resourceKey = driver.resourceKey(fault, hauntingId);
    const claim: LedgerClaim = { hauntingId, fault };
    let entry = this.state.entries.find((e) => e.resourceKey === resourceKey);
    if (entry === undefined) {
      const original = await driver.capture(fault, hauntingId);
      entry = { resourceKey, owner: claim, original, claims: [] };
      this.state.entries.push(entry);
    }
    upsertClaim(entry, claim);
    // Save before touching the sandbox, so a crash right after this still knows how to undo it.
    await this.save();
    await this.applyTop(entry);
  }

  private async applyTop(entry: LedgerEntry): Promise<void> {
    const top = topClaim(entry);
    if (top === undefined) return;
    await driverFor(this.drivers, top.fault).apply(top.fault, top.hauntingId);
  }

  private async revertUnlocked(id: string): Promise<RevertResult> {
    const wasActive = this.activeRecord(id) !== undefined;
    const touched = removeClaims(this.state, id);
    this.state.active = this.state.active.filter((a) => a.hauntingId !== id);

    const restored: string[] = [];
    const handedOver: string[] = [];
    const failures: { resourceKey: string; error: string }[] = [];
    // Also retry entries whose restore failed earlier.
    const pending = this.state.entries.filter((e) => e.claims.length === 0 && !touched.includes(e));

    for (const entry of [...touched, ...pending]) {
      try {
        if (entry.claims.length > 0) {
          await this.applyTop(entry);
          handedOver.push(entry.resourceKey);
        } else {
          const { fault, hauntingId } = entry.owner;
          await driverFor(this.drivers, fault).restore(fault, hauntingId, entry.original);
          this.state.entries = this.state.entries.filter((e) => e !== entry);
          restored.push(entry.resourceKey);
        }
      } catch (err) {
        failures.push({ resourceKey: entry.resourceKey, error: (err as Error).message });
      }
    }
    await this.save();
    if (failures.length > 0) throw new RevertError(id, failures);
    return { id, reverted: wasActive || touched.length > 0, restored, handedOver };
  }

  /** Retries restores that failed earlier (entries left with no claims). */
  private async restorePendingUnlocked(): Promise<void> {
    if (!this.state.entries.some((e) => e.claims.length === 0)) return;
    await this.revertUnlocked('(pending restores)');
  }

  private save(): Promise<void> {
    return this.store.save(this.state);
  }

  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async evaluate(def: QueryDefinition): Promise<QueryEvaluation> {
    const base = {
      id: def.id,
      description: def.description,
      source: def.source,
      query: def.query,
      expect: def.expect,
    };
    try {
      const raw = await this.queries.query(def.source, def.query);
      const observed = raw ?? def.emptyValue ?? null;
      return { ...base, observed, pass: compare(observed, def.expect) };
    } catch (err) {
      return { ...base, observed: null, pass: false, error: (err as Error).message };
    }
  }
}
