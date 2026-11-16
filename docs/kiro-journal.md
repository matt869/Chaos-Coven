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

**2026-11-15: First run against the real sandbox.** Every test had passed against fakes; the first real run still found bugs that fakes could not:
- The services image could not be pulled from ghcr.io on this machine ("denied"), so Toxiproxy is now built from its checksum-verified release binary.
- Compose raced five parallel builds of the same image; only storefront builds it now.
- The Vanishing's latency signal asked for `route="/checkout"`, but the real route is `/api/checkout`, so the query matched nothing. A fake returns whatever the test tells it to, so it couldn't catch this. Every haunting query is now checked against live metrics.
- Slow Whisper's leak used Buffers, which live outside the V8 heap, so heap and GC metrics never moved. Its "GC pause" froze the event loop between requests, so it never showed in measured latency. Both now behave like real Node failures.
- Two thresholds were wrong for this shop: one red herring claimed payments was slow when it was normal.

A bot playtest (`npm run playthrough`) now plays every haunting end to end and checks the evidence appears, the fix verifies, and the sandbox recovers.

**2026-11-15: Hosting with the PC off.** The game needs Docker, so static hosting was out. First a Cloudflare Quick Tunnel from a laptop, then one Azure for Students VM (`Standard_B2s` was sold out in the region, so `B2als_v2`), set up by `cloud-init.sh` and managed only with `az vm run-command`, with no SSH port open. Two bugs only showed on the VM: `tr | head` under `pipefail` killed cloud-init with SIGPIPE while generating the access code, and the service restarted in a loop because it opened the tunnel before the sandbox was healthy.

**2026-11-16: One permanent address.** Quick Tunnel links change on every restart. The VM's public IP got a free Azure DNS name, and `stable-url.sh` puts Caddy in front with a Let's Encrypt certificate. The address survived a full VM reboot.

**2026-11-16: Security pass for a public link.** Security headers and a CSP on every response, player-facing errors scrubbed of URLs, paths, IDs and IPs (with a property test), Server, Via and the Grafana version hidden, `/mcp` refusing anything proxied, and a lockout on the access code. Grafana Live needed `GF_LIVE_ALLOWED_ORIGINS` to work behind the proxy.

**2026-11-16: The design.** A night-shift redesign around the pager, then a Halloween layer: a moon, fog, bats, pumpkin difficulty meters, cobwebs and a verdict stamp. Each change was checked with headless-browser screenshots at desktop and phone widths, which caught the moon sitting behind the headline and the terminal overflowing on phones.

**2026-11-17: A ghost with moods.** The ghost now has faces (calm, worried, scared, happy, sad, boo) and blinks. It reacts to the shift: worried when paged, panicking on escalation or over par, cheering when the fix verifies, and on the postmortem it follows your rank, with candy corn for a perfect score. The first screenshot showed the "worried" brows reading as angry, because they sloped down toward the middle; they now rise. All of it is decorative and stops under reduced motion.

**2026-11-17: No password, without breaking anything.** Dropping the access code exposed a real problem: the page picked up whatever shift was running, so any visitor would land in someone else's shift and could run commands or end it. Now starting a shift gives that browser a random secret in an HttpOnly cookie, and only that browser can see or drive it; everyone else gets "someone else is on call, it frees up by HH:MM". A shift whose page stops checking in for 5 minutes ends on its own, so a closed tab can't hold the only sandbox. Requests from the server itself (the bot playtest, local agents) still work, using the same loopback-and-not-forwarded check as `/mcp`. Tests cover a second visitor being refused on every route and on the terminal WebSocket.
