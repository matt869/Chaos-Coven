# Playtests

No playtests have been run yet. This page holds the plan and the template; add a section per session below the template.

## Plan

| Who | Haunting | What we want to learn |
|---|---|---|
| 2–3 engineers new to on-call | The Vanishing | Can someone with no context find a silent failure? Is the par (5 min) fair? |
| 2 engineers with on-call experience | Possessed Config | Do players try a restart first? Is the penalty for restarting payments fair? |
| 1–2 experienced on-call engineers | Slow Whisper | Is the leak findable before escalation step 2? Is "hard" the right label? |
| A team lead | Daemonwatch with 3 players | Is the drill table useful for a debrief? |

Before each session:

1. `npm run sandbox:up`, wait for every container to be healthy, and run the engine integration test (`WH_SANDBOX=1`).
2. Start the server with `WH_TIME_SCALE=1` (real time).
3. Tell the player only what's in the page. Don't help unless they're stuck for more than 5 minutes; note when you do.

## Template

```
### <date>: <haunting>, <player experience>

- Score: <total>/100 (detection <n>, root cause <n>, fix <n>, penalties -<n>)
- Time to detect: <m:ss> (par <m:ss>)
- Hints used: <n>
- Commands that helped:
- Evidence they missed:
- Harmful actions, and why they tried them:
- Where they got stuck:
- What the player said afterwards:
- Changes to make: (haunting, narration, scoring, UI)
```

## Sessions

_None yet._
