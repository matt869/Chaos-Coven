---
inclusion: always
---

# Sandbox safety

These rules are not negotiable. If a task seems to need breaking one, stop and ask. Do not find a way around it.

## Every fault must be reversible

- Every fault primitive in `engine/` has a matching **revert** that puts the sandbox back in its baseline state.
- Reverts must be **idempotent**: running one twice, or on a sandbox that was never faulted, is safe.
- Ending a session, timing out or crashing the server must revert all active faults. Add this cleanup path along with any new fault.
- A sandbox that cannot be reverted must be destroyed and recreated, never reused.
- Do not use faults that destroy data permanently, such as dropping the database without a restore path or deleting volumes the baseline needs.

## Resource caps

- Every sandbox container has explicit **CPU and memory limits** in `sandbox/docker-compose.yml`. Do not add a service without them.
- Faults that use up resources (CPU burn, memory leaks, disk fill) must stay within those caps, and they must also have their own upper bound and timeout.

## No host access

- No privileged containers, host network mode, host PID or IPC namespaces, or Docker socket mounts.
- No bind mounts from the host into sandbox containers, except read-only config the sandbox needs.
- Do not add Linux capabilities beyond the defaults. Drop them where you can.

## No outbound network

- Sandbox containers have **no outbound internet access**. Put them on internal Docker networks only.
- Only the observability stack and the engine may reach sandbox services, and only through defined networks.
- Toxiproxy faults apply only to traffic between sandbox services.

## Restricted player terminal

- The player terminal runs **only allowlisted `haunt` commands**. It is not a shell.
- Commands are parsed and matched against the allowlist on the server. Never pass player input to `sh -c`, `exec`, `eval` or string-built Docker commands.
- Reject anything not on the allowlist, including shell metacharacters, pipes, redirects and command substitution, and tell the player clearly.
- Adding a command to the allowlist needs tests, including tests that hostile input is rejected.

## AI agents

- Ghost agents and the narrator can only call engine operations that are already defined. They never get a shell, Docker access or the ability to write fault code.
- Bedrock access uses an IAM role. Never put credentials in code.
