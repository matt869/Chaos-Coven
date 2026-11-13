---
inclusion: always
---

# Testing

## Rules

- **Every engine behavior has unit tests.** New fault primitives, recovery checks, scoring rules and haunting validation all need tests in the same change that adds them.
- **Core guarantees use fast-check property tests.** If something must hold for all inputs, test it as a property, not with a few examples.
- **Never mark a task done while any test is failing.** Do not skip, delete or weaken a test to make it pass. Fix the code, or explain the problem and ask.

## Core guarantees that need property tests

- **Reversibility:** for any valid sequence of faults, injecting and then reverting returns the sandbox to its baseline state.
- **Revert idempotency:** reverting twice gives the same result as reverting once.
- **Haunting validation:** every haunting the generator can produce that passes `hauntings/schema.json` can be loaded by the engine. Invalid ones are rejected with a clear error, and the engine never crashes on them.
- **Terminal allowlist:** for any input string, the command parser accepts only allowlisted `haunt` commands and never produces anything that could run a shell.
- **Scoring:** scores always stay within their documented range, and a better run (faster, correct root cause) never scores lower than a worse one when every other factor is the same.
- **Resource bounds:** any valid fault parameters stay within the sandbox CPU, memory and duration caps.

## Conventions

- Unit tests: `*.test.ts` next to the source file.
- Property tests: `*.property.test.ts` next to the source file.
- Keep engine logic pure where you can so it can be tested without Docker. Put Docker, Toxiproxy and Bedrock behind interfaces and use fakes in unit tests.
- Integration tests that need the real sandbox are kept separate and labeled, so the unit suite stays fast.
- When a property test fails, keep the shrunk counterexample as a regular unit test after you fix the bug.
