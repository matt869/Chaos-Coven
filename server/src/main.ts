import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSandboxEngine, loadConfig } from '@witching-hour/engine';
import { DrillStore } from './drills/drills.js';
import { createApp } from './http/app.js';
import { createMcpHttpHandler } from './mcp/http-mcp.js';
import { BedrockNarrator, StaticNarrator, type Narrator } from './narrator/bedrock.js';
import { SessionManager } from './session/session.js';
import { HttpObservability } from './terminal/observability.js';
import { DockerSandboxControl } from './terminal/sandbox-control.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const log = (msg: string) => process.stderr.write(`[server] ${msg}\n`);

const env = process.env;
const engineConfig = loadConfig(env);
const { engine, invalid } = await createSandboxEngine(engineConfig);
for (const bad of invalid) log(`skipping invalid haunting ${bad.file}: ${bad.problems.join('; ')}`);
const recovered = await engine.init();
if (recovered.length > 0) log(`reverted hauntings left by a previous run: ${recovered.join(', ')}`);

// Bedrock narration is opt-in. It uses the AWS credential chain (an IAM role), never keys in code.
const narrator: Narrator =
  env.WH_NARRATOR === 'bedrock'
    ? new BedrockNarrator({ model: env.WH_BEDROCK_MODEL_ID, awsRegion: env.AWS_REGION, onError: (e) => log(`narrator fell back: ${(e as Error).message}`) })
    : new StaticNarrator();

const sessions = new SessionManager({
  engine,
  narrator,
  exec: {
    control: new DockerSandboxControl({
      composeProject: engineConfig.composeProject,
      composeFile: resolve(ROOT, 'sandbox/docker-compose.yml'),
      serviceAdminUrls: engineConfig.serviceAdminUrls,
    }),
    observability: new HttpObservability({ prometheus: engineConfig.prometheusUrl, loki: engineConfig.lokiUrl }),
  },
  timeScale: Number(env.WH_TIME_SCALE ?? 1),
  maxMinutes: Number(env.WH_SESSION_MAX_MINUTES ?? 45),
});

const webDist = resolve(ROOT, 'web/dist');
// The standalone Daemonwatch page; crew-app/ui/dist/index.mjs is the Crew bundle.
const daemonwatchDist = resolve(ROOT, 'crew-app/ui/dist/standalone');
const port = Number(env.PORT ?? 4000);
const drills = new DrillStore(resolve(env.WH_DATA_DIR ?? resolve(ROOT, 'server/.data'), 'drills.json'));
const app = createApp({
  sessions,
  drills,
  mcp: createMcpHttpHandler({ engine, sessions, drills, port }),
  grafanaUrl: env.WH_GRAFANA_URL ?? 'http://127.0.0.1:3000',
  staticDirs: {
    web: existsSync(webDist) ? webDist : undefined,
    daemonwatch: existsSync(daemonwatchDist) ? daemonwatchDist : undefined,
  },
});

// Loopback only: the server can restart sandbox containers.
app.listen(port, '127.0.0.1', () => log(`listening on http://127.0.0.1:${port} with ${engine.list().length} haunting(s), MCP at /mcp, narrator: ${env.WH_NARRATOR === 'bedrock' ? 'bedrock' : 'static'}`));

let stopping = false;
const shutdown = async (signal: string) => {
  if (stopping) return;
  stopping = true;
  log(`${signal}: ending the session and reverting all hauntings`);
  try {
    await sessions.shutdown();
    await engine.revertAll();
  } catch (err) {
    log(`revert failed, the ledger keeps it for the next start: ${(err as Error).message}`);
    process.exitCode = 1;
  }
  app.close();
  process.exit();
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
