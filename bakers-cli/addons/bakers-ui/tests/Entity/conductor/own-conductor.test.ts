import { describe, expect, it } from 'vitest';
import {
  readOwnConductor,
  selectOwnConductor,
} from '../../../src/Entity/conductor/Data/own-conductor.js';
import type { DropshClient } from '../../../src/types.js';

// BB-232 spec Decision D9, and the review's blocking finding F1.
//
// Deleting `~/.bakers/conductors.json` took away the answer the ui entry used
// to read out of it: which project this checkout belongs to. The entry cannot
// replace it — it holds no JSON:API
// client (BB-223 spec Finding 1) — so it hands over the `.bakers` dir and the
// renderer matches it against each conductor's `workspace_root`.
//
// The matching rule is deliberately the SAME one the registry lookup used
// (`resolve(entry.path) === resolve(bakersDir)`), so nothing about which checkout
// counts as "this project" changed with the store behind it.
//
// BB-450 D3/D15: `workspace_root` now records the checkout root
// (`dirname(bakersDir)`), not this `.bakers` config directory, because every
// heartbeat rewrites the field going forward. A record written before that
// change still carries the legacy `.bakers` value until its next heartbeat, so
// the match accepts EITHER form.

const conductor = (attrs: Record<string, unknown>, projectId?: string) => ({
  id: `c-${String(attrs.machine_id ?? 'x')}`,
  type: 'bb_conductor--bb_conductor',
  attributes: attrs,
  ...(projectId
    ? {
        relationships: {
          project_id: { data: { id: projectId, type: 'bb_project' } },
        },
      }
    : {}),
});

const project = (id: string, name: string) => ({
  id,
  type: 'bb_project--bb_project',
  attributes: { name },
});

const DOC = {
  data: [
    conductor(
      { machine_id: 'cw-shop', workspace_root: '/repos/shop/.bakers' },
      'p-shop',
    ),
    conductor(
      { machine_id: 'cw-framework', workspace_root: '/repos/bakers/.bakers' },
      'p-bakers',
    ),
  ],
  included: [project('p-shop', 'shop'), project('p-bakers', 'bakers')],
};

describe('selectOwnConductor — the registry lookup, against the control plane', () => {
  it('resolves the project name of the matching workspace_root', () => {
    expect(selectOwnConductor(DOC, '/repos/bakers/.bakers')).toEqual({
      project: 'bakers',
    });
  });

  it('matches path-normalised, exactly as the registry lookup did', () => {
    expect(selectOwnConductor(DOC, '/repos/bakers/.bakers/').project).toBe(
      'bakers',
    );
    expect(selectOwnConductor(DOC, '/repos/./bakers/.bakers').project).toBe(
      'bakers',
    );
  });

  it('is a prefix-free exact match — a worktree is not its parent checkout', () => {
    // The registry lookup was `resolve(e.path) === resolve(bakersDir)`, never a
    // longest-prefix walk. A worktree has its own `.bakers`, so it resolves to no
    // conductor rather than silently inheriting the parent checkout's project.
    expect(
      selectOwnConductor(DOC, '/repos/bakers/.bakers-worktrees/feat-x/.bakers'),
    ).toEqual({ project: undefined });
  });

  it('matches the new checkout-root form (BB-450 D3): workspace_root without the .bakers suffix', () => {
    const doc = {
      data: [
        conductor(
          { machine_id: 'cw-framework', workspace_root: '/repos/bakers' },
          'p-bakers',
        ),
      ],
      included: [project('p-bakers', 'bakers')],
    };
    expect(selectOwnConductor(doc, '/repos/bakers/.bakers')).toEqual({
      project: 'bakers',
    });
  });

  it('still matches the legacy .bakers form for a record not yet healed by a heartbeat', () => {
    const doc = {
      data: [
        conductor(
          {
            machine_id: 'cw-framework',
            workspace_root: '/repos/bakers/.bakers',
          },
          'p-bakers',
        ),
      ],
      included: [project('p-bakers', 'bakers')],
    };
    expect(selectOwnConductor(doc, '/repos/bakers/.bakers')).toEqual({
      project: 'bakers',
    });
  });

  it('yields nothing when no record names this dir', () => {
    expect(selectOwnConductor(DOC, '/repos/unknown/.bakers')).toEqual({
      project: undefined,
    });
  });

  it('yields no project when the matching record names none', () => {
    const doc = {
      data: [
        conductor({ machine_id: 'orphan', workspace_root: '/repos/o/.bakers' }),
      ],
      included: [],
    };
    expect(selectOwnConductor(doc, '/repos/o/.bakers')).toEqual({
      project: undefined,
    });
  });

  it('ignores records that report no workspace_root at all', () => {
    const doc = {
      data: [conductor({ machine_id: 'never-started' }, 'p-bakers')],
      included: [project('p-bakers', 'bakers')],
    };
    expect(selectOwnConductor(doc, '/repos/bakers/.bakers')).toEqual({
      project: undefined,
    });
  });

  it('takes the first record in server order when a repo hosts several conductors', () => {
    // Several conductor configs in one `.bakers` share a workspace_root, and the
    // dir alone cannot say which one this cockpit belongs to. First in server
    // order is a documented guess, not a resolution — it only picks the default
    // project, which `--project` overrides.
    const doc = {
      data: [
        conductor(
          { machine_id: 'cw-a', workspace_root: '/repos/multi/.bakers' },
          'p-a',
        ),
        conductor(
          { machine_id: 'cw-b', workspace_root: '/repos/multi/.bakers' },
          'p-b',
        ),
      ],
      included: [project('p-a', 'alpha'), project('p-b', 'beta')],
    };
    expect(selectOwnConductor(doc, '/repos/multi/.bakers')).toEqual({
      project: 'alpha',
    });
  });

  it('yields nothing for an empty document', () => {
    expect(selectOwnConductor({}, '/repos/bakers/.bakers')).toEqual({
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

  it('reads bb_conductor once, with the project sideloaded', async () => {
    const client = clientReturning(DOC);
    const own = await readOwnConductor(client, '/repos/bakers/.bakers');

    expect(own).toEqual({ project: 'bakers' });
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]?.path).toBe('bb_conductor/bb_conductor');
    // Sideloaded, so the project NAME costs no second request.
    expect(client.calls[0]?.query).toContain('include=project_id');
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
      readOwnConductor(client, '/repos/bakers/.bakers'),
    ).resolves.toEqual({ project: undefined });
  });
});
