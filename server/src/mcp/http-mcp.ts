import type { IncomingMessage, ServerResponse } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Engine } from '@witching-hour/engine';
import { createMcpServer } from '@witching-hour/engine/mcp';
import { z } from 'zod';
import type { DrillStore } from '../drills/drills.js';
import type { SessionManager } from '../session/session.js';

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

export interface McpHttpOptions {
  engine: Engine;
  sessions: SessionManager;
  drills: DrillStore;
  /** The port the game server listens on, for the Host/Origin allowlist. */
  port: number;
}

const json = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] });

/**
 * The haunting engine's MCP tools over Streamable HTTP at /mcp, for the Daemonwatch
 * Crew App. Loopback only: the server binds 127.0.0.1, this handler re-checks the peer
 * address, and the transport's DNS-rebinding protection only accepts loopback
 * Host/Origin headers. The stdio server (engine/src/mcp/server.ts) stays for Kiro IDE.
 *
 * Stateless: every request gets a fresh MCP server bound to the shared engine.
 */
export function createMcpHttpHandler(opts: McpHttpOptions): (req: IncomingMessage, res: ServerResponse, body: unknown) => Promise<void> {
  const hosts = [`127.0.0.1:${opts.port}`, `localhost:${opts.port}`, `[::1]:${opts.port}`];
  const origins = hosts.map((h) => `http://${h}`);

  return async (req, res, body) => {
    // A tunnel (cloudflared) connects from loopback too, so also refuse anything that
    // was forwarded: MCP can apply hauntings and must never be public.
    const forwarded = ['cf-connecting-ip', 'cf-ray', 'x-forwarded-for', 'forwarded'].some((h) => req.headers[h] !== undefined);
    if (forwarded || !LOOPBACK.has(req.socket.remoteAddress ?? '')) {
      res.writeHead(403, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'MCP is only served to loopback clients' }));
      return;
    }

    const server = createMcpServer(opts.engine, {
      // One sandbox: an agent may not apply a haunting while a player is in a session.
      beforeApply: () => (opts.sessions.active() ? 'a player session is using the sandbox; wait until it ends' : undefined),
    });

    server.registerTool(
      'list_drills',
      {
        title: 'List drills',
        description: 'Lists Daemonwatch drills. Pass a date (YYYY-MM-DD, UTC) to get only the drills scheduled that day.',
        inputSchema: { date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() },
      },
      async ({ date }) => {
        const all = await opts.drills.list();
        return json(date === undefined ? all : all.filter((d) => d.scheduledFor.startsWith(date)));
      },
    );

    server.registerTool(
      'drill_results',
      {
        title: 'Drill results',
        description: "One drill's players and every recorded result (score, detection time, root cause, fix, harmful actions).",
        inputSchema: { id: z.string().uuid() },
      },
      async ({ id }) => {
        const d = await opts.drills.get(id);
        if (d === undefined) return { ...json({ error: 'unknown drill' }), isError: true };
        return json(d);
      },
    );

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
      enableDnsRebindingProtection: true,
      allowedHosts: hosts,
      allowedOrigins: origins,
    });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  };
}
