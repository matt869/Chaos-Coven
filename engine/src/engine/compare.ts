import type { Comparison } from '../haunting/types.js';

/** True when `observed` satisfies the comparison. A missing value never does. */
export function compare(observed: number | null, { op, value }: Comparison): boolean {
  if (observed === null || Number.isNaN(observed)) return false;
  switch (op) {
    case '>':
      return observed > value;
    case '>=':
      return observed >= value;
    case '<':
      return observed < value;
    case '<=':
      return observed <= value;
    case '==':
      return observed === value;
    case '!=':
      return observed !== value;
  }
}

/** JSON with sorted object keys, so equal states always produce the same string. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => {
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      return Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
    }
    return v;
  });
}
