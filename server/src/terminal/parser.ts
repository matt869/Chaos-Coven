/**
 * The player terminal's command parser. It is the security boundary for player input
 * (sandbox-safety.md): only allowlisted `haunt` commands are accepted, every argument
 * is checked against a pattern, and the result is a typed command, never a string
 * that reaches a shell.
 */

export const LOG_SERVICES = ['storefront', 'cart', 'payments', 'worker', 'traffic'] as const;
export const RESTARTABLE = ['storefront', 'cart', 'payments', 'worker', 'postgres', 'queue'] as const;
export const CONFIG_SERVICES = ['storefront', 'cart', 'payments', 'worker'] as const;
export const MAX_WORKERS = 3;

export type Command =
  | { kind: 'help' }
  | { kind: 'status' }
  | { kind: 'logs'; service: (typeof LOG_SERVICES)[number]; minutes: number; grep?: string }
  | { kind: 'promql'; expr: string }
  | { kind: 'queue' }
  | { kind: 'restart'; service: (typeof RESTARTABLE)[number] }
  | { kind: 'scale'; service: 'worker'; replicas: number }
  | { kind: 'config-get'; service: (typeof CONFIG_SERVICES)[number]; key: string }
  | { kind: 'config-set'; service: (typeof CONFIG_SERVICES)[number]; key: string; value: string | number | boolean }
  | { kind: 'purge-queue'; queue: 'orders' };

export type ParseResult = { ok: true; command: Command; canonical: string } | { ok: false; error: string };

/** Never allowed anywhere: these only mean something to a shell. */
const SHELL_CHARS = /[;&$`\\\n\r\t\0]/;
/** Allowed only inside a PromQL expression. */
const QUERY_CHARS = /[|<>'"(){}[\]=~!,*/+%^]/;
const PROMQL = /^[A-Za-z0-9_{}()[\]"=~!,.:<>+\-*/ %^]+$/;
const CONFIG_KEY = /^[a-z0-9]+([._][a-z0-9]+)*$/;
const CONFIG_VALUE = /^[A-Za-z0-9_.:-]{1,40}$/;
const GREP_WORD = /^[A-Za-z0-9_.:-]{1,40}$/;
const MAX_LINE = 300;

export const HELP = `Commands (all start with "haunt"):
  haunt status                          containers and their health
  haunt logs <service> [minutes]        recent log lines (service: ${LOG_SERVICES.join(', ')})
  haunt grep <service> <word> [minutes] log lines containing a word
  haunt promql <expression>             run a Prometheus query
  haunt queue                           orders queue depth
  haunt restart <service>               restart a service (${RESTARTABLE.join(', ')})
  haunt scale worker <1-${MAX_WORKERS}>               change the number of workers
  haunt config get <service> <key>      read a config value
  haunt config set <service> <key> <v>  change a config value
  haunt purge-queue orders              delete every message in the orders queue
  haunt help                            this list`;

const err = (error: string): ParseResult => ({ ok: false, error });

function oneOf<T extends string>(list: readonly T[], value: string | undefined, what: string): T | string {
  if (value !== undefined && (list as readonly string[]).includes(value)) return value as T;
  return `unknown ${what} "${value ?? ''}". Try one of: ${list.join(', ')}`;
}

function minutesArg(raw: string | undefined): number | string {
  if (raw === undefined) return 5;
  if (!/^\d{1,2}$/.test(raw)) return `minutes must be a number from 1 to 60, got "${raw}"`;
  const n = Number(raw);
  return n >= 1 && n <= 60 ? n : `minutes must be a number from 1 to 60, got "${raw}"`;
}

function parseValue(raw: string): string | number | boolean {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
  return raw;
}

export function parseCommand(input: string): ParseResult {
  if (input.length > MAX_LINE) return err(`command too long (max ${MAX_LINE} characters)`);
  if (SHELL_CHARS.test(input)) return err('this terminal is not a shell: ; & $ ` \\ and control characters are not allowed');
  const tokens = input.trim().split(/ +/).filter(Boolean);
  if (tokens.length === 0) return err('type "haunt help" to see the commands');
  if (tokens[0]!.toLowerCase() !== 'haunt') return err(`only "haunt" commands run here. Type "haunt help".`);

  const sub = tokens[1]?.toLowerCase();
  const args = tokens.slice(2);

  if (sub === 'promql') {
    const expr = input.trim().split(/ +/).slice(2).join(' ');
    if (expr === '') return err('usage: haunt promql <expression>');
    if (!PROMQL.test(expr)) return err('the expression has characters PromQL does not use');
    return { ok: true, command: { kind: 'promql', expr }, canonical: `haunt promql ${expr}` };
  }
  if (tokens.some((t) => QUERY_CHARS.test(t))) return err('quotes, pipes, brackets and redirects are only allowed in "haunt promql"');

  const lower = args.map((a) => a.toLowerCase());
  const done = (command: Command, parts: (string | number | boolean)[]): ParseResult => ({
    ok: true,
    command,
    canonical: ['haunt', ...parts].join(' '),
  });
  switch (sub) {
    case undefined:
    case 'help':
      return done({ kind: 'help' }, ['help']);
    case 'status':
      return args.length > 0 ? err('usage: haunt status') : done({ kind: 'status' }, ['status']);
    case 'queue':
      return args.length > 0 ? err('usage: haunt queue') : done({ kind: 'queue' }, ['queue']);
    case 'logs': {
      const service = oneOf(LOG_SERVICES, lower[0], 'service');
      if (!LOG_SERVICES.includes(service as never)) return err(service);
      const minutes = minutesArg(args[1]);
      if (typeof minutes === 'string') return err(minutes);
      if (args.length > 2) return err('usage: haunt logs <service> [minutes]');
      return done({ kind: 'logs', service: service as (typeof LOG_SERVICES)[number], minutes }, ['logs', service, minutes]);
    }
    case 'grep': {
      const service = oneOf(LOG_SERVICES, lower[0], 'service');
      if (!LOG_SERVICES.includes(service as never)) return err(service);
      const word = args[1];
      if (word === undefined || !GREP_WORD.test(word)) return err('usage: haunt grep <service> <word> [minutes] (letters, digits, _ . : - only)');
      const minutes = minutesArg(args[2]);
      if (typeof minutes === 'string') return err(minutes);
      if (args.length > 3) return err('usage: haunt grep <service> <word> [minutes]');
      return done({ kind: 'logs', service: service as (typeof LOG_SERVICES)[number], minutes, grep: word }, ['grep', service, word, minutes]);
    }
    case 'restart': {
      const service = oneOf(RESTARTABLE, lower[0], 'service');
      if (!RESTARTABLE.includes(service as never)) return err(service);
      if (args.length > 1) return err('usage: haunt restart <service>');
      return done({ kind: 'restart', service: service as (typeof RESTARTABLE)[number] }, ['restart', service]);
    }
    case 'scale': {
      if (lower[0] !== 'worker') return err('only the worker can be scaled: haunt scale worker <1-3>');
      const n = Number(args[1]);
      if (!/^\d$/.test(args[1] ?? '') || n < 1 || n > MAX_WORKERS) return err(`replicas must be 1 to ${MAX_WORKERS}`);
      if (args.length > 2) return err('usage: haunt scale worker <1-3>');
      return done({ kind: 'scale', service: 'worker', replicas: n }, ['scale', 'worker', n]);
    }
    case 'config': {
      const action = lower[0];
      const service = oneOf(CONFIG_SERVICES, lower[1], 'service');
      if (action !== 'get' && action !== 'set') return err('usage: haunt config get|set <service> <key> [value]');
      if (!CONFIG_SERVICES.includes(service as never)) return err(service);
      const key = lower[2];
      if (key === undefined || !CONFIG_KEY.test(key)) return err('config keys look like db.pool_max');
      const svc = service as (typeof CONFIG_SERVICES)[number];
      if (action === 'get') {
        if (args.length > 3) return err('usage: haunt config get <service> <key>');
        return done({ kind: 'config-get', service: svc, key }, ['config', 'get', svc, key]);
      }
      const raw = args[3];
      if (raw === undefined || !CONFIG_VALUE.test(raw) || args.length > 4) {
        return err('usage: haunt config set <service> <key> <value> (letters, digits, _ . : - only)');
      }
      const value = parseValue(raw);
      return done({ kind: 'config-set', service: svc, key, value }, ['config', 'set', svc, key, String(value)]);
    }
    case 'purge-queue':
      if (lower[0] !== 'orders' || args.length > 1) return err('usage: haunt purge-queue orders');
      return done({ kind: 'purge-queue', queue: 'orders' }, ['purge-queue', 'orders']);
    default:
      return err(`unknown command "${tokens[1]}". Type "haunt help".`);
  }
}
