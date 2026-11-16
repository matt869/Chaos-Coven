import type { ServerResponse } from 'node:http';

/**
 * Response hardening for everything the game serves itself (not the Grafana proxy,
 * which sets its own headers). The player UI and Daemonwatch only load their own
 * files, talk to their own origin, and may embed only same-origin frames (Grafana).
 */
export const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  // React and xterm.js set element styles at runtime.
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-src 'self'",
  "frame-ancestors 'self'",
  "base-uri 'none'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

export function setSecurityHeaders(res: ServerResponse, kind: 'html' | 'asset' | 'api'): void {
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('referrer-policy', 'no-referrer');
  res.setHeader('x-frame-options', 'SAMEORIGIN');
  res.setHeader('permissions-policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
  res.setHeader('cross-origin-opener-policy', 'same-origin');
  if (kind === 'html') res.setHeader('content-security-policy', CSP);
  // Hashed build assets never change; pages and API answers must never be cached.
  res.setHeader('cache-control', kind === 'asset' ? 'public, max-age=31536000, immutable' : 'no-store');
}

/**
 * What a player may see when the sandbox misbehaves: the gist, without internal URLs,
 * file paths, container IDs or command lines. The full error goes to the server log.
 */
export function publicError(message: string): string {
  const first = message.split('\n')[0] ?? '';
  const cleaned = first
    .replace(/https?:\/\/\S+/g, '<service>')
    .replace(/(?:[A-Za-z]:\\|\/)(?:[\w.-]+[\\/])+[\w.-]*/g, '<path>')
    .replace(/\b[0-9a-f]{12,64}\b/g, '<id>')
    .replace(/\b\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?\b/g, '<address>')
    .replace(/^(?:docker|npm|node)\b.*?\bfailed:\s*/i, '')
    .trim();
  return (cleaned || 'unexpected error').slice(0, 160);
}
