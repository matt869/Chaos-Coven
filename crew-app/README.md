# Daemonwatch

Daemonwatch is the team side of Witching Hour, built as a Kiro Crew App. A team lead schedules drills, each player runs the same haunting in the sandbox, and everyone's scored postmortem lands in one place.

## What's here

| Path | What it is |
|---|---|
| [`app.json`](app.json) | The app manifest: agents, skills, the engine MCP server and the UI |
| [`agents/ghost-director.json`](agents/ghost-director.json) | Runs hauntings through the engine's MCP tools, and always reverts at the end |
| [`agents/medium.json`](agents/medium.json) | Writes a blameless team postmortem from the drill results |
| [`skills/haunting-playbook`](skills/haunting-playbook/SKILL.md) | Which haunting to pick, and how to run and clean up a drill |
| [`skills/postmortem-writing`](skills/postmortem-writing/SKILL.md) | How to write the team postmortem |
| [`ui/`](ui/) | The Daemonwatch web UI (React + Vite) |

## Running the UI

The UI talks to the game server's drills API (`/api/drills`).

```bash
npm run dev:server          # game server on http://127.0.0.1:4000
npm run dev:daemonwatch     # Daemonwatch on http://127.0.0.1:5174/daemonwatch/
```

After `npm run build`, the game server also serves Daemonwatch at `http://127.0.0.1:4000/daemonwatch/`.

## A drill, start to finish

1. Schedule it: pick a haunting, name the team, list the players and choose a time.
2. When it's a player's turn, press **Start** next to their name. The haunting is applied and the player view opens.
3. The player investigates and fixes it. When they end the session, their score, detection time, root cause, fix and harmful actions appear in the drill's table.
4. Ask the Medium agent for the team postmortem.

There is one sandbox, so players take turns.
