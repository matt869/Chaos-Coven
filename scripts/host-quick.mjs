#!/usr/bin/env node
// Hosts Witching Hour on a public https://*.trycloudflare.com link, with no domain and
// no Cloudflare account, protected by an access code.
//
//   npm run build && npm run sandbox:up && npm run host:quick
//
// Share the printed link and access code. Stop with Ctrl+C. The link changes every time
// this starts. For a permanent link on your own domain, see infra/cloudflare/README.md.

import { execFileSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { get } from 'node:http';

const PORT = process.env.PORT ?? '4000';
const fail = (msg) => {
  console.error(`\n[host] ${msg}\n`);
  process.exit(1);
};

if (!existsSync('server/dist/main.js') || !existsSync('web/dist/index.html')) fail('Build first: npm run build');
try {
  execFileSync(process.execPath, ['scripts/sandbox-status.mjs'], { stdio: 'pipe' });
} catch {
  fail('The sandbox is not healthy. Start Docker Desktop, then: npm run sandbox:up && npm run sandbox:status');
}
try {
  execFileSync('cloudflared', ['--version'], { stdio: 'pipe' });
} catch {
  fail('cloudflared is not installed: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/');
}

// Readable but unguessable: 3 groups of 4 from a 32-letter alphabet (60 bits).
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
const code =
  process.env.WH_ACCESS_CODE ??
  [0, 1, 2].map(() => [...randomBytes(4)].map((b) => ALPHABET[b % ALPHABET.length]).join('')).join('-');

const server = spawn(process.execPath, ['server/dist/main.js'], {
  env: { WH_TIME_SCALE: '3', WH_SESSION_MAX_MINUTES: '20', ...process.env, PORT, WH_ACCESS_CODE: code },
  stdio: ['ignore', 'inherit', 'inherit'],
});

const healthy = () =>
  new Promise((resolve) => {
    get(`http://127.0.0.1:${PORT}/api/health`, { agent: false }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    }).on('error', () => resolve(false));
  });
for (let i = 0; i < 40 && !(await healthy()); i++) await new Promise((r) => setTimeout(r, 250));
if (!(await healthy())) fail(`The game server did not start on port ${PORT}.`);

const tunnel = spawn('cloudflared', ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${PORT}`], { stdio: ['ignore', 'pipe', 'pipe'] });
let announced = false;
const scan = (chunk) => {
  const m = String(chunk).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
  if (m && !announced) {
    announced = true;
    mkdirSync('scripts/.hosting', { recursive: true });
    writeFileSync('scripts/.hosting/link.txt', `${m[0]}\naccess code: ${code}\n`);
    console.log(`\n  Witching Hour is live\n\n    Link:         ${m[0]}\n    Access code:  ${code}\n\n  Share both. Daemonwatch: ${m[0]}/daemonwatch/\n  (Also saved to scripts/.hosting/link.txt. The link can take up to a minute to start working.)\n  Stop with Ctrl+C.\n`);
  }
};
tunnel.stdout.on('data', scan);
tunnel.stderr.on('data', scan);

const stop = () => {
  tunnel.kill();
  server.kill('SIGTERM');
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
tunnel.on('exit', (c) => {
  console.error(`[host] cloudflared exited (${c}). Stopping.`);
  server.kill('SIGTERM');
});
server.on('exit', (c) => {
  tunnel.kill();
  process.exit(c ?? 0);
});
