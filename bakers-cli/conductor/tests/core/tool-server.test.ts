import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterEach, describe, expect, it } from 'vitest';
import {
  startToolServer,
  type ToolServer,
} from '../../src/core/tool-server.js';
import { loadTools } from '../../src/plugins/tools.js';

async function registry() {
  return loadTools([
    {
      name: 'demo',
      version: '1.0.0',
      tools: {
        contract: 1,
        tools: {
          where: {
            description: 'Where am I',
            input: {
              type: 'object',
              properties: { note: { type: 'string' } },
            },
          },
          boom: { description: 'Fails' },
        },
        handlers: async () => ({
          where: async (req) => ({ text: req.worktreePath }),
          boom: async () => {
            throw new Error('it broke');
          },
        }),
      },
    },
  ]);
}

let server: ToolServer | undefined;
afterEach(async () => {
  await server?.stop();
  server = undefined;
});

async function connect(url: string, token: string): Promise<Client> {
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(url), {
      requestInit: { headers: { authorization: `Bearer ${token}` } },
    }),
  );
  return client;
}

describe('conductor tool server', () => {
  it("serves the addon tools bound to the run token's worktree", async () => {
    server = await startToolServer({ registry: await registry() });
    const token = server.issueRunToken({ worktreePath: '/work/bb-1' });
    const client = await connect(server.url, token);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(['where', 'boom']);
    const result = await client.callTool({ name: 'where', arguments: {} });
    expect(result.content).toEqual([{ type: 'text', text: '/work/bb-1' }]);
    await client.close();
  });

  it('refuses a worktree argument and reports handler errors as isError', async () => {
    server = await startToolServer({ registry: await registry() });
    const client = await connect(
      server.url,
      server.issueRunToken({ worktreePath: '/work/bb-1' }),
    );
    const wrong = await client.callTool({
      name: 'where',
      arguments: { worktree: '/work/other' },
    });
    expect(wrong.isError).toBe(true);
    const boom = await client.callTool({ name: 'boom', arguments: {} });
    expect(boom).toMatchObject({
      isError: true,
      content: [{ type: 'text', text: 'it broke' }],
    });
    await client.close();
  });

  it('answers 401 for an unknown or revoked run token', async () => {
    server = await startToolServer({ registry: await registry() });
    const token = server.issueRunToken({ worktreePath: '/work/bb-1' });
    server.revokeRunToken(token);
    const res = await fetch(server.url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: '{}',
    });
    expect(res.status).toBe(401);
    expect(await res.text()).toMatch(/unknown run token/);
  });

  it('lets only the operator token name a worktree, under the workspace root', async () => {
    const home = mkdtempSync(join(tmpdir(), 'bb-tool-server-'));
    const endpointFile = join(home, 'conductors', 'c1.json');
    server = await startToolServer({
      registry: await registry(),
      endpointFile,
      workspaceRoot: '/work',
    });
    const endpoint = JSON.parse(readFileSync(endpointFile, 'utf8'));
    expect(endpoint).toMatchObject({
      url: server.url,
      workspaceRoot: '/work',
      pid: process.pid,
    });
    expect(statSync(endpointFile).mode & 0o777).toBe(0o600);

    const call = (token: string, worktree: string) =>
      fetch(`${endpoint.url}/call`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ tool: 'where', args: {}, worktree }),
      });
    const ok = await call(endpoint.operatorToken, '/work/bb-2');
    expect(await ok.json()).toEqual({ text: '/work/bb-2' });
    const outside = await call(endpoint.operatorToken, '/etc');
    expect(outside.status).toBe(403);
    const asRun = await call(
      server.issueRunToken({ worktreePath: '/work/bb-1' }),
      '/work/bb-2',
    );
    expect(asRun.status).toBe(401);

    await server.stop();
    server = undefined;
    expect(() => statSync(endpointFile)).toThrow();
  });
});
