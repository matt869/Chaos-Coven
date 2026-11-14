import { readEnv, startRuntime, type Runtime } from './common/runtime.js';
import { cart } from './roles/cart.js';
import { payments } from './roles/payments.js';
import { storefront } from './roles/storefront.js';
import { traffic } from './roles/traffic.js';
import { worker } from './roles/worker.js';

const ROLES: Record<string, (rt: Runtime) => Promise<void>> = { storefront, cart, payments, worker, traffic };

const service = process.env.SERVICE ?? '';
const role = ROLES[service];
if (role === undefined) {
  process.stderr.write(`SERVICE must be one of ${Object.keys(ROLES).join(', ')}\n`);
  process.exit(2);
}

const rt = await startRuntime(service, readEnv());
await role(rt);

const shutdown = () => {
  rt.log.info('shutting down');
  void rt.log.flush().finally(() => process.exit(0));
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
