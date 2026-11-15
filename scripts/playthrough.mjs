#!/usr/bin/env node
// Bot playtest against the real sandbox. For each haunting it:
//   1. starts a session through the game server, like a player
//   2. waits until the haunting's symptom and cause signals really show up (is it fair?)
//   3. names the root cause and applies the haunting's documented fix in the terminal
//   4. waits until verify passes (does the fix work?)
//   5. ends the session and checks the sandbox is healthy again (did it revert?)
//
//   npm run build && npm run sandbox:up
//   node scripts/playthrough.mjs [haunting-id ...]      (or: npm run playthrough)
//
// It starts its own game server on port 4799. Results go to stdout and
// scripts/.playthrough/results.json. Takes a few minutes per haunting.

import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const PORT = Number(process.env.PLAYTHROUGH_PORT ?? 4799);
const BASE = `http://127.0.0.1:${PORT}`;
const SIGNAL_TIMEOUT_MS = Number(process.env.PLAYTHROUGH_SIGNAL_TIMEOUT_S ?? 480) * 1000;
const VERIFY_TIMEOUT_MS = Number(process.env.PLAYTHROUGH_VERIFY_TIMEOUT_S ?? 300) * 1000;
const POLL_MS = 15_000;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (msg) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);

async function api(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${data.error ?? ''}`);
  return data;
}

function sandboxHealthy() {
  try {
    execFileSync('node', ['scripts/sandbox-status.mjs'], { stdio: 'pipe' });
    return true;
  } catch (err) {
    log(String(err.stdout ?? '').split('\n').filter((l) => l.startsWith('FAIL')).join(' | '));
    return false;
  }
}

async function waitUntil(label, timeoutMs, fn) {
  const started = Date.now();
  for (;;) {
    const r = await fn();
    if (r.done) return { ...r, seconds: Math.round((Date.now() - started) / 1000) };
    if (Date.now() - started > timeoutMs) return { ...r, done: false, seconds: Math.round((Date.now() - started) / 1000) };
    log(`  ${label}: ${r.status}`);
    await wait(POLL_MS);
  }
}

async function play(haunting, mcp) {
  log(`=== ${haunting.id}`);
  const result = { id: haunting.id };
  // The engine has the full definition (fix, root cause); the player API never shows it.
  const def = JSON.parse(execFileSync('node', ['-e', `import('./engine/dist/index.js').then(async (e) => { const r = await e.loadHauntings('hauntings'); process.stdout.write(JSON.stringify(r.hauntings.find((h) => h.id === ${JSON.stringify(haunting.id)}))) })`], { encoding: 'utf8' }));

  const session = await api('POST', '/api/sessions', { hauntingId: haunting.id, player: 'playthrough-bot' });
  log(`session ${session.id} started: ${session.alert}`);

  // 2. Fairness: wait until every symptom and cause signal matches.
  const wanted = def.signals.filter((s) => s.kind !== 'red-herring').map((s) => s.id);
  const firstSeen = {};
  const signals = await waitUntil('signals', SIGNAL_TIMEOUT_MS, async () => {
    const r = await mcp.callTool({ name: 'haunting_signals', arguments: { id: haunting.id } });
    const list = JSON.parse(r.content[0].text).signals;
    for (const s of list) if (s.pass && firstSeen[s.id] === undefined) firstSeen[s.id] = Math.round((Date.now() - session.startedAt) / 1000);
    const missing = wanted.filter((id) => firstSeen[id] === undefined);
    const herrings = list.filter((s) => s.kind === 'red-herring').map((s) => `${s.id}=${s.pass ? 'as expected' : 'NOT as expected'}`);
    return { done: missing.length === 0, status: `missing ${missing.join(', ') || 'none'}; red herrings: ${herrings.join(', ')}`, missing, list };
  });
  const view = await api('GET', `/api/sessions/${session.id}`);
  result.signals = { allSeen: signals.done, secondsToAll: signals.seconds, firstSeenSeconds: firstSeen, neverSeen: signals.missing, escalationStepReached: view.escalationStep };
  log(`signals: ${signals.done ? `all seen after ${signals.seconds}s` : `NOT all seen: ${signals.missing.join(', ')}`}`);

  // 3. Diagnose and fix like a player.
  await api('POST', `/api/sessions/${session.id}/diagnose`, { component: def.rootCause.component, summary: def.rootCause.summary });
  const fix = def.fix.actions[0];
  const fixOut = await api('POST', `/api/sessions/${session.id}/command`, { line: fix });
  log(`fix "${fix}": ${fixOut.output}`);
  result.fix = { command: fix, ok: fixOut.ok, output: fixOut.output };

  // 4. Verify.
  const verify = await waitUntil('verify', VERIFY_TIMEOUT_MS, async () => {
    const v = await api('POST', `/api/sessions/${session.id}/verify`);
    const failing = v.checks.filter((c) => !c.pass).map((c) => `${c.id}=${c.observed}`);
    return { done: v.pass, status: `failing ${failing.join(', ')}`, checks: v.checks };
  });
  result.verify = { passed: verify.done, seconds: verify.seconds, checks: verify.checks };
  log(`verify: ${verify.done ? `passed after ${verify.seconds}s` : 'did NOT pass'}`);

  // 5. End, score, and check the sandbox recovered.
  const pm = await api('POST', `/api/sessions/${session.id}/end`);
  result.score = pm.score.total;
  result.scoreBreakdown = { detection: pm.score.detection.points, rootCause: pm.score.rootCause.points, fix: pm.score.fix.points, penalties: pm.score.penalties.points };
  const engineState = JSON.parse((await mcp.callTool({ name: 'list_hauntings', arguments: {} })).content[0].text);
  result.revertedInEngine = !engineState.some((h) => h.active);
  const recovered = await waitUntil('sandbox recovery', 180_000, async () => ({ done: sandboxHealthy(), status: 'waiting for the sandbox to recover' }));
  result.sandboxRecovered = recovered.done;
  result.recoverySeconds = recovered.seconds;
  log(`score ${pm.score.total}/100; reverted: ${result.revertedInEngine}; sandbox healthy again: ${recovered.done} (${recovered.seconds}s)`);
  return result;
}

const tmp = join(tmpdir(), 'wh-playthrough');
const server = spawn('node', ['server/dist/main.js'], {
  env: { ...process.env, PORT: String(PORT), WH_TIME_SCALE: process.env.WH_TIME_SCALE ?? '5', WH_LEDGER_PATH: join(tmp, 'ledger.json'), WH_DATA_DIR: tmp },
  stdio: ['ignore', 'ignore', 'inherit'],
});
const results = [];
let mcp;
try {
  for (let i = 0; i < 40; i++) {
    if (await fetch(`${BASE}/api/health`).then((r) => r.ok, () => false)) break;
    await wait(250);
  }
  mcp = new Client({ name: 'playthrough', version: '0' });
  await mcp.connect(new StreamableHTTPClientTransport(new URL(`${BASE}/mcp`)));
  if (!sandboxHealthy()) throw new Error('the sandbox is not healthy before starting. Run: npm run sandbox:up');

  const wantedIds = process.argv.slice(2);
  const all = await api('GET', '/api/hauntings');
  const chosen = all.filter((x) => wantedIds.length === 0 || wantedIds.includes(x.id));
  for (const [i, h] of chosen.entries()) {
    if (i > 0) {
      // Metrics use 1-2 minute windows: let the previous haunting's effects age out.
      log('cooling down 150s before the next haunting');
      await wait(150_000);
    }
    try {
      results.push(await play(h, mcp));
    } catch (err) {
      log(`ERROR in ${h.id}: ${err.message}`);
      results.push({ id: h.id, error: err.message });
      await api('GET', '/api/sessions/active').then((s) => s && api('POST', `/api/sessions/${s.id}/end`)).catch(() => undefined);
    }
  }
} finally {
  await mcp?.close().catch(() => undefined);
  server.kill('SIGTERM');
  mkdirSync('scripts/.playthrough', { recursive: true });
  writeFileSync('scripts/.playthrough/results.json', JSON.stringify(results, null, 2));
  console.log('\nSUMMARY');
  for (const r of results) {
    console.log(
      r.error
        ? `  ${r.id}: ERROR ${r.error}`
        : `  ${r.id}: signals ${r.signals.allSeen ? `all in ${r.signals.secondsToAll}s` : `MISSING ${r.signals.neverSeen.join(',')}`}; fix ${r.verify.passed ? `verified in ${r.verify.seconds}s` : 'NOT verified'}; score ${r.score}; reverted ${r.revertedInEngine && r.sandboxRecovered}`,
    );
  }
  const ok = results.length > 0 && results.every((r) => !r.error && r.signals.allSeen && r.verify.passed && r.revertedInEngine && r.sandboxRecovered);
  process.exitCode = ok ? 0 : 1;
}
