// Verifies the X-Crew-Proxy header the Crew gateway adds to every request it proxies
// to this backend (/apps/daemonwatch/api/* -> here).
//
// Signing rule, from https://kiro.dev/docs/crew/apps/sdk/:
//   HMAC-SHA256(app secret, "timestamp:method:/api/path[?query]:sha256(body)")
//   timestamp within +/-60 seconds of now, compared in constant time.
//
// ASSUMPTION: the docs do not show the header's value layout or encodings. This file
// assumes `t=<unix seconds>,sig=<hex hmac>` with a hex sha256 body hash (empty body =
// sha256 of ""). If Crew's verifyProxyRequest differs, change parseHeader/formatHeader
// and the encodings here; nothing else depends on them.

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export const HEADER = 'x-crew-proxy';
export const MAX_SKEW_SECONDS = 60;

/** @param {string | Uint8Array} body */
export function bodyHash(body) {
  return createHash('sha256').update(body).digest('hex');
}

/**
 * @param {number} timestamp unix seconds
 * @param {string} method
 * @param {string} pathWithQuery path as received, including any ?query
 * @param {string | Uint8Array} body raw body bytes ("" when there is none)
 */
export function stringToSign(timestamp, method, pathWithQuery, body) {
  return `${timestamp}:${method.toUpperCase()}:${pathWithQuery}:${bodyHash(body)}`;
}

/** @returns {string} hex HMAC-SHA256 */
export function sign(secret, timestamp, method, pathWithQuery, body) {
  return createHmac('sha256', secret).update(stringToSign(timestamp, method, pathWithQuery, body)).digest('hex');
}

export function formatHeader(timestamp, signature) {
  return `t=${timestamp},sig=${signature}`;
}

/** @returns {{ timestamp: number, signature: string } | null} */
export function parseHeader(value) {
  if (typeof value !== 'string' || value.length > 200) return null;
  const parts = Object.fromEntries(
    value.split(',').map((p) => {
      const i = p.indexOf('=');
      return i === -1 ? [p.trim(), ''] : [p.slice(0, i).trim(), p.slice(i + 1).trim()];
    }),
  );
  if (!/^\d{1,12}$/.test(parts.t ?? '') || !/^[0-9a-f]{64}$/.test(parts.sig ?? '')) return null;
  return { timestamp: Number(parts.t), signature: parts.sig };
}

/**
 * @param {{ secret: string, header: unknown, method: string, pathWithQuery: string, body: string | Uint8Array, nowSeconds?: number }} req
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function verifyProxyRequest({ secret, header, method, pathWithQuery, body, nowSeconds = Math.floor(Date.now() / 1000) }) {
  if (typeof secret !== 'string' || secret.length === 0) return { ok: false, reason: 'no app secret configured' };
  const parsed = parseHeader(header);
  if (parsed === null) return { ok: false, reason: 'missing or malformed X-Crew-Proxy header' };
  if (Math.abs(nowSeconds - parsed.timestamp) > MAX_SKEW_SECONDS) return { ok: false, reason: 'timestamp outside the 60 second window' };
  const expected = Buffer.from(sign(secret, parsed.timestamp, method, pathWithQuery, body), 'hex');
  const given = Buffer.from(parsed.signature, 'hex');
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return { ok: false, reason: 'bad signature' };
  return { ok: true };
}
