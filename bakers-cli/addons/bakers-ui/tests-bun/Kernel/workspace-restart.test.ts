import { describe, expect, it } from 'bun:test';
import type {
  Collection,
  DropshClient,
  RendererServices,
} from '../../src/types.js';
import { bootTui } from '../tui-harness.js';

// A workspace switch re-execs `bakers ui`; the child's output (a start error
// included) must land on a restored terminal, not over the open popup.
describe('workspace switch restart', () => {
  const workspaces = [
    { id: 'ws-1', name: 'bakers' },
    { id: 'ws-2', name: 'keytec' },
  ];

  const services = (): RendererServices => {
    const collection = (type: string): Collection => {
      const c: Collection = {
        where: () => c,
        sort: () => c,
        page: () => c,
        first: async () => null,
        list: async () =>
          type === 'bb_workspace'
            ? workspaces.map((w) => ({
                id: w.id,
                type: 'bb_workspace',
                attr: (key: string) => (key === 'name' ? w.name : undefined),
                rel: () => null,
                rels: () => [],
              }))
            : [],
      } as unknown as Collection;
      return c;
    };
    const client = {
      collection,
      get: async () => ({ data: [] }),
    } as unknown as DropshClient;
    return { client, writeClient: client, baseUrl: 'https://bakers.example' };
  };

  it('tears the kernel down before it restarts on the picked workspace', async () => {
    let shellStanding: boolean | undefined;
    let picked: string | undefined;
    const tui = await bootTui({
      services: services(),
      tui: {
        workspaceId: 'ws-1',
        workspace: 'bakers',
        restartProcess: (name: string) => {
          picked = name;
          shellStanding =
            tui.renderer.root.findDescendantById('shell') !== undefined;
        },
      },
    });
    await tui.press('W');
    expect(tui.frame()).toContain('Which workspace?');
    await tui.press('j');
    await tui.press('\r');
    await tui.running;
    expect(picked).toBe('keytec');
    expect(shellStanding).toBe(false);
    await tui.stop();
  });
});
