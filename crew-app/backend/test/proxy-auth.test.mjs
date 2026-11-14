// Property 1: the proxy accepts a correctly signed request and rejects any change to
// the body, path, method or timestamp, and any timestamp outside +/-60 seconds.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { formatHeader, MAX_SKEW_SECONDS, parseHeader, sign, verifyProxyRequest } from '../src/proxy-auth.mjs';

const secretArb = fc.string({ minLength: 16, maxLength: 64 });
const methodArb = fc.constantFrom('GET', 'POST', 'PUT', 'PATCH', 'DELETE');
const pathArb = fc
  .tuple(
    fc.array(fc.stringMatching(/^[a-z0-9-]{1,12}$/), { minLength: 1, maxLength: 4 }),
    fc.option(fc.stringMatching(/^[a-z]{1,6}=[a-z0-9]{0,8}$/), { nil: undefined }),
  )
  .map(([segs, q]) => `/api/${segs.join('/')}${q === undefined ? '' : `?${q}`}`);
const bodyArb = fc.oneof(fc.constant(''), fc.json({ maxDepth: 2 }), fc.string({ maxLength: 200 }));
const nowArb = fc.integer({ min: 1_700_000_000, max: 2_000_000_000 });

const signed = ({ secret, method, path, body, ts }) => formatHeader(ts, sign(secret, ts, method, path, body));

describe('X-Crew-Proxy verification', () => {
  it('accepts a correctly signed request within the window', () => {
    fc.assert(
      fc.property(
        secretArb,
        methodArb,
        pathArb,
        bodyArb,
        nowArb,
        fc.integer({ min: -MAX_SKEW_SECONDS, max: MAX_SKEW_SECONDS }),
        (secret, method, path, body, now, skew) => {
          const header = signed({ secret, method, path, body, ts: now + skew });
          expect(verifyProxyRequest({ secret, header, method, pathWithQuery: path, body, nowSeconds: now })).toEqual({ ok: true });
        },
      ),
      { numRuns: 500 },
    );
  });

  it('rejects any change to the body, path, method or timestamp', () => {
    fc.assert(
      fc.property(
        secretArb,
        methodArb,
        pathArb,
        bodyArb,
        nowArb,
        fc.constantFrom('body', 'path', 'method', 'timestamp'),
        fc.string({ minLength: 1, maxLength: 8 }),
        (secret, method, path, body, now, what, extra) => {
          const header = signed({ secret, method, path, body, ts: now });
          const req = { secret, header, method, pathWithQuery: path, body, nowSeconds: now };
          if (what === 'body') req.body = body + extra;
          if (what === 'path') req.pathWithQuery = `${path}${path.includes('?') ? '&' : '?'}x=${encodeURIComponent(extra)}`;
          if (what === 'method') req.method = method === 'GET' ? 'POST' : 'GET';
          if (what === 'timestamp') {
            // A different timestamp, still inside the window, must not reuse the signature.
            const p = parseHeader(header);
            req.header = formatHeader(p.timestamp + 1, p.signature);
          }
          expect(verifyProxyRequest(req).ok).toBe(false);
        },
      ),
      { numRuns: 500 },
    );
  });

  it('rejects any timestamp outside +/-60 seconds, even when correctly signed', () => {
    fc.assert(
      fc.property(
        secretArb,
        methodArb,
        pathArb,
        bodyArb,
        nowArb,
        fc.integer({ min: MAX_SKEW_SECONDS + 1, max: 100_000 }),
        fc.boolean(),
        (secret, method, path, body, now, off, past) => {
          const ts = past ? now - off : now + off;
          const header = signed({ secret, method, path, body, ts });
          const r = verifyProxyRequest({ secret, header, method, pathWithQuery: path, body, nowSeconds: now });
          expect(r).toEqual({ ok: false, reason: 'timestamp outside the 60 second window' });
        },
      ),
      { numRuns: 300 },
    );
  });

  it('rejects another secret, a missing header and garbage headers', () => {
    fc.assert(
      fc.property(secretArb, secretArb, methodArb, pathArb, bodyArb, nowArb, fc.string({ maxLength: 120 }), (secret, other, method, path, body, now, junk) => {
        fc.pre(secret !== other);
        const base = { secret, method, pathWithQuery: path, body, nowSeconds: now };
        expect(verifyProxyRequest({ ...base, header: signed({ secret: other, method, path, body, ts: now }) }).ok).toBe(false);
        expect(verifyProxyRequest({ ...base, header: undefined }).ok).toBe(false);
        expect(verifyProxyRequest({ ...base, header: junk }).ok).toBe(false);
      }),
      { numRuns: 300 },
    );
  });

  it('fails closed without a secret', () => {
    const header = formatHeader(1, '0'.repeat(64));
    expect(verifyProxyRequest({ secret: '', header, method: 'GET', pathWithQuery: '/api/x', body: '', nowSeconds: 1 }).ok).toBe(false);
  });
});
