import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Engine } from '../../src/engine/engine.js';
import { MemoryLedgerStore, type LedgerStore } from '../../src/engine/ledger.js';
import { createDrivers } from '../../src/faults/drivers.js';
import { createValidator, parseHaunting } from '../../src/haunting/loader.js';
import type { Haunting } from '../../src/haunting/types.js';
import { FakeSandbox } from './fake-sandbox.js';

export const HAUNTINGS_DIR = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../hauntings');

export function loadSchema(): object {
  return JSON.parse(readFileSync(resolve(HAUNTINGS_DIR, 'schema.json'), 'utf8')) as object;
}

export function loadRepoHaunting(id: string): Haunting {
  const file = `${id}.yaml`;
  return parseHaunting(readFileSync(resolve(HAUNTINGS_DIR, file), 'utf8'), file, createValidator(loadSchema()));
}

export function fakeEngine(
  hauntings: Haunting[],
  opts: { sandbox?: FakeSandbox; store?: LedgerStore; clock?: () => number } = {},
): { engine: Engine; sandbox: FakeSandbox } {
  const sandbox = opts.sandbox ?? new FakeSandbox();
  const engine = new Engine({
    hauntings,
    drivers: createDrivers(sandbox.clients()),
    queries: sandbox.queryClient(),
    store: opts.store ?? new MemoryLedgerStore(),
    clock: opts.clock,
  });
  return { engine, sandbox };
}
