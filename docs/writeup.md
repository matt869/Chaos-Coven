# Witching Hour: project writeup

## The problem

Most engineers do their first on-call shift with no practice. They learn incident response during a real outage, with customers affected and someone senior watching. Reading runbooks and old postmortems doesn't build the instinct to go from an alert to the evidence to the root cause under pressure.

## What we built

Witching Hour is an on-call training game. A haunting injects a realistic fault into a small, sandboxed online shop (storefront, cart, payments, an async worker, Postgres and a queue). The player gets paged and investigates with real tools: Grafana dashboards, logs in Loki, and a restricted terminal. They name the root cause, apply a fix, and get a scored postmortem that shows what they found and what they missed.

Daemonwatch, a Kiro Crew App, lets a team lead schedule the same drill for a whole team and compare the results.

### The three hauntings

| Haunting | What breaks | What it teaches |
|---|---|---|
| The Vanishing (easy) | The worker that consumes the orders queue stops silently. The storefront stays green. | A healthy front end can hide a dead consumer. Look at queue depth and throughput, not just errors. |
| Possessed Config (medium) | Payments' database pool is set to 1, and the value lives in Postgres. | Config is a cause too, and restarts don't fix persisted config. Pool saturation shows up as latency, then errors. |
| Slow Whisper (hard) | Cart leaks memory slowly; later, GC pauses stall it. | Slow failures show in memory and GC metrics long before they show as errors. |

## How it works

- **Engine** (`engine/`). Applies, escalates, verifies and reverts hauntings. Each fault type (Toxiproxy latency/timeouts, Docker stop/pause, config values, debug toggles) has a driver that captures the resource's original state before touching it. A ledger tracks which haunting holds which resource, so reverts work in any order even when hauntings overlap, and it is saved to disk so a crash can be undone on the next start. The engine is also an MCP server, so Kiro agents can run drills.
- **Sandbox** (`sandbox/`). Docker Compose with resource caps on every container, an internal network with no route out, and a single nginx gateway bound to 127.0.0.1. Services push logs straight to Loki, so nothing needs the Docker socket.
- **Game server** (`server/`). Sessions, escalation timers, a restricted terminal that only accepts allowlisted `haunt` commands, verification against live Prometheus and Loki data, deterministic scoring and the postmortem.
- **Narrator.** Optional, using Claude on Amazon Bedrock through an IAM role. Every generated line passes a guard that enforces the ghost-voice rules (at most two sentences; no service or number that isn't in the facts it was given). Anything that fails falls back to the hand-written line, so the narrator can hint but never invent a signal.
- **Player UI** (`web/`) and **Daemonwatch** (`crew-app/`). React and Vite. The terminal is xterm.js over a WebSocket.

## How we used Kiro

- **Steering** set the rules before any code existed: product scope, the stack, sandbox safety, the ghost voice and testing standards.
- **A spec** for the haunting engine (requirements, design, tasks) defined the API, the safety requirements and four properties to prove.
- **Property tests** (fast-check) turned those properties into checks. They found real bugs (see `kiro-journal.md`).
- **Hooks** validate hauntings on save, review UI changes for accessibility, run the full check before submitting and keep the journal.
- **Agents** author new hauntings, QA them against the sandbox, direct drills and write team postmortems.

## What's next

- Run the playtests in `playtests.md` and tune pars, penalties and narration.
- More hauntings: retry storms, slow dependencies, a bad deploy.
- Multiple sandboxes so a team can drill at the same time (multiplayer stays out of scope for now).
