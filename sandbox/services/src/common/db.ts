import pg from 'pg';
import type { ConfigBackend, Scalar } from './config.js';

export type Pool = pg.Pool;

export function createPool(connectionString: string, max = 10): pg.Pool {
  const pool = new pg.Pool({ connectionString, max, connectionTimeoutMillis: 5000, idleTimeoutMillis: 10_000 });
  // An idle client error (for example Postgres restarting) must not crash the process.
  pool.on('error', () => undefined);
  return pool;
}

/** Config overrides stored in the service_config table (see sandbox/postgres/init.sql). */
export function postgresConfigBackend(pool: pg.Pool): ConfigBackend {
  return {
    async load(service) {
      const { rows } = await pool.query<{ key: string; value: Scalar }>(
        'SELECT key, value FROM service_config WHERE service = $1',
        [service],
      );
      return Object.fromEntries(rows.map((r) => [r.key, r.value]));
    },
    async set(service, key, value) {
      await pool.query(
        `INSERT INTO service_config (service, key, value) VALUES ($1, $2, $3::jsonb)
         ON CONFLICT (service, key) DO UPDATE SET value = EXCLUDED.value`,
        [service, key, JSON.stringify(value)],
      );
    },
    async unset(service, key) {
      await pool.query('DELETE FROM service_config WHERE service = $1 AND key = $2', [service, key]);
    },
  };
}
