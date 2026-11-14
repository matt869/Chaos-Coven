# Design: crew-app

## Shape

```
crew-app/
  app.json                       manifest (documented schema)
  agents/ghost-director.json     tools: @kirocrew-core, @witching-engine
  agents/medium.json             same tools, read-only by instruction
  skills/haunting-playbook/      + weekday cron procedure
  skills/postmortem-writing/
  skills/sandbox-safety/         copied from .kiro/steering (always loaded)
  skills/ghost-voice/            copied from .kiro/steering
  ui/src/shared/                 Daemonwatch components, DrillsClient, UiKit
  ui/src/standalone/main.tsx     fetch + plain HTML kit  -> ui/dist/standalone/ (served at /daemonwatch/)
  ui/src/crew/index.tsx          useAppApi + SDK UI kit  -> ui/dist/index.mjs (default export)
  backend/src/proxy-auth.mjs     X-Crew-Proxy verification (pure)
  backend/src/server.mjs         verify, allowlist, forward to the game server
  scripts/check-manifest.mjs     documented manifest rules + path containment
```

## Decisions

- **One component set, two shells.** Shared components take a `DrillsClient` (the API) and a `UiKit` (Header, Card, Button, Empty). The standalone shell passes `fetch` and plain HTML; the Crew shell passes `useAppApi()` and `@kirocrew/app-sdk/ui` components.
- **MCP over HTTP from the game server.** The game server already holds the engine and the single-sandbox lock, so `/mcp` is served there (stateless Streamable HTTP, DNS-rebinding protection, loopback peers only). It adds `list_drills` and `drill_results`. An agent's `apply_haunting` is refused during a player session, and a player can't start while an agent's haunting is applied.
- **Dependency-free backend.** Crew copies the app folder without `node_modules`, so the backend uses only Node built-ins.
- **Fail closed.** No secret, or a malformed header, means 401. Only the drills API (and `GET /api/hauntings`) is forwarded, to a loopback game server only.
- **Cron "runs drills" as rehearsals.** Drills are played by people. The 09:00 job lists the day's drills, rehearses each haunting (apply, check signals, revert) so it's known to work, and posts the schedule and results.

## Assumptions the docs leave open

These are isolated so each is a one-place change. See `crew-app/README.md`.

- The `X-Crew-Proxy` value layout (`t=<sec>,sig=<hex>`) and hex encodings.
- The app secret source (`CREW_APP_SECRET`, then `.app_secret` files).
- Whether `ui.entry` is relative to the app root (used) or to `ui/`.
- SDK UI component props.
- How Crew passes `port: "auto"` and config to the backend (`PORT`, `DAEMONWATCH_GAME_SERVER_URL`).
