import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveBaseRef } from '../src/shared.js';
import herdrWorkspace, {
  HerdrWorkspace,
  herdrWorkspace as named,
} from '../src/workspace.js';

// Canned herdr JSON responses matching the verified CLI shapes.
function listEmpty(): string {
  return JSON.stringify({ result: { worktrees: [] } });
}

function listWithEntry(
  branch: string,
  path: string,
  open_workspace_id?: string,
): string {
  return JSON.stringify({
    result: {
      worktrees: [
        {
          branch,
          path,
          ...(open_workspace_id !== undefined ? { open_workspace_id } : {}),
        },
      ],
    },
  });
}

function createResponse(branch: string, path: string): string {
  return JSON.stringify({
    result: {
      worktree: { branch, path, open_workspace_id: 'ws-new' },
      workspace: { workspace_id: 'ws-new' },
      // BB-374: create JSON carries tab_id so overview tab rename needs no
      // live `pane get` round-trip in the happy path.
      root_pane: { pane_id: 'pane-1', tab_id: 'tab-overview-1' },
      tab: { tab_id: 'tab-overview-1' },
    },
  });
}

function openResponse(branch: string, path: string): string {
  return JSON.stringify({
    result: {
      worktree: { branch, path, open_workspace_id: 'ws-opened' },
    },
  });
}

describe('@bakers-build/addon-herdr workspace factory', () => {
  it('default export builds a workspace plugin', () => {
    const ws = herdrWorkspace({ root: '/tmp/x' });
    expect(ws.kind).toBe('worktree');
  });
  it('default and named export are the same factory', () => {
    expect(herdrWorkspace).toBe(named);
  });
  it('derives root from the git common dir (linked worktree → main clone)', async () => {
    // BB-177: config discovery finds the worktree-local .bakers config; the
    // factory must anchor on the git common dir's parent, not dirname(config).
    const plugin = herdrWorkspace({
      execGit: async () => '/parent/.git\n',
    });
    const ws = await plugin.createWorkspace({
      config_path: '/parent/.bakers-worktrees/x/.bakers/project.config.js',
    } as never);
    expect((ws as unknown as { root: string }).root).toBe('/parent');
  });
});

describe('HerdrWorkspace', () => {
  it('sets branch.autoSetupMerge=false in the root before creating, and gives the run push.default=current', async () => {
    const root = mkdtempSync(join(tmpdir(), 'herdr-ws-'));
    try {
      execFileSync('git', ['init', '-q', root]);
      const autoSetupMerge = () =>
        execFileSync('git', ['-C', root, 'config', 'branch.autoSetupMerge'], {
          encoding: 'utf8',
        }).trim();
      let atCreate = '';
      const ws = new HerdrWorkspace({
        root,
        execHerdr: async (args) => {
          if (args.includes('list')) return listEmpty();
          atCreate = autoSetupMerge();
          return createResponse('bakers/GL-9', join(root, 'wt'));
        },
        execGit: async () => '',
      });
      const result = await ws.ensure('GL-9', 'bakers/GL-9');
      expect(atCreate).toBe('false');
      const env = result.env ?? {};
      const last = Number(env.GIT_CONFIG_COUNT) - 1;
      expect(env[`GIT_CONFIG_KEY_${last}`]).toBe('push.default');
      expect(env[`GIT_CONFIG_VALUE_${last}`]).toBe('current');
      const off = await new HerdrWorkspace({
        root,
        autoSetupMerge: true,
        execHerdr: async () =>
          listWithEntry('bakers/GL-9', join(root, 'wt'), 'w'),
        execGit: async () => '',
      }).ensure('GL-9', 'bakers/GL-9');
      expect(off.env).toBeUndefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('creates a new worktree from the fetched remote branch (reports created=true)', async () => {
    const herdrCalls: string[][] = [];
    const gitCalls: string[][] = [];
    const createdPath = '/repo/.bakers-worktrees/bakers/GL-9';

    const ws = new HerdrWorkspace({
      root: '/repo',
      execHerdr: async (args) => {
        herdrCalls.push(args);
        if (args.includes('list')) return listEmpty();
        if (args.includes('create'))
          return createResponse('bakers/GL-9', createdPath);
        return '';
      },
      execGit: async (args) => {
        gitCalls.push(args);
        // rev-parse @{u} → the upstream tracking ref.
        if (args.includes('rev-parse')) return 'origin/develop\n';
        return '';
      },
    });

    const result = await ws.ensure('GL-9', 'bakers/GL-9');

    expect(result.path).toBe(createdPath);
    expect(result.instructions).toBeNull();
    // Fresh worktree → the core runs after_create (BB-84); the workspace only
    // reports it created one.
    expect(result.created).toBe(true);

    // Upstream resolved, then the remote branch fetched before create.
    expect(gitCalls[0]).toContain('rev-parse');
    expect(gitCalls[1]).toEqual([
      '-C',
      '/repo',
      'fetch',
      'origin',
      '--',
      'develop',
    ]);

    // list, then create — and nothing else. Since BB-237 the open layout's
    // `pane run` deep link is NO LONGER issued by `ensure()`: the conductor
    // applies it via `applyOpenLayout` after the `after_create` hook has built
    // the CLI the command names (asserted in the open-layout describe).
    expect(herdrCalls).toHaveLength(2);
    expect(herdrCalls[0]).toContain('list');
    const create = herdrCalls[1];
    expect(create).toContain('create');
    expect(create[create.indexOf('--branch') + 1]).toBe('bakers/GL-9');
    // New branch is based on the remote tracking ref, not the local HEAD.
    expect(create[create.indexOf('--base') + 1]).toBe('origin/develop');
    expect(create[create.indexOf('--label') + 1]).toBe('bakers/GL-9');
    // ABSOLUTE — a relative --path is canonicalized by herdr against its own
    // cwd, which explodes when the caller's cwd was deleted.
    expect(create[create.indexOf('--path') + 1]).toBe(
      '/repo/.bakers-worktrees/bakers/GL-9',
    );
    expect(create).toContain('--no-focus');
    expect(create).toContain('--json');
  });

  it('passes an absolute --path, honouring an absolute worktreeDir override', async () => {
    // The relative `--path` was the root cause of every dispatch dying with
    // `herdr (exit 1): Error: Os { code: 2, kind: NotFound }`: herdr resolves it
    // against its own cwd, and a conductor polling from a reaped worktree has
    // none. `resolve` also means an absolute override is not prefixed with root.
    for (const [worktreeDir, expected] of [
      ['.bakers-worktrees', '/repo/.bakers-worktrees/bakers/GL-9'],
      ['nested/trees', '/repo/nested/trees/bakers/GL-9'],
      ['/elsewhere/trees', '/elsewhere/trees/bakers/GL-9'],
    ] as const) {
      const herdrCalls: string[][] = [];
      const ws = new HerdrWorkspace({
        root: '/repo',
        worktreeDir,
        execHerdr: async (args) => {
          herdrCalls.push(args);
          if (args.includes('list')) return listEmpty();
          if (args.includes('create'))
            return createResponse('bakers/GL-9', `${expected}`);
          return '';
        },
        execGit: async () => '',
      });

      await ws.ensure('GL-9', 'bakers/GL-9');

      const create = herdrCalls[1] as string[];
      expect(create[create.indexOf('--path') + 1]).toBe(expected);
    }
  });

  it('omits --base when the repo has no upstream (falls back to parent HEAD)', async () => {
    const herdrCalls: string[][] = [];
    const createdPath = '/repo/.bakers-worktrees/bakers/GL-9';

    const ws = new HerdrWorkspace({
      root: '/repo',
      execHerdr: async (args) => {
        herdrCalls.push(args);
        if (args.includes('list')) return listEmpty();
        if (args.includes('create'))
          return createResponse('bakers/GL-9', createdPath);
        return '';
      },
      // No upstream configured → git rev-parse @{u} fails.
      execGit: async () => {
        throw new Error('no upstream configured for branch');
      },
    });

    await ws.ensure('GL-9', 'bakers/GL-9');

    const create = herdrCalls[1];
    expect(create).toContain('create');
    expect(create).not.toContain('--base');
  });

  it('uses an explicit baseBranch override and fetches it', async () => {
    const herdrCalls: string[][] = [];
    const gitCalls: string[][] = [];
    const createdPath = '/repo/.bakers-worktrees/bakers/GL-9';

    const ws = new HerdrWorkspace({
      root: '/repo',
      baseBranch: 'origin/main',
      execHerdr: async (args) => {
        herdrCalls.push(args);
        if (args.includes('list')) return listEmpty();
        if (args.includes('create'))
          return createResponse('bakers/GL-9', createdPath);
        return '';
      },
      execGit: async (args) => {
        gitCalls.push(args);
        return '';
      },
    });

    await ws.ensure('GL-9', 'bakers/GL-9');

    // Override used verbatim; no rev-parse needed, fetch targets it.
    expect(gitCalls).toEqual([
      ['-C', '/repo', 'fetch', 'origin', '--', 'main'],
    ]);
    const create = herdrCalls[1];
    expect(create[create.indexOf('--base') + 1]).toBe('origin/main');
  });

  it('uses the baseRef override when it resolves on the remote', async () => {
    const herdrCalls: string[][] = [];
    const created = '/repo/.bakers-worktrees/bakers/GL-child';
    const ws = new HerdrWorkspace({
      root: '/repo',
      execHerdr: async (args) => {
        herdrCalls.push(args);
        if (args.includes('list')) return listEmpty();
        if (args.includes('create'))
          return createResponse('bakers/GL-child', created);
        return '';
      },
      execGit: async (args) => {
        if (args.includes('--verify')) return 'abc123\n';
        if (args.includes('rev-parse')) return 'origin/develop\n';
        return '';
      },
    });

    await ws.ensure('GL-child', 'bakers/GL-child', 'origin/feat/p-1-parent');

    const create = herdrCalls.find((c) => c.includes('create')) ?? [];
    expect(create[create.indexOf('--base') + 1]).toBe('origin/feat/p-1-parent');
  });

  it('falls back to the default base when the override is missing on the remote', async () => {
    const herdrCalls: string[][] = [];
    const created = '/repo/.bakers-worktrees/bakers/GL-child';
    const ws = new HerdrWorkspace({
      root: '/repo',
      execHerdr: async (args) => {
        herdrCalls.push(args);
        if (args.includes('list')) return listEmpty();
        if (args.includes('create'))
          return createResponse('bakers/GL-child', created);
        return '';
      },
      execGit: async (args) => {
        if (args.includes('--verify')) throw new Error('unknown revision');
        if (args.includes('rev-parse')) return 'origin/develop\n';
        return '';
      },
    });

    await ws.ensure('GL-child', 'bakers/GL-child', 'origin/feat/p-1-parent');

    const create = herdrCalls.find((c) => c.includes('create')) ?? [];
    expect(create[create.indexOf('--base') + 1]).toBe('origin/develop');
  });

  it('reuses an existing worktree with open_workspace_id (no create; created=false)', async () => {
    const herdrCalls: string[][] = [];
    const existingPath = '/repo/.bakers-worktrees/bakers/GL-2';

    const ws = new HerdrWorkspace({
      root: '/repo',
      execHerdr: async (args) => {
        herdrCalls.push(args);
        if (args.includes('list'))
          return listWithEntry('bakers/GL-2', existingPath, 'ws-open');
        return '';
      },
    });

    const result = await ws.ensure('GL-2', 'bakers/GL-2');

    expect(result.path).toBe(existingPath);
    // Reuse → created=false, so the core skips after_create.
    expect(result.created).toBe(false);
    // Only the list call — no create, no open.
    expect(herdrCalls).toHaveLength(1);
    expect(herdrCalls[0]).toContain('list');
  });

  it('opens an on-disk worktree that has no open_workspace_id (created=false)', async () => {
    const herdrCalls: string[][] = [];
    const onDiskPath = '/repo/.bakers-worktrees/bakers/GL-3';

    const ws = new HerdrWorkspace({
      root: '/repo',
      execHerdr: async (args) => {
        herdrCalls.push(args);
        if (args.includes('list'))
          return listWithEntry('bakers/GL-3', onDiskPath);
        if (args.includes('open'))
          return openResponse('bakers/GL-3', onDiskPath);
        return '';
      },
    });

    const result = await ws.ensure('GL-3', 'bakers/GL-3');

    expect(result.path).toBe(onDiskPath);
    expect(herdrCalls).toHaveLength(2);
    const open = herdrCalls[1];
    expect(open).toContain('open');
    expect(open[open.indexOf('--branch') + 1]).toBe('bakers/GL-3');
    // open is a reuse path → created=false, after_create must NOT run.
    expect(result.created).toBe(false);
  });
});

describe('resolveBaseRef', () => {
  it('returns a base-ref override that resolves on the remote', async () => {
    const calls: string[][] = [];
    const ref = await resolveBaseRef(
      '/repo',
      async (args) => {
        calls.push(args);
        return '';
      },
      { override: 'origin/release' },
    );
    expect(ref).toBe('origin/release');
    expect(calls).toContainEqual([
      '-C',
      '/repo',
      'fetch',
      'origin',
      '--',
      'release',
    ]);
  });

  it('falls back to the upstream when the override does not resolve', async () => {
    const ref = await resolveBaseRef(
      '/repo',
      async (args) => {
        if (args.includes('--verify')) throw new Error('unknown revision');
        if (args.includes('@{u}')) return 'origin/develop\n';
        return '';
      },
      { override: 'origin/gone' },
    );
    expect(ref).toBe('origin/develop');
  });

  it('returns undefined when the repo has no upstream', async () => {
    const ref = await resolveBaseRef(
      '/repo',
      async (args) => {
        if (args.includes('@{u}')) throw new Error('no upstream');
        return '';
      },
      {},
    );
    expect(ref).toBeUndefined();
  });
});

describe('HerdrWorkspace.remove', () => {
  it('tears down through herdr, anchored at the workspace root', async () => {
    const calls: string[][] = [];
    const ws = new HerdrWorkspace({
      root: '/repo',
      execHerdr: async (args) => {
        calls.push(args);
        if (args[0] === 'worktree' && args[1] === 'list')
          return listWithEntry('bakers/GL-9', '/repo/wt-gone', 'ws-1');
        return JSON.stringify({ result: { workspaces: [] } });
      },
      runGit: async () => '',
    });

    // The directory does not exist, so herdr's remove is verified gone.
    await expect(ws.remove('bakers/GL-9', '/repo/wt-gone')).resolves.toBe(
      'removed',
    );
    expect(calls).toContainEqual([
      'worktree',
      'list',
      '--cwd',
      '/repo',
      '--json',
    ]);
    expect(calls).toContainEqual([
      'worktree',
      'remove',
      '--workspace',
      'ws-1',
      '--force',
      '--json',
    ]);
  });

  it('refuses the main checkout', async () => {
    const ws = new HerdrWorkspace({
      root: '/repo',
      execHerdr: async () => {
        throw new Error('herdr must not be called');
      },
    });
    await expect(ws.remove('develop', '/repo/')).resolves.toBe('unverified');
  });
});
