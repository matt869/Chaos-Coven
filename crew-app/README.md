# Daemonwatch

Daemonwatch is the team side of Witching Hour, packaged as a [Kiro Crew App](https://kiro.dev/docs/crew/apps/). A team lead schedules drills, each player runs the same haunting in the sandbox, and everyone's scored postmortem lands in one table. Agents rehearse drills on a weekday schedule and write team postmortems.

The folder is self-contained: Crew copies only `crew-app/` on install, so every path in `app.json` stays inside it.

## What's here

| Path | What it is |
|---|---|
| [`app.json`](app.json) | The manifest: agents, skills, the engine MCP server, the weekday cron, the UI page, the backend, permissions and setup |
| [`agents/ghost-director.json`](agents/ghost-director.json) | Applies, escalates and reverts hauntings through the engine's MCP tools. Always reverts at the end of a drill. |
| [`agents/medium.json`](agents/medium.json) | Reads drill results and writes a blameless team postmortem. Read-only. |
| [`skills/`](skills/) | `haunting-playbook`, `postmortem-writing`, plus `sandbox-safety` and `ghost-voice` copied from the repo's steering so the installed app works without `.kiro/` |
| [`ui/`](ui/) | One set of React components, two builds: `dist/index.mjs` for the Crew dashboard, and `dist/standalone/` for the page the game server serves at `/daemonwatch/` |
| [`backend/`](backend/) | A dependency-free Node proxy. It verifies Crew's `X-Crew-Proxy` signature, then forwards drill calls to the game server. |
| [`scripts/check-manifest.mjs`](scripts/check-manifest.mjs) | Checks `app.json` against the documented manifest rules (a local stand-in for `kirocrew doctor`) |

## How the pieces connect

```
Crew dashboard ── /apps/daemonwatch (ui/dist/index.mjs, uses useAppApi)
      │
      ▼ /apps/daemonwatch/api/*  (signed with X-Crew-Proxy)
backend/src/server.mjs ── verifies the signature ──▶ game server http://127.0.0.1:4000/api/drills…

Crew agents ── MCP ──▶ game server http://127.0.0.1:4000/mcp  (engine tools + list_drills, drill_results)
```

The game server owns the sandbox. Player sessions and agents can't use it at the same time: an agent's `apply_haunting` is refused while a player is in a session, and a player can't start while an agent's haunting is applied.

## Install into Crew

Start the game server first (`npm run build && npm run dev:server` from the repo root), because the MCP server and backend both point at it. Then:

```bash
curl -X POST http://localhost:5476/api/apps/install -H 'content-type: application/json' -d '{"source": "./crew-app"}'
curl -X POST http://localhost:5476/api/apps/daemonwatch/enable
```

Daemonwatch then appears in the Crew sidebar. The `weekday-drills` cron runs at 09:00, Monday to Friday. It lists the day's drills, rehearses each haunting (apply, check signals, revert), and posts a summary.

## Without Crew

The game server serves the same UI at **http://127.0.0.1:4000/daemonwatch/**. For hot reload, run `npm run dev:daemonwatch` from the repo root.

## Building the UI

```bash
npm run build -w crew-app/ui         # typecheck, standalone page, then the Crew bundle
npm run build:crew -w crew-app/ui    # only ui/dist/index.mjs
```

`ui/dist/index.mjs` is committed, because Crew copies the app folder rather than building it. `setup.onInstall` rebuilds it only if it's missing.

## Things to confirm on a real Crew install

The Crew docs leave a few details open. Each one is isolated, so it's a one-place change:

- **The `X-Crew-Proxy` header layout.** The docs give the signing rule (timestamp within ±60s; HMAC-SHA256 with the app secret over `timestamp:method:/api/path?query:sha256(body)`), but not how the header is laid out. [`backend/src/proxy-auth.mjs`](backend/src/proxy-auth.mjs) assumes `t=<unix seconds>,sig=<hex>` with a hex body hash. If Crew differs, change `parseHeader`/`formatHeader` there.
- **Where the app secret comes from.** The backend reads `CREW_APP_SECRET`, then `.app_secret` in the app folder, then `~/.kiro/crew/apps/daemonwatch/.app_secret`. Without a secret, it rejects everything.
- **`ui.entry` base folder.** The manifest reference says paths are relative to the app root (`ui/dist/index.mjs`). The tutorial's example shows `dist/index.mjs`.
- **SDK component props.** `@kirocrew/app-sdk/ui` props aren't documented. [`ui/src/crew/index.tsx`](ui/src/crew/index.tsx) maps the shared kit onto `PageHeader`, `Card`, `CardTitle`, `Btn` and `EmptyState`.
- **Backend port and config.** The backend listens on `PORT` (default 4410) and reads the game server URL from `DAEMONWATCH_GAME_SERVER_URL`. How Crew passes `port: "auto"` and `configSchema` values isn't documented.
