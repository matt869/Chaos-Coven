import type { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterEach, describe, expect, it } from 'vitest';
import { DrillStore } from '../src/drills/drills.js';
import { createApp } from '../src/http/app.js';
import { createMcpHttpHandler } from '../src/mcp/http-mcp.js';
import { setup } from './support.js';

let cleanup: (() => Promise<void>) | undefined;
afterEach(async () => cleanup?.());

async function start() {
  const ctx = await setup();
  const drills = new DrillStore(undefined);
  // Listen first so the MCP handler knows the port for its Host allowlist.
  const placeholder: { handler?: ReturnType<typeof createMcpHttpHandler> } = {};
  const server = createApp({
    sessions: ctx.sessions,
    drills,
    grafanaUrl: 'http://127.0.0.1:3000',
    mcp: (req, res, body) => placeholder.handler!(req, res, body),
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  placeholder.handler = createMcpHttpHandler({ engine: ctx.engine, sessions: ctx.sessions, drills, port });

  const client = new Client({ name: 'crew-test', version: '0.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`)));
  cleanup = async () => {
    await client.close();
    server.close();
  };
  return { ...ctx, drills, client, port };
}

const text = (r: unknown) => JSON.parse((r as { content: { text: string }[] }).content[0]!.text);

describe('MCP over HTTP at /mcp', () => {
  it('serves the engine tools plus the drill tools', async () => {
    const { client } = await start();
    const names = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual([
      'apply_haunting',
      'drill_results',
      'escalate_haunting',
      'haunting_signals',
      'list_drills',
      'list_hauntings',
      'revert_all_hauntings',
      'revert_haunting',
      'verify_haunting',
    ]);
    expect(text(await client.callTool({ name: 'list_hauntings', arguments: {} }))).toHaveLength(3);
  });

  it('lets an agent apply and revert, and keeps players and agents from sharing the sandbox', async () => {
    const { client, sessions, sandbox } = await start();
    const baseline = sandbox.snapshot();

    expect((await client.callTool({ name: 'apply_haunting', arguments: { id: 'the-vanishing' } })).isError).toBeFalsy();
    await expect(sessions.start('slow-whisper')).rejects.toMatchObject({ status: 409 });
    await client.callTool({ name: 'revert_haunting', arguments: { id: 'the-vanishing' } });
    sandbox.settle();
    expect(sandbox.snapshot()).toBe(baseline);

    const view = await sessions.start('the-vanishing');
    const refused = await client.callTool({ name: 'apply_haunting', arguments: { id: 'slow-whisper' } });
    expect(refused.isError).toBe(true);
    await sessions.end(view.id);
  });

  it('lists drills by day', async () => {
    const { client, drills } = await start();
    await drills.create({ hauntingId: 'the-vanishing', team: 'A', players: ['sam'], scheduledFor: '2026-12-01T09:00:00.000Z' });
    await drills.create({ hauntingId: 'the-vanishing', team: 'B', players: ['ana'], scheduledFor: '2026-12-02T09:00:00.000Z' });
    const today = text(await client.callTool({ name: 'list_drills', arguments: { date: '2026-12-01' } }));
    expect(today.map((d: { team: string }) => d.team)).toEqual(['A']);
    const r = await client.callTool({ name: 'drill_results', arguments: { id: today[0].id } });
    expect(text(r).players).toEqual(['sam']);
  });

  it('rejects requests whose Host is not loopback (DNS rebinding)', async () => {
    const { port } = await start();
    const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', origin: 'http://evil.example' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});
