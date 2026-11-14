---
inclusion: always
---

# Tech stack

## Language and runtime

- **TypeScript** everywhere, with `strict` mode on. Do not use `any` without a comment explaining why.
- **Node.js 18+** for runtime code. Do not use APIs that need a newer Node version. Development tooling (Vitest 4, Vite) needs Node 20+.
- **npm workspaces**:
  - `engine`: haunting loader, fault injection, recovery checks, scoring, MCP server
  - `server`: game API, sessions, narrator, terminal backend, drills API
  - `web`: player UI
  - `sandbox/services`: the haunted shop's services (one image, role chosen by `SERVICE`)
  - `crew-app/ui`: the Daemonwatch UI
- Use npm, not yarn or pnpm. Add dependencies to the workspace that uses them: `npm install <pkg> -w <workspace>`.

## Frontend

- **React** with **Vite**.
- **xterm.js** for the player terminal. It sends input to the server and never runs anything in the browser.
- Grafana panels are embedded in the player UI. Do not rebuild dashboards in React.

## Sandbox and observability

- **Docker Compose** runs the sandboxed microservices (`sandbox/docker-compose.yml`).
- **Toxiproxy** injects network faults (latency, timeouts, dropped connections) between services.
- **Prometheus** for metrics.
- **Loki** for logs.
- **Grafana** for dashboards and log exploration.

## AI

- **Amazon Bedrock** powers the ghost agents and the narrator (`server/src/narrator/bedrock.ts`).
- Authenticate with an **IAM role** through the default AWS credential provider chain.
- **Never put API keys, access keys or secrets in code**, config files, fixtures or tests. `.env.example` may name variables, but never with real values.
- Ghost agents choose from defined hauntings and their parameters. They do not write or run arbitrary fault code.

## Testing

- Unit tests for every engine behavior.
- **fast-check** for property-based tests of core guarantees. See `testing.md`.

## Conventions

- ES modules.
- Validate external input (haunting YAML, API payloads, terminal commands) at the boundary with a schema. Haunting files must validate against `hauntings/schema.json`.
- Prefer small pure functions in `engine` so they are easy to property-test. Keep Docker and network I/O behind interfaces.
