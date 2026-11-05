import { mkdtemp, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  type DiscoveredTools,
  loadTools,
  provisionTools,
  type ToolHandler,
} from '../../src/plugins/tools.js';

function addon(
  name: string,
  handlers: Record<string, ToolHandler>,
  options?: unknown,
): DiscoveredTools {
  return {
    name,
    version: '1.0.0',
    tools: {
      contract: 1,
      tools: Object.fromEntries(
        Object.keys(handlers).map((tool) => [
          tool,
          {
            description: `${tool} tool`,
            input: {
              type: 'object',
              properties: { service: { type: 'string' } },
            },
          },
        ]),
      ),
      handlers: async (opts) => {
        expect(opts).toEqual(options);
        return handlers;
      },
    },
    ...(options !== undefined ? { options } : {}),
  };
}

const binding = { worktreePath: '/work/bb-1' };
const here = { worktreePath: tmpdir() };

describe('loadTools', () => {
  it("collects every addon's tools and calls them on the bound worktree", async () => {
    const registry = await loadTools([
      addon(
        'ports',
        {
          ports_up: async (req) => ({
            text: `${req.worktreePath} ${req.args.service}`,
          }),
        },
        { zone: 'z' },
      ),
      addon('ddev', { ddev_status: async () => ({ text: 'running' }) }),
    ]);
    expect(registry.list().map((t) => t.name)).toEqual([
      'ports_up',
      'ddev_status',
    ]);
    expect(
      await registry.call('ports_up', { service: 'web' }, binding),
    ).toEqual({ text: '/work/bb-1 web' });
  });

  it('fails on a tool name declared by two addons', async () => {
    const ping = async () => ({ text: '' });
    await expect(
      loadTools([addon('a', { ping }), addon('b', { ping })]),
    ).rejects.toThrow(/ping.*a.*b/);
  });

  it('refuses arguments outside the declared input, such as a worktree', async () => {
    const registry = await loadTools([
      addon('ports', { ports_up: async () => ({ text: 'up' }) }),
    ]);
    await expect(
      registry.call('ports_up', { service: 'web', worktree: '/x' }, binding),
    ).rejects.toThrow(/worktree|additional/);
    await expect(registry.call('nope', {}, binding)).rejects.toThrow(
      /unknown tool nope/,
    );
  });

  it('offers no provision_up tool without the hook', () => {
    expect(provisionTools(undefined)).toEqual([]);
  });

  it('runs a string provision_up hook in the bound worktree', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'bb-provision-'));
    const registry = await loadTools(provisionTools('pwd'));
    expect(registry.list().map((t) => t.name)).toEqual(['provision_up']);
    const { text } = await registry.call(
      'provision_up',
      {},
      {
        worktreePath: dir,
      },
    );
    expect(text).toBe(`exit 0\n${await realpath(dir)}\n`);
  });

  it('runs the chosen profile and refuses an unknown or missing one', async () => {
    const registry = await loadTools(
      provisionTools({ a: 'echo first', b: 'echo second' }),
    );
    expect(
      (await registry.call('provision_up', { profile: 'b' }, here)).text,
    ).toBe('exit 0\nsecond\n');
    await expect(
      registry.call('provision_up', { profile: 'c' }, here),
    ).rejects.toThrow(/unknown profile c.*a, b/);
    await expect(registry.call('provision_up', {}, here)).rejects.toThrow(
      /profile required.*a, b/,
    );
  });

  it('reports a failing provision_up as a tool error', async () => {
    const registry = await loadTools(provisionTools('echo broken; exit 3'));
    await expect(registry.call('provision_up', {}, here)).rejects.toThrow(
      'exit 3\nbroken\n',
    );
  });

  it('refuses a malformed provision_up hook at load', () => {
    expect(() => provisionTools({ a: 1 } as never)).toThrow(
      /hooks.provision_up/,
    );
  });

  it("lets a tool call another addon's tool on the same worktree", async () => {
    const registry = await loadTools([
      addon('ports', {
        ports_status: async (req) => ({ text: `status ${req.worktreePath}` }),
      }),
      addon('ddev', {
        ddev_login: async (req) => req.callTool('ports_status', {}),
      }),
    ]);
    expect(await registry.call('ddev_login', {}, binding)).toEqual({
      text: 'status /work/bb-1',
    });
  });
});
