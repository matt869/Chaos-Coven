import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it } from 'vitest';
import { createMcpServer } from '../../src/mcp/server.js';
import type { FakeSandbox } from '../../src/testing/fake-sandbox.js';
import { fakeEngine, loadRepoHaunting } from '../support/setup.js';

let sandbox: FakeSandbox | undefined;
afterEach(() => sandbox?.dispose());

async function connect() {
  const r = fakeEngine([loadRepoHaunting('the-vanishing')]);
  sandbox = r.sandbox;
  const server = createMcpServer(r.engine);
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await server.connect(serverT);
  const client = new Client({ name: 'test', version: '0.0.0' });
  await client.connect(clientT);
  return { client, sandbox: r.sandbox };
}

function json(result: unknown): unknown {
  const content = (result as { content: { type: string; text: string }[] }).content;
  return JSON.parse(content[0]!.text);
}

describe('MCP server', () => {
  it('exposes the engine API as tools', async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      'apply_haunting',
      'escalate_haunting',
      'haunting_signals',
      'list_hauntings',
      'revert_all_hauntings',
      'revert_haunting',
      'verify_haunting',
    ]);
  });

  it('runs a full apply, escalate, verify, revert cycle', async () => {
    const { client, sandbox } = await connect();
    const before = sandbox.snapshot();

    expect(json(await client.callTool({ name: 'list_hauntings', arguments: {} }))).toMatchObject([{ id: 'the-vanishing', active: false }]);
    expect(json(await client.callTool({ name: 'apply_haunting', arguments: { id: 'the-vanishing' } }))).toMatchObject({ alreadyActive: false });
    expect(json(await client.callTool({ name: 'escalate_haunting', arguments: { id: 'the-vanishing', step: 2 } }))).toMatchObject({ step: 2 });
    expect(json(await client.callTool({ name: 'verify_haunting', arguments: { id: 'the-vanishing' } }))).toMatchObject({ pass: false });
    expect(json(await client.callTool({ name: 'haunting_signals', arguments: { id: 'the-vanishing' } }))).toMatchObject({ id: 'the-vanishing' });
    expect(json(await client.callTool({ name: 'revert_haunting', arguments: { id: 'the-vanishing' } }))).toMatchObject({ reverted: true });

    sandbox.settle();
    expect(sandbox.snapshot()).toBe(before);
  });

  it('returns engine errors as tool errors', async () => {
    const { client } = await connect();
    const r = await client.callTool({ name: 'escalate_haunting', arguments: { id: 'the-vanishing', step: 1 } });
    expect(r.isError).toBe(true);
    expect((r.content as { text: string }[])[0]!.text).toMatch(/not active/);
  });

  it('rejects malformed ids before they reach the engine', async () => {
    const { client } = await connect();
    const r = await client.callTool({ name: 'apply_haunting', arguments: { id: '../../etc' } });
    expect(r.isError).toBe(true);
  });
});
