import { describe, expect, it } from 'vitest';
import {
  type DiscoveredTools,
  loadTools,
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
