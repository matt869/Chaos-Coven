import { mkdtemp, writeFile, copyFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { stringify } from 'yaml';
import {
  createValidator,
  HauntingValidationError,
  loadHauntings,
  parseHaunting,
} from '../../src/haunting/loader.js';
import { normalizeCommand, type Haunting } from '../../src/haunting/types.js';
import { HAUNTINGS_DIR, loadRepoHaunting, loadSchema } from '../support/setup.js';

const validator = createValidator(loadSchema());
const vanishing = () => structuredClone(loadRepoHaunting('the-vanishing'));

function problems(h: unknown, file = 'the-vanishing.yaml') {
  return validator.problems(h, file);
}

describe('the-vanishing.yaml', () => {
  it('is a valid haunting', () => {
    const h = loadRepoHaunting('the-vanishing');
    expect(h.id).toBe('the-vanishing');
    expect(h.target).toBe('worker');
    expect(h.fault).toEqual({ type: 'docker', params: { service: 'worker', action: 'stop' } });
    expect(h.rootCause.component).toBe('worker');
  });

  it('includes a red herring that keeps the storefront looking healthy', () => {
    const h = loadRepoHaunting('the-vanishing');
    expect(h.signals.find((s) => s.kind === 'red-herring')?.id).toBe('storefront-errors-normal');
  });

  it('keeps every narration line to at most 2 sentences (ghost-voice.md)', () => {
    const h = loadRepoHaunting('the-vanishing');
    for (const line of [h.page.narration, ...h.escalation.map((s) => s.narration)]) {
      const sentences = line.split(/[.!?](\s|$)/).filter((s) => s.trim().length > 0);
      expect(sentences.length, line).toBeLessThanOrEqual(2);
    }
  });
});

describe('schema validation', () => {
  it('rejects an unknown fault type', () => {
    const h = vanishing() as unknown as { fault: unknown };
    h.fault = { type: 'kubernetes', params: {} };
    expect(problems(h).length).toBeGreaterThan(0);
  });

  it('rejects an unknown service', () => {
    const h = vanishing() as unknown as { target: string };
    h.target = 'mainframe';
    expect(problems(h).join()).toMatch(/target/);
  });

  it('rejects config faults on services without admin endpoints', () => {
    const h = vanishing() as unknown as { fault: unknown };
    h.fault = { type: 'config', params: { service: 'postgres', key: 'max_connections', value: 1 } };
    expect(problems(h).length).toBeGreaterThan(0);
  });

  it('rejects toxiproxy latency above the 30s cap', () => {
    const h = vanishing() as unknown as { fault: unknown };
    h.fault = { type: 'toxiproxy', params: { proxy: 'storefront_queue', toxic: 'latency', latency: 999999 } };
    expect(problems(h).length).toBeGreaterThan(0);
  });

  it('rejects unknown top-level fields', () => {
    expect(problems({ ...vanishing(), surprise: true }).join()).toMatch(/surprise/);
  });

  it('rejects harmful actions that are not haunt commands', () => {
    const h = vanishing();
    h.harmfulActions[0]!.action = 'rm -rf /';
    expect(problems(h).length).toBeGreaterThan(0);
  });
});

describe('semantic rules', () => {
  it('requires the id to match the file name', () => {
    expect(problems(vanishing(), 'other-name.yaml')).toContain('id "the-vanishing" must match the file name "other-name"');
  });

  it('requires escalation steps numbered 1..n with increasing times', () => {
    const h = vanishing();
    h.escalation[1]!.step = 5;
    h.escalation[1]!.afterSeconds = 10;
    const p = problems(h);
    expect(p).toContain('escalation[1].step must be 2, got 5');
    expect(p.join()).toMatch(/afterSeconds must be greater/);
  });

  it('rejects duplicate signal ids', () => {
    const h = vanishing();
    h.signals.push(structuredClone(h.signals[0]!));
    expect(problems(h)).toContain('signals has duplicate id "queue-depth-rising"');
  });

  it('rejects an action that is both a fix and harmful', () => {
    const h = vanishing();
    h.harmfulActions.push({ action: 'haunt restart worker', penalty: 5, reason: 'x' });
    expect(problems(h).join()).toMatch(/both a fix and a harmful action/);
  });

  it('rejects minKeywordMatches above the number of groups', () => {
    const h = vanishing();
    h.rootCause.minKeywordMatches = 3;
    expect(problems(h).join()).toMatch(/minKeywordMatches/);
  });
});

describe('parseHaunting', () => {
  it('reports empty files and YAML errors as validation errors', () => {
    expect(() => parseHaunting('', 'x.yaml', validator)).toThrow(HauntingValidationError);
    expect(() => parseHaunting('id: [unclosed', 'x.yaml', validator)).toThrow(/YAML parse error/);
  });
});

describe('loadHauntings', () => {
  it('loads valid files, reports invalid ones and ignores subdirectories', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'wh-hauntings-'));
    await copyFile(resolve(HAUNTINGS_DIR, 'schema.json'), join(dir, 'schema.json'));
    await copyFile(resolve(HAUNTINGS_DIR, 'the-vanishing.yaml'), join(dir, 'the-vanishing.yaml'));
    await writeFile(join(dir, 'empty.yaml'), '');
    const renamed: Haunting = { ...vanishing(), id: 'wrong-id' };
    await writeFile(join(dir, 'mismatch.yml'), stringify(renamed));
    await mkdir(join(dir, 'stretch'));
    await writeFile(join(dir, 'stretch', 'ignored.yaml'), 'not: valid');

    const result = await loadHauntings(dir);
    expect(result.hauntings.map((h) => h.id)).toEqual(['the-vanishing']);
    expect(result.invalid.map((i) => i.file).sort()).toEqual(['empty.yaml', 'mismatch.yml']);
  });
});

describe('normalizeCommand', () => {
  it('collapses whitespace and case', () => {
    expect(normalizeCommand('  HAUNT   Restart\tworker ')).toBe('haunt restart worker');
  });
});
