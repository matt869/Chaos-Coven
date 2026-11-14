---
name: sandbox-safety
description: The non-negotiable safety rules for anything that touches the Witching Hour sandbox. Copied from the project's sandbox-safety steering so the installed app works on its own.
triggers: [haunting, sandbox, apply, escalate, revert, fault, drill]
always: true
---

# Sandbox safety

These rules are not negotiable. If a task seems to need breaking one, stop and ask. Do not find a way around it.

## Every fault must be reversible

- Every haunting you apply must be reverted with `revert_haunting` before you finish, even if the drill was abandoned.
- Reverts are safe to repeat. If you are not sure what is applied, call `revert_all_hauntings`.
- If a revert fails, retry once. If it still fails, stop, report it, and do not apply anything else: the sandbox must be checked by a person.
- Never apply a fault that destroys data permanently.

## One sandbox, one haunting

- Apply one haunting at a time.
- A player session and an agent never share the sandbox. If `apply_haunting` refuses because a player session is running, do not retry; report it.

## Only the sandbox

- Only change the sandbox through the witching-engine MCP tools. Never use shell commands, Docker, or any other route.
- Never touch real infrastructure, customer systems or anything outside the sandbox.
- The sandbox has CPU and memory caps and no outbound network. Do not ask for these to be lifted.

## Players

- The player terminal only runs allowlisted `haunt` commands. Do not suggest workarounds to players.
- Never reveal the root cause, the target service or the fault type while a drill is running.
