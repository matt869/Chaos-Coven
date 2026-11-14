import { sleep, type Runtime } from '../common/runtime.js';
import { ORDERS_QUEUE } from './storefront.js';

const MAX_CONSUMERS = 16;

/** Consumes the orders queue and marks each paid order as confirmed. */
export async function worker(rt: Runtime): Promise<void> {
  const { config, metrics, log, toggles } = rt;
  const db = rt.dataDb();
  const redis = await rt.redis();

  const consume = async (slot: number) => {
    // Each consumer needs its own connection: BRPOP blocks it.
    const conn = redis.duplicate();
    conn.on('error', () => undefined);
    await conn.connect();
    for (;;) {
      const concurrency = Math.min(MAX_CONSUMERS, Math.max(1, config.number('concurrency', 4)));
      // consumer-stall: stop taking work without a sound. No log line on purpose.
      if (slot >= concurrency || toggles.enabled('consumer-stall')) {
        await sleep(1000);
        continue;
      }
      try {
        const item = await conn.brPop(ORDERS_QUEUE, 1);
        if (item === null) continue;
        const { orderId } = JSON.parse(item.element) as { orderId: string };
        await db.query(`UPDATE orders SET status = 'confirmed', confirmed_at = now() WHERE id = $1`, [orderId]);
        metrics.jobsProcessed.inc({ service: rt.service });
        log.info('order confirmed', { orderId });
      } catch (err) {
        log.error('job failed', { error: (err as Error).message });
        await sleep(500);
      }
    }
  };

  for (let i = 0; i < MAX_CONSUMERS; i++) void consume(i);
}
