import { randomUUID } from 'node:crypto';
import { HttpError } from '../common/http.js';
import { Limiter, TimeoutError } from '../common/limiter.js';
import type { Runtime } from '../common/runtime.js';

/** How long the simulated card provider call holds a database transaction open. */
export const PROVIDER_HOLD_MS = 250;

export async function payments(rt: Runtime): Promise<void> {
  const { router, config, metrics, log } = rt;
  const db = rt.dataDb();
  const limiter = new Limiter(Math.max(1, config.number('db.pool_max', 10)), (inUse, waiting) => {
    metrics.poolInUse.set({ service: rt.service }, inUse);
    metrics.poolWaiting.set({ service: rt.service }, waiting);
  });
  config.onChange((key) => {
    if (key === 'db.pool_max') {
      const size = Math.max(1, config.number(key, 10));
      limiter.resize(size);
      log.info('db pool resized', { size });
    }
  });

  const charge = (cartId: number, amount: number) =>
    limiter.run(async () => {
      const client = await db.connect();
      try {
        const orderId = randomUUID();
        await client.query('BEGIN');
        await client.query(`INSERT INTO orders (id, cart_id, amount, status) VALUES ($1, $2, $3, 'paid')`, [orderId, cartId, amount]);
        // The provider call happens inside the transaction, holding the connection.
        await client.query('SELECT pg_sleep($1)', [PROVIDER_HOLD_MS / 1000]);
        await client.query('INSERT INTO payments (id, order_id, amount) VALUES ($1, $2, $3)', [randomUUID(), orderId, amount]);
        await client.query('COMMIT');
        return orderId;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }
    }, 1500);

  router.on('POST', '/payments/authorize', async ({ body }) => {
    const b = body as { cartId?: unknown; amount?: unknown } | undefined;
    const cartId = Number(b?.cartId);
    const amount = Number(b?.amount);
    if (!Number.isInteger(cartId) || !Number.isFinite(amount) || amount < 0) throw new HttpError(400, 'invalid payment');

    const attempts = Math.min(10, Math.max(1, config.number('retry.max_attempts', 3)));
    let lastError: Error | undefined;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        const orderId = await charge(cartId, amount);
        return { status: 200, body: { orderId } };
      } catch (err) {
        lastError = err as Error;
        log.warn(err instanceof TimeoutError ? 'timeout acquiring db connection' : 'payment attempt failed', {
          cartId,
          attempt,
          attempts,
          error: lastError.message,
        });
      }
    }
    log.error('payment failed', { cartId, error: lastError?.message });
    throw new HttpError(503, 'payment failed');
  });
}
