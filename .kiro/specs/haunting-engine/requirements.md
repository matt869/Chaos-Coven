# Requirements: haunting-engine

The engine injects, escalates, verifies and reverts hauntings (realistic production faults) in the Docker Compose sandbox. It also exposes these operations as an MCP server.

## R1. Haunting definitions

1. Each haunting SHALL be a YAML file in `hauntings/` that validates against `hauntings/schema.json`.
2. A haunting SHALL define: id, name, difficulty, target service, the page shown to the player, a fault (type and parameters), escalation steps, expected signals, verify checks, root cause, correct fix, harmful actions and a scoring par.
3. Fault types SHALL be limited to `toxiproxy` (latency, timeout), `docker` (stop, pause), `config` (set a service config value) and `debug-endpoint` (enable a debug toggle).
4. WHEN a file fails validation, the engine SHALL skip it, report why, and never apply it.
5. The haunting id SHALL match its file name. Escalation steps SHALL be numbered 1..n, and their `afterSeconds` SHALL increase.
6. `the-vanishing.yaml` SHALL be fully defined: the worker stops silently, queue depth climbs while the storefront stays healthy, and the fix is restarting or scaling the worker.

## R2. Engine API

1. `list()` SHALL return a summary of every valid haunting, including whether it is active and its escalation step.
2. `apply(id)` SHALL inject the base fault. WHEN the haunting is already active, it SHALL change nothing.
3. `escalate(id, step)` SHALL apply every not-yet-applied step up to `step`. WHEN the haunting is not active, it SHALL fail.
4. `verify(id)` SHALL run the verify checks against Prometheus and Loki and return pass/fail, with the observed value of each check as evidence.
5. `revert(id)` SHALL remove every fault the haunting added. WHEN the haunting is not active, it SHALL change nothing.
6. `signals(id)` SHALL evaluate the expected signals against live data.
7. The API SHALL be exposed as MCP tools in `engine/src/mcp/server.ts` using the MCP TypeScript SDK.

## R3. Safety (sandbox-safety.md)

1. Every fault SHALL be reversible. Reverts SHALL be idempotent and work in any order, including when hauntings overlap on the same resource.
2. The engine SHALL save its active faults before changing the sandbox. On start, it SHALL revert anything a crashed run left behind.
3. WHEN the MCP server shuts down or its client disconnects, it SHALL revert all hauntings.
4. Docker actions SHALL only touch containers labeled with the sandbox compose project. Every URL SHALL be loopback or a compose service name.
5. No command SHALL be run through a shell.

## R4. Scoring

1. Scoring SHALL be deterministic, with no LLM. It covers time to detect, correct root cause, verified fix, and penalties for harmful actions.
2. Scores SHALL stay within 0-100.

## R5. Properties (fast-check, `engine/test/properties`)

1. For any haunting h, `apply(h)` then `revert(h)` returns all health probes to baseline within a timeout.
2. `apply(h)` twice has the same effect as once.
3. Any two hauntings applied together revert cleanly.
4. Adding a harmful action never increases a score.
