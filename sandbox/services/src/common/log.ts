/**
 * JSON logs to stdout, also pushed to Loki over HTTP. Pushing directly means no log
 * collector needs the Docker socket (sandbox-safety.md: no host access).
 */
export type Level = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  log(level: Level, msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
  flush(): Promise<void>;
}

export function createLogger(service: string, lokiUrl?: string, out: (line: string) => void = (l) => process.stdout.write(l + '\n')): Logger {
  let batch: [string, string][] = [];

  const flush = async () => {
    if (lokiUrl === undefined || batch.length === 0) return;
    const values = batch;
    batch = [];
    try {
      await fetch(`${lokiUrl}/loki/api/v1/push`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ streams: [{ stream: { service }, values }] }),
        signal: AbortSignal.timeout(2000),
      });
    } catch {
      // Logging must never take a service down. Lines stay on stdout either way.
    }
  };
  if (lokiUrl !== undefined) setInterval(() => void flush(), 1000).unref();

  const log = (level: Level, msg: string, fields: Record<string, unknown> = {}) => {
    const line = JSON.stringify({ ts: new Date().toISOString(), level, service, msg, ...fields });
    out(line);
    if (lokiUrl !== undefined) {
      batch.push([`${BigInt(Date.now()) * 1_000_000n}`, line]);
      if (batch.length > 500) batch.splice(0, batch.length - 500);
    }
  };

  return {
    log,
    info: (m, f) => log('info', m, f),
    warn: (m, f) => log('warn', m, f),
    error: (m, f) => log('error', m, f),
    flush,
  };
}
