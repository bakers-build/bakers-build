import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, expect, it, vi } from 'vitest';
import { dispatchBbDropsh, toolNameFor } from '../src/index.js';

let server: Server | undefined;
const savedExitCode = process.exitCode;
afterEach(async () => {
  vi.unstubAllEnvs();
  process.exitCode = savedExitCode;
  await new Promise<void>((done) =>
    server ? server.close(() => done()) : done(),
  );
  server = undefined;
});

/** A minimal MCP endpoint standing in for the conductor's `bakers` server. */
async function fakeConductor() {
  const seen: Array<{ authorization?: string; method: string; params?: any }> =
    [];
  const http = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const msg = JSON.parse(Buffer.concat(chunks).toString() || '{}');
    seen.push({
      authorization: req.headers.authorization,
      method: msg.method,
      params: msg.params,
    });
    if (msg.id === undefined) return res.writeHead(202).end();
    const result =
      msg.method === 'initialize'
        ? {
            protocolVersion: msg.params.protocolVersion,
            capabilities: { tools: {} },
            serverInfo: { name: 'bakers', version: '1' },
          }
        : msg.method === 'tools/list'
          ? {
              tools: [
                {
                  name: 'bakers_ticket_read',
                  inputSchema: {
                    type: 'object',
                    properties: { ticket: { type: 'string' } },
                  },
                },
              ],
            }
          : { content: [{ type: 'text', text: '{"identifier":"BB-1"}' }] };
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }));
  });
  server = http;
  await new Promise<void>((done) => http.listen(0, '127.0.0.1', done));
  return {
    seen,
    url: `http://127.0.0.1:${(http.address() as AddressInfo).port}`,
  };
}

it("calls the run's conductor with the run token and no connection config, even with the site's tool name", async () => {
  const conductor = await fakeConductor();
  vi.stubEnv('BB_CONDUCTOR_URL', conductor.url);
  vi.stubEnv('BB_CONDUCTOR_TOKEN', 'run-token');
  let out = '';
  let err = '';
  await dispatchBbDropsh(
    { resolveBases: [] },
    ['tool', 'tool_api__bakers_ticket_read', '--data', '{"ticket":"BB-1"}'],
    {
      publicCommand: 'tools',
      stdout: (s) => (out += s),
      stderr: (s) => (err += s),
    },
  );
  expect(err).toBe('');
  expect(process.exitCode ?? 0).toBe(0);
  const call = conductor.seen.find((r) => r.method === 'tools/call');
  expect(call?.params).toEqual({
    name: 'bakers_ticket_read',
    arguments: { ticket: 'BB-1' },
  });
  expect(new Set(conductor.seen.map((r) => r.authorization))).toEqual(
    new Set(['Bearer run-token']),
  );
});

it('names a site tool by its wire name outside a run and by its plain name inside one', () => {
  expect(toolNameFor('bakers_ticket_read', false)).toBe(
    'tool_api__bakers_ticket_read',
  );
  expect(toolNameFor('tool_api__bakers_ticket_read', false)).toBe(
    'tool_api__bakers_ticket_read',
  );
  expect(toolNameFor('tool_api__bakers_ticket_read', true)).toBe(
    'bakers_ticket_read',
  );
  expect(toolNameFor('ports_up', true)).toBe('ports_up');
});
