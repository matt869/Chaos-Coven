# Chaos Coven: Witching Hour

**An on-call training game.** AI "ghost" agents inject realistic production faults into a sandboxed microservice system. You get paged, investigate with real tools (Grafana, logs, a restricted terminal), name the root cause, apply a fix, and get a scored postmortem.

Most engineers do their first on-call shift without any practice. Witching Hour lets you practice on a system that is actually broken, where getting it wrong costs nothing.

## How a haunting plays out

1. **Haunt.** A ghost injects a fault into the sandboxed shop.
2. **Page.** You get an alert, like a real page.
3. **Investigate.** Grafana dashboards, logs in Loki, and allowlisted `haunt` terminal commands.
4. **Name the root cause.** Which component failed, and why.
5. **Fix.** The fix only counts once live Prometheus and Loki checks confirm it.
6. **Postmortem.** A deterministic score (time to detect, root cause, verified fix, penalties for harmful actions), plus the evidence you found and missed and a full timeline.

**Daemonwatch**, a Kiro Crew App, lets a team lead schedule the same drill for a whole team and compare results.

## Who it's for

- Engineers new to on-call who want practice before their first rotation
- Students who have never debugged a distributed system under pressure
- Engineering managers running drills for their team

## Hauntings

| Haunting | Difficulty | What breaks |
|---|---|---|
| [The Vanishing](hauntings/the-vanishing.yaml) | easy | The worker consuming the orders queue stops silently. The storefront stays green while orders pile up. |
| [Possessed Config](hauntings/possessed-config.yaml) | medium | Payments' DB pool is set to 1, and the value is stored in Postgres, so restarting doesn't help. Then retries pile on. |
| [Slow Whisper](hauntings/slow-whisper.yaml) | hard | Cart leaks memory slowly; later, GC pauses stall every request. |

Each haunting is a YAML file validated against [`hauntings/schema.json`](hauntings/schema.json). It defines the fault, how it escalates, the signals a player can find (including a red herring), the health checks that prove a fix, the root cause, the fix, and which actions are harmful.

## Quick start

You need Node.js 20+ and Docker.

```bash
npm install
npm run build              # engine, server, both UIs, sandbox services
npm run sandbox:up         # the shop + Toxiproxy, Prometheus, Loki, Grafana
npm run sandbox:status     # wait for "sandbox: healthy"
npm run dev:server         # game server on http://127.0.0.1:4000
```

Then open **http://127.0.0.1:4000**, pick a haunting, and start your shift. Daemonwatch is at **http://127.0.0.1:4000/daemonwatch/**, and Grafana at **http://127.0.0.1:4000/grafana/** (the game server proxies it, so it works on one hostname).

To add Daemonwatch to a running Kiro Crew, see [crew-app/README.md](crew-app/README.md) (`POST /api/apps/install {"source": "./crew-app"}`).

To work on the UIs with hot reload, run `npm run dev:web` (port 5173) or `npm run dev:daemonwatch` (port 5174) alongside the server.

When you're done: `npm run sandbox:down`.

### Hosting it (Cloudflare)

The game needs Docker, so it can't run on Cloudflare Pages or Workers. Run the stack on one machine and put a Cloudflare Tunnel with Cloudflare Access in front of it: see [infra/cloudflare/README.md](infra/cloudflare/README.md). `npm run start:hosted` starts the server with demo-friendly timings.

### Settings

Copy [`.env.example`](.env.example) and adjust. The useful ones:

| Variable | What it does |
|---|---|
| `WH_TIME_SCALE` | Speeds up escalation. `10` runs a 10-minute haunting in 1 minute. |
| `WH_NARRATOR` | `static` (default) uses the hand-written lines. `bedrock` rewrites them with Claude on Amazon Bedrock. |
| `AWS_REGION`, `WH_BEDROCK_MODEL_ID` | Bedrock region and model (default `anthropic.claude-opus-5-5`). Credentials come from the AWS credential chain, such as an IAM role. Never put keys in code or `.env`. |
| `WH_SESSION_MAX_MINUTES` | Sessions end and revert on their own after this long (default 45). |

## The player terminal

The terminal is not a shell. Only these commands run, and the server checks every argument:

```
haunt status                          haunt restart <service>
haunt logs <service> [minutes]        haunt scale worker <1-3>
haunt grep <service> <word> [minutes] haunt config get <service> <key>
haunt promql <expression>             haunt config set <service> <key> <value>
haunt queue                           haunt purge-queue orders
haunt help
```

Some of these are traps. Purging the orders queue, for example, deletes orders customers already paid for, and the postmortem explains why it cost you points.

## Architecture

```
 Player UI (web/) ──┐                         ┌── Daemonwatch UI (crew-app/ui/)
                    ▼                         ▼
              Game server (server/) ── sessions, terminal, scoring, drills, narrator ──▶ Bedrock (optional)
                    │
                    ▼
              Engine (engine/) ── apply / escalate / verify / revert ◀── MCP tools for Kiro agents
                    │
        ┌───────────┼──────────────┬───────────────┐
        ▼           ▼              ▼               ▼
    Toxiproxy   Docker CLI    service admin   Prometheus / Loki
        └───────────┴──── sandbox (Docker Compose) ┘
```

| Part | What it is |
|---|---|
| [`engine/`](engine/) | Loads hauntings and applies, escalates, verifies and reverts them. A ledger records each resource's original state, so reverts work in any order, even with overlapping hauntings, and survive a crash. Also an MCP server (`list_hauntings`, `apply_haunting`, `escalate_haunting`, `verify_haunting`, `revert_haunting`, `revert_all_hauntings`, `haunting_signals`). |
| [`sandbox/`](sandbox/) | The haunted shop (storefront, cart, payments, worker, a traffic generator) with Postgres, a Redis queue, Toxiproxy between every hop, Prometheus, Loki and a provisioned Grafana dashboard. |
| [`server/`](server/) | Game API and WebSocket terminal, sessions with escalation timers, the narrator, postmortems, and the drills API for Daemonwatch. |
| [`web/`](web/) | The player UI: page, narration, embedded Grafana, xterm.js terminal, diagnosis, verify, postmortem. |
| [`crew-app/`](crew-app/) | Daemonwatch, a self-contained Kiro Crew App: manifest, Ghost Director and Medium agents, skills, a weekday drill cron, the dashboard page (plus the standalone page) and a signed-proxy backend. Its agents use the engine's MCP tools over HTTP at `/mcp` on the game server (loopback only). |
| [`.kiro/`](.kiro/) | Steering, the haunting-engine spec, hooks, agents and MCP settings. |
| [`docs/`](docs/) | [Writeup](docs/writeup.md), [playtest plan](docs/playtests.md), [Kiro journal](docs/kiro-journal.md). |

## Safety

From [`sandbox-safety.md`](.kiro/steering/sandbox-safety.md), enforced in code:

- **Every fault is reversible.** Ending a session, a timeout, a server shutdown or a crash (on the next start) all revert it.
- **Resource caps.** Every container has CPU and memory limits, and the faults themselves are capped (latency, leak size, GC pauses).
- **No host access.** App containers drop all Linux capabilities and run read-only as non-root. Nothing mounts the Docker socket, and services push logs straight to Loki.
- **No outbound network.** Services sit on an internal network. Only the nginx gateway is reachable, and only on 127.0.0.1.
- **The engine only touches the sandbox.** Docker actions require the sandbox's compose label, and every URL must be loopback or a compose service name.
- **The terminal only runs allowlisted commands**, parsed into typed commands. Nothing reaches a shell.
- **Narration can't invent signals.** Generated lines must pass a guard (at most 2 sentences, and no service or number outside the given facts), or the hand-written line is used.

## Testing

```bash
npm run check   # validate hauntings, build the engine, typecheck, run every test
```

Every workspace has unit tests. Core guarantees are [fast-check](https://fast-check.dev/) property tests:

- **Engine:** apply then revert returns to baseline; apply is idempotent; any two hauntings revert cleanly in any order; harmful actions never raise a score.
- **Server:** the terminal parser never accepts shell metacharacters and only produces allowlisted commands; the narration guard never lets through more than 2 sentences or an invented service or number.
- **Sandbox services:** the DB connection limiter never admits work beyond its current limit, even while it's being resized.
- **Daemonwatch:** the backend accepts a correctly signed proxy request and rejects any change to its body, path, method or timestamp, and any timestamp outside ±60s; no path in `app.json` is absolute or escapes `crew-app/`.

**Bot playtest against the real sandbox:** `npm run playthrough` plays every haunting like a player would. It waits for each signal to really appear, applies the documented fix, checks that verify passes, and confirms the sandbox recovers. Results go to `scripts/.playthrough/results.json`.

Engine property tests run against an in-memory fake sandbox that implements the same interfaces as the real clients. To run property 1 against the real sandbox, use `WH_SANDBOX=1 npx vitest run test/integration` from `engine/`.

> **On Windows,** run tests from PowerShell or cmd, not Git Bash. Git Bash's lowercase `c:` drive letter makes Vitest load twice, and every suite fails with "failed to find the current suite".

## Status

Built and tested: the engine, three hauntings, the sandbox definition, the game server, the player UI and Daemonwatch. Not yet done:

- The sandbox has been validated (`docker compose config`) but not yet run end to end, and the real-sandbox integration test is still to run. CI builds the image.
- No playtests yet ([plan](docs/playtests.md)).
- Daemonwatch hasn't been installed into a real Crew yet, and `kirocrew doctor` hasn't been run on it. A few Crew details the docs leave open are listed in [crew-app/README.md](crew-app/README.md).
- `infra/` (AWS deployment and IAM roles) is not built.

## Out of scope

- Real customer infrastructure: nothing ever runs outside the sandbox
- Kubernetes
- Multiplayer: one player per sandbox (Daemonwatch players take turns)

## License

[MIT](LICENSE)

