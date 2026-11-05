import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ovenTools } from '../../src/commands/oven-tools.js';
import {
  startToolServer,
  type ToolServer,
} from '../../src/core/tool-server.js';
import { loadTools } from '../../src/plugins/tools.js';

const registry = () =>
  loadTools([
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
          where: async (req) => ({
            text: `${req.worktreePath} ${String(req.args.note ?? '')}`.trim(),
          }),
          boom: async () => {
            throw new Error('it broke');
          },
        }),
      },
    },
  ]);

let server: ToolServer | undefined;
afterEach(async () => {
  await server?.stop();
  server = undefined;
});

async function run(
  name: string | undefined,
  opts: { data?: string; schema?: boolean } = {},
  env?: NodeJS.ProcessEnv,
) {
  server ??= await startToolServer({ registry: await registry() });
  const token = server.issueRunToken({ worktreePath: '/work/bb-1' });
  const out: string[] = [];
  const err: string[] = [];
  const code = await ovenTools(
    name,
    opts,
    env ?? { BB_CONDUCTOR_URL: server.url, BB_CONDUCTOR_TOKEN: token },
    { out: (l) => out.push(l), err: (l) => err.push(l) },
  );
  const all = [...out, ...err].join('\n');
  expect(all).not.toContain(token);
  return { code, out: out.join('\n'), err: err.join('\n') };
}

describe('bakers oven tools', () => {
  it("lists the conductor's tools for this run", async () => {
    const { code, out } = await run(undefined);
    expect(code).toBe(0);
    expect(out).toBe('where\tWhere am I\nboom\tFails');
  });

  it("prints a tool's input schema", async () => {
    const { code, out } = await run('where', { schema: true });
    expect(code).toBe(0);
    expect(JSON.parse(out)).toMatchObject({
      type: 'object',
      properties: { note: { type: 'string' } },
    });
  });

  it("calls a tool bound to the run token's worktree, with --data inline or from a file", async () => {
    expect(await run('where', { data: '{"note":"hi"}' })).toMatchObject({
      code: 0,
      out: '/work/bb-1 hi',
    });
    const file = join(mkdtempSync(join(tmpdir(), 'bb-oven-tools-')), 'a.json');
    writeFileSync(file, '{"note":"file"}');
    expect(await run('where', { data: `@${file}` })).toMatchObject({
      code: 0,
      out: '/work/bb-1 file',
    });
  });

  it('exits 1 with the message when the tool reports an error', async () => {
    expect(await run('boom')).toMatchObject({ code: 1, err: 'it broke' });
  });

  it('exits 4 outside a run, for an unknown tool and for invalid --data', async () => {
    const outside = await run(undefined, {}, {});
    expect(outside.code).toBe(4);
    expect(outside.err).toMatch(/no conductor tools in this shell/);
    expect((await run('nope')).code).toBe(4);
    expect((await run('where', { data: '[1]' })).code).toBe(4);
    expect((await run('where', { data: '{' })).code).toBe(4);
  });

  it('exits 3 when the run token is rejected', async () => {
    server = await startToolServer({ registry: await registry() });
    const { code, err } = await run(
      undefined,
      {},
      { BB_CONDUCTOR_URL: server.url, BB_CONDUCTOR_TOKEN: 'stale-token' },
    );
    expect(code).toBe(3);
    expect(err).not.toContain('stale-token');
  });
});
