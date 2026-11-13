#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { loadConfig } from '../config.js';
import type { Engine } from '../engine/engine.js';
import { createSandboxEngine } from '../index.js';

type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean };

async function run(fn: () => unknown): Promise<ToolResult> {
  try {
    const result = await fn();
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  } catch (err) {
    return { content: [{ type: 'text', text: (err as Error).message }], isError: true };
  }
}

const hauntingId = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).describe('Haunting id, for example "the-vanishing"');

/** Exposes the engine API as MCP tools. */
export function createMcpServer(engine: Engine): McpServer {
  const server = new McpServer({ name: 'witching-hour-engine', version: '0.1.0' });

  server.registerTool(
    'list_hauntings',
    {
      title: 'List hauntings',
      description: 'Lists every valid haunting with its difficulty, target, fault type and whether it is active.',
    },
    () => run(() => engine.list()),
  );

  server.registerTool(
    'apply_haunting',
    {
      title: 'Apply haunting',
      description:
        'Injects the haunting\'s base fault into the sandbox and returns the page sent to the player. Applying an active haunting again changes nothing.',
      inputSchema: { id: hauntingId },
    },
    ({ id }) => run(() => engine.apply(id)),
  );

  server.registerTool(
    'escalate_haunting',
    {
      title: 'Escalate haunting',
      description: 'Applies escalation steps up to and including `step`. Steps already applied are skipped.',
      inputSchema: { id: hauntingId, step: z.number().int().min(1).describe('Escalation step to reach') },
    },
    ({ id, step }) => run(() => engine.escalate(id, step)),
  );

  server.registerTool(
    'verify_haunting',
    {
      title: 'Verify fix',
      description:
        'Runs the haunting\'s Prometheus and Loki health checks. Returns pass/fail with the observed value of each check as evidence.',
      inputSchema: { id: hauntingId },
    },
    ({ id }) => run(() => engine.verify(id)),
  );

  server.registerTool(
    'revert_haunting',
    {
      title: 'Revert haunting',
      description: 'Removes every fault the haunting added and restores the sandbox. Safe to call more than once.',
      inputSchema: { id: hauntingId },
    },
    ({ id }) => run(() => engine.revert(id)),
  );

  server.registerTool(
    'revert_all_hauntings',
    {
      title: 'Revert all hauntings',
      description: 'Reverts every active haunting. Use to reset the sandbox after a session.',
    },
    () => run(() => engine.revertAll()),
  );

  server.registerTool(
    'haunting_signals',
    {
      title: 'Haunting signals',
      description:
        'Evaluates the haunting\'s expected signals (symptoms, causes, red herrings) against live metrics and logs. For ghost agents and QA only: never show this to the player.',
      inputSchema: { id: hauntingId },
    },
    ({ id }) => run(() => engine.signals(id)),
  );

  return server;
}

async function main(): Promise<void> {
  // stdout carries the MCP protocol, so all logging goes to stderr.
  const log = (msg: string) => process.stderr.write(`[witching-engine] ${msg}\n`);
  const config = loadConfig();
  const { engine, invalid } = await createSandboxEngine(config);
  for (const bad of invalid) log(`skipping invalid haunting ${bad.file}: ${bad.problems.join('; ')}`);

  const recovered = await engine.init();
  if (recovered.length > 0) log(`reverted hauntings left by a previous run: ${recovered.join(', ')}`);

  const server = createMcpServer(engine);
  await server.connect(new StdioServerTransport());
  log(`ready with ${engine.list().length} haunting(s)`);

  let shuttingDown = false;
  const shutdown = async (reason: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log(`${reason}: reverting all hauntings`);
    try {
      await engine.revertAll();
    } catch (err) {
      log(`revert failed, the ledger keeps it for the next start: ${(err as Error).message}`);
      process.exitCode = 1;
    }
    await server.close();
    process.exit();
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.stdin.on('close', () => void shutdown('client disconnected'));
}

function isMain(): boolean {
  if (process.argv[1] === undefined) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMain()) {
  main().catch((err: unknown) => {
    process.stderr.write(`[witching-engine] fatal: ${(err as Error).stack ?? String(err)}\n`);
    process.exit(1);
  });
}
