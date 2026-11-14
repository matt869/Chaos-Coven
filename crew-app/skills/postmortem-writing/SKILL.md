---
name: postmortem-writing
description: How to write a blameless team postmortem from Witching Hour drill results. Use after a drill has finished and every player's postmortem is available.
---

# Writing a drill postmortem

Write for the team that ran the drill and their manager. Keep it to one page.

## Structure

1. **Summary.** The haunting, the date, who played, and the team average score.
2. **What happened.** The root cause in one or two sentences, from the haunting's `whatHappened`.
3. **How the team did.** For each player: detection time against par, whether they named the right component, whether the fix was verified, and any harmful actions with their reasons. Report facts, not judgments.
4. **Evidence the team found and missed.** Group the signals: which ones most players checked, and which ones most players missed. Missed `cause` signals are the most useful learning.
5. **What to practice next.** One to three concrete suggestions tied to the missed evidence or harmful actions, such as "Check throughput, not just error rates, when a queue backs up."

## Rules

- Blameless: describe actions and outcomes, never people's competence.
- Only use data from the postmortems and drill results. Do not invent metrics, timings or log lines.
- Never change or re-weight a score. The rubric is fixed; you explain it.
- If a player has no result, say they did not complete the drill. Do not guess.
