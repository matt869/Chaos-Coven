---
inclusion: always
---

# Project structure

```
.kiro/          Kiro config: steering, hooks, custom agents, MCP settings
hauntings/      Fault scenarios as YAML, validated by hauntings/schema.json
engine/         Workspace: loads hauntings, injects and reverts faults, checks recovery, scores runs; also hosts the engine MCP server
sandbox/        Docker Compose system the player debugs: services/ (shop code), gateway, Postgres schema, Toxiproxy, Prometheus/Loki/Grafana config
server/         Workspace: game API, session lifecycle, narrator (Bedrock), terminal backend for `haunt` commands
web/            Workspace: React + Vite player UI, xterm.js terminal, embedded Grafana
crew-app/       Daemonwatch, the Kiro Crew App for scheduling team drills (manifest, agents, skills, ui/)
infra/          Deployment infrastructure (AWS, including IAM roles for Bedrock). Not built yet
scripts/        Developer scripts. Not built yet; the haunting validator lives in engine/scripts/
docs/           Writeup, playtest notes, Kiro journal
```

## Where things go

- **A new fault scenario** goes in a new YAML file in `hauntings/`. If it needs a new kind of fault, add the fault primitive to `engine/` first, with tests and a revert.
- **Fault injection and revert logic** lives only in `engine/`. `server/` and `crew-app/` call the engine and never touch sandbox containers directly.
- **Narration and ghost text** lives in `server/src/narrator/` and the haunting files. Follow `ghost-voice.md`.
- **Sandbox services and limits** live in `sandbox/`. Follow `sandbox-safety.md`.
- **Daemonwatch** reuses the engine and hauntings. It must not contain a separate copy of fault logic.
- **Tests** live in each workspace's `test/` folder as `*.test.ts` (`*.test.tsx` for UI). Property tests use `*.property.test.ts` where they are their own file.
- **Kiro hooks** are `.kiro/hooks/*.kiro.hook` JSON files.
- Write files with kebab-case names. Haunting IDs match their file names, for example `slow-whisper.yaml` has `id: slow-whisper`.
