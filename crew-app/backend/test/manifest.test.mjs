// Property 2: no path in app.json escapes crew-app/ or is absolute.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { checkManifest, manifestPaths, staysInside } from '../../scripts/check-manifest.mjs';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');
const manifest = JSON.parse(readFileSync(resolve(ROOT, 'app.json'), 'utf8'));

describe('crew-app/app.json', () => {
  it('passes the documented manifest rules, and every referenced file exists', () => {
    expect(checkManifest(manifest, ROOT)).toEqual([]);
  });

  it('keeps every path relative and inside crew-app/', () => {
    for (const [field, p] of manifestPaths(manifest)) {
      expect(staysInside(ROOT, p), `${field}: ${p}`).toBe(true);
    }
  });

  it('declares the page, cron, backend and MCP server the spec asks for', () => {
    expect(manifest.ui.pages).toEqual([{ route: '/apps/daemonwatch', label: 'Daemonwatch', icon: 'Ghost' }]);
    expect(manifest.crons[0]).toMatchObject({ cron_expr: '0 9 * * 1-5', agent: 'ghost-director' });
    expect(manifest.backend).toMatchObject({ type: 'node', healthCheck: '/health' });
    expect(manifest.mcpServers['witching-engine'].url).toBe('http://127.0.0.1:4000/mcp');
    for (const a of manifest.agents) {
      const agent = JSON.parse(readFileSync(resolve(ROOT, a), 'utf8'));
      expect(agent.tools).toEqual(['@kirocrew-core', '@witching-engine']);
      expect(JSON.stringify(agent)).not.toMatch(/\.kiro\/steering|\.\.\//);
    }
  });
});

describe('path containment', () => {
  const segment = fc.stringMatching(/^[a-zA-Z0-9_.-]{1,10}$/).filter((s) => s !== '.' && s !== '..');

  it('accepts any relative path made of plain segments', () => {
    fc.assert(
      fc.property(fc.array(segment, { minLength: 1, maxLength: 5 }), (segs) => {
        expect(staysInside(ROOT, segs.join('/'))).toBe(true);
      }),
    );
  });

  it('rejects any path with a .. segment, and any absolute path', () => {
    fc.assert(
      fc.property(
        fc.array(segment, { maxLength: 4 }),
        fc.array(segment, { maxLength: 4 }),
        fc.constantFrom('/', '\\'),
        fc.constantFrom('/', '\\', 'C:\\', 'C:/', '~/'),
        (before, after, sep, absPrefix) => {
          expect(staysInside(ROOT, [...before, '..', ...after].join(sep))).toBe(false);
          expect(staysInside(ROOT, absPrefix + [...before, 'x'].join(sep))).toBe(false);
        },
      ),
    );
  });

  it('flags a manifest whose paths escape', () => {
    const bad = {
      ...manifest,
      agents: ['../engine/agent.json'],
      ui: { ...manifest.ui, entry: '/etc/passwd' },
      backend: { ...manifest.backend, entryPoint: 'C:\\x.mjs' },
    };
    const problems = checkManifest(bad, ROOT).join('\n');
    expect(problems).toMatch(/agents "\.\.\/engine\/agent\.json"/);
    expect(problems).toMatch(/ui\.entry "\/etc\/passwd"/);
    expect(problems).toMatch(/backend\.entryPoint/);
  });
});
