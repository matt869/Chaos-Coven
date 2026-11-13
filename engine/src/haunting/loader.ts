import { readdir, readFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { Ajv, type ErrorObject } from 'ajv';
import { parse as parseYaml } from 'yaml';
import { normalizeCommand, type Haunting } from './types.js';

export class HauntingValidationError extends Error {
  constructor(
    readonly source: string,
    readonly problems: string[],
  ) {
    super(`${source} is not a valid haunting:\n  - ${problems.join('\n  - ')}`);
    this.name = 'HauntingValidationError';
  }
}

export interface HauntingValidator {
  /** Returns the problems with `value`. An empty array means it is a valid haunting. */
  problems(value: unknown, fileName?: string): string[];
}

export function createValidator(schema: object): HauntingValidator {
  const ajv = new Ajv({ allErrors: true, strict: true, allowUnionTypes: true });
  const validate = ajv.compile(schema);
  return {
    problems(value, fileName) {
      if (!validate(value)) return formatSchemaErrors(validate.errors ?? []);
      return semanticProblems(value as Haunting, fileName);
    },
  };
}

function formatSchemaErrors(errors: ErrorObject[]): string[] {
  // oneOf failures report every branch. Keep the most specific messages and drop the
  // generic "must match exactly one schema in oneOf" ones when there are others.
  const specific = errors.filter((e) => e.keyword !== 'oneOf' && e.keyword !== 'const');
  const chosen = specific.length > 0 ? specific : errors;
  const lines = chosen.map((e) => {
    const where = e.instancePath === '' ? '(root)' : e.instancePath;
    const extra =
      e.keyword === 'additionalProperties'
        ? ` (${String((e.params as { additionalProperty?: string }).additionalProperty)})`
        : e.keyword === 'enum'
          ? ` (${JSON.stringify((e.params as { allowedValues?: unknown }).allowedValues)})`
          : '';
    return `${where} ${e.message ?? 'is invalid'}${extra}`;
  });
  return [...new Set(lines)];
}

/** Rules the JSON schema cannot express. */
export function semanticProblems(h: Haunting, fileName?: string): string[] {
  const problems: string[] = [];

  if (fileName !== undefined) {
    const expected = basename(fileName, extname(fileName));
    if (h.id !== expected) problems.push(`id "${h.id}" must match the file name "${expected}"`);
  }

  h.escalation.forEach((step, i) => {
    if (step.step !== i + 1) problems.push(`escalation[${i}].step must be ${i + 1}, got ${step.step}`);
    const prev = h.escalation[i - 1];
    if (prev !== undefined && step.afterSeconds <= prev.afterSeconds) {
      problems.push(`escalation[${i}].afterSeconds must be greater than step ${prev.step}'s`);
    }
  });

  for (const [field, items] of [
    ['signals', h.signals],
    ['verify', h.verify],
  ] as const) {
    const seen = new Set<string>();
    for (const item of items) {
      if (seen.has(item.id)) problems.push(`${field} has duplicate id "${item.id}"`);
      seen.add(item.id);
    }
  }

  if (h.rootCause.minKeywordMatches > h.rootCause.keywords.length) {
    problems.push('rootCause.minKeywordMatches cannot be more than the number of keyword groups');
  }

  const fixes = new Set(h.fix.actions.map(normalizeCommand));
  const harmful = new Set<string>();
  for (const a of h.harmfulActions) {
    const cmd = normalizeCommand(a.action);
    if (harmful.has(cmd)) problems.push(`harmfulActions has duplicate action "${a.action}"`);
    if (fixes.has(cmd)) problems.push(`"${a.action}" cannot be both a fix and a harmful action`);
    harmful.add(cmd);
  }

  return problems;
}

export function parseHaunting(text: string, fileName: string, validator: HauntingValidator): Haunting {
  let value: unknown;
  try {
    value = parseYaml(text);
  } catch (err) {
    throw new HauntingValidationError(fileName, [`YAML parse error: ${(err as Error).message}`]);
  }
  if (value === null || value === undefined) {
    throw new HauntingValidationError(fileName, ['file is empty']);
  }
  const problems = validator.problems(value, fileName);
  if (problems.length > 0) throw new HauntingValidationError(fileName, problems);
  return value as Haunting;
}

export interface LoadResult {
  hauntings: Haunting[];
  /** Files that failed validation. They are skipped and never applied. */
  invalid: { file: string; problems: string[] }[];
}

/** Loads every *.yaml / *.yml directly inside `dir` and validates it against `dir/schema.json`. */
export async function loadHauntings(dir: string): Promise<LoadResult> {
  const schema = JSON.parse(await readFile(join(dir, 'schema.json'), 'utf8')) as object;
  const validator = createValidator(schema);
  const entries = await readdir(dir, { withFileTypes: true });
  const files = entries
    .filter((e) => e.isFile() && /\.ya?ml$/.test(e.name))
    .map((e) => e.name)
    .sort();

  const result: LoadResult = { hauntings: [], invalid: [] };
  const ids = new Set<string>();
  for (const file of files) {
    try {
      const h = parseHaunting(await readFile(join(dir, file), 'utf8'), file, validator);
      if (ids.has(h.id)) throw new HauntingValidationError(file, [`duplicate haunting id "${h.id}"`]);
      ids.add(h.id);
      result.hauntings.push(h);
    } catch (err) {
      if (!(err instanceof HauntingValidationError)) throw err;
      result.invalid.push({ file, problems: err.problems });
    }
  }
  return result;
}
