import { HttpError } from '../common/http.js';
import { Limiter } from '../common/limiter.js';
import type { Runtime } from '../common/runtime.js';

export async function cart(rt: Runtime): Promise<void> {
  const { router, config, metrics, log } = rt;
  const db = rt.dataDb();
  const limiter = new Limiter(config.number('pool.max_connections', 20), (inUse, waiting) => {
    metrics.poolInUse.set({ service: rt.service }, inUse);
    metrics.poolWaiting.set({ service: rt.service }, waiting);
  });
  config.onChange((key) => {
    if (key === 'pool.max_connections') limiter.resize(Math.max(1, config.number(key, 20)));
  });

  router.on('GET', '/cart/:id', async ({ params }) => {
    const id = Number(params.id);
    if (!Number.isInteger(id) || id < 1) throw new HttpError(400, 'invalid cart id');
    try {
      const { rows } = await limiter.run(
        () =>
          db.query<{ total: string | null; found: boolean }>(
            `SELECT EXISTS(SELECT 1 FROM carts WHERE id = $1) AS found,
                    (SELECT COALESCE(SUM((item->>'price')::numeric * (item->>'qty')::int), 0)
                       FROM carts, jsonb_array_elements(items) AS item WHERE id = $1) AS total`,
            [id],
          ),
        2000,
      );
      if (!rows[0]?.found) throw new HttpError(404, 'cart not found');
      return { status: 200, body: { cartId: id, total: Number(rows[0].total ?? 0) } };
    } catch (err) {
      if (err instanceof HttpError) throw err;
      log.error('cart lookup failed', { cartId: id, error: (err as Error).message });
      throw err;
    }
  });
}
