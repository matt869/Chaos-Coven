/**
 * Limits concurrent database work to a size that can change at runtime (the
 * `db.pool_max` config key). Waiters time out with a clear error, which is the log
 * line players find in Possessed Config.
 */
export class TimeoutError extends Error {}

export class Limiter {
  private inUse = 0;
  private readonly waiters: { resolve: () => void; timer: ReturnType<typeof setTimeout> }[] = [];

  constructor(
    private max: number,
    private readonly onChange: (inUse: number, waiting: number) => void = () => undefined,
  ) {
    if (!(max >= 1)) throw new RangeError('limit must be at least 1');
  }

  get size(): number {
    return this.max;
  }

  get stats(): { inUse: number; waiting: number } {
    return { inUse: this.inUse, waiting: this.waiters.length };
  }

  resize(max: number): void {
    if (!(max >= 1)) throw new RangeError('limit must be at least 1');
    this.max = Math.floor(max);
    this.drain();
  }

  async run<T>(fn: () => Promise<T>, timeoutMs: number): Promise<T> {
    await this.acquire(timeoutMs);
    try {
      return await fn();
    } finally {
      this.inUse--;
      this.drain();
      this.report();
    }
  }

  private acquire(timeoutMs: number): Promise<void> {
    if (this.inUse < this.max && this.waiters.length === 0) {
      this.inUse++;
      this.report();
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const waiter = {
        resolve,
        timer: setTimeout(() => {
          const i = this.waiters.indexOf(waiter);
          if (i !== -1) this.waiters.splice(i, 1);
          this.report();
          reject(new TimeoutError(`timeout acquiring db connection after ${timeoutMs}ms`));
        }, timeoutMs),
      };
      this.waiters.push(waiter);
      this.report();
    });
  }

  private drain(): void {
    while (this.inUse < this.max && this.waiters.length > 0) {
      const w = this.waiters.shift()!;
      clearTimeout(w.timer);
      this.inUse++;
      w.resolve();
    }
  }

  private report(): void {
    this.onChange(this.inUse, this.waiters.length);
  }
}
