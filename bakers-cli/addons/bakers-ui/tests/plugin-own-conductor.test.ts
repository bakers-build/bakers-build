import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  DropshClient,
  RendererServices,
  TuiOptions,
} from '../src/types.js';

// BB-232 spec Decision D9, and the review's blocking finding F1.
//
// F1 was not a wrong value — it was a value that never arrived. `bakers ui` passed
// `bakersDir` into the launcher, nothing read it, and the default project the
// deleted registry used to supply silently became `undefined`.
//
// So the assertion that matters is not "the resolver works" (that is
// `Entity/conductor/own-conductor.test.ts`) but "the resolved project REACHES the
// kernel". The kernel is mocked here for exactly that: what `run()` hands it is
// the observable, and nothing else in this file needs a terminal.

const runTicketTui = vi.hoisted(() => vi.fn(() => Promise.resolve(undefined)));
vi.mock('../src/Kernel/tui-kernel.js', () => ({ runTicketTui }));

const { default: bakersUiPlugin } = await import('../src/plugin.js');

const CONDUCTORS = {
  data: [
    {
      id: 'c-1',
      type: 'bb_conductor--bb_conductor',
      attributes: {
        // BB-353: registration key is conductor_id (legacy machine_id still
        // accepted by selectOwnConductor during cutover).
        conductor_id: 'cw-framework',
        workspace_root: '/repos/bakers/.bakers',
      },
      relationships: {
        project_id: { data: { id: 'p-1', type: 'bb_project' } },
      },
    },
  ],
  included: [
    {
      id: 'p-1',
      type: 'bb_project--bb_project',
      attributes: { name: 'bakers' },
    },
  ],
};

function fakeServices(doc: unknown = CONDUCTORS): RendererServices {
  const client = {
    collection: () => ({
      where: () => client.collection(''),
      sort: () => client.collection(''),
      page: () => client.collection(''),
      first: async () => null,
      list: async () => [],
    }),
    get: async () => doc,
  } as unknown as DropshClient;
  return { client, baseUrl: 'https://bakers.example' };
}

/** The options `run()` handed the kernel. */
async function optionsHandedToKernel(
  options: Parameters<typeof bakersUiPlugin>[0],
  doc?: unknown,
): Promise<TuiOptions> {
  const renderer = bakersUiPlugin(options).renderers[0];
  if (!renderer) throw new Error('the plugin registered no renderer');
  await renderer.run({}, {}, fakeServices(doc));
  const call = runTicketTui.mock.calls.at(-1) as unknown[] | undefined;
  if (!call) throw new Error('the kernel was never reached');
  return call[3] as TuiOptions;
}

beforeEach(() => {
  runTicketTui.mockClear();
});

describe('run() hands the kernel this checkout’s project (F1)', () => {
  it('resolves it from the conductor record matching bakersDir', async () => {
    const opts = await optionsHandedToKernel({
      bakersDir: '/repos/bakers/.bakers',
    });

    expect(opts.project).toBe('bakers');
    expect(opts).not.toHaveProperty('ownConductorMachineId');
  });

  it('leaves the project unset when no bakersDir was handed over', async () => {
    // Outside any project the cockpit claims no project — the honest empty
    // cockpit `resolveProjectRooting` documents, not a guess.
    const opts = await optionsHandedToKernel({});

    expect(opts.project).toBeUndefined();
  });

  it('leaves the project unset when no record names this dir', async () => {
    const opts = await optionsHandedToKernel({
      bakersDir: '/repos/somewhere-else/.bakers',
    });

    expect(opts.project).toBeUndefined();
  });

  it('an explicit --project wins over the resolved one', async () => {
    // `bakers ui --project shop` inside the bakers checkout must open `shop`: the
    // flag is the operator saying it outright, the record is an inference.
    const opts = await optionsHandedToKernel({
      bakersDir: '/repos/bakers/.bakers',
      project: 'shop',
    });

    expect(opts.project).toBe('shop');
  });

  it('a failed read leaves the defaults unset and still boots', async () => {
    const client = {
      collection: () => {
        throw new Error('not used');
      },
      get: async () => {
        throw new Error('503 Service Unavailable');
      },
    } as unknown as DropshClient;
    const renderer = bakersUiPlugin({ bakersDir: '/repos/bakers/.bakers' })
      .renderers[0];
    if (!renderer) throw new Error('the plugin registered no renderer');

    await expect(
      renderer.run({}, {}, { client, baseUrl: 'https://bakers.example' }),
    ).resolves.toBeUndefined();
    expect(runTicketTui).toHaveBeenCalledOnce();
    const opts = runTicketTui.mock.calls[0]?.[3] as TuiOptions;
    expect(opts.project).toBeUndefined();
  });
});
