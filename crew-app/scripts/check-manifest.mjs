// Checks crew-app/app.json against the documented Crew manifest rules
// (https://kiro.dev/docs/crew/apps/manifest/). A local stand-in for `kirocrew doctor`,
// which is not available everywhere; it does not replace it.
//
//   node crew-app/scripts/check-manifest.mjs

import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/** True when `p` is a relative path that stays inside `root` (no absolute paths, no `..` escape). */
export function staysInside(root, p) {
  if (typeof p !== 'string' || p.length === 0) return false;
  if (isAbsolute(p) || /^[a-zA-Z]:/.test(p) || p.startsWith('/') || p.startsWith('\\') || p.startsWith('~')) return false;
  if (p.split(/[\\/]/).includes('..')) return false;
  const rel = relative(root, resolve(root, p));
  // Compare whole segments: a folder named "..-x" is fine, only ".." itself escapes.
  return rel === '' || (!isAbsolute(rel) && !rel.split(sep).includes('..'));
}

/** Every path-checked manifest field, as [field, path] pairs. mcpServers is exempt per the docs. */
export function manifestPaths(m) {
  const out = [];
  for (const a of m.agents ?? []) out.push(['agents', a]);
  for (const s of m.skills ?? []) out.push(['skills', s]);
  for (const s of m.sops ?? []) out.push(['sops', s]);
  if (m.ui?.entry !== undefined) out.push(['ui.entry', m.ui.entry]);
  for (const p of m.ui?.pages ?? []) {
    if (p.entryPoint !== undefined) out.push(['ui.pages[].entryPoint', p.entryPoint]);
    if (p.iconUrl !== undefined) out.push(['ui.pages[].iconUrl', p.iconUrl]);
  }
  if (m.backend?.entryPoint !== undefined) out.push(['backend.entryPoint', m.backend.entryPoint]);
  return out;
}

export function checkManifest(m, root) {
  const problems = [];
  const need = (cond, msg) => cond || problems.push(msg);

  for (const f of ['name', 'version', 'displayName', 'description']) need(typeof m[f] === 'string' && m[f].length > 0, `${f} is required`);
  need(/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(m.name ?? ''), 'name must be kebab-case');
  need(/^\d+\.\d+\.\d+$/.test(m.version ?? ''), 'version must be semver X.Y.Z');
  need(Array.isArray(m.agents) && m.agents.every((a) => typeof a === 'string'), 'agents must be an array of paths');
  need(Array.isArray(m.skills) && m.skills.every((s) => typeof s === 'string'), 'skills must be an array of paths');

  for (const [field, p] of manifestPaths(m)) {
    if (!staysInside(root, p)) {
      problems.push(`${field} "${p}" must be relative and stay inside the app folder`);
      continue;
    }
    const full = resolve(root, p);
    if (!existsSync(full)) problems.push(`${field} "${p}" does not exist`);
  }
  for (const a of m.agents ?? []) {
    if (!staysInside(root, a) || !existsSync(resolve(root, a))) continue;
    try {
      const agent = JSON.parse(readFileSync(resolve(root, a), 'utf8'));
      need(/^[A-Za-z0-9_-]+$/.test(agent.name ?? ''), `agent ${a}: name must be plain ASCII`);
      need(typeof agent.prompt === 'string' && agent.prompt.length > 0, `agent ${a}: prompt is required`);
    } catch {
      problems.push(`agent ${a} is not valid JSON`);
    }
  }
  for (const s of m.skills ?? []) {
    if (!staysInside(root, s) || !existsSync(resolve(root, s))) continue;
    need(statSync(resolve(root, s)).isDirectory() && existsSync(resolve(root, s, 'SKILL.md')), `skill ${s} must be a directory with SKILL.md`);
  }
  for (const c of m.crons ?? []) {
    need(typeof c.name === 'string' && c.name.length > 0, 'every cron needs a name');
    need((c.every === undefined) !== (c.cron_expr === undefined), `cron ${c.name}: set exactly one of every or cron_expr`);
    need(typeof c.message === 'string' && c.message.length > 0, `cron ${c.name}: message is required`);
  }
  for (const p of m.ui?.pages ?? []) need(typeof p.route === 'string' && typeof p.label === 'string', 'every ui page needs route and label');
  if (m.backend !== undefined) need(['python', 'asgi', 'node', 'exec', ''].includes(m.backend.type ?? ''), 'backend.type is not a documented value');
  for (const [name, server] of Object.entries(m.mcpServers ?? {})) {
    need(typeof server.url === 'string' || typeof server.command === 'string', `mcpServers.${name} needs url or command`);
  }
  return problems;
}

const isMain = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const problems = checkManifest(JSON.parse(readFileSync(resolve(root, 'app.json'), 'utf8')), root);
  for (const p of problems) console.error(`  - ${p}`);
  console.log(problems.length === 0 ? 'app.json: valid' : `app.json: ${problems.length} problem(s)`);
  process.exit(problems.length === 0 ? 0 : 1);
}
