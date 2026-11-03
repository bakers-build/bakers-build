import { describe, expect, it } from 'vitest';
import {
  readOwnConductor,
  selectOwnConductor,
} from '../../../src/Entity/conductor/Data/own-conductor.js';
import type { DropshClient } from '../../../src/types.js';

// BB-232 spec Decision D9: a conductor is machine +
// project + variant. The `bakers ui` entry hands over the `.bakers` dir it is
// standing in; the renderer picks THIS machine's conductor whose
// `workspace_root` is this checkout, preferring the default variant, and the
// record supplies the project and the conductor UUID.
//
// The path rule is an exact, normalised comparison (never a longest-prefix
// walk), and `workspace_root` may hold the checkout root (BB-450 D3) or the
// legacy `.bakers` dir of a record not yet healed by a heartbeat.

const MACHINE = '0b6f3c1e-9a2d-4e57-8c41-2f7d9e5a1b30';
const OTHER_MACHINE = '9d1e2f3a-4b5c-4d6e-8f70-1a2b3c4d5e6f';

const conductor = (
  id: string,
  attrs: Record<string, unknown>,
  projectId?: string,
  machine: string = MACHINE,
) => ({
  id,
  type: 'bb_conductor--bb_conductor',
  attributes: attrs,
  relationships: {
    machine: { data: { id: machine, type: 'bb_machine' } },
    ...(projectId
      ? { project_id: { data: { id: projectId, type: 'bb_project' } } }
      : {}),
  },
});

const project = (id: string, name: string) => ({
  id,
  type: 'bb_project--bb_project',
  attributes: { name },
});

const DOC = {
  data: [
    conductor('c-shop', { workspace_root: '/repos/shop' }, 'p-shop'),
    conductor('c-bakers', { workspace_root: '/repos/bakers' }, 'p-bakers'),
  ],
  included: [project('p-shop', 'shop'), project('p-bakers', 'bakers')],
};

describe('selectOwnConductor — this machine, this checkout, the default variant', () => {
  it('resolves the conductor UUID and project of this machine at this checkout', () => {
    expect(selectOwnConductor(DOC, '/repos/bakers/.bakers', MACHINE)).toEqual({
      conductorId: 'c-bakers',
      project: 'bakers',
    });
  });

  it('matches path-normalised and still accepts the legacy .bakers form', () => {
    expect(
      selectOwnConductor(DOC, '/repos/./bakers/.bakers/', MACHINE).conductorId,
    ).toBe('c-bakers');
    const legacy = {
      data: [
        conductor('c-old', { workspace_root: '/repos/bakers/.bakers' }, 'p-1'),
      ],
      included: [project('p-1', 'bakers')],
    };
    expect(
      selectOwnConductor(legacy, '/repos/bakers/.bakers', MACHINE).conductorId,
    ).toBe('c-old');
  });

  it('never takes another machine’s conductor at the same path', () => {
    const doc = {
      data: [
        conductor(
          'c-theirs',
          { workspace_root: '/repos/bakers' },
          'p-1',
          OTHER_MACHINE,
        ),
      ],
      included: [project('p-1', 'bakers')],
    };
    expect(selectOwnConductor(doc, '/repos/bakers/.bakers', MACHINE)).toEqual({
      conductorId: undefined,
      project: undefined,
    });
  });

  it('prefers the default variant when the checkout runs several', () => {
    const doc = {
      data: [
        conductor(
          'c-shop-variant',
          { workspace_root: '/repos/multi', variant: 'shop' },
          'p-1',
        ),
        conductor(
          'c-default',
          { workspace_root: '/repos/multi', variant: 'conductor' },
          'p-1',
        ),
      ],
      included: [project('p-1', 'multi')],
    };
    expect(
      selectOwnConductor(doc, '/repos/multi/.bakers', MACHINE).conductorId,
    ).toBe('c-default');
  });

  it('is a prefix-free exact match — a worktree is not its parent checkout', () => {
    expect(
      selectOwnConductor(
        DOC,
        '/repos/bakers/.bakers-worktrees/feat-x/.bakers',
        MACHINE,
      ),
    ).toEqual({ conductorId: undefined, project: undefined });
  });

  it('yields nothing without a machine UUID, for an unknown dir, or an empty document', () => {
    const nothing = { conductorId: undefined, project: undefined };
    expect(selectOwnConductor(DOC, '/repos/bakers/.bakers', undefined)).toEqual(
      nothing,
    );
    expect(selectOwnConductor(DOC, '/repos/unknown/.bakers', MACHINE)).toEqual(
      nothing,
    );
    expect(selectOwnConductor({}, '/repos/bakers/.bakers', MACHINE)).toEqual(
      nothing,
    );
  });

  it('ignores records that report no workspace_root at all', () => {
    const doc = {
      data: [conductor('c-never', {}, 'p-1')],
      included: [project('p-1', 'bakers')],
    };
    expect(
      selectOwnConductor(doc, '/repos/bakers/.bakers', MACHINE).conductorId,
    ).toBeUndefined();
  });

  it('yields the conductor even when the project cannot be resolved', () => {
    const doc = {
      data: [conductor('c-orphan', { workspace_root: '/repos/o' })],
      included: [],
    };
    expect(selectOwnConductor(doc, '/repos/o/.bakers', MACHINE)).toEqual({
      conductorId: 'c-orphan',
      project: undefined,
    });
  });
});

describe('readOwnConductor — one read, and it never breaks the boot', () => {
  const clientReturning = (
    doc: unknown,
  ): DropshClient & { calls: Array<{ path: string; query: string }> } => {
    const calls: Array<{ path: string; query: string }> = [];
    return {
      calls,
      collection: () => {
        throw new Error('not used');
      },
      get: async (path: string, params?: unknown) => {
        const q = params as { getQueryString?: () => string } | undefined;
        calls.push({ path, query: q?.getQueryString?.() ?? '' });
        return doc;
      },
    } as unknown as DropshClient & {
      calls: Array<{ path: string; query: string }>;
    };
  };

  it("reads this machine's conductors once, with the project sideloaded", async () => {
    const client = clientReturning(DOC);
    const own = await readOwnConductor(
      client,
      '/repos/bakers/.bakers',
      MACHINE,
    );

    expect(own).toEqual({ conductorId: 'c-bakers', project: 'bakers' });
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]?.path).toBe('bb_conductor/bb_conductor');
    const query = decodeURIComponent(client.calls[0]?.query ?? '');
    // Sideloaded, so the project NAME costs no second request.
    expect(query).toContain('include=project_id');
    expect(query).toContain(`filter[machine.id]=${MACHINE}`);
  });

  it('reads nothing without a machine UUID', async () => {
    const client = clientReturning(DOC);
    await expect(
      readOwnConductor(client, '/repos/bakers/.bakers', undefined),
    ).resolves.toEqual({ conductorId: undefined, project: undefined });
    expect(client.calls).toHaveLength(0);
  });

  it('swallows a failed read — an unreachable hub must not stop the cockpit', async () => {
    const client: DropshClient = {
      collection: () => {
        throw new Error('not used');
      },
      get: async () => {
        throw new Error('503 Service Unavailable');
      },
    } as unknown as DropshClient;

    await expect(
      readOwnConductor(client, '/repos/bakers/.bakers', MACHINE),
    ).resolves.toEqual({ conductorId: undefined, project: undefined });
  });
});
