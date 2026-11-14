# Requirements: crew-app

Rebuild `crew-app/` (Daemonwatch) so it installs and runs as a real Kiro Crew App, and keep the standalone `/daemonwatch/` page. The Crew docs (apps, build-first-app, manifest, sdk) override anything in this repo.

## R1. Manifest
1. `app.json` SHALL follow the documented schema: `name` "daemonwatch", `version`, `displayName`, `description`, `author` "matt869", `license` "MIT", `agents` and `skills` as arrays of relative paths, `mcpServers`, `crons`, `ui`, `backend`, `permissions` (only what is used) and `setup`.
2. Every path in `app.json` SHALL be relative and stay inside `crew-app/`.
3. `setup.onInstall` and `setup.onUpdate` SHALL build the UI only when `ui/dist/index.mjs` is missing.

## R2. Self-contained
1. Agents SHALL NOT reference files outside `crew-app/`. The rules they need from `ghost-voice.md` and `sandbox-safety.md` SHALL live in the app's skills.

## R3. UI
1. A second Vite build SHALL output `ui/dist/index.mjs`: an ES library whose default export is the Daemonwatch page, with react, react-dom, react/jsx-runtime, lucide-react and `@kirocrew/app-sdk*` as externals.
2. The Crew page SHALL use `useAppApi()` for requests and the SDK's UI components.
3. The standalone build SHALL keep working at `/daemonwatch/` and share the same components.
4. `ui/dist/index.mjs` SHALL be committed.
5. The app SHALL declare one page: route `/apps/daemonwatch`, label `Daemonwatch`, icon `Ghost`.

## R4. Backend proxy
1. A Node backend in `crew-app/backend/` SHALL forward drill API calls to the game server (default `http://127.0.0.1:4000`).
2. It SHALL reject any request whose `X-Crew-Proxy` HMAC does not verify: timestamp within ±60s, signature over `timestamp:method:path?query:sha256(body)`, keyed with the app secret.

## R5. MCP
1. The game server SHALL serve the engine's MCP tools over HTTP at `/mcp`, bound to 127.0.0.1 only. `app.json` SHALL point at that URL.
2. The stdio MCP server SHALL keep working for Kiro IDE.

## R6. Agents and crons
1. `ghost-director` and `medium` SHALL be JSON with plain ASCII names and tools `@kirocrew-core` plus the engine server.
2. `ghost-director` MAY apply, escalate and revert hauntings, and SHALL always revert at the end of a drill.
3. A weekday cron (`0 9 * * 1-5`, agent `ghost-director`) SHALL run the day's drills and post results.

## R7. Properties (fast-check)
1. The proxy accepts a correctly signed request and rejects any change to the body, path, method or timestamp, and any timestamp outside ±60s.
2. No path in `app.json` escapes `crew-app/` or is absolute.
