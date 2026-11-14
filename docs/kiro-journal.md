# Kiro journal

How Kiro features shaped the build. Newest entries at the bottom. The `kiro-journal` hook (`.kiro/hooks/kiro-journal.json`) appends to this file.

---

**2026-11-14: Steering first.** Wrote the six steering files (product, tech, structure, ghost voice, sandbox safety, testing) before any code. Sandbox safety and testing are always included; ghost voice only loads for narrator and haunting files.

**2026-11-14: The haunting-engine spec.** Requirements, design and tasks for the engine. The spec named four properties up front: apply-then-revert returns to baseline; apply is idempotent; any two hauntings revert cleanly; harmful actions never raise a score.

**2026-11-14: Property tests found a real engine bug.** The idempotence property failed on a generated haunting whose escalation step changed the same debug toggle as its base fault. Re-applying the active haunting replaced the escalated claim with the base fault, silently undoing the escalation. Fix: applying an active haunting now changes nothing. A hand-written example test would not have tried that combination.

**2026-11-14: Property tests also caught a test-double bug.** The two-haunting property timed out: in the in-memory fake sandbox, a container paused straight from "stopped" and then unpaused stayed in "starting" health forever. The engine was right; the fake was not. Worth knowing that properties test your fakes too.

**2026-11-14: A ledger instead of per-fault undo.** Overlapping hauntings (two configs on the same key, a stop and a pause on the same service) broke simple "remember the old value" reverts. The design moved to a ledger per resource: the original state plus a stack of claims. The composition property (any two hauntings, any apply and revert order) is what forced this.

**2026-11-14: Windows gotcha.** Running Vitest from Git Bash (lowercase `c:` drive) loaded Vitest twice and every suite failed with "failed to find the current suite". Run tests from PowerShell or cmd.

**2026-11-14: The rest of the game.** Built the sandbox services and Compose stack, the game server (sessions, restricted terminal, Bedrock narrator with a ghost-voice guard, postmortems, drills API), the player UI and Daemonwatch. A property test on the database limiter first failed because the property was wrong: shrinking a limit cannot stop work already running, so the real guarantee is about admission, not about how many tasks are in flight.

**2026-11-14: Docs-first spec for the Crew App.** The crew-app spec told Kiro to read the Crew docs before touching code, and to let them override the repo. That changed a lot:
- the manifest moved to the documented schema (agents and skills as path arrays, crons with `cron_expr` and `message`, `backend.entryPoint`)
- the UI became an ES library bundle with React and the SDK as host-provided externals, plus the old standalone build
- the MCP server moved from a file path outside the app to `http://127.0.0.1:4000/mcp`
- the agents' rules moved from `.kiro/steering` into the app's own skills, so the installed copy works without the repo

The docs left the proxy header layout and secret source open, so those sit in one file each, flagged. A fast-check property on the manifest path checker failed first: it rejected a folder named `..-`. The check compared characters, not whole path segments.
