import { HttpError, type Router } from './http.js';
import type { Logger } from './log.js';
import type { Scalar } from './config.js';

export interface ToggleState {
  enabled: boolean;
  settings: Record<string, Scalar>;
}

export const TOGGLES = ['memory-leak', 'consumer-stall', 'slow-gc'] as const;
export type ToggleName = (typeof TOGGLES)[number];

/** Hard caps, whatever a haunting asks for (sandbox-safety.md: bounded faults). */
export const LIMITS = { leakMaxMb: 200, leakMbPerMinute: 60, gcPauseMs: 500 } as const;

/**
 * Debug toggles live in memory on purpose: restarting the service clears them, which
 * is the realistic mitigation for a leak.
 */
export class Toggles {
  private readonly state = new Map<ToggleName, ToggleState>(TOGGLES.map((t) => [t, { enabled: false, settings: {} }]));
  private leaked: Buffer[] = [];
  private leakTimer?: ReturnType<typeof setInterval>;
  private gcTimer?: ReturnType<typeof setInterval>;

  constructor(private readonly log: Logger) {}

  get(name: string): ToggleState {
    const s = this.state.get(name as ToggleName);
    if (s === undefined) throw new HttpError(404, `unknown toggle ${name}`);
    return structuredClone(s);
  }

  enabled(name: ToggleName): boolean {
    return this.state.get(name)!.enabled;
  }

  set(name: string, next: ToggleState): void {
    if (!this.state.has(name as ToggleName)) throw new HttpError(404, `unknown toggle ${name}`);
    this.state.set(name as ToggleName, structuredClone(next));
    this.apply(name as ToggleName);
  }

  /** Leaked memory in MB, for tests. */
  get leakedMb(): number {
    return this.leaked.length;
  }

  /** One leak step. Exposed so tests can drive it without timers. */
  leakTick(mbPerTick: number, maxMb: number): void {
    const cap = Math.min(maxMb, LIMITS.leakMaxMb);
    for (let i = 0; i < mbPerTick && this.leaked.length < cap; i++) {
      // Fill the buffer so the pages are really resident.
      this.leaked.push(Buffer.alloc(1024 * 1024, 1));
    }
  }

  stop(): void {
    clearInterval(this.leakTimer);
    clearInterval(this.gcTimer);
  }

  private apply(name: ToggleName): void {
    const s = this.state.get(name)!;
    if (name === 'memory-leak') {
      clearInterval(this.leakTimer);
      this.leakTimer = undefined;
      if (s.enabled) {
        const perMinute = Math.min(num(s.settings.mb_per_minute, 10), LIMITS.leakMbPerMinute);
        const max = num(s.settings.max_mb, 150);
        // Leak in 6 steps per minute.
        this.leakTimer = setInterval(() => this.leakTick(Math.max(1, Math.round(perMinute / 6)), max), 10_000);
        this.leakTimer.unref();
      } else {
        this.leaked = [];
      }
    }
    if (name === 'slow-gc') {
      clearInterval(this.gcTimer);
      this.gcTimer = undefined;
      if (s.enabled) {
        const pause = Math.min(num(s.settings.pause_ms, 100), LIMITS.gcPauseMs);
        // Block the event loop, the way a long GC pause does.
        this.gcTimer = setInterval(() => {
          const until = Date.now() + pause;
          while (Date.now() < until) {
            /* stall */
          }
        }, 1000);
        this.gcTimer.unref();
      }
    }
    this.log.info('debug toggle changed', { toggle: name, enabled: s.enabled });
  }
}

function num(v: Scalar | undefined, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : fallback;
}

/** The /__debug endpoints the engine's debug-endpoint driver uses. */
export function mountDebugAdmin(router: Router, toggles: Toggles): void {
  router
    .on('GET', '/__debug/:toggle', ({ params }) => ({ status: 200, body: toggles.get(params.toggle!) }))
    .on('PUT', '/__debug/:toggle', ({ params, body }) => {
      const b = body as Partial<ToggleState> | undefined;
      if (typeof b?.enabled !== 'boolean') throw new HttpError(400, 'enabled must be a boolean');
      const settings = b.settings ?? {};
      if (typeof settings !== 'object' || Array.isArray(settings)) throw new HttpError(400, 'settings must be an object');
      toggles.set(params.toggle!, { enabled: b.enabled, settings });
      return { status: 204 };
    });
}
