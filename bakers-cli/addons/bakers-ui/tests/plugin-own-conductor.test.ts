import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  DropshClient,
  RendererServices,
  TuiOptions,
} from '../src/types.js';

// BB-232 spec Decision D9, and the review's blocking finding F1.
//
// F1 was not a wrong value — it was a value that never arrived. `bakers ui` passed
// `bakersDir` into the launcher, nothing read it, and the two answers the deleted
// registry used to supply silently became `undefined`: the new-ticket form lost
// this machine's conductor from the top of its list, and its project fell back
// to the hardcoded `'bakers'` in ANY repo.
//
// So the assertion that matters is not "the resolver works" (that is
// `Entity/conductor/own-conductor.test.ts`) but "the resolved values REACH the
// kernel". The kernel is mocked here for exactly that: what `run()` hands it is
// the observable, and nothing else in this file needs a terminal.

const runTicketTui = vi.hoisted(() => vi.fn(() => Promise.resolve(undefined)));
vi.mock('../src/Kernel/tui-kernel.js', () => ({ runTicketTui }));

const { default: bakersUiPlugin } = await import('../src/plugin.js');

const MACHINE = '0b6f3c1e-9a2d-4e57-8c41-2f7d9e5a1b30';

const CONDUCTORS = {
  data: [
    {
      id: 'c-1',
      type: 'bb_conductor--bb_conductor',
      attributes: { workspace_root: '/repos/bakers' },
      relationships: {
        machine: { data: { id: MACHINE, type: 'bb_machine' } },
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

let bbHome: string;
beforeEach(() => {
  runTicketTui.mockClear();
  // This machine's UUID comes from machine.config.js under BB_HOME.
  bbHome = mkdtempSync(join(tmpdir(), 'bakers-ui-own-'));
  writeFileSync(
    join(bbHome, 'machine.config.js'),
    `export default { machine_id: '${MACHINE}', label: 'cw-laptop' };\n`,
  );
  vi.stubEnv('BB_HOME', bbHome);
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(bbHome, { recursive: true, force: true });
});

describe('run() hands the kernel this checkout’s project + conductor (F1)', () => {
  it('resolves both from the conductor record matching bakersDir', async () => {
    const opts = await optionsHandedToKernel({
      bakersDir: '/repos/bakers/.bakers',
    });

    expect(opts.project).toBe('bakers');
    expect(opts.ownConductorId).toBe('c-1');
  });

  it('leaves both unset when no bakersDir was handed over', async () => {
    // Outside any project the cockpit claims no project — the honest empty
    // cockpit `resolveProjectRooting` documents, not a guess.
    const opts = await optionsHandedToKernel({});

    expect(opts.project).toBeUndefined();
    expect(opts.ownConductorId).toBeUndefined();
  });

  it('leaves both unset when no record names this dir', async () => {
    const opts = await optionsHandedToKernel({
      bakersDir: '/repos/somewhere-else/.bakers',
    });

    expect(opts.project).toBeUndefined();
    expect(opts.ownConductorId).toBeUndefined();
  });

  it('an explicit --project wins over the resolved one', async () => {
    // `bakers ui --project shop` inside the bakers checkout must open `shop`: the
    // flag is the operator saying it outright, the record is an inference.
    const opts = await optionsHandedToKernel({
      bakersDir: '/repos/bakers/.bakers',
      project: 'shop',
    });

    expect(opts.project).toBe('shop');
    // The conductor id has no flag, so it still resolves.
    expect(opts.ownConductorId).toBe('c-1');
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
    expect(opts.ownConductorId).toBeUndefined();
  });
});
