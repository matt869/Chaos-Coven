import type { Runtime } from '../common/runtime.js';

export const CART_COUNT = 50;

/** Simulated customers: steady checkouts against the storefront. */
export async function traffic(rt: Runtime): Promise<void> {
  const { env, log } = rt;
  const interval = 1000 / Math.max(0.1, env.trafficRps);
  let failures = 0;
  setInterval(() => {
    const cartId = 1 + Math.floor(Math.random() * CART_COUNT);
    fetch(`${env.storefrontUrl}/api/checkout`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cartId }),
      signal: AbortSignal.timeout(10_000),
    })
      .then((res) => {
        if (!res.ok) failures++;
        return res.body?.cancel();
      })
      .catch(() => failures++);
  }, interval);
  // One summary line a minute, so traffic does not drown the real services' logs.
  setInterval(() => {
    if (failures > 0) log.info('customers saw failed checkouts', { failures });
    failures = 0;
  }, 60_000);
}
