---
name: haunting-playbook
description: How to choose, run, escalate and clean up a Witching Hour haunting for a drill. Use when scheduling or running a drill with the witching-engine MCP tools.
---

# Haunting playbook

## Choosing a haunting

| Haunting | Difficulty | Good for | Teaches |
|---|---|---|---|
| `the-vanishing` | easy | First drill, students | Silent failures: a healthy-looking front end can hide a dead consumer. Read queue depth and throughput, not only error rates. |
| `possessed-config` | medium | Engineers who have done one drill | Config is a cause too. A restart does not fix a value stored in the database. Pool saturation looks like latency, then errors. |
| `slow-whisper` | hard | Experienced on-call engineers | Slow leaks. Memory and GC metrics tell the story long before errors do. |

- Start a new team on `the-vanishing`.
- Do not give a player a haunting they have already completed in a drill unless they ask to retry it.
- One haunting at a time: the sandbox is shared.

## Running it

1. `list_hauntings` and confirm nothing is active. If something is, `revert_all_hauntings` first.
2. `apply_haunting` with the chosen id. Send the returned `page` to the player, not the haunting details.
3. Escalate on the haunting's schedule (`afterSeconds` for each step) with `escalate_haunting`. The game server does this automatically for normal sessions.
4. When the player says they fixed it, `verify_haunting`. Report pass/fail and which checks failed, without naming the root cause.
5. Always finish with `revert_haunting`, even if the player gave up. If it fails, retry once, then stop and report.

## What never to do

- Never apply faults outside the engine, and never touch anything outside the sandbox.
- Never reveal `haunting_signals` output, the target service or the root cause to a player mid-drill.
- Never leave a haunting running between drills.
