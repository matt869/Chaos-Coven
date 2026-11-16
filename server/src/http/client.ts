import type { IncomingMessage } from 'node:http';

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const FORWARDING_HEADERS = ['cf-connecting-ip', 'cf-ray', 'x-forwarded-for', 'forwarded'];

/**
 * True for requests made on this machine, such as local agents, the playthrough bot
 * or a developer's browser. Caddy and cloudflared also connect from loopback, but they
 * always add a forwarding header, so a public visitor is never a local operator.
 */
export function isLocalOperator(req: IncomingMessage): boolean {
  const forwarded = FORWARDING_HEADERS.some((h) => req.headers[h] !== undefined);
  return !forwarded && LOOPBACK.has(req.socket.remoteAddress ?? '');
}

/** True when the visitor reached us over HTTPS (through Caddy or Cloudflare). */
export function isHttps(req: IncomingMessage): boolean {
  return req.headers['x-forwarded-proto'] === 'https' || String(req.headers['cf-visitor'] ?? '').includes('https');
}
