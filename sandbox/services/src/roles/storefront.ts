import { randomUUID } from 'node:crypto';
import { callJson, HttpError } from '../common/http.js';
import type { Runtime } from '../common/runtime.js';

export const ORDERS_QUEUE = 'orders';

/**
 * The customer-facing shop. Checkout asks cart for the total, asks payments to charge
 * it, then queues the order for the worker to confirm.
 */
export async function storefront(rt: Runtime): Promise<void> {
  const { router, config, log, metrics, env } = rt;
  const redis = await rt.redis();

  router
    .on('GET', '/', () => ({
      status: 200,
      contentType: 'text/html',
      body: '<!doctype html><title>Witching Hour Shop</title><h1>Witching Hour Shop</h1><p>POST /api/checkout</p>',
    }))
    .on('POST', '/api/checkout', async ({ body }) => {
      const cartId = Number((body as { cartId?: unknown } | undefined)?.cartId);
      if (!Number.isInteger(cartId) || cartId < 1) throw new HttpError(400, 'cartId must be a positive integer');
      const timeoutMs = config.number('checkout.timeout_ms', 2000);
      const started = Date.now();
      try {
        const cart = await callJson<{ total: number }>(`${env.cartUrl}/cart/${cartId}`, { timeoutMs });
        const left = Math.max(100, timeoutMs - (Date.now() - started));
        const payment = await callJson<{ orderId: string }>(`${env.paymentsUrl}/payments/authorize`, {
          method: 'POST',
          body: { cartId, amount: cart.total, requestId: randomUUID() },
          timeoutMs: left,
        });
        await redis.lPush(ORDERS_QUEUE, JSON.stringify({ orderId: payment.orderId, at: Date.now() }));
        return { status: 202, body: { orderId: payment.orderId } };
      } catch (err) {
        const timedOut = (err as Error).name === 'TimeoutError';
        log.error(timedOut ? 'checkout timed out' : 'checkout failed', { cartId, error: (err as Error).message });
        throw new HttpError(timedOut ? 504 : 502, timedOut ? 'checkout timed out' : 'checkout failed');
      }
    })
    .on('POST', '/__admin/purge-queue/:name', async ({ params }) => {
      if (params.name !== ORDERS_QUEUE) throw new HttpError(404, 'unknown queue');
      const dropped = await redis.lLen(ORDERS_QUEUE);
      await redis.del(ORDERS_QUEUE);
      log.warn('orders queue purged', { dropped });
      return { status: 200, body: { dropped } };
    });

  // The storefront reports the queue depth it publishes into.
  setInterval(() => {
    redis
      .lLen(ORDERS_QUEUE)
      .then((n) => metrics.queueDepth.set({ queue: ORDERS_QUEUE }, n))
      .catch(() => undefined);
  }, 5000).unref();
}
