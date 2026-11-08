import type {
  EnsuredWorkspace,
  OpenWorkspaceContext,
} from '@bakers-build/conductor/contract';
import type { ConductorLogger } from '@bakers-build/core';
import { describe, expect, it } from 'vitest';
import herdrExecutor, { HerdrExecutor } from '../src/index.js';
import { DEFAULT_OPEN_LAYOUT, type OpenLayout } from '../src/open-layout.js';
import herdrWorkspace, { HerdrWorkspace } from '../src/workspace.js';

// The open layout moved from the herdr workspace to `HerdrExecutor.openWorkspace`.
// These cases drive a herdr workspace and a herdr executor sharing one fake
// herdr, exactly as the conductor does: ensure, then openWorkspace on create.

const quiet: ConductorLogger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

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
      root_pane: { pane_id: 'pane-1', tab_id: 'tab-overview-1' },
      tab: { tab_id: 'tab-overview-1' },
    },
  });
}

/** `pane list` of the fresh workspace: its single root pane by default. */
function paneList(
  panes: unknown[] = [{ pane_id: 'pane-1', tab_id: 'tab-overview-1' }],
): string {
  return JSON.stringify({ result: { panes } });
}

interface Pair {
  ensure(identifier: string, branch?: string): Promise<EnsuredWorkspace>;
  openWorkspace(path: string, ctx: OpenWorkspaceContext): Promise<void>;
}

/** A herdr workspace (ensure) and a herdr executor (openWorkspace) on one herdr. */
function herdrPair(opts: {
  root: string;
  open?: OpenLayout;
  execHerdr: (args: string[]) => Promise<string>;
  execGit: (args: string[]) => Promise<string>;
  logger?: ConductorLogger;
  autoSetupMerge?: boolean;
}): Pair {
  const ws = new HerdrWorkspace({
    root: opts.root,
    execHerdr: opts.execHerdr,
    execGit: opts.execGit,
    ...(opts.logger ? { logger: opts.logger } : {}),
    // `/repo` is no repository: leave Git config alone.
    autoSetupMerge: opts.autoSetupMerge ?? true,
  });
  const executor = new HerdrExecutor(
    { root: opts.root, ...(opts.open ? { open: opts.open } : {}) },
    opts.execHerdr,
    opts.logger ?? quiet,
  );
  return {
    ensure: (identifier, branch) => ws.ensure(identifier, branch),
    openWorkspace: (path, ctx) => executor.openWorkspace(path, ctx),
  };
}

/** The same pair through both plugin factories, with no `open` configured. */
async function factoryPair(
  execHerdr: (args: string[]) => Promise<string>,
  logger: ConductorLogger = quiet,
): Promise<Pair> {
  const config = { config_path: '/repo/.bakers/conductor.config.js' } as never;
  const ws = await herdrWorkspace({
    root: '/repo',
    execHerdr,
    execGit: async () => '/repo/.git\n',
    autoSetupMerge: true,
  }).createWorkspace(config, { logger });
  const executor = await herdrExecutor({ root: '/repo' }).createExecutor(
    config,
    { logger },
  );
  // The factory's executor talks to the real herdr; swap in the fake.
  (executor as unknown as { execHerdr: typeof execHerdr }).execHerdr =
    execHerdr;
  return {
    ensure: (identifier, branch) => ws.ensure(identifier, branch),
    openWorkspace: (path, ctx) =>
      (executor.openWorkspace as NonNullable<typeof executor.openWorkspace>)(
        path,
        ctx,
      ),
  };
}

describe('HerdrExecutor.openWorkspace layout (BB-139/BB-234)', () => {
  /** Fresh-create fake: empty list, then a create carrying root_pane.pane_id. */
  function freshCreateHerdr(
    calls: string[][],
    opts: { throwOnRun?: boolean; createdPath: string; panes?: unknown[] },
  ) {
    let created = false;
    return async (args: string[]): Promise<string> => {
      calls.push(args);
      if (args[0] === 'pane' && args[1] === 'list') return paneList(opts.panes);
      if (args.includes('list'))
        return created
          ? listWithEntry('bakers/GL-9', opts.createdPath, 'ws-new')
          : listEmpty();
      if (args.includes('create')) {
        created = true;
        return createResponse('bakers/GL-9', opts.createdPath);
      }
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
   * BB-237: the layout is not applied inside `ensure()` — the conductor calls
   * `executor.openWorkspace` AFTER the `after_create` hook, and only on a
   * created worktree, so the hook-built CLI exists by the time the pane command
   * fires. These tests therefore drive the real two-call sequence the
   * conductor drives.
   */
  async function ensureAndOpen(
    ws: Pair,
    identifier: string,
    branch: string,
    title = 'Fix the labels',
  ) {
    const result = await ws.ensure(identifier, branch);
    // The herdr executor MUST implement it: a missing method would mean the
    // layout silently never runs, which is precisely the defect being fixed.
    expect(ws.openWorkspace).toBeTypeOf('function');
    if (result.created) {
      await ws.openWorkspace(result.path, { identifier, branch, title });
    }
    return result;
  }

  // AC-1, AC-2, AC-4
  it('launches the configured command in the initial root pane on a fresh worktree', async () => {
    const calls: string[][] = [];
    const ws = herdrPair({
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
    const ws = herdrPair({
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
    const ws = herdrPair({
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
    const ws = herdrPair({
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
    const ws = herdrPair({
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
    const ws = herdrPair({
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
    const ws = herdrPair({
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
    const ws = herdrPair({
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
    const ws = herdrPair({
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
    const ws = herdrPair({
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
    const ws = herdrPair({
      root: '/repo',
      open: { command: 'spiceedit' },
      execHerdr: freshCreateHerdr(calls, {
        createdPath: CHECKOUT,
        throwOnRun: true,
      }),
      execGit: async () => '',
      logger,
      autoSetupMerge: true, // `/repo` is no repository; count only layout warnings
    });

    // ensure() still resolves with the created worktree, and openWorkspace
    // still resolves despite the failing pane command.
    const result = await ensureAndOpen(ws, 'GL-9', 'bakers/GL-9');
    expect(result.created).toBe(true);
    expect(result.path).toBe(CHECKOUT);
    // The failure is logged, not thrown.
    expect(warnings).toHaveLength(1);
    expect(String(warnings[0]?.err)).toContain('herdr pane run failed');
  });

  // BB-234 AC-4, spec D6: the warn above only reaches a real log if the
  // CONDUCTOR's logger is handed to the plugin factory — here the executor's,
  // which now owns the layout.
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

    const ws = await factoryPair(
      freshCreateHerdr(calls, { createdPath: CHECKOUT, throwOnRun: true }),
      logger,
    );

    const result = await ensureAndOpen(ws, 'GL-9', 'bakers/GL-9');

    expect(result.created).toBe(true);
    expect(warnings).toHaveLength(1);
    expect(String(warnings[0]?.err)).toContain('herdr pane run failed');
  });

  // --- BB-237: the layout moved OUT of ensure() ---------------------------

  it('ensure() alone applies NO layout — openWorkspace applies it afterwards', async () => {
    // BB-237. This is the property the whole ordering fix rests on: the pane
    // command must not fire until the conductor has run `after_create` (which
    // builds the CLI the command names). While the layout lived inside
    // `ensure()` the two ran in the wrong order across two processes, and the
    // only available remedy was a sentinel wait loop in the pane command.
    const calls: string[][] = [];
    const ws = herdrPair({
      root: '/repo',
      open: { command: 'spiceedit' },
      execHerdr: freshCreateHerdr(calls, { createdPath: CHECKOUT }),
      execGit: async () => '',
    });

    const result = await ws.ensure('GL-9', 'bakers/GL-9');

    expect(result.created).toBe(true);
    expect(calls.some((c) => c[0] === 'pane')).toBe(false);

    // ...and the workspace's root pane is laid out afterwards.
    await ws.openWorkspace(result.path, {
      identifier: 'GL-9',
      branch: 'bakers/GL-9',
      title: 'Fix the labels',
    });
    expect(calls).toContainEqual(['pane', 'run', 'pane-1', 'spiceedit']);
  });

  it('openWorkspace is a silent no-op when herdr reports no pane for the workspace', async () => {
    // Nothing to lay out is not a failure: no pane command, nothing thrown.
    const calls: string[][] = [];
    const warnings: unknown[] = [];
    const ws = herdrPair({
      root: '/repo',
      open: { command: 'spiceedit' },
      execHerdr: freshCreateHerdr(calls, { createdPath: CHECKOUT, panes: [] }),
      execGit: async () => '',
      logger: { ...quiet, warn: (o: object) => warnings.push(o) },
    });

    const result = await ws.ensure('GL-9', 'bakers/GL-9');
    await expect(
      ws.openWorkspace(result.path, {
        identifier: 'GL-9',
        branch: 'bakers/GL-9',
        title: 'Fix the labels',
      }),
    ).resolves.toBeUndefined();
    expect(calls.some((c) => c[0] === 'pane' && c[1] !== 'list')).toBe(false);
    expect(warnings).toEqual([]);
  });

  it('opens and lays out a worktree herdr did not create (any workspace)', async () => {
    // AC8: the worktree came from another workspace (git); herdr has no open
    // workspace for it, so openWorkspace opens it from the parent root and
    // lays out the root pane `worktree open` reports.
    const calls: string[][] = [];
    const executor = new HerdrExecutor(
      { root: '/repo', open: { command: 'spiceedit' } },
      async (args) => {
        calls.push(args);
        if (args[0] === 'worktree' && args[1] === 'list') return listEmpty();
        if (args[0] === 'worktree' && args[1] === 'open') {
          return JSON.stringify({
            result: {
              workspace: { workspace_id: 'w7' },
              root_pane: { pane_id: 'w7:p1', tab_id: 'w7:t1' },
            },
          });
        }
        return '';
      },
    );

    await executor.openWorkspace('/repo-worktrees/GL-9', {
      identifier: 'GL-9',
      branch: 'bakers/GL-9-fix',
      title: 'Fix the labels',
    });

    expect(calls).toContainEqual([
      'worktree',
      'open',
      '--cwd',
      '/repo',
      '--branch',
      'bakers/GL-9-fix',
      '--no-focus',
      '--json',
    ]);
    expect(calls).toContainEqual(['pane', 'run', 'w7:p1', 'spiceedit']);
    expect(calls).toContainEqual([
      'tab',
      'rename',
      'w7:t1',
      'GL-9 · Fix the labels',
    ]);
  });

  it('the factory falls back to DEFAULT_OPEN_LAYOUT when the slot configures no open key', async () => {
    // BB-237: bakers's own `.bakers/conductor.config.js` used to override `open`
    // with a sentinel wait loop; once the ordering was fixed the override became
    // byte-identical to the shipped default and was DELETED. This pins that
    // deleting it is not a silent behaviour change — the factory path with no
    // `with.open` must still render the ticket deep link — and that bakers cannot
    // silently stop following the default if it ever changes.
    const calls: string[][] = [];
    const ws = await factoryPair(
      freshCreateHerdr(calls, { createdPath: CHECKOUT }),
    );

    await ensureAndOpen(ws, 'GL-9', 'bakers/GL-9');

    expect(calls).toContainEqual([
      'pane',
      'run',
      'pane-1',
      'bakers ui --ticket GL-9',
    ]);
    expect(DEFAULT_OPEN_LAYOUT.command).toBe('bakers ui --ticket {identifier}');
  });
});

// BB-374: overview tab + pane (panel) labels on fresh open only.
describe('HerdrExecutor.openWorkspace overview labels (BB-374)', () => {
  const CHECKOUT = '/repo/.bakers-worktrees/bakers/GL-9';

  function freshCreateHerdr(
    calls: string[][],
    opts: {
      createdPath: string;
      throwOnRename?: 'tab' | 'pane' | 'both';
      panes?: unknown[];
    },
  ) {
    let created = false;
    return async (args: string[]): Promise<string> => {
      calls.push(args);
      if (args[0] === 'pane' && args[1] === 'list') return paneList(opts.panes);
      if (args.includes('list'))
        return created
          ? listWithEntry('bakers/GL-9', opts.createdPath, 'ws-new')
          : listEmpty();
      if (args.includes('create')) {
        created = true;
        return createResponse('bakers/GL-9', opts.createdPath);
      }
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
    ws: Pair,
    identifier: string,
    branch: string,
    title: string,
  ) {
    const result = await ws.ensure(identifier, branch);
    if (result.created) {
      await ws.openWorkspace(result.path, { identifier, branch, title });
    }
    return result;
  }

  it('renames the overview tab to identifier · title on fresh open', async () => {
    const calls: string[][] = [];
    const ws = herdrPair({
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
    const ws = herdrPair({
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
    const ws = herdrPair({
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
    const ws = herdrPair({
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
    const ws = herdrPair({
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

  it('swallows rename failures without failing openWorkspace', async () => {
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
    const ws = herdrPair({
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
    // Layout command still ran; rename failures did not abort openWorkspace.
    expect(calls).toContainEqual([
      'pane',
      'run',
      'pane-1',
      'bakers ui --ticket GL-9',
    ]);
    expect(warnings.length).toBeGreaterThanOrEqual(1);
  });
});
