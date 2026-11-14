# Tasks: haunting-engine

- [x] 1. Workspace setup: root npm workspaces, `engine` package, TypeScript, Vitest, fast-check
- [x] 2. `hauntings/schema.json` with the four fault types and safety bounds _(R1.1-R1.3)_
- [x] 3. Loader with schema and semantic validation; invalid files are skipped and reported _(R1.4, R1.5)_
- [x] 4. `the-vanishing.yaml`, fully defined _(R1.6)_
- [x] 5. Client interfaces and real clients (Toxiproxy, docker CLI, service admin, Prometheus/Loki) with the sandbox URL and container-label guards _(R3.4, R3.5)_
- [x] 6. Fault drivers: capture / apply / restore / probe _(R3.1)_
- [x] 7. Ledger and file store; engine API with crash recovery _(R2.1-R2.6, R3.1, R3.2)_
- [x] 8. Deterministic scoring rubric _(R4)_
- [x] 9. MCP server with stdio transport; reverts all hauntings on shutdown _(R2.7, R3.3)_
- [x] 10. Fake sandbox and haunting generators for tests
- [x] 11. Property tests 1-4 _(R5)_
- [x] 12. Unit tests for every module
- [ ] 13. Run `test/integration` against the real sandbox (`WH_SANDBOX=1`). `sandbox/` now implements the contract in design.md; this needs a machine with Docker running.
- [x] 14. Write `possessed-config.yaml` and `slow-whisper.yaml`
