import type { Scalar } from '@witching-hour/engine';
import { HELP, type Command } from './parser.js';

export interface ContainerRow {
  service: string;
  name: string;
  state: string;
  health: string;
}

/** Actions a player can take on the sandbox. Real version: ./sandbox-control.ts. */
export interface SandboxControl {
  status(): Promise<ContainerRow[]>;
  restart(service: string): Promise<number>;
  scaleWorker(replicas: number): Promise<void>;
  purgeOrders(): Promise<number>;
  configGet(service: string, key: string): Promise<Scalar | null>;
  configSet(service: string, key: string, value: Scalar): Promise<void>;
}

export interface LogLine {
  ts: string;
  line: string;
}

/** Read-only views of metrics and logs. Real version: ./observability.ts. */
export interface Observability {
  logs(service: string, minutes: number, grep?: string, limit?: number): Promise<LogLine[]>;
  promql(expr: string): Promise<{ labels: Record<string, string>; value: string }[]>;
  queueDepth(): Promise<number | null>;
}

export interface ExecDeps {
  control: SandboxControl;
  observability: Observability;
}

const pad = (s: string, n: number) => s + ' '.repeat(Math.max(1, n - s.length));

/** Runs one parsed command and returns the text shown in the terminal. */
export async function execute(cmd: Command, { control, observability }: ExecDeps): Promise<string> {
  switch (cmd.kind) {
    case 'help':
      return HELP;
    case 'status': {
      const rows = await control.status();
      if (rows.length === 0) return 'no sandbox containers found. Is the sandbox running?';
      return [
        pad('SERVICE', 12) + pad('CONTAINER', 15) + pad('STATE', 9) + 'HEALTH',
        ...rows.map((r) => pad(r.service, 12) + pad(r.name, 15) + pad(r.state, 9) + r.health),
      ].join('\n');
    }
    case 'logs': {
      const lines = await observability.logs(cmd.service, cmd.minutes, cmd.grep);
      const what = cmd.grep === undefined ? '' : ` containing "${cmd.grep}"`;
      if (lines.length === 0) return `no ${cmd.service} log lines${what} in the last ${cmd.minutes} minute(s).`;
      return lines.map((l) => `${l.ts}  ${l.line}`).join('\n');
    }
    case 'promql': {
      const rows = await observability.promql(cmd.expr);
      if (rows.length === 0) return '(no data)';
      return rows
        .map((r) => {
          const labels = Object.entries(r.labels)
            .filter(([k]) => k !== '__name__')
            .map(([k, v]) => `${k}="${v}"`)
            .join(', ');
          return `${labels === '' ? '{}' : `{${labels}}`}  ${r.value}`;
        })
        .join('\n');
    }
    case 'queue': {
      const depth = await observability.queueDepth();
      return depth === null ? 'orders queue depth: unknown (no data from the storefront)' : `orders queue depth: ${depth}`;
    }
    case 'restart': {
      const n = await control.restart(cmd.service);
      return n === 0 ? `no ${cmd.service} containers to restart.` : `restarted ${n} ${cmd.service} container(s).`;
    }
    case 'scale':
      await control.scaleWorker(cmd.replicas);
      return `worker scaled to ${cmd.replicas} replica(s).`;
    case 'config-get': {
      const v = await control.configGet(cmd.service, cmd.key);
      return v === null ? `${cmd.service} ${cmd.key} is not set.` : `${cmd.service} ${cmd.key} = ${JSON.stringify(v)}`;
    }
    case 'config-set':
      await control.configSet(cmd.service, cmd.key, cmd.value);
      return `${cmd.service} ${cmd.key} set to ${JSON.stringify(cmd.value)}.`;
    case 'purge-queue': {
      const dropped = await control.purgeOrders();
      return `purged the orders queue: ${dropped} message(s) deleted.`;
    }
  }
}
