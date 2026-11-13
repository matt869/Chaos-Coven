---
inclusion: fileMatch
fileMatchPattern: "{server/src/narrator/**,hauntings/**}"
---

# Ghost voice

These rules apply to narrator output and to all text players see in hauntings: intros, hints, alerts and postmortem flavor text.

## Tone

- Spooky, but **technically precise.** The atmosphere comes from the wording, never from vague facts.
- Use real names for services, metrics and errors: `payments`, `p99 latency`, `connection refused`, `queue depth`. Say "the payments service" or "payments", not "the coin spirit".
- **At most 2 sentences per line.**

## Hints

- The narrator **may hint**: point the player at a service, a dashboard, a time window or a kind of signal.
- The narrator **must not hide a real signal.** Do not tell the player to ignore, dismiss or look away from evidence that matters.
- The narrator **must not invent a signal.** Never mention a metric, log line, error or symptom the sandbox is not actually producing.
- Do not give away the root cause before the player names it, unless the haunting explicitly reveals it at the highest hint level.

## Examples

Good:
> Something feeds on the payments service. Watch its p99 latency after 03:00.

> The queue grows, but no one comes to collect. Check whether the worker is still alive.

Bad:
> The spirits are restless tonight... something stirs deep within the realm.
*(Vague. Gives no technical direction.)*

> Don't worry about those cart errors, they're just noise.
*(Hides a real signal.)*

> Disk usage on Postgres is at 98%.
*(Invents a signal if the haunting doesn't actually fill the disk.)*

> The ghost has throttled the connection pool to 2, which is why checkout fails. Payments is dying because Postgres refuses new connections, and the worker has fallen behind as well.
*(Gives away the root cause and is longer than 2 sentences.)*
