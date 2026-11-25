import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GitWorkspace } from '@bakers-build/addon-workspace-git';
import type { ConductorLogger } from '@bakers-build/core';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { HerdrExecutor } from '../src/index.js';

// With workspace-git as the workspace addon, the reaper removes the git
// worktree and then asks the herdr executor to close the branch workspace it
// opened (closeWorkspace), and once per process to close older leftovers
// (sweepWorkspaces).

let base: string;
let root: string;
const BRANCH = 'feat/bb-1-one';
const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'bakers-herdr-close-'));
  root = join(base, 'repo');
  mkdirSync(root);
  git(root, 'init', '-q', '-b', 'main');
  writeFileSync(join(root, '.gitignore'), '/.bakers-worktrees/\n');
  git(root, 'add', '.');
  git(root, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'b');
});
afterEach(() => rmSync(base, { recursive: true, force: true }));

interface FakeWorkspace {
  id: string;
  label: string;
  path: string;
  linked?: boolean;
  focused?: boolean;
  /** Tabs in order; each lists its panes' agent (null = no agent). */
  tabs: Array<{ label: string; panes: Array<string | null> }>;
}

/** A herdr holding workspaces with tabs and panes; records every call. */
function fakeHerdr(
  workspaces: FakeWorkspace[],
  opts: { paneList?: string; focusSticks?: boolean } = {},
) {
  const calls: string[][] = [];
  const byId = (id: string) => workspaces.find((w) => w.id === id);
  const exec = async (args: string[]) => {
    calls.push(args);
    const [noun, verb, id] = args;
    const ws = byId(args[args.indexOf('--workspace') + 1] as string);
    if (noun === 'workspace' && verb === 'list')
      return JSON.stringify({
        result: {
          workspaces: workspaces.map((w) => ({
            workspace_id: w.id,
            label: w.label,
            focused: w.focused === true,
            worktree: {
              is_linked_worktree: w.linked !== false,
              repo_root: root,
              checkout_path: w.path,
            },
          })),
        },
      });
    if (noun === 'workspace' && verb === 'focus') {
      if (opts.focusSticks === false) return '{}';
      for (const w of workspaces) w.focused = w.id === id;
      return '{}';
    }
    if (noun === 'workspace' && verb === 'close') {
      workspaces.splice(
        workspaces.indexOf(byId(id as string) as FakeWorkspace),
        1,
      );
      return '{}';
    }
    if (noun === 'tab' && verb === 'list')
      return JSON.stringify({
        result: {
          tabs: (ws?.tabs ?? []).map((t, i) => ({
            tab_id: `${ws?.id}-t${i}`,
            label: t.label,
          })),
        },
      });
    if (noun === 'pane' && verb === 'list')
      return (
        opts.paneList ??
        JSON.stringify({
          result: {
            panes: (ws?.tabs ?? []).flatMap((t, i) =>
              t.panes.map((agent, j) => ({
                pane_id: `${ws?.id}-p${i}${j}`,
                tab_id: `${ws?.id}-t${i}`,
                agent,
              })),
            ),
          },
        })
      );
    throw new Error(`unexpected herdr ${args.join(' ')}`);
  };
  return { exec, calls, workspaces };
}

function spyLogger() {
  const warnings: Array<{ obj: Record<string, unknown>; msg?: string }> = [];
  const noop = () => {};
  const log: ConductorLogger = {
    debug: noop,
    info: noop,
    error: noop,
    warn: (obj: object, msg?: string) =>
      warnings.push({ obj: obj as Record<string, unknown>, msg }),
  };
  return { log, warnings };
}

const closes = (calls: string[][]) =>
  calls.filter(([n, v]) => n === 'workspace' && v === 'close').map((c) => c[2]);

/** The workspace the executor opened for BRANCH: its bakers ui tab and a finished run's tab. */
function ticketWorkspace(
  path: string,
  extra: Partial<FakeWorkspace> = {},
): FakeWorkspace {
  return {
    id: 'w79',
    label: BRANCH,
    path,
    tabs: [
      { label: 'BB-1 · One', panes: [null] },
      { label: 'BB-1 · working #3', panes: [null] },
    ],
    ...extra,
  };
}

const mainWorkspace = (): FakeWorkspace => ({
  id: 'w1',
  label: 'repo',
  path: root,
  linked: false,
  tabs: [{ label: 'shell', panes: [null] }],
});

async function reapedWorktree(): Promise<string> {
  const workspace = new GitWorkspace({ root });
  const { path } = await workspace.ensure('BB-1', BRANCH);
  expect(await workspace.remove(BRANCH, path)).toBe('removed');
  return path;
}

it('closes the branch workspace once workspace-git removed the worktree', async () => {
  const path = await reapedWorktree();
  const herdr = fakeHerdr([mainWorkspace(), ticketWorkspace(path)]);
  const executor = new HerdrExecutor({ root }, herdr.exec);

  expect(await executor.closeWorkspace(BRANCH, path)).toBe(true);

  expect(closes(herdr.calls)).toEqual(['w79']);
  expect(herdr.workspaces.map((w) => w.id)).toEqual(['w1']);
});

it('finds the workspace by its label when herdr reports another checkout path', async () => {
  const path = await reapedWorktree();
  const herdr = fakeHerdr([ticketWorkspace(join(base, 'elsewhere'))]);
  const executor = new HerdrExecutor({ root }, herdr.exec);

  expect(await executor.closeWorkspace(BRANCH, path)).toBe(true);
  expect(closes(herdr.calls)).toEqual(['w79']);
});

it('no branch workspace is a finished close', async () => {
  const herdr = fakeHerdr([mainWorkspace()]);
  const executor = new HerdrExecutor({ root }, herdr.exec);

  expect(
    await executor.closeWorkspace(
      BRANCH,
      join(root, '.bakers-worktrees', BRANCH),
    ),
  ).toBe(true);
  expect(closes(herdr.calls)).toEqual([]);
});

it('never closes the main checkout workspace, even when its label is the branch', async () => {
  const herdr = fakeHerdr([{ ...mainWorkspace(), label: BRANCH }]);
  const executor = new HerdrExecutor({ root }, herdr.exec);

  expect(await executor.closeWorkspace(BRANCH)).toBe(true);
  expect(closes(herdr.calls)).toEqual([]);
});

it('moves focus to the main checkout workspace before it closes a focused one', async () => {
  const path = await reapedWorktree();
  const herdr = fakeHerdr([
    mainWorkspace(),
    ticketWorkspace(path, { focused: true }),
  ]);
  const executor = new HerdrExecutor({ root }, herdr.exec);

  expect(await executor.closeWorkspace(BRANCH, path)).toBe(true);

  const focus = herdr.calls.findIndex(
    ([n, v]) => n === 'workspace' && v === 'focus',
  );
  const close = herdr.calls.findIndex(
    ([n, v]) => n === 'workspace' && v === 'close',
  );
  expect(herdr.calls[focus]).toEqual(['workspace', 'focus', 'w1']);
  expect(focus).toBeLessThan(close);
  expect(closes(herdr.calls)).toEqual(['w79']);
});

it.each([
  ['no main checkout workspace', [], true],
  ['a focus switch that does not take', [mainWorkspace()], false],
] as const)('keeps a focused workspace and asks for a retry with %s', async (_name, others, focusSticks) => {
  const path = await reapedWorktree();
  const herdr = fakeHerdr(
    [
      ...others.map((w) => ({ ...w })),
      ticketWorkspace(path, { focused: true }),
    ],
    {
      focusSticks,
    },
  );
  const executor = new HerdrExecutor({ root }, herdr.exec);

  expect(await executor.closeWorkspace(BRANCH, path)).toBe(false);
  expect(closes(herdr.calls)).toEqual([]);
});

it.each([
  [
    'a live agent',
    {
      tabs: [
        { label: 'BB-1 · One', panes: [null] },
        { label: 'BB-1 · working #3', panes: ['claude'] },
      ],
    },
    {},
  ],
  [
    'a tab that bakers did not open',
    {
      tabs: [
        { label: 'BB-1 · One', panes: [null] },
        { label: 'notes', panes: [null] },
      ],
    },
    {},
  ],
  [
    'an extra pane in the first tab',
    { tabs: [{ label: 'BB-1 · One', panes: [null, null] }] },
    {},
  ],
  ['an unreadable pane list', {}, { paneList: 'not json' }],
] as const)('keeps a workspace holding %s and reports it', async (reason, extra, opts) => {
  const path = await reapedWorktree();
  const herdr = fakeHerdr(
    [ticketWorkspace(path, extra as Partial<FakeWorkspace>)],
    opts as { paneList?: string },
  );
  const { log, warnings } = spyLogger();
  const executor = new HerdrExecutor({ root }, herdr.exec, log);

  expect(await executor.closeWorkspace(BRANCH, path), reason).toBe(true);

  expect(closes(herdr.calls)).toEqual([]);
  expect(warnings).toHaveLength(1);
  expect(warnings[0]?.obj).toMatchObject({ workspace: 'w79' });
  expect(warnings[0]?.obj.reason).toEqual(expect.any(String));
});

it('allows the open layout its configured split panes in the first tab', async () => {
  const path = await reapedWorktree();
  const herdr = fakeHerdr([
    ticketWorkspace(path, {
      tabs: [{ label: 'BB-1 · One', panes: [null, null] }],
    }),
  ]);
  const executor = new HerdrExecutor(
    {
      root,
      open: {
        command: 'bakers ui',
        panes: [{ direction: 'right', command: 'lazygit' }],
      },
    },
    herdr.exec,
  );

  expect(await executor.closeWorkspace(BRANCH, path)).toBe(true);
  expect(closes(herdr.calls)).toEqual(['w79']);
});

it('the sweep closes only leftovers: a missing checkout under the worktree dir with the bakers ui tab alone', async () => {
  const worktrees = join(root, '.bakers-worktrees');
  const present = join(worktrees, 'feat/bb-2-here');
  mkdirSync(present, { recursive: true });
  const leftover = (
    id: string,
    path: string,
    extra: Partial<FakeWorkspace> = {},
  ): FakeWorkspace => ({
    id,
    label: id,
    path,
    tabs: [{ label: `${id} · ui`, panes: [null] }],
    ...extra,
  });
  const herdr = fakeHerdr([
    mainWorkspace(),
    leftover('gone', join(worktrees, 'feat/bb-3-gone')),
    leftover('here', present),
    leftover('outside', join(base, 'other-repo', 'gone')),
    leftover('agent', join(worktrees, 'feat/bb-4'), {
      tabs: [{ label: 'x', panes: ['claude'] }],
    }),
    leftover('two-tabs', join(worktrees, 'feat/bb-5'), {
      tabs: [
        { label: 'ui', panes: [null] },
        { label: 'BB-5 · working #9', panes: [null] },
      ],
    }),
  ]);
  const executor = new HerdrExecutor({ root }, herdr.exec);

  expect(await executor.sweepWorkspaces()).toBe(true);

  expect(closes(herdr.calls)).toEqual(['gone']);
});

it('the sweep asks for a retry when a focused leftover cannot lose focus', async () => {
  const herdr = fakeHerdr([
    {
      id: 'gone',
      label: 'gone',
      path: join(root, '.bakers-worktrees', 'feat/bb-3-gone'),
      focused: true,
      tabs: [{ label: 'ui', panes: [null] }],
    },
  ]);
  const executor = new HerdrExecutor({ root }, herdr.exec);

  expect(await executor.sweepWorkspaces()).toBe(false);
  expect(closes(herdr.calls)).toEqual([]);
});
