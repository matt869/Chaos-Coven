import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { normalizeCommand } from '@witching-hour/engine';
import { parseCommand, type Command } from '../src/terminal/parser.js';

const ok = (line: string) => {
  const r = parseCommand(line);
  if (!r.ok) throw new Error(`expected "${line}" to parse: ${r.error}`);
  return r;
};

describe('parseCommand', () => {
  it.each([
    ['haunt help', { kind: 'help' }],
    ['haunt', { kind: 'help' }],
    ['haunt status', { kind: 'status' }],
    ['haunt logs worker', { kind: 'logs', service: 'worker', minutes: 5 }],
    ['haunt logs payments 15', { kind: 'logs', service: 'payments', minutes: 15 }],
    ['haunt grep payments timeout 10', { kind: 'logs', service: 'payments', minutes: 10, grep: 'timeout' }],
    ['haunt queue', { kind: 'queue' }],
    ['haunt restart worker', { kind: 'restart', service: 'worker' }],
    ['haunt scale worker 2', { kind: 'scale', service: 'worker', replicas: 2 }],
    ['haunt config get payments db.pool_max', { kind: 'config-get', service: 'payments', key: 'db.pool_max' }],
    ['haunt config set payments db.pool_max 10', { kind: 'config-set', service: 'payments', key: 'db.pool_max', value: 10 }],
    ['haunt config set storefront feature.new_cart true', { kind: 'config-set', service: 'storefront', key: 'feature.new_cart', value: true }],
    ['haunt purge-queue orders', { kind: 'purge-queue', queue: 'orders' }],
    ['haunt promql sum(up{job="worker"})', { kind: 'promql', expr: 'sum(up{job="worker"})' }],
  ] as [string, Command][])('parses %s', (line, command) => {
    expect(ok(line).command).toEqual(command);
  });

  it('produces canonical commands that match hauntings fix and harmful actions', () => {
    expect(ok('  HAUNT   Restart   Worker ').canonical).toBe('haunt restart worker');
    expect(ok('haunt config set payments db.pool_max 10').canonical).toBe('haunt config set payments db.pool_max 10');
    expect(ok('haunt purge-queue orders').canonical).toBe('haunt purge-queue orders');
  });

  it.each([
    'rm -rf /',
    'haunt restart worker; rm -rf /',
    'haunt restart worker && curl evil',
    'haunt logs worker | sh',
    'haunt restart $(whoami)',
    'haunt restart `id`',
    'haunt logs worker > /etc/passwd',
    'haunt restart kubernetes',
    'haunt scale cart 2',
    'haunt scale worker 9',
    'haunt config set payments db.pool_max 1 2',
    'haunt config set postgres max_connections 1',
    "haunt grep worker 'x'",
    'haunt promql up; reboot',
    'haunt exec worker sh',
    'sudo haunt restart worker',
    '',
  ])('rejects %j', (line) => {
    expect(parseCommand(line).ok).toBe(false);
  });

  it('rejects overlong lines', () => {
    expect(parseCommand(`haunt promql ${'a'.repeat(400)}`).ok).toBe(false);
  });
});

describe('parseCommand properties', () => {
  const SHELL = /[;&$`\\\n\r\0]/;
  const ALLOWED_KINDS = ['help', 'status', 'logs', 'promql', 'queue', 'restart', 'scale', 'config-get', 'config-set', 'purge-queue'];

  it('never accepts shell metacharacters, and every accepted command is allowlisted', () => {
    const tokens = fc.constantFrom(
      'haunt', 'restart', 'logs', 'grep', 'scale', 'config', 'set', 'get', 'promql', 'purge-queue', 'status',
      'worker', 'payments', 'cart', 'postgres', 'orders', 'db.pool_max', '2', '10', ';', '&&', '|', '$(id)', '`id`', '>', 'rm', '-rf', '/',
    );
    const lines = fc.oneof(
      fc.string({ maxLength: 80 }),
      fc.array(tokens, { maxLength: 8 }).map((t) => t.join(' ')),
      fc.array(tokens, { maxLength: 6 }).map((t) => `haunt ${t.join(' ')}`),
    );
    fc.assert(
      fc.property(lines, (line) => {
        const r = parseCommand(line);
        if (!r.ok) return;
        expect(SHELL.test(line)).toBe(false);
        expect(ALLOWED_KINDS).toContain(r.command.kind);
        expect(r.canonical.startsWith('haunt')).toBe(true);
        // Canonical form is stable: parsing it again gives the same command.
        const again = parseCommand(r.canonical);
        expect(again.ok && again.command).toEqual(r.command);
        // Outside promql, canonical commands are already normalized, so they match hauntings' action strings.
        if (r.command.kind !== 'promql') expect(normalizeCommand(r.canonical)).toBe(r.canonical);
      }),
      { numRuns: 2000 },
    );
  });
});
