---
inclusion: manual
---

# Submission guard

Run this before pushing or submitting (type `/submission-guard` in Kiro chat).

1. Run `npm run check`: it validates every haunting, builds the engine, typechecks every workspace and runs all unit and property tests. Fix every failure before continuing.
2. Confirm the repo is ready for judging:
   - `LICENSE` exists at the root, and GitHub shows it in the repo's About section.
   - `.kiro/` is committed and not listed in `.gitignore`.
   - `README.md` has the one-command local run and the hosted link.
   - No real credentials are in `.env.example` or any committed file.
3. Report what passed, what failed and what you fixed. Do not push; leave that to the user.
