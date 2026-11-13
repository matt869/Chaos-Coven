# Chaos Coven: Witching Hour

**An on-call training game.** AI "ghost" agents inject realistic production faults into a sandboxed microservice system. You investigate with real tools (Grafana, logs, a restricted terminal), name the root cause, apply a fix, and get a scored postmortem.

Most engineers do their first on-call shift without any practice. Witching Hour lets you practice on a system that is actually broken, where getting it wrong costs nothing.

> **Status: early hackathon build.** The **haunting engine** (fault injection, verification, revert, scoring and its MCP server) is built and tested. The sandbox services, game server, player UI and the Daemonwatch crew app are planned but not built yet; their folders hold empty placeholder files. See [Project status](#project-status).

## How a haunting plays out

1. **Haunt.** A ghost agent picks a haunting and injects its fault into your sandbox.
2. **Page.** You get an alert, like a real page.
3. **Investigate.** Dashboards, logs and allowlisted `haunt` terminal commands.
4. **Name the root cause.** Which component failed, and why.
5. **Fix.** The engine checks the fix against live Prometheus and Loki data, not just your word.
6. **Postmortem.** A deterministic score: time to detect, root cause, verified fix, and penalties for harmful actions.

The haunted shop has a **storefront**, **cart**, **payments**, an async **worker**, **Postgres** and a **queue**.

## Who it's for

- Engineers new to on-call who want practice before their first rotation
- Students who have never debugged a distributed system under pressure
- Engineering managers running drills for their team (through Daemonwatch, a Kiro Crew App)

## Hauntings

A haunting is a YAML file in [`hauntings/`](hauntings/) validated against [`hauntings/schema.json`](hauntings/schema.json). It defines the fault, how it escalates over time, the signals a player can find, the health checks that prove a fix, the root cause, the correct fix, and which actions are harmful.

| Haunting | Difficulty | What happens | Status |
|---|---|---|---|
| [The Vanishing](hauntings/the-vanishing.yaml) | easy | The worker stops silently. Orders pile up in the queue while the storefront looks healthy. | Done |
| Possessed Config | medium | A service is running with a bad config value | Placeholder |
| Slow Whisper | hard | A slow-building fault | Placeholder |

There are four fault types, and every one is reversible:

| Type | What it does |
|---|---|
| `toxiproxy` | Adds latency or timeouts between services |
| `docker` | Stops or pauses a service's containers |
| `config` | Sets a service config value |
| `debug-endpoint` | Turns on a debug toggle, such as a memory leak |

## The engine

[`engine/`](engine/) is a TypeScript package that applies, escalates, verifies and reverts hauntings.

| API | What it does |
|---|---|
| `list()` | All valid hauntings, with whether each is active |
| `apply(id)` | Inject the base fault. Applying again changes nothing. |
| `escalate(id, step)` | Apply escalation steps up to `step` |
| `verify(id)` | Run the health checks against Prometheus and Loki. Returns pass/fail with evidence. |
| `revert(id)` | Remove every fault the haunting added |
| `signals(id)` | Evaluate the expected signals against live data |

**Safety comes first** (see [`sandbox-safety.md`](.kiro/steering/sandbox-safety.md)):

- **Reverts in any order.** A ledger records each resource's original state and which hauntings are faulting it. Reverts work in any order, even when two hauntings touch the same resource.
- **Crash recovery.** The ledger is saved before every change, so a restarted engine undoes faults left behind by a crash.
- **Sandbox only.** Docker commands only touch containers labeled with the sandbox's compose project, and no command ever runs through a shell. Every URL must be loopback or a compose service name.
- **Deterministic scoring.** Scores are computed by fixed rules, with no LLM involved.

### MCP server

The engine exposes its API as MCP tools over stdio, so Kiro agents can drive hauntings: `list_hauntings`, `apply_haunting`, `escalate_haunting`, `verify_haunting`, `revert_haunting`, `revert_all_hauntings` and `haunting_signals`. It reverts all hauntings when it shuts down or its client disconnects.

## Getting started

Requirements: Node.js 20+ for development (the engine itself runs on Node 18+), and Docker for the sandbox once it exists.

```bash
npm install
npm test            # unit + property tests for every workspace
npm run typecheck
npm run build -w engine
```

Run the MCP server:

```bash
node engine/dist/mcp/server.js
```

Configuration comes from `WH_*` environment variables. Each one defaults to the local sandbox:

| Variable | Default |
|---|---|
| `WH_HAUNTINGS_DIR` | `hauntings/` |
| `WH_COMPOSE_PROJECT` | `witching-hour-sandbox` |
| `WH_TOXIPROXY_URL` | `http://127.0.0.1:8474` |
| `WH_PROMETHEUS_URL` | `http://127.0.0.1:9090` |
| `WH_LOKI_URL` | `http://127.0.0.1:3100` |
| `WH_SERVICE_ADMIN_URLS` | JSON map, defaults to ports 8081-8084 |
| `WH_LEDGER_PATH` | `engine/.witching/ledger.json` |

> **On Windows,** run the tests from PowerShell or cmd, not Git Bash. Git Bash's lowercase `c:` drive letter makes Vitest load twice, and every suite fails with "failed to find the current suite".

## Testing

Every engine module has unit tests. Four core guarantees are checked with [fast-check](https://fast-check.dev/) property tests, in [`engine/test/properties`](engine/test/properties):

1. For any haunting, `apply` then `revert` returns every health probe to baseline within a timeout.
2. Applying a haunting twice has the same effect as applying it once.
3. Any two hauntings applied together revert cleanly, in either order.
4. Adding a harmful action never increases a score.

The property tests run against an in-memory fake sandbox that implements the same client interfaces as the real Docker, Toxiproxy and Prometheus/Loki clients. To run property 1 against a real sandbox, use `WH_SANDBOX=1 npx vitest run test/integration` from `engine/`.

## Project layout

```
.kiro/       Kiro steering, specs, hooks, agents and MCP settings
hauntings/   Fault scenarios (YAML) and their schema
engine/      Haunting engine and MCP server         (built)
sandbox/     Docker Compose system the player debugs (planned)
server/      Game API, sessions, narrator (Bedrock)  (planned)
web/         Player UI: React, Vite, xterm.js        (planned)
crew-app/    Daemonwatch, the Kiro Crew App for team drills (planned)
docs/        Writeup, playtests, Kiro journal
```

## Project status

| Part | Status |
|---|---|
| Kiro steering and the `haunting-engine` spec | Done |
| Haunting schema and The Vanishing | Done |
| Engine, scoring and MCP server | Done: 122 tests passing |
| Possessed Config and Slow Whisper hauntings | Placeholder files |
| Sandbox (Docker Compose, Toxiproxy, Prometheus, Loki, Grafana) | Not started |
| Game server and Bedrock narrator | Not started |
| Player UI | Not started |
| Daemonwatch crew app | Not started |

The contract the sandbox must meet (service names, admin endpoints, metric names) is in [`.kiro/specs/haunting-engine/design.md`](.kiro/specs/haunting-engine/design.md).

## Tech stack

TypeScript on Node.js, npm workspaces, Vitest and fast-check, the MCP TypeScript SDK, Docker Compose, Toxiproxy, Prometheus, Loki and Grafana. Planned: React with Vite and xterm.js for the player UI, and Amazon Bedrock (through an IAM role, never API keys in code) for the ghost narrator.

## Out of scope

- Real customer infrastructure: nothing ever runs outside the sandbox
- Kubernetes
- Multiplayer: one player per sandbox
