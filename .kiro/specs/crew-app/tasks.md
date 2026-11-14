# Tasks: crew-app

- [x] 1. Read the four Crew docs pages; note where they differ from the spec and the repo
- [x] 2. Rewrite `app.json` to the documented schema, with every path inside `crew-app/` _(R1)_
- [x] 3. Copy the ghost-voice and sandbox-safety rules into app skills; remove `.kiro` references from agents _(R2)_
- [x] 4. Split the UI into shared components plus standalone and Crew shells; add `vite.crew.config.ts`; commit `ui/dist/index.mjs` _(R3)_
- [x] 5. Backend proxy with X-Crew-Proxy verification and a drills-only allowlist _(R4)_
- [x] 6. `/mcp` on the game server (loopback, DNS-rebinding protection), drill tools, two-way sandbox lock; keep stdio _(R5)_
- [x] 7. Agents with `@kirocrew-core` + `@witching-engine`; weekday cron _(R6)_
- [x] 8. Property tests: proxy signatures, manifest path containment _(R7)_
- [x] 9. `npm run check` passes
- [ ] 10. `kirocrew doctor` reports a valid manifest. **Blocked:** the `kirocrew` CLI isn't available here. `npm run check:crew-manifest` checks the documented rules meanwhile.
- [ ] 11. Install with `POST /api/apps/install {"source": "./crew-app"}`, enable, check the sidebar, list hauntings, and run one drill end to end against the sandbox with the haunting reverted. **Blocked:** needs a running Crew gateway and Docker. Confirm the open assumptions in design.md at the same time.
