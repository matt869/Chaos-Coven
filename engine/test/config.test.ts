import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  it('defaults to the local sandbox', () => {
    const c = loadConfig({});
    expect(c.toxiproxyUrl).toBe('http://127.0.0.1:8474');
    expect(c.composeProject).toBe('witching-hour-sandbox');
    expect(c.hauntingsDir.replace(/\\/g, '/')).toMatch(/\/hauntings$/);
    expect(Object.keys(c.serviceAdminUrls).sort()).toEqual(['cart', 'payments', 'storefront', 'worker']);
  });

  it('accepts compose service names when the engine runs inside the sandbox network', () => {
    const c = loadConfig({ WH_TOXIPROXY_URL: 'http://toxiproxy:8474', WH_SERVICE_ADMIN_URLS: '{"cart":"http://cart:8080"}' });
    expect(c.serviceAdminUrls).toEqual({ cart: 'http://cart:8080' });
  });

  it('refuses URLs outside the sandbox', () => {
    expect(() => loadConfig({ WH_PROMETHEUS_URL: 'https://prometheus.prod.example.com' })).toThrow(/non-sandbox/);
    expect(() => loadConfig({ WH_SERVICE_ADMIN_URLS: '{"cart":"http://203.0.113.9"}' })).toThrow(/non-sandbox/);
  });
});
