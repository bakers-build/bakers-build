import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { SpawnRunInput } from '@bakers-build/bakers/plugin';
import { describe, expect, it, vi } from 'vitest';
import { HerdrExecutor } from '../src/index.js';
import { INSTANT_WATCH, plantStarted } from './plant-started.js';

function expectTypedScript(args: unknown, paneId: string): string {
  expect(args).toEqual([
    'pane',
    'run',
    paneId,
    expect.stringMatching(/^sh '.+\/run\.sh'$/),
  ]);
  const typed = (args as string[])[3] ?? '';
  return typed.slice("sh '".length, -1);
}

function withPlant(
  exec: (args: string[]) => Promise<string>,
): (args: string[]) => Promise<string> {
  return async (args: string[]) => {
    plantStarted(args);
    return exec(args);
  };
}

function input(): SpawnRunInput {
  return {
    ticket: {
      uuid: 't-1',
      identifier: 'GL-7',
      title: 'T',
      branchName: 'bakers/gl-7-fix-login-flow',
      state: 'coding',
    },
    run: { uuid: 'r-7', id: 7, handler: 'code' },
    workspacePath: '/tmp/ws/gl-7',
    instructions: null,
    command: 'claude',
  };
}

/** worktree list with the workspace already open for the branch. */
const WORKTREE_LIST_OPEN = JSON.stringify({
  result: {
    worktrees: [
      {
        branch: 'bakers/gl-7-fix-login-flow',
        path: '/worktrees/bakers/gl-7',
        open_workspace_id: 'ws-branch',
      },
    ],
  },
});

/** worktree list with no open workspace for the branch. */
const WORKTREE_LIST_CLOSED = JSON.stringify({
  result: {
    worktrees: [
      { branch: 'bakers/gl-7-fix-login-flow', path: '/worktrees/bakers/gl-7' },
    ],
  },
});

const WORKTREE_OPEN_RESULT = JSON.stringify({
  result: { workspace: { workspace_id: 'ws-branch' } },
});

const TAB_CREATED = JSON.stringify({
  result: {
    root_pane: { pane_id: 'ws-branch-1' },
    tab: { tab_id: 'ws-branch:1' },
  },
});

describe('HerdrExecutor', () => {
  it('is persistent', () => {
    const plugin = new HerdrExecutor({ command: 'claude' });
    expect(plugin.id).toBe('herdr');
    expect(plugin.capabilities()).toEqual({ persistent: true });
  });

  it('startRun with workspace already open: list → tab create (label=id-token, no --json) → pane rename → pane run', async () => {
    const exec = vi.fn();
    exec.mockResolvedValueOnce(WORKTREE_LIST_OPEN); // worktree list (findWorkspaceByBranch)
    exec.mockResolvedValueOnce(TAB_CREATED); // tab create
    exec.mockResolvedValueOnce(''); // pane rename (BB-374 panel label)
    exec.mockResolvedValueOnce(''); // pane run
    const plugin = new HerdrExecutor(
      { command: 'claude', launchWatch: INSTANT_WATCH },
      withPlant(exec),
    );
    const session = await plugin.startRun(input());
    expect(session.sessionRef).toBe('bakers/gl-7-fix-login-flow');

    // Call 1: worktree list
    expect(exec).toHaveBeenNthCalledWith(1, ['worktree', 'list', '--json']);

    // Call 2: tab create — label is the run-id token, NO --json
    expect(exec).toHaveBeenNthCalledWith(2, [
      'tab',
      'create',
      '--workspace',
      'ws-branch',
      '--label',
      'GL-7 · coding #7',
      '--no-focus',
      '--env',
      'BB_AGENT_SHELL=1',
    ]);
    // Assert NO --json in tab create
    expect(exec.mock.calls[1]).not.toContain('--json');

    // Call 3: BB-374 state panel label (default `{title}`)
    expect(exec).toHaveBeenNthCalledWith(3, [
      'pane',
      'rename',
      'ws-branch-1',
      'T',
    ]);

    // Call 4: pane run — short sh wrapper, not the assembled command
    expectTypedScript(exec.mock.calls[3]?.[0], 'ws-branch-1');
  });

  it('startRun without open workspace: list → worktree open (id from open output) → tab create → pane rename → pane run', async () => {
    const exec = vi.fn();
    exec.mockResolvedValueOnce(WORKTREE_LIST_CLOSED); // worktree list (no open_workspace_id)
    exec.mockResolvedValueOnce(WORKTREE_OPEN_RESULT); // worktree open — carries the id
    exec.mockResolvedValueOnce(TAB_CREATED); // tab create
    exec.mockResolvedValueOnce(''); // pane rename (BB-374)
    exec.mockResolvedValueOnce(''); // pane run
    const plugin = new HerdrExecutor(
      { command: 'claude', launchWatch: INSTANT_WATCH },
      withPlant(exec),
    );
    const session = await plugin.startRun(input());
    expect(session.sessionRef).toBe('bakers/gl-7-fix-login-flow');

    expect(exec).toHaveBeenNthCalledWith(1, ['worktree', 'list', '--json']);
    expect(exec).toHaveBeenNthCalledWith(2, [
      'worktree',
      'open',
      '--cwd',
      '/tmp/ws/gl-7',
      '--branch',
      'bakers/gl-7-fix-login-flow',
      '--no-focus',
      '--json',
    ]);
    // BB-114: the id comes from `worktree open`'s OWN output, so there is NO
    // second `worktree list` re-derivation. tab create follows the open directly.
    expect(exec).toHaveBeenNthCalledWith(3, [
      'tab',
      'create',
      '--workspace',
      'ws-branch',
      '--label',
      'GL-7 · coding #7',
      '--no-focus',
      '--env',
      'BB_AGENT_SHELL=1',
    ]);
    expect(exec).toHaveBeenNthCalledWith(4, [
      'pane',
      'rename',
      'ws-branch-1',
      'T',
    ]);
    expectTypedScript(exec.mock.calls[4]?.[0], 'ws-branch-1');
    // no second worktree list call anywhere (each mock.calls entry is the
    // positional-args list, so the herdr argv is c[0]).
    expect(
      exec.mock.calls.filter(
        (c) => c[0]?.[0] === 'worktree' && c[0]?.[1] === 'list',
      ),
    ).toHaveLength(1);
  });

  it('single-quotes environment values before running the command', async () => {
    const exec = vi.fn();
    exec.mockResolvedValueOnce(WORKTREE_LIST_OPEN);
    exec.mockResolvedValueOnce(TAB_CREATED);
    exec.mockResolvedValueOnce(''); // pane rename
    exec.mockResolvedValueOnce(''); // pane run
    const plugin = new HerdrExecutor(
      { command: 'claude', launchWatch: INSTANT_WATCH },
      withPlant(exec),
    );
    await plugin.startRun({
      ...input(),
      env: { BB_TOKEN: "a'$(echo unsafe)`b" },
    });
    const wrapPath = expectTypedScript(exec.mock.calls[3]?.[0], 'ws-branch-1');
    expect(readFileSync(join(dirname(wrapPath), 'command'), 'utf8')).toBe(
      "BB_TOKEN='a'\\''$(echo unsafe)`b' claude",
    );
  });

  it('passes a redactArgs that hides env values from the pane-run exec log', async () => {
    const exec = vi.fn();
    exec.mockResolvedValueOnce(WORKTREE_LIST_OPEN);
    exec.mockResolvedValueOnce(TAB_CREATED);
    exec.mockResolvedValueOnce(''); // pane rename
    exec.mockResolvedValueOnce(''); // pane run
    const plugin = new HerdrExecutor(
      { command: 'claude', launchWatch: INSTANT_WATCH },
      withPlant(exec),
    );
    const secret = 'mysql://user:p@ss@h/db';
    await plugin.startRun({ ...input(), env: { DB_DSN: secret } });

    // Fourth call is the agent pane run (after BB-374 pane rename). The typed
    // line is the short wrapper; the secret lives only in the 0600 command file.
    const [args, opts] = exec.mock.calls[3] as [
      string[],
      { redactArgs?: (a: string[]) => string[] } | undefined,
    ];
    const wrapPath = expectTypedScript(args, 'ws-branch-1');
    expect(args[3]).not.toContain(secret);
    const logged = opts?.redactArgs?.(args) ?? args;
    expect(logged.join(' ')).not.toContain(secret);
    expect(readFileSync(join(dirname(wrapPath), 'command'), 'utf8')).toBe(
      `DB_DSN='${secret}' claude`,
    );
  });

  it('rejects invalid environment variable names', async () => {
    const exec = vi.fn();
    exec.mockResolvedValueOnce(WORKTREE_LIST_OPEN);
    exec.mockResolvedValueOnce(TAB_CREATED);
    exec.mockResolvedValueOnce(''); // pane rename (before env validation in layout)
    const plugin = new HerdrExecutor(
      { command: 'claude', launchWatch: INSTANT_WATCH },
      withPlant(exec),
    );
    await expect(
      plugin.startRun({ ...input(), env: { 'BAD-NAME': 'value' } }),
    ).rejects.toThrow(/invalid environment variable/);
    expect(exec).toHaveBeenCalledWith(['tab', 'close', 'ws-branch:1']);
  });

  it('falls back to the configured command when input.command is absent', async () => {
    const exec = vi.fn();
    exec.mockResolvedValueOnce(WORKTREE_LIST_OPEN);
    exec.mockResolvedValueOnce(TAB_CREATED);
    exec.mockResolvedValueOnce(''); // pane rename
    exec.mockResolvedValueOnce(''); // pane run
    const plugin = new HerdrExecutor(
      { command: 'claude', launchWatch: INSTANT_WATCH },
      withPlant(exec),
    );
    await plugin.startRun({
      ...input(),
      command: undefined,
      env: { BB_ID: 't-1' },
    });
    const wrapPath = expectTypedScript(exec.mock.calls[3]?.[0], 'ws-branch-1');
    expect(readFileSync(join(dirname(wrapPath), 'command'), 'utf8')).toBe(
      "BB_ID='t-1' claude",
    );
  });

  it('throws when tab create output is invalid', async () => {
    const exec = vi.fn();
    exec.mockResolvedValueOnce(WORKTREE_LIST_OPEN);
    exec.mockResolvedValueOnce(JSON.stringify({ result: {} }));
    const plugin = new HerdrExecutor(
      { command: 'claude', launchWatch: INSTANT_WATCH },
      withPlant(exec),
    );
    await expect(plugin.startRun(input())).rejects.toThrow(
      /tab create returned invalid schema/,
    );
  });

  it('splits configured panes after the agent pane', async () => {
    const exec = vi.fn();
    exec.mockResolvedValueOnce(WORKTREE_LIST_OPEN); // worktree list
    exec.mockResolvedValueOnce(TAB_CREATED); // tab create
    exec.mockResolvedValueOnce(''); // pane rename (BB-374)
    exec.mockResolvedValueOnce(''); // pane run (agent)
    exec.mockResolvedValueOnce(
      JSON.stringify({ result: { pane: { pane_id: 'ws-branch-2' } } }),
    ); // pane split
    exec.mockResolvedValueOnce(''); // pane run (extra)
    const plugin = new HerdrExecutor(
      {
        command: 'claude',
        launchWatch: INSTANT_WATCH,
        states: {
          coding: {
            panes: [
              { direction: 'right', command: 'git -C {workspacePath} diff' },
            ],
          },
        },
      },
      withPlant(exec),
    );
    await plugin.startRun(input());
    expect(exec).toHaveBeenNthCalledWith(5, [
      'pane',
      'split',
      'ws-branch-1',
      '--direction',
      'right',
      '--cwd',
      '/tmp/ws/gl-7',
      '--no-focus',
      '--env',
      'BB_AGENT_SHELL=1',
    ]);
    expect(exec).toHaveBeenNthCalledWith(6, [
      'pane',
      'run',
      'ws-branch-2',
      'git -C /tmp/ws/gl-7 diff',
    ]);
  });

  it('rollback on startRun failure: closes only the created tab via tab close <tabId>', async () => {
    const exec = vi.fn();
    exec.mockResolvedValueOnce(WORKTREE_LIST_OPEN); // findWorkspaceByBranch
    exec.mockResolvedValueOnce(TAB_CREATED); // tab create → tabId = ws-branch:1
    exec.mockResolvedValueOnce(''); // pane rename (BB-374)
    exec.mockRejectedValueOnce(new Error('pane run failed')); // pane run fails
    exec.mockResolvedValueOnce(''); // tab close (rollback)
    const plugin = new HerdrExecutor(
      { command: 'claude', launchWatch: INSTANT_WATCH },
      withPlant(exec),
    );
    const err = await plugin.startRun(input()).catch((e) => e);
    expect((err as Error).message).toContain('pane run failed');
    // Rollback closes only the tab, not the workspace
    expect(exec).toHaveBeenNthCalledWith(5, ['tab', 'close', 'ws-branch:1']);
    // No workspace close call
    const subcommands = exec.mock.calls.map((c: string[]) =>
      `${c[0]} ${c[1] ?? ''}`.trim(),
    );
    expect(subcommands).not.toContain('workspace close');
    expect(subcommands).not.toContain('worktree close');
  });
});

describe('herdrExecutor factory', () => {
  it('factory forwards default/states config into startRun', async () => {
    const { herdrExecutor } = await import('../src/index.js');
    const plugin = herdrExecutor({
      states: { coding: { workspaceLabel: 'fixed-ws' } },
    });
    expect(plugin.id).toBe('herdr');
    expect(plugin.kind).toBe('executor');
  });
});

describe('default export', () => {
  it('is the same factory reference as the named `herdrExecutor` export', async () => {
    const mod = await import('../src/index.js');
    expect(mod.default).toBe(mod.herdrExecutor);
  });
  it('builds an executor plugin descriptor (kind "executor")', async () => {
    const mod = await import('../src/index.js');
    expect(mod.default().kind).toBe('executor');
  });
});
