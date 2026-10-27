import type { BbWorkspace } from '@bakers-build/conductor/contract';
import type { ConductorLogger } from '@bakers-build/core';
import { describe, expect, it } from 'vitest';
import { resolveBaseRef } from '../src/shared.js';
import herdrWorkspace, {
  DEFAULT_OPEN_LAYOUT,
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
    expect(ws.kind).toBe('workspace');
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
      config_path: '/parent/.bakers-worktrees/x/.bakers/conductor.config.js',
    } as never);
    expect((ws as unknown as { root: string }).root).toBe('/parent');
  });
});

describe('HerdrWorkspace', () => {
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
    expect(gitCalls[1]).toEqual(['-C', '/repo', 'fetch', 'origin', 'develop']);

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
    expect(gitCalls).toEqual([['-C', '/repo', 'fetch', 'origin', 'main']]);
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

  it('throws on invalid branch names', async () => {
    const ws = new HerdrWorkspace({
      root: '/repo',
      execHerdr: async () => '',
    });

    await expect(ws.ensure('GL-1', '.hidden')).rejects.toThrow(
      /invalid workspace branch/,
    );
    await expect(ws.ensure('GL-1', 'bakers/../evil')).rejects.toThrow(
      /invalid workspace branch/,
    );
    await expect(ws.ensure('GL-1', 'has space!')).rejects.toThrow(
      /invalid workspace branch/,
    );
  });
});

// BB-139: configurable startup layout for the workspace's initial pane on a
// FRESH worktree open. Realises the spec `test` comment's Gherkin scenarios as
// Vitest units over `ensure()` with a mocked `execHerdr`.
// BB-234: the UNSET case is no longer the bare tab — it is the shipped
// `DEFAULT_OPEN_LAYOUT` deep link `bakers ui --ticket {identifier}`, rendered from
// the identifier `ensure()` receives. `open: {}` is the opt-out back to the bare
// tab.
describe('HerdrWorkspace open layout (BB-139/BB-234)', () => {
  /** Fresh-create fake: empty list, then a create carrying root_pane.pane_id. */
  function freshCreateHerdr(
    calls: string[][],
    opts: { throwOnRun?: boolean; createdPath: string },
  ) {
    return async (args: string[]): Promise<string> => {
      calls.push(args);
      if (args.includes('list')) return listEmpty();
      if (args.includes('create'))
        return createResponse('bakers/GL-9', opts.createdPath);
      if (args[0] === 'pane' && args[1] === 'run' && opts.throwOnRun) {
        throw new Error('herdr pane run failed');
      }
      if (args[0] === 'pane' && args[1] === 'split') {
        return JSON.stringify({ result: { pane: { pane_id: 'split-1' } } });
      }
      return '';
    };
  }

  const CHECKOUT = '/repo/.bakers-worktrees/bakers/GL-9';

  /**
   * BB-237: the layout is no longer applied inside `ensure()` — the conductor
   * applies it AFTER the `after_create` hook, so the hook-built CLI exists by
   * the time the pane command fires. These tests therefore drive the real
   * two-call sequence the conductor drives.
   */
  async function ensureAndOpen(
    ws: BbWorkspace,
    identifier: string,
    branch: string,
    title = 'Fix the labels',
  ) {
    const result = await ws.ensure(identifier, branch);
    // The herdr workspace MUST implement it: a missing method would mean the
    // layout silently never runs, which is precisely the defect being fixed.
    expect(ws.applyOpenLayout).toBeTypeOf('function');
    await ws.applyOpenLayout?.(result.path, { identifier, branch, title });
    return result;
  }

  // AC-1, AC-2, AC-4
  it('launches the configured command in the initial root pane on a fresh worktree', async () => {
    const calls: string[][] = [];
    const ws = new HerdrWorkspace({
      root: '/repo',
      open: { command: 'spiceedit' },
      execHerdr: freshCreateHerdr(calls, { createdPath: CHECKOUT }),
      execGit: async () => '',
    });

    const result = await ensureAndOpen(ws, 'GL-9', 'bakers/GL-9');

    expect(result.created).toBe(true);
    // spiceedit runs in the create's root pane (pane-1) …
    expect(calls).toContainEqual(['pane', 'run', 'pane-1', 'spiceedit']);
    // … and its cwd is the worktree checkout (the root pane's cwd is already the
    // checkout — no split needed for a main-pane command).
  });

  // AC-1, AC-2, AC-4
  it('splits configured panes with the checkout as cwd and runs their commands', async () => {
    const calls: string[][] = [];
    const ws = new HerdrWorkspace({
      root: '/repo',
      open: {
        command: 'spiceedit',
        panes: [{ direction: 'right', command: 'tail -f log' }],
      },
      execHerdr: freshCreateHerdr(calls, { createdPath: CHECKOUT }),
      execGit: async () => '',
    });

    await ensureAndOpen(ws, 'GL-9', 'bakers/GL-9');

    const split = calls.find((c) => c[0] === 'pane' && c[1] === 'split');
    expect(split).toBeDefined();
    expect(split?.[2]).toBe('pane-1');
    expect((split as string[])[(split as string[]).indexOf('--cwd') + 1]).toBe(
      CHECKOUT,
    );
    expect(calls).toContainEqual(['pane', 'run', 'split-1', 'tail -f log']);
  });

  // BB-64 guard: the open-layout panes are the HUMAN's — they are where you
  // land when a worktree opens. Only the executor's per-run agent panes carry
  // `BB_AGENT_SHELL`, whose opt-in unsets HISTFILE; marking these too would
  // silently drop the history of a pane the user types in. `applyPaneLayout` is
  // shared between both callers, so this pins the asymmetry.
  it('never marks the open-layout panes as agent shells', async () => {
    const calls: string[][] = [];
    const ws = new HerdrWorkspace({
      root: '/repo',
      open: {
        command: 'spiceedit',
        panes: [{ direction: 'right', command: 'tail -f log' }],
      },
      execHerdr: freshCreateHerdr(calls, { createdPath: CHECKOUT }),
      execGit: async () => '',
    });

    await ensureAndOpen(ws, 'GL-9', 'bakers/GL-9');

    expect(calls.flat().join(' ')).not.toContain('BB_AGENT_SHELL');
  });

  // BB-234 AC-1, AC-8: the shipped default renders the ticket deep link.
  it('renders the ticket deep link in the initial pane when no open layout is configured', async () => {
    const calls: string[][] = [];
    const ws = new HerdrWorkspace({
      root: '/repo',
      execHerdr: freshCreateHerdr(calls, { createdPath: CHECKOUT }),
      execGit: async () => '',
    });

    await ensureAndOpen(ws, 'GL-9', 'bakers/GL-9');

    expect(calls).toContainEqual([
      'pane',
      'run',
      'pane-1',
      'bakers ui --ticket GL-9',
    ]);
  });

  // BB-234 AC-2, AC-8: the identifier is the one PASSED, never one derived
  // back out of the branch or the checkout path — the reason spec D1 rejected
  // `--here`, whose branch parse returns null for a branch carrying no id.
  it('renders the passed identifier, not one derived from the branch or path', async () => {
    const calls: string[][] = [];
    const branch = 'bakers/GL-9';
    const ws = new HerdrWorkspace({
      root: '/repo',
      execHerdr: freshCreateHerdr(calls, { createdPath: CHECKOUT }),
      execGit: async () => '',
    });

    await ensureAndOpen(ws, 'ZZ-7', branch);

    // The identifier is recoverable from NEITHER of the two things a derivation
    // could read, so the assertion below can only pass via the passed value.
    expect(branch).not.toContain('ZZ-7');
    expect(CHECKOUT).not.toContain('ZZ-7');
    expect(calls).toContainEqual([
      'pane',
      'run',
      'pane-1',
      'bakers ui --ticket ZZ-7',
    ]);
  });

  // BB-234 AC-8: a CONFIGURED root command is templated too — the render
  // happens in the workspace (spec D2), not inside applyPaneLayout.
  it('expands {identifier} in a configured open command', async () => {
    const calls: string[][] = [];
    const ws = new HerdrWorkspace({
      root: '/repo',
      open: { command: 'bakers ui --ticket {identifier} --view teaser' },
      execHerdr: freshCreateHerdr(calls, { createdPath: CHECKOUT }),
      execGit: async () => '',
    });

    await ensureAndOpen(ws, 'GL-9', 'bakers/GL-9');

    expect(calls).toContainEqual([
      'pane',
      'run',
      'pane-1',
      'bakers ui --ticket GL-9 --view teaser',
    ]);
  });

  // BB-234 AC-8, spec D3: `identifier` joins the shared layout vars, so a
  // configured split pane can use it on the same terms as the root command.
  it('expands {identifier} in a configured split pane command', async () => {
    const calls: string[][] = [];
    const ws = new HerdrWorkspace({
      root: '/repo',
      open: {
        panes: [
          { direction: 'right', command: 'bakers ui --ticket {identifier}' },
        ],
      },
      execHerdr: freshCreateHerdr(calls, { createdPath: CHECKOUT }),
      execGit: async () => '',
    });

    await ensureAndOpen(ws, 'GL-9', 'bakers/GL-9');

    expect(calls).toContainEqual([
      'pane',
      'run',
      'split-1',
      'bakers ui --ticket GL-9',
    ]);
  });

  // BB-234 AC-6, spec D2 non-regression: `renderTemplate` leaves an unknown
  // `{key}` verbatim, so a brace-bearing root command round-trips untouched.
  // This is the property that lets the executor keep pre-assembling
  // `KEY='{"a":1}' <agent>` env prefixes without them being rewritten.
  it("leaves the root command's braces alone when the key is unknown", async () => {
    const calls: string[][] = [];
    const command = 'X Y=\'{"a":1}\' z';
    const ws = new HerdrWorkspace({
      root: '/repo',
      open: { command },
      execHerdr: freshCreateHerdr(calls, { createdPath: CHECKOUT }),
      execGit: async () => '',
    });

    await ensureAndOpen(ws, 'GL-9', 'bakers/GL-9');

    expect(calls).toContainEqual(['pane', 'run', 'pane-1', command]);
  });

  // BB-234 AC-1, spec D4: `open: {}` is the documented opt-out back to the
  // pre-BB-234 bare tab. The assertion that used to guard the UNSET case
  // moves here rather than disappearing.
  it('leaves the empty tab unchanged when open is explicitly empty', async () => {
    const calls: string[][] = [];
    const ws = new HerdrWorkspace({
      root: '/repo',
      open: {},
      execHerdr: freshCreateHerdr(calls, { createdPath: CHECKOUT }),
      execGit: async () => '',
    });

    await ensureAndOpen(ws, 'GL-9', 'bakers/GL-9');

    // No pane split, no pane run — the bare empty tab opens as before.
    expect(calls.some((c) => c[0] === 'pane')).toBe(false);
  });

  // Trigger decision: fresh create only.
  it('does not re-apply the layout when the worktree is reused', async () => {
    const calls: string[][] = [];
    const ws = new HerdrWorkspace({
      root: '/repo',
      open: { command: 'spiceedit' },
      execHerdr: async (args) => {
        calls.push(args);
        if (args.includes('list'))
          return listWithEntry('bakers/GL-9', CHECKOUT, 'ws-open');
        return '';
      },
      execGit: async () => '',
    });

    const result = await ensureAndOpen(ws, 'GL-9', 'bakers/GL-9');

    expect(result.created).toBe(false);
    // No open-layout command run, no split — reuse never re-applies the layout.
    expect(calls.some((c) => c[0] === 'pane')).toBe(false);
  });

  // Failure decision: best-effort.
  it('a failing startup command does not break worktree creation (logged, not thrown)', async () => {
    const calls: string[][] = [];
    const warnings: Array<Record<string, unknown>> = [];
    const logger: ConductorLogger = {
      debug() {},
      info() {},
      warn(obj: object) {
        warnings.push(obj as Record<string, unknown>);
      },
      error() {},
    };
    const ws = new HerdrWorkspace({
      root: '/repo',
      open: { command: 'spiceedit' },
      execHerdr: freshCreateHerdr(calls, {
        createdPath: CHECKOUT,
        throwOnRun: true,
      }),
      execGit: async () => '',
      logger,
    });

    // ensure() still resolves with the created worktree, and applyOpenLayout
    // still resolves despite the failing pane command.
    const result = await ensureAndOpen(ws, 'GL-9', 'bakers/GL-9');
    expect(result.created).toBe(true);
    expect(result.path).toBe(CHECKOUT);
    // The failure is logged, not thrown.
    expect(warnings).toHaveLength(1);
    expect(String(warnings[0]?.err)).toContain('herdr pane run failed');
  });

  // BB-234 AC-4, spec D6: the warn above only reaches a real log if the
  // CONDUCTOR's logger is handed to the plugin factory. Before BB-234
  // `createWorkspace` took no deps, so in production the warn went to the noop
  // logger — swallowed AND invisible, which makes AC-4 unsatisfiable.
  it('logs the swallowed failure through the injected conductor logger', async () => {
    const calls: string[][] = [];
    const warnings: Array<Record<string, unknown>> = [];
    const logger: ConductorLogger = {
      debug() {},
      info() {},
      warn(obj: object) {
        warnings.push(obj as Record<string, unknown>);
      },
      error() {},
    };

    const plugin = herdrWorkspace({
      root: '/repo',
      execHerdr: freshCreateHerdr(calls, {
        createdPath: CHECKOUT,
        throwOnRun: true,
      }),
      execGit: async () => '/repo/.git\n',
    });
    const ws = await plugin.createWorkspace(
      { config_path: '/repo/.bakers/conductor.config.js' } as never,
      { logger },
    );

    const result = await ensureAndOpen(ws, 'GL-9', 'bakers/GL-9');

    expect(result.created).toBe(true);
    expect(warnings).toHaveLength(1);
    expect(String(warnings[0]?.err)).toContain('herdr pane run failed');
  });

  // --- BB-237: the layout moved OUT of ensure() ---------------------------

  it('ensure() alone applies NO layout — it only captures the root pane', async () => {
    // BB-237. This is the property the whole ordering fix rests on: the pane
    // command must not fire until the conductor has run `after_create` (which
    // builds the CLI the command names). While the layout lived inside
    // `ensure()` the two ran in the wrong order across two processes, and the
    // only available remedy was a sentinel wait loop in the pane command.
    const calls: string[][] = [];
    const ws = new HerdrWorkspace({
      root: '/repo',
      open: { command: 'spiceedit' },
      execHerdr: freshCreateHerdr(calls, { createdPath: CHECKOUT }),
      execGit: async () => '',
    });

    const result = await ws.ensure('GL-9', 'bakers/GL-9');

    expect(result.created).toBe(true);
    expect(calls.some((c) => c[0] === 'pane')).toBe(false);

    // ...and the captured root pane is still there to be used afterwards.
    await ws.applyOpenLayout(result.path, {
      identifier: 'GL-9',
      branch: 'bakers/GL-9',
      title: 'Fix the labels',
    });
    expect(calls).toContainEqual(['pane', 'run', 'pane-1', 'spiceedit']);
  });

  it('applyOpenLayout is a silent no-op when no root pane was captured', async () => {
    // The reused-worktree case: `ensure` took the reuse branch, so there is no
    // fresh root pane and nothing to lay out. Preserves the pre-BB-237
    // behaviour that the layout is applied on a FRESH create only — no
    // duplicate editor process on reattach.
    const calls: string[][] = [];
    const ws = new HerdrWorkspace({
      root: '/repo',
      open: { command: 'spiceedit' },
      execHerdr: async (args) => {
        calls.push(args);
        if (args.includes('list'))
          return listWithEntry('bakers/GL-9', CHECKOUT, 'ws-open');
        return '';
      },
      execGit: async () => '',
    });

    const result = await ws.ensure('GL-9', 'bakers/GL-9');
    expect(result.created).toBe(false);

    await expect(
      ws.applyOpenLayout(result.path, {
        identifier: 'GL-9',
        branch: 'bakers/GL-9',
        title: 'Fix the labels',
      }),
    ).resolves.toBeUndefined();
    expect(calls.some((c) => c[0] === 'pane')).toBe(false);
  });

  it('the factory falls back to DEFAULT_OPEN_LAYOUT when the slot configures no open key', async () => {
    // BB-237: bakers's own `.bakers/conductor.config.js` used to override `open`
    // with a sentinel wait loop; once the ordering was fixed the override became
    // byte-identical to the shipped default and was DELETED. This pins that
    // deleting it is not a silent behaviour change — the factory path with no
    // `with.open` must still render the ticket deep link — and that bakers cannot
    // silently stop following the default if it ever changes.
    const calls: string[][] = [];
    const plugin = herdrWorkspace({
      root: '/repo',
      execHerdr: freshCreateHerdr(calls, { createdPath: CHECKOUT }),
      execGit: async () => '/repo/.git\n',
    });
    const ws = await plugin.createWorkspace({
      config_path: '/repo/.bakers/conductor.config.js',
    } as never);

    await ensureAndOpen(ws, 'GL-9', 'bakers/GL-9');

    expect(calls).toContainEqual([
      'pane',
      'run',
      'pane-1',
      'bakers ui --ticket GL-9',
    ]);
    expect(DEFAULT_OPEN_LAYOUT.command).toBe('bakers ui --ticket {identifier}');
  });

  it('applyOpenLayout consumes the captured pane — a second call is a no-op', async () => {
    // The capture is one-shot, so an accidental double call cannot start a
    // second editor in the same pane, and the map cannot grow unboundedly.
    const calls: string[][] = [];
    const ws = new HerdrWorkspace({
      root: '/repo',
      open: { command: 'spiceedit' },
      execHerdr: freshCreateHerdr(calls, { createdPath: CHECKOUT }),
      execGit: async () => '',
    });
    const ctx = {
      identifier: 'GL-9',
      branch: 'bakers/GL-9',
      title: 'Fix the labels',
    };

    const result = await ws.ensure('GL-9', 'bakers/GL-9');
    await ws.applyOpenLayout(result.path, ctx);
    await ws.applyOpenLayout(result.path, ctx);

    expect(calls.filter((c) => c[0] === 'pane' && c[1] === 'run')).toHaveLength(
      1,
    );
  });
});

// BB-374: overview tab + pane (panel) labels on fresh open only.
describe('HerdrWorkspace overview labels (BB-374)', () => {
  const CHECKOUT = '/repo/.bakers-worktrees/bakers/GL-9';

  function freshCreateHerdr(
    calls: string[][],
    opts: {
      createdPath: string;
      throwOnRename?: 'tab' | 'pane' | 'both';
    },
  ) {
    return async (args: string[]): Promise<string> => {
      calls.push(args);
      if (args.includes('list')) return listEmpty();
      if (args.includes('create'))
        return createResponse('bakers/GL-9', opts.createdPath);
      if (args[0] === 'pane' && args[1] === 'split') {
        return JSON.stringify({ result: { pane: { pane_id: 'split-1' } } });
      }
      if (
        args[0] === 'tab' &&
        args[1] === 'rename' &&
        (opts.throwOnRename === 'tab' || opts.throwOnRename === 'both')
      ) {
        throw new Error('herdr tab rename failed');
      }
      if (
        args[0] === 'pane' &&
        args[1] === 'rename' &&
        (opts.throwOnRename === 'pane' || opts.throwOnRename === 'both')
      ) {
        throw new Error('herdr pane rename failed');
      }
      return '';
    };
  }

  async function ensureAndOpen(
    ws: BbWorkspace,
    identifier: string,
    branch: string,
    title: string,
  ) {
    const result = await ws.ensure(identifier, branch);
    await ws.applyOpenLayout?.(result.path, { identifier, branch, title });
    return result;
  }

  it('renames the overview tab to identifier · title on fresh open', async () => {
    const calls: string[][] = [];
    const ws = new HerdrWorkspace({
      root: '/repo',
      execHerdr: freshCreateHerdr(calls, { createdPath: CHECKOUT }),
      execGit: async () => '',
    });

    await ensureAndOpen(ws, 'GL-9', 'bakers/GL-9', 'Fix the labels');

    expect(calls).toContainEqual([
      'tab',
      'rename',
      'tab-overview-1',
      'GL-9 · Fix the labels',
    ]);
  });

  it('truncates the overview tab title to 30 characters', async () => {
    const calls: string[][] = [];
    const ws = new HerdrWorkspace({
      root: '/repo',
      execHerdr: freshCreateHerdr(calls, { createdPath: CHECKOUT }),
      execGit: async () => '',
    });
    const longTitle =
      'herdr: Ticket overview pane label + panel labels for ticket identity';

    await ensureAndOpen(ws, 'BB-374', 'feat/bb-374', longTitle);

    expect(calls).toContainEqual([
      'tab',
      'rename',
      'tab-overview-1',
      `BB-374 · ${longTitle.slice(0, 30)}...`,
    ]);
    expect(calls).toContainEqual([
      'pane',
      'rename',
      'pane-1',
      `BB-374 · ${longTitle}`,
    ]);
  });

  it('renames the overview pane to the full ticket label', async () => {
    const calls: string[][] = [];
    const ws = new HerdrWorkspace({
      root: '/repo',
      execHerdr: freshCreateHerdr(calls, { createdPath: CHECKOUT }),
      execGit: async () => '',
    });

    await ensureAndOpen(ws, 'GL-9', 'bakers/GL-9', 'Fix the labels');

    expect(calls).toContainEqual([
      'pane',
      'rename',
      'pane-1',
      'GL-9 · Fix the labels',
    ]);
  });

  it('does not rename tab or pane on reuse', async () => {
    const calls: string[][] = [];
    const ws = new HerdrWorkspace({
      root: '/repo',
      execHerdr: async (args) => {
        calls.push(args);
        if (args.includes('list'))
          return listWithEntry('bakers/GL-9', CHECKOUT, 'ws-open');
        return '';
      },
      execGit: async () => '',
    });

    const result = await ensureAndOpen(
      ws,
      'GL-9',
      'bakers/GL-9',
      'Fix the labels',
    );

    expect(result.created).toBe(false);
    expect(
      calls.some(
        (c) =>
          (c[0] === 'tab' && c[1] === 'rename') ||
          (c[0] === 'pane' && c[1] === 'rename'),
      ),
    ).toBe(false);
  });

  it('honours open.tabLabel and open.panelLabel templates', async () => {
    const calls: string[][] = [];
    const ws = new HerdrWorkspace({
      root: '/repo',
      open: {
        command: 'bakers ui --ticket {identifier}',
        tabLabel: 'Overview · {identifier}',
        panelLabel: '{title} ({identifier})',
      },
      execHerdr: freshCreateHerdr(calls, { createdPath: CHECKOUT }),
      execGit: async () => '',
    });

    await ensureAndOpen(ws, 'GL-9', 'bakers/GL-9', 'Fix the labels');

    expect(calls).toContainEqual([
      'tab',
      'rename',
      'tab-overview-1',
      'Overview · GL-9',
    ]);
    expect(calls).toContainEqual([
      'pane',
      'rename',
      'pane-1',
      'Fix the labels (GL-9)',
    ]);
  });

  it('swallows rename failures without failing applyOpenLayout', async () => {
    const calls: string[][] = [];
    const warnings: Array<Record<string, unknown>> = [];
    const logger: ConductorLogger = {
      debug() {},
      info() {},
      warn(obj: object) {
        warnings.push(obj as Record<string, unknown>);
      },
      error() {},
    };
    const ws = new HerdrWorkspace({
      root: '/repo',
      execHerdr: freshCreateHerdr(calls, {
        createdPath: CHECKOUT,
        throwOnRename: 'both',
      }),
      execGit: async () => '',
      logger,
    });

    await expect(
      ensureAndOpen(ws, 'GL-9', 'bakers/GL-9', 'Fix the labels'),
    ).resolves.toBeDefined();
    // Layout command still ran; rename failures did not abort applyOpenLayout.
    expect(calls).toContainEqual([
      'pane',
      'run',
      'pane-1',
      'bakers ui --ticket GL-9',
    ]);
    expect(warnings.length).toBeGreaterThanOrEqual(1);
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
    expect(calls).toContainEqual(['-C', '/repo', 'fetch', 'origin', 'release']);
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
