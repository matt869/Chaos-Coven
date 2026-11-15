#!/usr/bin/env node
// Starts the game server with settings for a hosted demo (judges, playtests):
// faster escalation, shorter sessions. Run behind Cloudflare Tunnel + Access, see
// infra/cloudflare/README.md.
//
//   npm run build && npm run sandbox:up && npm run start:hosted
//
// Any of these can be overridden with the same environment variable.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

const defaults = {
  PORT: '4000',
  // Escalation steps arrive 3x sooner: The Vanishing escalates at 1:40 and 3:20.
  WH_TIME_SCALE: '3',
  // A session ends and reverts on its own after 20 minutes, so a judge who walks
  // away never blocks the sandbox for long.
  WH_SESSION_MAX_MINUTES: '20',
  WH_GRAFANA_URL: '/grafana',
};

if (!existsSync('server/dist/main.js') || !existsSync('web/dist/index.html')) {
  console.error('Build first: npm run build');
  process.exit(1);
}

const env = { ...defaults, ...process.env };
for (const k of Object.keys(defaults)) console.error(`[hosted] ${k}=${env[k]}`);
const child = spawn(process.execPath, ['server/dist/main.js'], { env, stdio: 'inherit' });
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
child.on('exit', (code) => process.exit(code ?? 0));
