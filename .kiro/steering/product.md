---
inclusion: always
---

# Product: Witching Hour

## The problem

Most engineers do their first on-call shift with no practice. They learn on real outages, while customers are affected and someone senior is watching. Reading runbooks and postmortems does not teach you how to investigate when a pager goes off at 3 a.m.

## What Witching Hour is

Witching Hour is an on-call training game. AI "ghost" agents inject realistic faults into a sandboxed microservice system. The player investigates with the same kinds of tools they would use in production, finds the root cause and fixes it.

The haunted system:

- **storefront**: the customer-facing web service
- **cart**: cart and checkout state
- **payments**: payment authorization
- **worker**: async jobs consumed from the queue
- **Postgres**: primary datastore
- **queue**: message broker between services

## Audience

- **Engineers new to on-call**, who need safe practice before their first real rotation.
- **Students**, who have never debugged a distributed system under pressure.
- **Engineering managers**, who run drills for their team and want an objective read on readiness.

## Core loop

1. **Haunt.** A ghost agent picks a haunting (a fault scenario from `hauntings/`) and injects it into the player's sandbox.
2. **Page.** The player gets an alert, like a real page.
3. **Investigate.** The player uses Grafana dashboards, logs and a restricted terminal (`haunt` commands only) to collect evidence.
4. **Name the root cause.** The player says which component failed and why.
5. **Fix.** The player applies a fix through the allowed tools. The engine checks that the system has actually recovered.
6. **Postmortem.** The player gets a scored postmortem covering time to detect, time to mitigate, accuracy of the root cause, quality of the fix and which signals they missed.

## Daemonwatch (Kiro Crew App)

Daemonwatch lets teams schedule the same drills: pick hauntings, assign players, set a time and review the postmortems together. It uses the same engine and hauntings as the solo game. It does not get its own fault logic.

## Product principles

- **Realism over spectacle.** Faults, metrics and logs must behave the way real incidents do. The spooky theme is a costume, not a replacement for real signals.
- **Fair difficulty.** Every haunting can be solved from the evidence available to the player.
- **Learning comes first in the score.** The postmortem should teach the player something, not only grade them.

## Out of scope

- **Real customer infrastructure.** Witching Hour never connects to, or injects faults into, anything outside its own sandbox.
- **Kubernetes.** The sandbox is Docker Compose only. Do not add k8s manifests, Helm charts or operators.
- **Multiplayer.** One player per sandbox. Daemonwatch schedules drills for a team, but each run is single-player.
