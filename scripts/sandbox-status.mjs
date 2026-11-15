#!/usr/bin/env node
// Shows whether the sandbox is healthy: containers, scrape targets, the metrics and
// logs the hauntings depend on, and the gateway endpoints the engine uses.
//
//   node scripts/sandbox-status.mjs          (or: npm run sandbox:status)
//
// Exits non-zero if anything the game needs is missing.

import { execFileSync } from 'node:child_process';
import { get } from 'node:http';

const PROM = process.env.WH_PROMETHEUS_URL ?? 'http://127.0.0.1:9090';
const LOKI = process.env.WH_LOKI_URL ?? 'http://127.0.0.1:3100';
const problems = [];

// node:http instead of fetch: fetch's keep-alive pool crashes Node on exit on Windows
// ("Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)").
function json(url) {
  return new Promise((resolve, reject) => {
    const req = get(url, { agent: false, timeout: 5000 }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) return reject(new Error(`${url} returned ${res.statusCode}`));
        try {
          resolve(JSON.parse(body));
        } catch (err) {
          reject(err);
        }
      });
    });
    req.on('timeout', () => req.destroy(new Error(`${url} timed out`)));
    req.on('error', reject);
  });
}

async function prom(query) {
  const body = await json(`${PROM}/api/v1/query?query=${encodeURIComponent(query)}`);
  return body.data.result.map((r) => ({ labels: r.metric, value: Number(r.value[1]) }));
}

async function check(label, fn, { required = true } = {}) {
  try {
    const out = await fn();
    console.log(`ok    ${label}: ${out}`);
  } catch (err) {
    console.log(`${required ? 'FAIL' : 'warn'}  ${label}: ${err.message}`);
    if (required) problems.push(label);
  }
}

const fmt = (rows, key) => (rows.length === 0 ? '(no data)' : rows.map((r) => `${r.labels[key] ?? ''}=${+r.value.toFixed(3)}`).join(', '));

await check('containers', async () => {
  const out = execFileSync('docker', ['compose', '-f', 'sandbox/docker-compose.yml', 'ps', '--format', '{{.Service}} {{.State}} {{.Health}}'], { encoding: 'utf8' });
  const rows = out.trim().split('\n').filter(Boolean);
  const bad = rows.filter((r) => !/ running( healthy)?\s*$/.test(r));
  if (rows.length === 0) throw new Error('no containers. Run: npm run sandbox:up');
  if (bad.length > 0) throw new Error(`not running/healthy: ${bad.join('; ')}`);
  return `${rows.length} running`;
});

await check('scrape targets up', async () => {
  const rows = await prom('sum by (job) (up)');
  for (const job of ['storefront', 'cart', 'payments', 'worker']) {
    if (!rows.some((r) => r.labels.job === job && r.value >= 1)) throw new Error(`${job} is not being scraped (${fmt(rows, 'job')})`);
  }
  return fmt(rows, 'job');
});

await check('checkout traffic (req/s)', async () => {
  const rows = await prom('sum by (code) (rate(http_requests_total{service="storefront",route="/api/checkout"}[1m]))');
  if (!rows.some((r) => r.labels.code?.startsWith('2') && r.value > 0)) throw new Error(`no successful checkouts yet (${fmt(rows, 'code')})`);
  return fmt(rows, 'code');
});

await check('worker throughput (jobs/s)', async () => {
  const rows = await prom('sum(rate(witching_worker_jobs_processed_total[1m]))');
  if (!(rows[0]?.value > 0)) throw new Error('the worker is not processing orders');
  return rows[0].value.toFixed(2);
});

await check('orders queue depth', async () => {
  const rows = await prom('sum(witching_queue_depth{queue="orders"})');
  if (rows.length === 0) throw new Error('no queue depth metric from the storefront');
  return String(rows[0].value);
});

await check('config gauge (payments db.pool_max)', async () => {
  const rows = await prom('max(witching_config_value{service="payments",key="db.pool_max"})');
  if (rows.length === 0) throw new Error('missing');
  return String(rows[0].value);
});

await check('process metrics (cart rss)', async () => {
  const rows = await prom('max(process_resident_memory_bytes{job="cart"})');
  if (rows.length === 0) throw new Error('missing');
  return `${Math.round(rows[0].value / 1e6)} MB`;
});

await check('logs in Loki (lines/min)', async () => {
  const body = await json(`${LOKI}/loki/api/v1/query?query=${encodeURIComponent('sum by (service) (count_over_time({service=~".+"}[1m]))')}`);
  const rows = body.data.result.map((r) => `${r.metric.service}=${r.value[1]}`);
  if (!rows.some((r) => r.startsWith('worker='))) throw new Error(`no worker logs (${rows.join(', ') || 'none'})`);
  return rows.join(', ');
});

await check('toxiproxy proxies', async () => Object.keys(await json('http://127.0.0.1:8474/proxies')).sort().join(', '));
await check('service admin (payments db.pool_max)', async () => JSON.stringify(await json('http://127.0.0.1:8083/__admin/config/db.pool_max')));
await check('grafana', async () => (await json('http://127.0.0.1:3000/grafana/api/health')).database);

console.log(problems.length === 0 ? '\nsandbox: healthy' : `\nsandbox: ${problems.length} problem(s)`);
process.exit(problems.length === 0 ? 0 : 1);
