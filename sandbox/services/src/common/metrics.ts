import { collectDefaultMetrics, Counter, Gauge, Histogram, Registry } from 'prom-client';

/**
 * Metric names here are part of the contract with hauntings/*.yaml. Renaming one
 * breaks the hauntings' signals and verify checks.
 */
export class Metrics {
  readonly registry = new Registry();
  private readonly requests: Counter<'service' | 'route' | 'code'>;
  private readonly duration: Histogram<'service' | 'route'>;
  readonly queueDepth: Gauge<'queue'>;
  readonly jobsProcessed: Counter<'service'>;
  readonly poolWaiting: Gauge<'service'>;
  readonly poolInUse: Gauge<'service'>;
  readonly configValue: Gauge<'service' | 'key'>;

  constructor(readonly service: string) {
    collectDefaultMetrics({ register: this.registry });
    this.requests = new Counter({
      name: 'http_requests_total',
      help: 'HTTP requests handled',
      labelNames: ['service', 'route', 'code'],
      registers: [this.registry],
    });
    this.duration = new Histogram({
      name: 'http_request_duration_seconds',
      help: 'HTTP request latency',
      labelNames: ['service', 'route'],
      buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10],
      registers: [this.registry],
    });
    this.queueDepth = new Gauge({
      name: 'witching_queue_depth',
      help: 'Messages waiting in a queue',
      labelNames: ['queue'],
      registers: [this.registry],
    });
    this.jobsProcessed = new Counter({
      name: 'witching_worker_jobs_processed_total',
      help: 'Jobs the worker finished',
      labelNames: ['service'],
      registers: [this.registry],
    });
    this.poolWaiting = new Gauge({
      name: 'witching_db_pool_waiting',
      help: 'Requests waiting for a database connection',
      labelNames: ['service'],
      registers: [this.registry],
    });
    this.poolInUse = new Gauge({
      name: 'witching_db_pool_in_use',
      help: 'Database connections in use',
      labelNames: ['service'],
      registers: [this.registry],
    });
    this.configValue = new Gauge({
      name: 'witching_config_value',
      help: 'Numeric and boolean config values (true = 1)',
      labelNames: ['service', 'key'],
      registers: [this.registry],
    });
  }

  observeRequest(route: string, code: number, seconds: number): void {
    this.requests.inc({ service: this.service, route, code: String(code) });
    this.duration.observe({ service: this.service, route }, seconds);
  }
}
