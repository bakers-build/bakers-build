import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { BbExecutor, SpawnRunInput } from '@bakers-build/bakers/plugin';
import { exec } from '@bakers-build/core';
import { describe, expect, it } from 'vitest';
import { restoreWritable } from '../src/fs.js';
import herdrExecutor, { HerdrExecutor } from '../src/index.js'; // already exported (index.ts)
import { removeHerdrWorktree } from '../src/worktrees.js';
import { INSTANT_WATCH, plantStarted } from './plant-started.js';

const quietLogger = { debug() {}, info() {}, warn() {}, error() {} };

/**
 * The worktree teardown these cases pin moved from the executor to
 * `HerdrWorkspace.remove` ({@link removeHerdrWorktree}). This takes the old
 * executor constructor's arguments — options, herdr exec, logger, the retired
 * hook runner, git runner — so every case keeps its exact assertions.
 */
function herdrTeardown(
  options: { root?: string },
  execHerdr: (args: string[]) => Promise<string>,
  logger: typeof quietLogger = quietLogger,
  _retiredShell?: unknown,
  runGit: (args: string[], cwd: string) => Promise<string> = (args, cwd) =>
    exec('git', args, { cwd }),
) {
  return {
    removeWorktree: (branch: string, worktreePath?: string) =>
      removeHerdrWorktree(
        {
          ...(options.root !== undefined ? { root: options.root } : {}),
          execHerdr,
          runGit,
          logger,
        },
        branch,
        worktreePath,
      ),
  };
}

/** A recorded git invocation: (args, cwd). */
type GitCall = { args: string[]; cwd: string };

/** Recording git runner: captures (args, cwd) and returns empty stdout. */
function recordingGit(gitCalls: GitCall[]) {
  return async (args: string[], cwd: string): Promise<string> => {
    gitCalls.push({ args, cwd });
    return '';
  };
}

// Canned herdr JSON keyed by subcommand (args[0] + args[1]).
function fakeExec(opts: {
  throwOn: string;
  calls: string[][];
  hasOpenWorkspace?: boolean;
}) {
  return async (args: string[]): Promise<string> => {
    opts.calls.push(args);
    plantStarted(args);
    const key = `${args[0]} ${args[1] ?? ''}`.trim();
    if (key === opts.throwOn) throw new Error(`herdr ${key} failed`);
    switch (key) {
      case 'worktree list':
        return JSON.stringify({
          result: {
            worktrees: [
              {
                branch: 'bakers/bb-1-t',
                path: '/repo/wt',
                ...(opts.hasOpenWorkspace !== false
                  ? { open_workspace_id: 'ws-1' }
                  : {}),
              },
            ],
          },
        });
      case 'tab create':
        return JSON.stringify({
          result: {
            root_pane: { pane_id: 'p-1' },
            tab: { tab_id: 'tab-1' },
          },
        });
      default:
        return JSON.stringify({ result: {} });
    }
  };
}

// ---- helpers for label + retire tests ----

/** Build a SpawnRunInput with overrides for identifier, state, and run id. */
function spawnInput(overrides: {
  identifier: string;
  state: string;
  id: number;
}): SpawnRunInput {
  return {
    ticket: {
      uuid: 't-1',
      identifier: overrides.identifier,
      title: 'T',
      branchName: 'bakers/bb-1-t',
      state: overrides.state,
    },
    run: { uuid: 'run-1', id: overrides.id, handler: 'code' },
    workspacePath: '/repo/wt',
    instructions: null,
    command: 'claude',
    env: {},
  };
}

/** Canned worktree list JSON with one entry for the given branch/workspaceId. */
function worktreeWith(branch: string, workspaceId: string): string {
  return JSON.stringify({
    result: {
      worktrees: [{ branch, path: '/repo/wt', open_workspace_id: workspaceId }],
    },
  });
}

/** Canned tab list JSON. */
function tabsJson(tabs: Array<{ tab_id: string; label: string }>): string {
  return JSON.stringify({ result: { tabs } });
}

/**
 * Fake herdr exec that records all calls.
 * `responses` maps "cmd subcmd" keys to pre-canned JSON strings.
 * Falls back to tab-create / generic defaults if no key matches.
 */
function makeFakeHerdr(
  calls: string[][],
  responses: Record<string, string> = {},
) {
  return async (args: string[]): Promise<string> => {
    calls.push(args);
    plantStarted(args);
    const key = `${args[0]} ${args[1] ?? ''}`.trim();
    if (key in responses) {
      return responses[key] as string;
    }
    switch (key) {
      case 'worktree list':
        return JSON.stringify({
          result: {
            worktrees: [
              {
                branch: 'bakers/bb-1-t',
                path: '/repo/wt',
                open_workspace_id: 'ws-1',
              },
            ],
          },
        });
      case 'tab create':
        return JSON.stringify({
          result: {
            root_pane: { pane_id: 'p-1' },
            tab: { tab_id: 'tab-1' },
          },
        });
      default:
        return JSON.stringify({ result: {} });
    }
  };
}

function makeExecutor(exec: (a: string[]) => Promise<string>): BbExecutor {
  // HerdrExecutor takes (options, execHerdr); inject the fake via the 2nd arg.
  return new HerdrExecutor({ launch_watch: INSTANT_WATCH }, exec);
}

const input = {
  ticket: {
    uuid: 't-1',
    identifier: 'BB-1',
    title: 'T',
    branchName: 'bakers/bb-1-t',
    state: 'coding',
  },
  run: { uuid: 'run-1', id: 1, handler: 'code' },
  workspacePath: '/repo/wt',
  instructions: null,
  command: 'claude',
  env: {},
};

describe('HerdrExecutor tab label', () => {
  it('labels the tab with the run id token', async () => {
    const calls: string[][] = [];
    const exec = makeFakeHerdr(calls);
    const executor = new HerdrExecutor(
      { command: 'claude', launch_watch: INSTANT_WATCH },
      exec,
    );
    await executor.startRun(
      spawnInput({ identifier: 'BB-123', state: 'coding', id: 12 }),
    );
    const create = calls.find((c) => c[0] === 'tab' && c[1] === 'create');
    expect(create).toContain('BB-123 · coding #12');
  });
});

// BB-374: state/run root pane gets a panel label (pane rename); tab label stays.
describe('HerdrExecutor.startRun panel label (BB-374)', () => {
  it('renames the state root pane to the ticket title after tab create', async () => {
    const calls: string[][] = [];
    const exec = makeFakeHerdr(calls);
    const executor = new HerdrExecutor(
      { command: 'claude', launch_watch: INSTANT_WATCH },
      exec,
    );
    await executor.startRun({
      ...input,
      ticket: { ...input.ticket, title: 'Fix the labels' },
      run: { ...input.run, id: 42 },
    });

    const create = calls.find((c) => c[0] === 'tab' && c[1] === 'create');
    expect(create).toBeDefined();
    expect(create?.[create.indexOf('--label') + 1]).toBe('BB-1 · coding #42');
    expect(calls).toContainEqual(['pane', 'rename', 'p-1', 'Fix the labels']);
  });

  it('honours states.*.panelLabel / default.panelLabel', async () => {
    const calls: string[][] = [];
    const exec = makeFakeHerdr(calls);
    const executor = new HerdrExecutor(
      {
        command: 'claude',
        launch_watch: INSTANT_WATCH,
        default: { panel_label: 'Run · {title}' },
        states: { coding: { panel_label: 'Coding · {title}' } },
      },
      exec,
    );
    await executor.startRun({
      ...input,
      ticket: { ...input.ticket, title: 'Fix the labels', state: 'coding' },
    });

    expect(calls).toContainEqual([
      'pane',
      'rename',
      'p-1',
      'Coding · Fix the labels',
    ]);
  });
});

describe('HerdrExecutor.startRun pane-run command (BB-101 / BB-128)', () => {
  it('types a short sh-script line; env values in the command file use POSIX quotes', async () => {
    const calls: string[][] = [];
    const exec = makeFakeHerdr(calls);
    const executor = new HerdrExecutor(
      { command: 'claude', launch_watch: INSTANT_WATCH },
      exec,
    );
    await executor.startRun({
      ...input,
      // What the agent plugin emits for a multi-line prompt: POSIX quoted,
      // newline literal — legal in the sh-evaluated command file.
      command: "claude 'para one\n\npara two' --dangerously-skip-permissions",
      // Env values are POSIX single-quoted the same way. The typed pty line
      // is only `sh '<path>'` and stays free of 0x0A.
      env: { PROMPT_FILE: 'a\nb' },
    });
    const run = calls.find((c) => c[0] === 'pane' && c[1] === 'run');
    expect(run).toBeDefined();
    const typed = (run as string[])[3];
    // herdr types this into an interactive pty — a single 0x0A submits the line
    // and breaks the command into fragments (the BB-101 defect).
    expect(typed.includes(String.fromCharCode(0x0a))).toBe(false);
    expect(typed.startsWith("sh '")).toBe(true);
    expect(typed.startsWith('bash -c')).toBe(false);
    const wrapPath = typed.slice("sh '".length, -1);
    const assembled = readFileSync(join(dirname(wrapPath), 'command'), 'utf8');
    expect(assembled).toBe(
      "PROMPT_FILE='a\nb' claude 'para one\n\npara two' --dangerously-skip-permissions",
    );
  });
});

describe('HerdrExecutor.stopRun', () => {
  it('is a no-op — issues no herdr commands (AC-3)', async () => {
    const calls: string[][] = [];
    const exec = makeFakeHerdr(calls, {
      'worktree list': worktreeWith('bakers/bb-123', 'ws1'),
      'tab list': tabsJson([{ tab_id: 't1', label: 'BB-123 · coding #12' }]),
    });
    const executor = new HerdrExecutor(
      { command: 'claude', launch_watch: INSTANT_WATCH },
      exec,
    );
    await executor.stopRun('bakers/bb-123');
    // The agent is idle and its transcript is on disk; stopRun touches nothing —
    // the subsequent cleanupRun tab-close kills the PTY.
    expect(calls).toEqual([]);
  });
});

// BB-183: cleanupRun is run-scoped — it closes ONLY the tab whose label
// carries the expected `#<Run-ID>` token (`startRun` labels every tab
// `<identifier> · <state> #<run.id>`), never a sibling run tab or a non-run tab.
describe('HerdrExecutor.cleanupRun (run-scoped by label #<runId>)', () => {
  it('closes only the tab with the expected run-ID, leaving the sibling run tab open (AC-1, AC-2)', async () => {
    const calls: string[][] = [];
    const exec = makeFakeHerdr(calls, {
      'worktree list': worktreeWith('bakers/bb-123', 'ws1'),
      'tab list': tabsJson([
        { tab_id: 't1', label: 'BB-123 · spec #11' },
        { tab_id: 't2', label: 'BB-123 · coding #12' },
      ]),
    });
    const executor = new HerdrExecutor(
      { command: 'claude', launch_watch: INSTANT_WATCH },
      exec,
    );
    await executor.cleanupRun('bakers/bb-123', 12);
    expect(calls).toContainEqual(['tab', 'close', 't2']);
    expect(calls).not.toContainEqual(['tab', 'close', 't1']);
    // No /exit, no C-c, no (done) rename — the matched tab simply goes away.
    const subcommands = calls.map((c) => `${c[0]} ${c[1] ?? ''}`.trim());
    expect(subcommands).not.toContain('pane send-keys');
    expect(subcommands).not.toContain('pane send-text');
    expect(subcommands).not.toContain('tab rename');
  });

  it('does not close a tab whose run-ID only partially matches (AC-3)', async () => {
    const calls: string[][] = [];
    const exec = makeFakeHerdr(calls, {
      'worktree list': worktreeWith('bakers/bb-123', 'ws1'),
      'tab list': tabsJson([
        { tab_id: 't1', label: 'BB-123 · coding #12' },
        { tab_id: 't2', label: 'BB-123 · review #123' },
      ]),
    });
    const executor = new HerdrExecutor(
      { command: 'claude', launch_watch: INSTANT_WATCH },
      exec,
    );
    await executor.cleanupRun('bakers/bb-123', 12);
    expect(calls).toContainEqual(['tab', 'close', 't1']);
    expect(calls).not.toContainEqual(['tab', 'close', 't2']);
  });

  it('closes every tab carrying the run-ID, such as one herdr restored beside a relaunch', async () => {
    const calls: string[][] = [];
    const exec = makeFakeHerdr(calls, {
      'worktree list': worktreeWith('bakers/bb-123', 'ws1'),
      'tab list': tabsJson([
        { tab_id: 't1', label: 'BB-123 · coding #12' },
        { tab_id: 't2', label: 'BB-123 · coding #12' },
      ]),
    });
    const executor = new HerdrExecutor(
      { command: 'claude', launch_watch: INSTANT_WATCH },
      exec,
    );
    await executor.cleanupRun('bakers/bb-123', 12);
    expect(calls).toContainEqual(['tab', 'close', 't1']);
    expect(calls).toContainEqual(['tab', 'close', 't2']);
  });

  it('is a quiet no-op when no tab matches the run-ID (AC-4)', async () => {
    const calls: string[][] = [];
    const exec = makeFakeHerdr(calls, {
      'worktree list': worktreeWith('bakers/bb-123', 'ws1'),
      'tab list': tabsJson([
        { tab_id: 't1', label: 'BB-123 · spec #11' },
        { tab_id: 't2', label: 'BB-123 · coding #12' },
      ]),
    });
    const executor = new HerdrExecutor(
      { command: 'claude', launch_watch: INSTANT_WATCH },
      exec,
    );
    await expect(
      executor.cleanupRun('bakers/bb-123', 99),
    ).resolves.toBeUndefined();
    const subcommands = calls.map((c) => `${c[0]} ${c[1] ?? ''}`.trim());
    expect(subcommands).not.toContain('tab close');
  });

  it('leaves a non-run (label-less) tab untouched (AC-2)', async () => {
    const calls: string[][] = [];
    const exec = makeFakeHerdr(calls, {
      'worktree list': worktreeWith('bakers/bb-123', 'ws1'),
      'tab list': tabsJson([
        { tab_id: 't1', label: 'BB-123 · coding #12' },
        { tab_id: 't2', label: 'scratch' },
      ]),
    });
    const executor = new HerdrExecutor(
      { command: 'claude', launch_watch: INSTANT_WATCH },
      exec,
    );
    await executor.cleanupRun('bakers/bb-123', 12);
    expect(calls).toContainEqual(['tab', 'close', 't1']);
    expect(calls).not.toContainEqual(['tab', 'close', 't2']);
  });

  it('is a no-op when no workspace is open for the branch', async () => {
    const calls: string[][] = [];
    const exec = makeFakeHerdr(calls, {
      'worktree list': JSON.stringify({
        result: { worktrees: [{ branch: 'bakers/bb-1-t', path: '/repo/wt' }] },
      }),
    });
    const executor = new HerdrExecutor({ launch_watch: INSTANT_WATCH }, exec);
    await executor.cleanupRun('bakers/bb-1-t', 12);
    const subcommands = calls.map((c) => `${c[0]} ${c[1] ?? ''}`.trim());
    expect(subcommands).not.toContain('tab close');
    expect(subcommands.every((k) => k === 'worktree list')).toBe(true);
  });

  it('swallows a failing tab-close (best-effort, AC-4)', async () => {
    const calls: string[][] = [];
    const exec = async (args: string[]): Promise<string> => {
      calls.push(args);
      const key = `${args[0]} ${args[1] ?? ''}`.trim();
      if (key === 'tab close') throw new Error('herdr tab close failed');
      switch (key) {
        case 'worktree list':
          return worktreeWith('bakers/bb-1-t', 'ws-1');
        case 'tab list':
          return tabsJson([{ tab_id: 't1', label: 'BB-1 · coding #2' }]);
        default:
          return JSON.stringify({ result: {} });
      }
    };
    const executor = new HerdrExecutor({ launch_watch: INSTANT_WATCH }, exec);
    // Must not throw even though the matched close fails.
    await expect(
      executor.cleanupRun('bakers/bb-1-t', 2),
    ).resolves.toBeUndefined();
    expect(calls).toContainEqual(['tab', 'close', 't1']);
  });
});

describe('HerdrExecutor.runAlive (by tab label #<runId>)', () => {
  const alive = (exec: (a: string[]) => Promise<string>, runId = 12) =>
    new HerdrExecutor({ launchWatch: INSTANT_WATCH }, exec).runAlive(
      'bakers/bb-123',
      runId,
    );

  /** The run tab t2 with pane p2 (and a foreign tab's pane p9), running `fg` in front. */
  const runTabWith = (fg: string[][], calls: string[][] = []) =>
    makeFakeHerdr(calls, {
      'worktree list': worktreeWith('bakers/bb-123', 'ws1'),
      'tab list': tabsJson([{ tab_id: 't2', label: 'BB-123 · coding #12' }]),
      'pane list': JSON.stringify({
        result: {
          panes: [
            { pane_id: 'p9', tab_id: 't9' },
            { pane_id: 'p2', tab_id: 't2' },
          ],
        },
      }),
      'pane process-info': JSON.stringify({
        result: {
          process_info: {
            foreground_processes: fg.map((argv) => ({ argv })),
          },
        },
      }),
    });

  it('is true while a pane of the run tab runs the launch wrapper', async () => {
    const calls: string[][] = [];
    const running = [
      ['claude', '--session-id', 'x'],
      ['sh', '/tmp/bakers-run-AbC123/run.sh'],
    ];
    expect(await alive(runTabWith(running, calls))).toBe(true);
    expect(calls).toContainEqual(['pane', 'process-info', '--pane', 'p2']);
    expect(calls).not.toContainEqual(['pane', 'process-info', '--pane', 'p9']);
  });

  it.each([
    ['only an idle shell', [['-zsh']]],
    ['an agent herdr resumed by itself', [['claude', '--resume=x']]],
  ])('is false when the restored run tab holds %s', async (_, fg) => {
    expect(await alive(runTabWith(fg))).toBe(false);
  });

  it('is true when a restored idle tab with the same run id comes before the live one', async () => {
    const fg: Record<string, string[][]> = {
      p1: [['-zsh']],
      p2: [['sh', '/tmp/bakers-run-AbC123/run.sh']],
    };
    const exec = async (args: string[]): Promise<string> => {
      switch (`${args[0]} ${args[1] ?? ''}`.trim()) {
        case 'worktree list':
          return worktreeWith('bakers/bb-123', 'ws1');
        case 'tab list':
          return tabsJson([
            { tab_id: 't1', label: 'BB-123 · coding #12' },
            { tab_id: 't2', label: 'BB-123 · coding #12' },
          ]);
        case 'pane list':
          return JSON.stringify({
            result: {
              panes: [
                { pane_id: 'p1', tab_id: 't1' },
                { pane_id: 'p2', tab_id: 't2' },
              ],
            },
          });
        case 'pane process-info':
          return JSON.stringify({
            result: {
              process_info: {
                foreground_processes: (fg[args[3] ?? ''] ?? []).map((argv) => ({
                  argv,
                })),
              },
            },
          });
        default:
          return JSON.stringify({ result: {} });
      }
    };
    expect(await alive(exec)).toBe(true);
  });

  it('is false when no tab carries the run id', async () => {
    const exec = makeFakeHerdr([], {
      'worktree list': worktreeWith('bakers/bb-123', 'ws1'),
      'tab list': tabsJson([{ tab_id: 't2', label: 'BB-123 · coding #123' }]),
    });
    expect(await alive(exec)).toBe(false);
  });

  it('is false when no workspace is open for the branch', async () => {
    const exec = makeFakeHerdr([], {
      'worktree list': JSON.stringify({
        result: { worktrees: [{ branch: 'bakers/bb-123', path: '/repo/wt' }] },
      }),
    });
    expect(await alive(exec)).toBe(false);
  });

  it('rejects when herdr cannot answer', async () => {
    await expect(
      alive(async () => {
        throw new Error('herdr not running');
      }),
    ).rejects.toThrow('herdr not running');
  });
});

describe('HerdrExecutor.removeWorktree', () => {
  it('removes the open workspace for the branch with --force', async () => {
    const calls: string[][] = [];
    const exec = makeFakeHerdr(calls, {
      'worktree list': worktreeWith('bakers/bb-1-t', 'ws-1'),
    });
    const executor = herdrTeardown({ launch_watch: INSTANT_WATCH }, exec);
    await executor.removeWorktree('bakers/bb-1-t');
    expect(calls).toContainEqual([
      'worktree',
      'remove',
      '--workspace',
      'ws-1',
      '--force',
      '--json',
    ]);
  });

  it('treats a fully absent worktree as a finished teardown → already_absent', async () => {
    const calls: string[][] = [];
    const gitCalls: GitCall[] = [];
    // herdr lists only a foreign repo's worktree (machine-global list).
    const exec = makeFakeHerdr(calls, {
      'worktree list': JSON.stringify({
        result: {
          worktrees: [
            {
              branch: 'other/branch',
              path: '/repo/other',
              open_workspace_id: 'ws-x',
            },
          ],
        },
      }),
    });
    const executor = herdrTeardown(
      { root: '/repo' },
      exec,
      undefined,
      undefined,
      recordingGit(gitCalls),
    );
    // The recorded path is gone from disk AND git does not register it → the
    // worktree is absent in both dimensions, which BB-293 reports as
    // `already_absent`: a FINISHED teardown the reaper flags cleaned, now
    // distinguishable from one this host performed. herdr's own remove/open
    // never run (not one of its tracked worktrees).
    await expect(
      executor.removeWorktree('bakers/bb-1-t', '/repo/wt-gone'),
    ).resolves.toBe('already_absent');
    const subcommands = calls.map((c) => `${c[0]} ${c[1] ?? ''}`.trim());
    expect(subcommands).not.toContain('worktree remove');
    expect(subcommands).not.toContain('worktree open');
    // BB-293 (spec D1) DELIBERATELY drops the prune this case used to run.
    // With no registration there is no `.git/worktrees/<name>` entry of OURS to
    // sweep, so pruning would only sweep unrelated orphans — not this
    // teardown's job, and AC 2 asks for nothing to be performed for an absent
    // worktree. The BB-141 sweep intent survives wherever a prunable entry of
    // ours can actually exist: the registered-but-gone case (see the
    // existence-probe suite below) and every present-worktree path still prune.
    expect(
      gitCalls.some(
        (g) =>
          g.args[0] === 'worktree' &&
          g.args[1] === 'prune' &&
          g.cwd === '/repo',
      ),
    ).toBe(false);
  });

  it('reclaims an on-disk orphan git-awarely: git worktree remove + prune, not a raw rm (BB-141 RC-1)', async () => {
    // herdr no longer tracks our worktree, but the directory survives on disk —
    // an orphan we own. The OLD code raw-rm'd the dir and left the parent repo's
    // `.git/worktrees/<name>` admin entry behind → a `prunable` orphan. The fix
    // removes it git-awarely (git worktree remove from the PARENT root, then a
    // prune sweep), so no metadata is orphaned.
    //
    // BB-293 made the git call conditional on the path really BEING a
    // registered worktree, so this fixture now says so explicitly: the parent
    // repo's `git worktree list --porcelain` lists the orphan. That is the
    // situation this test is about — git knows the worktree, therefore `git
    // worktree remove` is the right tool and a raw `rm` would orphan the admin
    // entry. The opposite case (on disk, NOT registered) is the reported defect
    // and is covered in the existence-probe suite, where the git call must NOT
    // run at all.
    const orphan = mkdtempSync(join(tmpdir(), 'bakers-orphan-'));
    writeFileSync(join(orphan, 'file.txt'), 'x');
    const calls: string[][] = [];
    const gitCalls: GitCall[] = [];
    const exec = makeFakeHerdr(calls, {
      'worktree list': JSON.stringify({
        result: {
          worktrees: [{ branch: 'other/branch', path: '/repo/other' }],
        },
      }),
    });
    const root = '/parent/repo';
    const executor = herdrTeardown(
      { root },
      exec,
      undefined,
      undefined,
      async (args: string[], cwd: string): Promise<string> => {
        gitCalls.push({ args, cwd });
        if (args[0] === 'worktree' && args[1] === 'list') {
          return [
            `worktree ${root}`,
            'branch refs/heads/main',
            '',
            `worktree ${orphan}`,
            'branch refs/heads/bakers/bb-1-t',
            '',
          ].join('\n');
        }
        return '';
      },
    );
    // Reclaimed on-disk → present here → true.
    await expect(
      executor.removeWorktree('bakers/bb-1-t', orphan),
    ).resolves.toBe('removed');
    // git-aware removal from the PARENT root (unlinks the dir AND prunes the
    // `.git/worktrees/<name>` admin entry), followed by a prune sweep.
    expect(gitCalls).toContainEqual({
      args: ['worktree', 'remove', '--force', orphan],
      cwd: root,
    });
    expect(
      gitCalls.some(
        (g) =>
          g.args[0] === 'worktree' && g.args[1] === 'prune' && g.cwd === root,
      ),
    ).toBe(true);
    // The directory is gone (the guaranteed-removal fallback covers a git no-op).
    expect(existsSync(orphan)).toBe(false);
    // herdr's own remove/open never run — not one of its tracked worktrees.
    const subcommands = calls.map((c) => `${c[0]} ${c[1] ?? ''}`.trim());
    expect(subcommands).not.toContain('worktree remove');
    expect(subcommands).not.toContain('worktree open');
  });

  it('resolves an unknown-path worktree via the parent-repo git worktree list and reclaims it (BB-141 RC-2)', async () => {
    // worktree_path was never persisted → removeWorktree(branch, undefined).
    // herdr lost track of the branch, but the PARENT repo's `git worktree list`
    // still knows the lost worktree — resolve it there and tear it down, rather
    // than falsely reporting "gone" (the ~28 never-touched leftovers).
    const orphan = mkdtempSync(join(tmpdir(), 'bakers-orphan-'));
    writeFileSync(join(orphan, 'file.txt'), 'x');
    const calls: string[][] = [];
    const gitCalls: GitCall[] = [];
    const root = '/parent/repo';
    const exec = makeFakeHerdr(calls, {
      'worktree list': JSON.stringify({ result: { worktrees: [] } }),
    });
    const runGit = async (args: string[], cwd: string): Promise<string> => {
      gitCalls.push({ args, cwd });
      if (args[0] === 'worktree' && args[1] === 'list') {
        return [
          `worktree ${root}`,
          'HEAD abc',
          'branch refs/heads/main',
          '',
          `worktree ${orphan}`,
          'HEAD def',
          'branch refs/heads/bakers/bb-1-t',
          '',
        ].join('\n');
      }
      return '';
    };
    const executor = herdrTeardown(
      { root },
      exec,
      undefined,
      undefined,
      runGit,
    );
    await expect(
      executor.removeWorktree('bakers/bb-1-t', undefined),
    ).resolves.toBe('removed');
    // It consulted the parent-repo git worktree list...
    expect(
      gitCalls.some((g) => g.args[0] === 'worktree' && g.args[1] === 'list'),
    ).toBe(true);
    // ...and reclaimed the resolved path git-awarely.
    expect(gitCalls).toContainEqual({
      args: ['worktree', 'remove', '--force', orphan],
      cwd: root,
    });
    expect(existsSync(orphan)).toBe(false);
  });

  it('returns false (unverified) when the path is unknown and git worktree list has no entry for the branch (BB-141 RC-2)', async () => {
    // Nothing resolvable on this host: herdr tracks nothing, no path was given,
    // and the parent repo lists only its own main worktree. Report an UNVERIFIED
    // teardown (false) so the reaper leaves the ticket on the work list instead
    // of falsely flagging it cleaned.
    const calls: string[][] = [];
    const gitCalls: GitCall[] = [];
    const root = '/parent/repo';
    const exec = makeFakeHerdr(calls, {
      'worktree list': JSON.stringify({ result: { worktrees: [] } }),
    });
    const runGit = async (args: string[], cwd: string): Promise<string> => {
      gitCalls.push({ args, cwd });
      if (args[0] === 'worktree' && args[1] === 'list') {
        return [
          `worktree ${root}`,
          'HEAD abc',
          'branch refs/heads/main',
          '',
        ].join('\n');
      }
      return '';
    };
    const executor = herdrTeardown(
      { root },
      exec,
      undefined,
      undefined,
      runGit,
    );
    await expect(
      executor.removeWorktree('bakers/bb-1-t', undefined),
    ).resolves.toBe('unverified');
  });

  it('resolves by stable path when the checked-out branch was renamed', async () => {
    // Real-world shape: ticket branch is `bakers/…`, but the coding agent switched
    // the worktree to a `fix/…` branch, so herdr reports the new branch. Matching
    // on branch alone misses (the original bug); the path still matches.
    const calls: string[][] = [];
    const exec = makeFakeHerdr(calls, {
      'worktree list': JSON.stringify({
        result: {
          worktrees: [
            {
              branch: 'fix/renamed-during-coding',
              path: '/repo/wt',
              open_workspace_id: 'ws-7',
            },
          ],
        },
      }),
    });
    const executor = herdrTeardown({ launch_watch: INSTANT_WATCH }, exec);
    await executor.removeWorktree('bakers/bb-1-t', '/repo/wt');
    expect(calls).toContainEqual([
      'worktree',
      'remove',
      '--workspace',
      'ws-7',
      '--force',
      '--json',
    ]);
  });

  it('reattaches a closed worktree via the parent root, never the linked path (Bug A)', async () => {
    // Released run: workspace closed (open_workspace_id = null). herdr rejects an
    // `open` whose --cwd is the linked worktree itself with linked_worktree_source;
    // the reattach MUST start from the parent repo root instead.
    const parentRoot = '/repo/root';
    const linkedPath = '/repo/root/.bakers-worktrees/bakers/x';
    const calls: string[][] = [];
    let opened = false;
    const exec = async (args: string[]): Promise<string> => {
      calls.push(args);
      const key = `${args[0]} ${args[1] ?? ''}`.trim();
      if (key === 'worktree list') {
        return JSON.stringify({
          result: {
            worktrees: [
              {
                branch: 'bakers/x',
                path: linkedPath,
                ...(opened ? { open_workspace_id: 'wNEW' } : {}),
              },
            ],
          },
        });
      }
      if (key === 'worktree open') {
        const cwd = args[args.indexOf('--cwd') + 1];
        if (cwd === linkedPath) {
          // Reproduce herdr's real rejection — the old bug swallowed this.
          return JSON.stringify({ error: { code: 'linked_worktree_source' } });
        }
        opened = true;
        return JSON.stringify({
          result: { root_pane: { workspace_id: 'wNEW' } },
        });
      }
      return JSON.stringify({ result: {} });
    };
    const executor = herdrTeardown(
      { root: parentRoot, launch_watch: INSTANT_WATCH },
      exec,
    );
    await executor.removeWorktree('bakers/x', linkedPath);

    const openCall = calls.find(
      (c) => c[0] === 'worktree' && c[1] === 'open',
    ) as string[];
    expect(openCall).toContain('--cwd');
    expect(openCall[openCall.indexOf('--cwd') + 1]).toBe(parentRoot);
    expect(openCall).not.toContain(linkedPath);
    // And it still removed the reattached workspace.
    expect(calls).toContainEqual([
      'worktree',
      'remove',
      '--workspace',
      'wNEW',
      '--force',
      '--json',
    ]);
  });

  it('restores write permissions on the worktree before removing (Bug B)', async () => {
    // Real hardened dir as the worktree path: Drupal 0555 sites/default + 0444
    // settings.php. herdr does the unlink; removeWorktree must chmod u+w first,
    // or the unlink hits EACCES.
    const root = mkdtempSync(join(tmpdir(), 'herdr-rm-'));
    const sitesDefault = join(root, 'web', 'sites', 'default');
    mkdirSync(sitesDefault, { recursive: true });
    const settings = join(sitesDefault, 'settings.php');
    writeFileSync(settings, '<?php');
    chmodSync(settings, 0o444);
    chmodSync(sitesDefault, 0o555);

    const calls: string[][] = [];
    const exec = async (args: string[]): Promise<string> => {
      calls.push(args);
      const key = `${args[0]} ${args[1] ?? ''}`.trim();
      if (key === 'worktree list') {
        return JSON.stringify({
          result: {
            worktrees: [
              { branch: 'bakers/x', path: root, open_workspace_id: 'ws-1' },
            ],
          },
        });
      }
      return JSON.stringify({ result: {} });
    };
    const executor = herdrTeardown(
      { root: '/repo/root', launch_watch: INSTANT_WATCH },
      exec,
    );
    await executor.removeWorktree('bakers/x', root);

    // sites/default and settings.php must now carry the owner-write bit.
    expect(statSync(sitesDefault).mode & 0o200).toBe(0o200);
    expect(statSync(settings).mode & 0o200).toBe(0o200);
    expect(calls).toContainEqual([
      'worktree',
      'remove',
      '--workspace',
      'ws-1',
      '--force',
      '--json',
    ]);

    // cleanup
    restoreWritable(root);
    rmSync(root, { recursive: true, force: true });
    expect(existsSync(root)).toBe(false);
  });

  // BB-468 / BB-228 (superseded MR !258, trigger folded in here) — a
  // ticket whose recorded `worktree_path` is the configured parent-repo root
  // must be refused, not acted on. Two live branches, read in the BB-468
  // diagnosis and established RED here before the guard:
  //   1. herdr still tracks that workspace → `resolveWorktreeEntry` matches it
  //      → `herdr worktree remove --force` is spawned against the main
  //      checkout, which herdr itself refuses with `not_linked_worktree` — a
  //      throw the reaper logs as `worktree teardown failed` and retries
  //      forever;
  //   2. herdr does NOT track it → the probe fallback resolves `worktreePath`
  //      unfiltered (`onDisk: true`, `registered: false`) and
  //      `gitAwareRemove` calls `forceRemoveDir` on the main checkout itself —
  //      more severe than the loop in case 1.
  // Both must be refused before either branch spawns anything destructive.
  it('refuses to tear down the main checkout when herdr still tracks it (BB-468 case 1)', async () => {
    const calls: string[][] = [];
    const exec = async (args: string[]): Promise<string> => {
      calls.push(args);
      const key = `${args[0]} ${args[1] ?? ''}`.trim();
      if (key === 'worktree list') {
        return JSON.stringify({
          result: {
            worktrees: [
              {
                branch: 'main',
                path: '/repo/root',
                open_workspace_id: 'ws-main',
              },
            ],
          },
        });
      }
      return JSON.stringify({ result: {} });
    };
    const executor = herdrTeardown(
      { root: '/repo/root', launch_watch: INSTANT_WATCH },
      exec,
    );
    const outcome = await executor.removeWorktree('main', '/repo/root');

    // Refused: the outcome must not claim the main checkout is cleaned, and
    // no destructive herdr command may have been spawned.
    expect(outcome).not.toBe('removed');
    expect(outcome).not.toBe('already_absent');
    const subcommands = calls.map((c) => `${c[0]} ${c[1] ?? ''}`.trim());
    expect(subcommands).not.toContain('worktree remove');
    expect(subcommands).not.toContain('worktree open');
  });

  it('refuses to tear down the main checkout when herdr does not track it (BB-468 case 2)', async () => {
    const root = mkdtempSync(join(tmpdir(), 'herdr-main-checkout-'));
    try {
      const gitCalls: GitCall[] = [];
      const exec = async (): Promise<string> =>
        JSON.stringify({ result: { worktrees: [] } }); // herdr tracks nothing
      const executor = herdrTeardown(
        { root },
        exec,
        undefined,
        undefined,
        recordingGit(gitCalls),
      );
      const outcome = await executor.removeWorktree('main', root);

      // Refused: the main checkout directory must survive, and no
      // `forceRemoveDir` (nor a `git worktree remove`) may target it.
      expect(outcome).not.toBe('removed');
      expect(outcome).not.toBe('already_absent');
      expect(existsSync(root)).toBe(true);
      expect(
        gitCalls.some(
          (c) => c.args[0] === 'worktree' && c.args[1] === 'remove',
        ),
      ).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('opens a closed on-disk worktree, then removes it', async () => {
    const calls: string[][] = [];
    let opened = false;
    const exec = async (args: string[]): Promise<string> => {
      calls.push(args);
      const key = `${args[0]} ${args[1] ?? ''}`.trim();
      if (key === 'worktree list') {
        // Closed before open (no workspace id), open once flips it.
        return JSON.stringify({
          result: {
            worktrees: [
              {
                branch: 'bakers/bb-1-t',
                path: '/repo/wt',
                ...(opened ? { open_workspace_id: 'ws-9' } : {}),
              },
            ],
          },
        });
      }
      if (key === 'worktree open') {
        opened = true;
      }
      return JSON.stringify({ result: {} });
    };
    const executor = herdrTeardown({ launch_watch: INSTANT_WATCH }, exec);
    await executor.removeWorktree('bakers/bb-1-t');
    const subcommands = calls.map((c) => `${c[0]} ${c[1] ?? ''}`.trim());
    expect(subcommands).toContain('worktree open');
    expect(calls).toContainEqual([
      'worktree',
      'remove',
      '--workspace',
      'ws-9',
      '--force',
      '--json',
    ]);
  });
});

// BB-166: the focus guard. herdr's `worktree remove` deletes the ticket
// worktree's directory; if that workspace is the CURRENTLY FOCUSED one, the
// interactive client is stranded in a now-deleted cwd (herdr then spawns a
// stray empty workspace). removeWorktree must, before removing, switch focus to
// the main-checkout (non-linked) workspace of the same repo — and only when the
// target is actually focused. A non-focused/background reap changes no focus.
describe('HerdrExecutor.removeWorktree focus guard (BB-166)', () => {
  /**
   * Stateful herdr fake driving `workspace list` / `workspace focus`.
   * `focused` tracks the currently focused workspace id; `workspace focus`
   * flips it (set `honorFocus:false` to simulate a focus switch that does not
   * take). `workspaces` are (id, isLinked, repoRoot) tuples; the ticket
   * worktree's `open_workspace_id` is fixed to `targetWs`.
   */
  function focusGuardHerdr(cfg: {
    calls: string[][];
    targetWs: string;
    path: string;
    focused: string;
    workspaces: Array<{
      id: string;
      isLinked: boolean;
      repoRoot: string;
    }>;
    honorFocus?: boolean;
  }) {
    let focused = cfg.focused;
    return async (args: string[]): Promise<string> => {
      cfg.calls.push(args);
      plantStarted(args);
      const key = `${args[0]} ${args[1] ?? ''}`.trim();
      if (key === 'worktree list') {
        return JSON.stringify({
          result: {
            worktrees: [
              {
                branch: 'bakers/bb-1-t',
                path: cfg.path,
                open_workspace_id: cfg.targetWs,
              },
            ],
          },
        });
      }
      if (key === 'workspace list') {
        return JSON.stringify({
          result: {
            type: 'workspace_list',
            workspaces: cfg.workspaces.map((w) => ({
              workspace_id: w.id,
              focused: w.id === focused,
              worktree: {
                checkout_path: w.repoRoot,
                is_linked_worktree: w.isLinked,
                repo_root: w.repoRoot,
              },
            })),
          },
        });
      }
      if (key === 'workspace focus') {
        if (cfg.honorFocus !== false) focused = args[2] as string;
        return JSON.stringify({ result: {} });
      }
      return JSON.stringify({ result: {} });
    };
  }

  it('refocuses the main-checkout workspace before removing a focused ticket worktree', async () => {
    const calls: string[][] = [];
    const exec = focusGuardHerdr({
      calls,
      targetWs: 'ws-target',
      path: '/repo/wt', // not on disk → post-remove verify passes
      focused: 'ws-target',
      workspaces: [
        { id: 'ws-target', isLinked: true, repoRoot: '/repo' },
        { id: 'ws-parent', isLinked: false, repoRoot: '/repo' },
      ],
    });
    const executor = herdrTeardown(
      { root: '/repo', launch_watch: INSTANT_WATCH },
      exec,
    );
    await expect(
      executor.removeWorktree('bakers/bb-1-t', '/repo/wt'),
    ).resolves.toBe('removed');
    const focusIdx = calls.findIndex(
      (c) => c[0] === 'workspace' && c[1] === 'focus' && c[2] === 'ws-parent',
    );
    const removeIdx = calls.findIndex(
      (c) => c[0] === 'worktree' && c[1] === 'remove',
    );
    expect(focusIdx).toBeGreaterThanOrEqual(0);
    expect(removeIdx).toBeGreaterThan(focusIdx);
  });

  it('changes no focus for a background (non-focused) worktree reap', async () => {
    const calls: string[][] = [];
    const exec = focusGuardHerdr({
      calls,
      targetWs: 'ws-target',
      path: '/repo/wt',
      focused: 'ws-parent', // the main checkout, NOT the ticket worktree
      workspaces: [
        { id: 'ws-target', isLinked: true, repoRoot: '/repo' },
        { id: 'ws-parent', isLinked: false, repoRoot: '/repo' },
      ],
    });
    const executor = herdrTeardown(
      { root: '/repo', launch_watch: INSTANT_WATCH },
      exec,
    );
    await expect(
      executor.removeWorktree('bakers/bb-1-t', '/repo/wt'),
    ).resolves.toBe('removed');
    expect(calls.some((c) => c[0] === 'workspace' && c[1] === 'focus')).toBe(
      false,
    );
    expect(calls.some((c) => c[0] === 'worktree' && c[1] === 'remove')).toBe(
      true,
    );
  });

  it('aborts (no remove, false) when the focused target has no resolvable main checkout', async () => {
    const calls: string[][] = [];
    const exec = focusGuardHerdr({
      calls,
      targetWs: 'ws-target',
      path: '/repo/wt',
      focused: 'ws-target',
      // Only linked worktrees / foreign repos — no non-linked workspace for /repo.
      workspaces: [
        { id: 'ws-target', isLinked: true, repoRoot: '/repo' },
        { id: 'ws-other', isLinked: false, repoRoot: '/other-repo' },
      ],
    });
    const executor = herdrTeardown(
      { root: '/repo', launch_watch: INSTANT_WATCH },
      exec,
    );
    await expect(
      executor.removeWorktree('bakers/bb-1-t', '/repo/wt'),
    ).resolves.toBe('unverified');
    expect(calls.some((c) => c[0] === 'worktree' && c[1] === 'remove')).toBe(
      false,
    );
  });

  it('aborts (no remove, false) when the focus switch does not take', async () => {
    const calls: string[][] = [];
    const exec = focusGuardHerdr({
      calls,
      targetWs: 'ws-target',
      path: '/repo/wt',
      focused: 'ws-target',
      workspaces: [
        { id: 'ws-target', isLinked: true, repoRoot: '/repo' },
        { id: 'ws-parent', isLinked: false, repoRoot: '/repo' },
      ],
      honorFocus: false, // focus command is issued but focus never moves
    });
    const executor = herdrTeardown(
      { root: '/repo', launch_watch: INSTANT_WATCH },
      exec,
    );
    await expect(
      executor.removeWorktree('bakers/bb-1-t', '/repo/wt'),
    ).resolves.toBe('unverified');
    expect(calls.some((c) => c[0] === 'workspace' && c[1] === 'focus')).toBe(
      true,
    );
    expect(calls.some((c) => c[0] === 'worktree' && c[1] === 'remove')).toBe(
      false,
    );
  });

  it('reports unverified (false) when the worktree directory survives the remove', async () => {
    // A real on-disk dir as entry.path; the fake herdr's `worktree remove` does
    // nothing, so the directory survives — the teardown is unverified.
    const dir = mkdtempSync(join(tmpdir(), 'bakers-survive-'));
    try {
      const calls: string[][] = [];
      const exec = focusGuardHerdr({
        calls,
        targetWs: 'ws-target',
        path: dir,
        focused: 'ws-parent', // not focused → guard passes, remove runs
        workspaces: [
          { id: 'ws-target', isLinked: true, repoRoot: '/repo' },
          { id: 'ws-parent', isLinked: false, repoRoot: '/repo' },
        ],
      });
      const executor = herdrTeardown(
        { root: '/repo', launch_watch: INSTANT_WATCH },
        exec,
      );
      await expect(executor.removeWorktree('bakers/bb-1-t', dir)).resolves.toBe(
        'unverified',
      );
      expect(calls.some((c) => c[0] === 'worktree' && c[1] === 'remove')).toBe(
        true,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// Ground-truth for BB-141 RC-1 (AC-1/AC-2): a REAL git worktree that herdr no
// longer tracks must be torn down git-awarely — the directory AND the parent
// repo's `.git/worktrees/<name>` admin entry both gone, leaving no `prunable`
// orphan. Uses real git (the default git runner) with a fake herdr that reports
// an empty worktree list, so it runs in CI with no herdr daemon.
describe('HerdrExecutor.removeWorktree git metadata (real git)', () => {
  function git(cwd: string, args: string[]): string {
    return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' });
  }

  it('removes the directory AND the .git/worktrees entry, leaving no prunable orphan', async () => {
    const repo = mkdtempSync(join(tmpdir(), 'bakers-gitmeta-'));
    try {
      git(repo, ['init', '-q']);
      git(repo, ['config', 'user.email', 'test@example.com']);
      git(repo, ['config', 'user.name', 'test']);
      writeFileSync(join(repo, 'README.md'), 'x\n');
      git(repo, ['add', '-A']);
      git(repo, ['commit', '-qm', 'init']);

      // A linked worktree registered in .git/worktrees/<name> — but NOT via
      // herdr, so herdr's worktree list will not contain it (the lost-track
      // case that produced the prunable orphans).
      const wtName = 'bb-1-t';
      const worktreePath = join(repo, '.bakers-worktrees', wtName);
      git(repo, ['worktree', 'add', '-q', '-b', 'bakers/bb-1-t', worktreePath]);
      const gitMeta = join(repo, '.git', 'worktrees', wtName);
      expect(existsSync(worktreePath)).toBe(true);
      expect(existsSync(gitMeta)).toBe(true);

      // Fake herdr: reports no worktrees at all → removeWorktree takes the
      // git-aware fallback. Real git runner (default, omitted 5th arg).
      const exec = makeFakeHerdr([], {
        'worktree list': JSON.stringify({ result: { worktrees: [] } }),
      });
      const executor = herdrTeardown(
        { root: repo, launch_watch: INSTANT_WATCH },
        exec,
      );

      await expect(
        executor.removeWorktree('bakers/bb-1-t', worktreePath),
      ).resolves.toBe('removed');

      // AC-2: the directory is gone AND so is the .git/worktrees/<name> entry.
      expect(existsSync(worktreePath)).toBe(false);
      // AC-1: no prunable/orphaned entry remains — the admin entry is gone and
      // `git worktree list` no longer lists the path (a raw rm would have left
      // both, the pre-fix defect).
      expect(existsSync(gitMeta)).toBe(false);
      const porcelain = git(repo, ['worktree', 'list', '--porcelain']);
      expect(porcelain).not.toContain(worktreePath);
    } finally {
      try {
        execFileSync('chmod', ['-R', 'u+w', repo]);
      } catch {
        /* ignore */
      }
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it('sweeps a pre-existing orphaned .git/worktrees entry (prunable) when the path is unknown (AC-1 remediation)', async () => {
    const repo = mkdtempSync(join(tmpdir(), 'bakers-gitmeta-'));
    try {
      git(repo, ['init', '-q']);
      git(repo, ['config', 'user.email', 'test@example.com']);
      git(repo, ['config', 'user.name', 'test']);
      writeFileSync(join(repo, 'README.md'), 'x\n');
      git(repo, ['add', '-A']);
      git(repo, ['commit', '-qm', 'init']);

      const wtName = 'bakers-orphan';
      const worktreePath = join(repo, '.bakers-worktrees', wtName);
      git(repo, ['worktree', 'add', '-q', worktreePath]);
      // Simulate the raw-rm leftover: the dir is deleted out of band, so the
      // .git/worktrees/<name> entry becomes prunable ("gitdir points to a
      // non-existent location").
      rmSync(worktreePath, { recursive: true, force: true });
      const gitMeta = join(repo, '.git', 'worktrees', wtName);
      expect(existsSync(gitMeta)).toBe(true);

      const exec = makeFakeHerdr([], {
        'worktree list': JSON.stringify({ result: { worktrees: [] } }),
      });
      const executor = herdrTeardown(
        { root: repo, launch_watch: INSTANT_WATCH },
        exec,
      );

      // Path unknown + branch not resolvable → unverified teardown (false), but
      // the reaper's pass still sweeps the pre-existing orphan metadata.
      await expect(
        executor.removeWorktree('bakers/bb-1-t', undefined),
      ).resolves.toBe('unverified');

      // AC-1 remediation: the orphaned admin entry has been pruned.
      expect(existsSync(gitMeta)).toBe(false);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});

describe('HerdrExecutor.startRun worktree open', () => {
  it('opens a closed worktree from the parent root, never the linked path (Bug A)', async () => {
    const calls: string[][] = [];
    let opened = false;
    const exec = async (args: string[]): Promise<string> => {
      calls.push(args);
      plantStarted(args);
      const key = `${args[0]} ${args[1] ?? ''}`.trim();
      if (key === 'worktree list') {
        // Closed before open (no workspace id); the open flips it.
        return JSON.stringify({
          result: {
            worktrees: [
              {
                branch: 'bakers/bb-1-t',
                path: '/repo/wt',
                ...(opened ? { open_workspace_id: 'ws-9' } : {}),
              },
            ],
          },
        });
      }
      if (key === 'worktree open') {
        opened = true;
        return JSON.stringify({ result: {} });
      }
      if (key === 'tab create') {
        return JSON.stringify({
          result: { root_pane: { pane_id: 'p-1' }, tab: { tab_id: 'tab-1' } },
        });
      }
      return JSON.stringify({ result: {} });
    };
    const executor = new HerdrExecutor(
      { command: 'claude', root: '/parent-root', launch_watch: INSTANT_WATCH },
      exec,
    );
    await executor.startRun(
      spawnInput({ identifier: 'BB-1', state: 'coding', id: 1 }),
    );
    const open = calls.find((c) => c[0] === 'worktree' && c[1] === 'open');
    // Must reattach from the parent repo root — herdr rejects an open whose
    // --cwd is a linked worktree with linked_worktree_source.
    expect(open).toEqual([
      'worktree',
      'open',
      '--cwd',
      '/parent-root',
      '--branch',
      'bakers/bb-1-t',
      '--no-focus',
      '--json',
    ]);
    expect(open).not.toContain('/repo/wt');
  });
});

describe('HerdrExecutor.startRun workspace-id resolution (BB-114)', () => {
  // Build a fake whose `worktree list` shape and `worktree open` result are
  // scripted per test, so we can drive the exact divergences the bug hits.
  function scriptedHerdr(cfg: {
    calls: string[][];
    listBefore: unknown[];
    listAfter?: unknown[];
    openResult: unknown;
  }) {
    let opened = false;
    return async (args: string[]): Promise<string> => {
      cfg.calls.push(args);
      plantStarted(args);
      const key = `${args[0]} ${args[1] ?? ''}`.trim();
      if (key === 'worktree list') {
        return JSON.stringify({
          result: {
            worktrees: opened && cfg.listAfter ? cfg.listAfter : cfg.listBefore,
          },
        });
      }
      if (key === 'worktree open') {
        opened = true;
        return JSON.stringify(cfg.openResult);
      }
      if (key === 'tab create') {
        return JSON.stringify({
          result: { root_pane: { pane_id: 'p-1' }, tab: { tab_id: 'tab-1' } },
        });
      }
      return JSON.stringify({ result: {} });
    };
  }

  const closedInput: SpawnRunInput = {
    ticket: {
      uuid: 't-1',
      identifier: 'BB-1',
      title: 'T',
      branchName: 'feat/x-123-do-a-thing',
      state: 'coding',
    },
    run: { uuid: 'run-1', id: 1, handler: 'code' },
    workspacePath: '/repo/.wt/feat/x-123-do-a-thing',
    instructions: null,
    command: 'claude',
    env: {},
  };

  it('uses the workspace id that `worktree open` returns directly', async () => {
    const calls: string[][] = [];
    const exec = scriptedHerdr({
      calls,
      // closed on disk: no open_workspace_id
      listBefore: [
        { branch: 'feat/x-123-do-a-thing', path: closedInput.workspacePath },
      ],
      // open returns the id in its own JSON; the post-open list is NOT flipped,
      // proving startRun used the returned id rather than re-deriving.
      listAfter: [
        { branch: 'feat/x-123-do-a-thing', path: closedInput.workspacePath },
      ],
      openResult: { result: { workspace: { workspace_id: 'ws-open' } } },
    });
    const executor = new HerdrExecutor(
      { root: '/repo', launch_watch: INSTANT_WATCH },
      exec,
    );
    await expect(executor.startRun(closedInput)).resolves.toEqual({
      sessionRef: 'feat/x-123-do-a-thing',
    });
    const create = calls.find((c) => c[0] === 'tab' && c[1] === 'create');
    expect(create?.[create.indexOf('--workspace') + 1]).toBe('ws-open');
  });

  it('resolves by stable path when the opened worktree HEAD is detached (branch null)', async () => {
    const calls: string[][] = [];
    const exec = scriptedHerdr({
      calls,
      listBefore: [{ branch: null, path: closedInput.workspacePath }],
      // open yields no id in its JSON → fall back to re-list, matched by PATH
      // (branch is null, so a branch match could never hit).
      listAfter: [
        {
          branch: null,
          path: closedInput.workspacePath,
          open_workspace_id: 'ws-det',
        },
      ],
      openResult: { result: {} },
    });
    const executor = new HerdrExecutor(
      { root: '/repo', launch_watch: INSTANT_WATCH },
      exec,
    );
    await expect(executor.startRun(closedInput)).resolves.toEqual({
      sessionRef: 'feat/x-123-do-a-thing',
    });
    const create = calls.find((c) => c[0] === 'tab' && c[1] === 'create');
    expect(create?.[create.indexOf('--workspace') + 1]).toBe('ws-det');
  });

  it('resolves by stable path when the worktree was switched to another branch', async () => {
    const calls: string[][] = [];
    const exec = scriptedHerdr({
      calls,
      listBefore: [
        { branch: 'feat/x-123-renamed', path: closedInput.workspacePath },
      ],
      listAfter: [
        {
          branch: 'feat/x-123-renamed',
          path: closedInput.workspacePath,
          open_workspace_id: 'ws-ren',
        },
      ],
      openResult: { result: {} },
    });
    const executor = new HerdrExecutor(
      { root: '/repo', launch_watch: INSTANT_WATCH },
      exec,
    );
    await expect(executor.startRun(closedInput)).resolves.toEqual({
      sessionRef: 'feat/x-123-do-a-thing',
    });
    const create = calls.find((c) => c[0] === 'tab' && c[1] === 'create');
    expect(create?.[create.indexOf('--workspace') + 1]).toBe('ws-ren');
  });

  it('resolves a workspace id on three dispatches in a row', async () => {
    for (let i = 0; i < 3; i++) {
      const calls: string[][] = [];
      const exec = scriptedHerdr({
        calls,
        listBefore: [
          { branch: 'feat/x-123-do-a-thing', path: closedInput.workspacePath },
        ],
        listAfter: [
          { branch: 'feat/x-123-do-a-thing', path: closedInput.workspacePath },
        ],
        openResult: { result: { worktree: { open_workspace_id: 'ws-open' } } },
      });
      const executor = new HerdrExecutor(
        { root: '/repo', launch_watch: INSTANT_WATCH },
        exec,
      );
      await expect(executor.startRun(closedInput)).resolves.toEqual({
        sessionRef: 'feat/x-123-do-a-thing',
      });
    }
  });

  it('throws with herdr open output + listed worktree state when no id can be resolved', async () => {
    const calls: string[][] = [];
    const exec = scriptedHerdr({
      calls,
      listBefore: [{ branch: null, path: closedInput.workspacePath }],
      // open succeeds but yields no id, and the post-open list has no matching
      // path either — a genuine failure.
      listAfter: [
        {
          branch: 'someone/else',
          path: '/other/wt',
          open_workspace_id: 'ws-other',
        },
      ],
      openResult: { error: { code: 'some_real_cause' } },
    });
    const executor = new HerdrExecutor(
      { root: '/repo', launch_watch: INSTANT_WATCH },
      exec,
    );
    const err = await executor.startRun(closedInput).catch((e) => e as Error);
    expect(err).toBeInstanceOf(Error);
    // Surfaces herdr's own open output …
    expect(err.message).toContain('some_real_cause');
    // … and the listed worktree state (path we looked for).
    expect(err.message).toContain(closedInput.workspacePath);
  });
});

// BB-64: every pane the executor opens for a run is agent-owned, so it gets
// the `BAKERS_AGENT_SHELL=1` marker at shell startup — the root pane via the tab
// it is created with, the layout panes via their split.
describe('HerdrExecutor.startRun agent-shell marker', () => {
  it('marks the agent pane via tab create --env', async () => {
    const calls: string[][] = [];
    const executor = new HerdrExecutor(
      { command: 'claude', launch_watch: INSTANT_WATCH },
      makeFakeHerdr(calls),
    );
    await executor.startRun(
      spawnInput({ identifier: 'BB-1', state: 'coding', id: 1 }),
    );
    const create = calls.find(
      (c) => c[0] === 'tab' && c[1] === 'create',
    ) as string[];
    expect(create[create.indexOf('--env') + 1]).toBe('BAKERS_AGENT_SHELL=1');
  });

  it('marks each configured layout pane via pane split --env', async () => {
    const calls: string[][] = [];
    const executor = new HerdrExecutor(
      {
        command: 'claude',
        launch_watch: INSTANT_WATCH,
        default: { panes: [{ direction: 'down', command: 'echo hi' }] },
      },
      makeFakeHerdr(calls, {
        'pane split': JSON.stringify({ result: { pane: { pane_id: 'sp-1' } } }),
      }),
    );
    await executor.startRun(
      spawnInput({ identifier: 'BB-1', state: 'coding', id: 1 }),
    );
    const split = calls.find(
      (c) => c[0] === 'pane' && c[1] === 'split',
    ) as string[];
    expect(split[split.indexOf('--env') + 1]).toBe('BAKERS_AGENT_SHELL=1');
  });
});

describe('HerdrExecutor.startRun rollback', () => {
  it('closes only the created tab and re-throws when pane run fails', async () => {
    const calls: string[][] = [];
    const exec = fakeExec({ throwOn: 'pane run', calls });
    const executor = makeExecutor(exec);

    const err = await executor.startRun(input).catch((e) => e);

    expect((err as Error).message).toContain('herdr pane run failed');
    const subcommands = calls.map((c) => `${c[0]} ${c[1] ?? ''}`.trim());
    // After the failure, cleanup closed only the tab
    expect(subcommands).toContain('tab close');
    // No workspace close (new model does not close workspace on rollback)
    expect(subcommands).not.toContain('workspace close');
  });

  it('does not close the workspace when reusing an existing workspace', async () => {
    const calls: string[][] = [];
    const exec = fakeExec({
      throwOn: 'pane run',
      calls,
      hasOpenWorkspace: true,
    });
    const executor = makeExecutor(exec);

    const err = await executor.startRun(input).catch((e) => e);

    expect((err as Error).message).toContain('herdr pane run failed');
    const subcommands = calls.map((c) => `${c[0]} ${c[1] ?? ''}`.trim());
    expect(subcommands).toContain('tab close'); // tab still cleaned up
    expect(subcommands).not.toContain('workspace close'); // workspace left intact
    expect(subcommands).not.toContain('workspace create'); // none created
  });
});

describe('herdrExecutor factory root derivation (BB-177)', () => {
  const noopLogger = {
    debug() {},
    info() {},
    warn() {},
    error() {},
  };

  it('derives root from the git common dir (linked worktree → main clone)', async () => {
    const plugin = herdrExecutor({ execGit: async () => '/parent/.git\n' });
    const executor = await plugin.createExecutor(
      {
        config_path: '/parent/.bakers-worktrees/x/.bakers/project.config.js',
      } as never,
      { logger: noopLogger },
    );
    expect(
      (executor as unknown as { options: { root: string } }).options.root,
    ).toBe('/parent');
  });

  it('rejects with.hooks, which the conductor no longer reads from the executor', async () => {
    const plugin = herdrExecutor({
      execGit: async () => '/parent/.git\n',
      hooks: { after_create: 'make worktree' },
    } as never);
    await expect(
      plugin.createExecutor(
        { config_path: '/parent/.bakers/project.config.js' } as never,
        { logger: noopLogger },
      ),
    ).rejects.toThrow(/top-level `hooks`/);
  });

  it('lets options.root override win over git derivation', async () => {
    let gitCalled = false;
    const plugin = herdrExecutor({
      root: '/explicit',
      execGit: async () => {
        gitCalled = true;
        return '/parent/.git';
      },
    });
    const executor = await plugin.createExecutor(
      { config_path: '/somewhere/.bakers/project.config.js' } as never,
      { logger: noopLogger },
    );
    expect(
      (executor as unknown as { options: { root: string } }).options.root,
    ).toBe('/explicit');
    expect(gitCalled).toBe(false);
  });

  it('forwards launch_watch onto the constructed executor', async () => {
    const plugin = herdrExecutor({
      execGit: async () => '/parent/.git\n',
      launch_watch: { timeout_ms: 1234, start_timeout_ms: 5678 },
    });
    const executor = await plugin.createExecutor(
      { config_path: '/parent/.bakers/project.config.js' } as never,
      { logger: noopLogger },
    );
    expect(
      (executor as unknown as { options: { launch_watch?: unknown } }).options
        .launch_watch,
    ).toEqual({ timeout_ms: 1234, start_timeout_ms: 5678 });
  });
});

// BB-211: every executor `worktree list` MUST be anchored with `--cwd <root>`.
// An unanchored `herdr worktree list --json` inherits herdr's ambient selected
// context; after a `bakers-cleanup-*` integration repo is selected then deleted,
// that stale context breaks dispatch (`cannot change to '/tmp/bakers-cleanup-…'`).
// These tests assert the exact argv shape per public call path and reject the
// unanchored variant. RED until the executor anchors all five list call sites.
describe('BB-211 HerdrExecutor worktree list is root-anchored', () => {
  const ROOT = '/repo/main';
  const ANCHORED = ['worktree', 'list', '--cwd', ROOT, '--json'];

  /** All recorded `worktree list` invocations. */
  function listCalls(calls: string[][]): string[][] {
    return calls.filter((c) => c[0] === 'worktree' && c[1] === 'list');
  }

  it('startRun (findOpenWorkspace) lists with --cwd <root>', async () => {
    const calls: string[][] = [];
    const exec = makeFakeHerdr(calls);
    const executor = new HerdrExecutor(
      { command: 'claude', root: ROOT, launch_watch: INSTANT_WATCH },
      exec,
    );
    await executor.startRun({ ...input });
    const lists = listCalls(calls);
    expect(lists.length).toBeGreaterThan(0);
    for (const l of lists) {
      expect(l).toEqual(ANCHORED);
    }
  });

  it('removeWorktree lists with --cwd <root> (reaper path)', async () => {
    const calls: string[][] = [];
    const exec = makeFakeHerdr(calls);
    const executor = herdrTeardown(
      { command: 'claude', root: ROOT, launch_watch: INSTANT_WATCH },
      exec,
    );
    await executor.removeWorktree('bakers/bb-1-t', '/repo/wt');
    const lists = listCalls(calls);
    expect(lists.length).toBeGreaterThan(0);
    for (const l of lists) {
      expect(l).toEqual(ANCHORED);
    }
  });

  it('no executor or teardown code path emits the unanchored ["worktree","list","--json"]', async () => {
    const calls: string[][] = [];
    const exec = makeFakeHerdr(calls);
    const executor = new HerdrExecutor(
      { command: 'claude', root: ROOT, launch_watch: INSTANT_WATCH },
      exec,
    );
    await executor.startRun({ ...input });
    await herdrTeardown({ root: ROOT }, exec).removeWorktree(
      'bakers/bb-1-t',
      '/repo/wt',
    );
    const unanchored = listCalls(calls).filter((l) => !l.includes('--cwd'));
    expect(unanchored).toEqual([]);
  });

  it('regression: a deleted bakers-cleanup context cannot break dispatch listing (AC-5)', async () => {
    // Simulate herdr inheriting a deleted `/tmp/bakers-cleanup-*` context: any
    // list that is NOT anchored to the configured root fails exactly as the
    // real daemon does. An anchored list always succeeds.
    const calls: string[][] = [];
    const staleContextExec = async (args: string[]): Promise<string> => {
      calls.push(args);
      const key = `${args[0]} ${args[1] ?? ''}`.trim();
      if (key === 'worktree list' && !args.includes('--cwd')) {
        throw new Error(
          "cannot change to '/tmp/bakers-cleanup-ABVsDY': No such file or directory",
        );
      }
      return makeFakeHerdr([], {})(args);
    };
    const executor = new HerdrExecutor(
      { command: 'claude', root: ROOT, launch_watch: INSTANT_WATCH },
      staleContextExec,
    );
    // Dispatch listing must succeed against the configured root regardless of
    // the deleted ambient context. RED today: the unanchored list throws.
    await expect(executor.startRun({ ...input })).resolves.toBeDefined();
  });
});

// BB-293. Teardown used to run `git worktree remove --force <path>`
// unconditionally, so an unregistered path made git exit 128 and the shared
// exec helper logged `ERROR: exec failed` for a condition the code EXPECTS.
// Existence has two independent dimensions — git's registration and the
// directory on disk — and the reported failure is exactly the case where they
// disagreed (dir present, registration gone). These tests pin all three
// interesting pairs.
describe('HerdrExecutor.removeWorktree existence probe (BB-293)', () => {
  /** A git runner that answers `worktree list --porcelain` with `porcelain`. */
  function gitWithList(porcelain: string, gitCalls: GitCall[]) {
    return async (args: string[], cwd: string): Promise<string> => {
      gitCalls.push({ args, cwd });
      if (args[0] === 'worktree' && args[1] === 'list') return porcelain;
      return '';
    };
  }

  /** Logger double recording level + message. */
  function spy() {
    const calls: { level: string; msg?: string }[] = [];
    const mk =
      (level: string) =>
      (_o: object, msg?: string): void => {
        calls.push({ level, msg });
      };
    return {
      calls,
      log: {
        debug: mk('debug'),
        info: mk('info'),
        warn: mk('warn'),
        error: mk('error'),
      },
    };
  }

  it('absent in BOTH dimensions: no git remove, no rm, no ERROR → already_absent', async () => {
    const calls: string[][] = [];
    const gitCalls: GitCall[] = [];
    const logger = spy();
    // herdr tracks only a foreign repo's worktree; git lists only the main one.
    const exec = makeFakeHerdr(calls, {
      'worktree list': JSON.stringify({
        result: {
          worktrees: [
            {
              branch: 'other/b',
              path: '/repo/other',
              open_workspace_id: 'ws-x',
            },
          ],
        },
      }),
    });
    const executor = herdrTeardown(
      { root: '/repo' },
      exec,
      logger.log,
      undefined,
      gitWithList('worktree /repo\nbranch refs/heads/main\n', gitCalls),
    );

    await expect(
      executor.removeWorktree('bakers/bb-1-t', '/repo/wt-gone'),
    ).resolves.toBe('already_absent');

    // AC 2: nothing was performed for the absent worktree...
    expect(
      gitCalls.some((g) => g.args[0] === 'worktree' && g.args[1] === 'remove'),
    ).toBe(false);
    const subcommands = calls.map((c) => `${c[0]} ${c[1] ?? ''}`.trim());
    expect(subcommands).not.toContain('worktree remove');
    expect(subcommands).not.toContain('worktree open');
    // ...and this executor logged no ERROR for the absence either.
    //
    // Note what this last assertion does and does NOT pin: `runGit` is a double
    // here, so the shared exec helper that emits `ERROR: exec failed` is never
    // reached and could not log whatever the code did. The assertion that
    // actually pins AC 2 is the `worktree remove` git-call check above — the
    // ERROR was a CONSEQUENCE of that call, so proving the call never happens is
    // what proves the ERROR cannot. This one only guards the executor's own
    // logger against a future `this.logger.error` on the absent path.
    expect(logger.calls.some((c) => c.level === 'error')).toBe(false);
    // AC 3 (executor half): the absence is stated, not swallowed.
    expect(logger.calls.some((c) => c.level === 'info')).toBe(true);
  });

  it('registered but gone from disk: sweeps the prunable entry → removed', async () => {
    const calls: string[][] = [];
    const gitCalls: GitCall[] = [];
    const exec = makeFakeHerdr(calls, {
      'worktree list': JSON.stringify({ result: { worktrees: [] } }),
    });
    const executor = herdrTeardown(
      { root: '/repo' },
      exec,
      undefined,
      undefined,
      gitWithList(
        'worktree /repo\nbranch refs/heads/main\n\n' +
          'worktree /repo/wt-gone\nbranch refs/heads/bakers/bb-1-t\nprunable gitdir file points to non-existent location\n',
        gitCalls,
      ),
    );

    await expect(
      executor.removeWorktree('bakers/bb-1-t', '/repo/wt-gone'),
    ).resolves.toBe('removed');

    // The BB-141 sweep intent survives exactly where a prunable admin entry
    // of ours can actually exist.
    expect(
      gitCalls.some(
        (g) =>
          g.args[0] === 'worktree' &&
          g.args[1] === 'prune' &&
          g.cwd === '/repo',
      ),
    ).toBe(true);
    expect(
      gitCalls.some((g) => g.args[0] === 'worktree' && g.args[1] === 'remove'),
    ).toBe(false);
  });

  it('on disk but NOT registered: reclaims the dir without git worktree remove', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bb-293-'));
    const calls: string[][] = [];
    const gitCalls: GitCall[] = [];
    const logger = spy();
    const exec = makeFakeHerdr(calls, {
      'worktree list': JSON.stringify({ result: { worktrees: [] } }),
    });
    const executor = herdrTeardown(
      { root: dir },
      exec,
      logger.log,
      undefined,
      // git knows nothing about the directory — the reported failure's shape.
      gitWithList(`worktree ${dir}\nbranch refs/heads/main\n`, gitCalls),
    );
    const stray = join(dir, 'stray');
    mkdirSync(stray);

    await expect(executor.removeWorktree('bakers/bb-1-t', stray)).resolves.toBe(
      'removed',
    );

    expect(existsSync(stray)).toBe(false);
    // The exit-128 call that produced the bogus ERROR never runs.
    expect(
      gitCalls.some((g) => g.args[0] === 'worktree' && g.args[1] === 'remove'),
    ).toBe(false);
    expect(logger.calls.some((c) => c.level === 'error')).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });
  // BB-293 spec D5. The reported failure's SECOND mode: the directory
  // reclaim threw EACCES, the throw propagated out of removeWorktree, and the
  // reaper logged an opaque `worktree teardown failed`. The outcome is
  // deliberately unchanged (warn, cleaned_up=0, retry) — what changes is that
  // the log names the reclaim as the failing step instead of surfacing a bare
  // exception. The root cause (foreign file ownership, which chmod cannot
  // repair) is split into its own ticket.
  //
  // Root can unlink regardless of permission bits, so this cannot be provoked
  // as root at all.
  it.skipIf(process.getuid?.() === 0)(
    'a reclaim that cannot remove the directory reports unverified, not a throw',
    async () => {
      const calls: string[][] = [];
      const gitCalls: GitCall[] = [];
      const logger = spy();
      const exec = makeFakeHerdr(calls, {
        'worktree list': JSON.stringify({ result: { worktrees: [] } }),
      });
      const dir = mkdtempSync(join(tmpdir(), 'bb-293-eacces-'));
      const executor = herdrTeardown(
        { root: dir },
        exec,
        logger.log,
        undefined,
        gitWithList(`worktree ${dir}\nbranch refs/heads/main\n`, gitCalls),
      );
      const target = join(dir, 'wt');
      mkdirSync(join(target, 'inner'), { recursive: true });
      // The undeletable bit must survive `restoreWritable`, which re-adds owner
      // write to every entry INSIDE the tree it is given — so hardening the
      // target itself would simply be repaired. Denying write on the CONTAINING
      // directory is what `restoreWritable(target)` structurally cannot fix:
      // unlinking `wt` needs write on `dir`. That is the same class of failure
      // as the reported one (a leftover whose removal is refused), reproduced
      // without needing a second uid.
      chmodSync(dir, 0o500);

      try {
        await expect(
          executor.removeWorktree('bakers/bb-1-t', target),
        ).resolves.toBe('unverified');
        expect(
          logger.calls.some(
            (c) =>
              c.level === 'warn' &&
              c.msg === 'worktree directory reclaim failed',
          ),
        ).toBe(true);
      } finally {
        chmodSync(dir, 0o700);
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );

  // BB-293 review, finding 1. A ROOTLESS executor — no configured parent root
  // — must still be able to see a worktree as REGISTERED. With no root the probe
  // runs git inside the worktree itself, and the old exclusion filter dropped
  // every entry whose path equalled the cwd git was run in: exactly the entry
  // being asked about. `registered` was therefore structurally false, so a
  // genuinely registered worktree was reclaimed as a raw directory and its
  // `.git/worktrees/<name>` admin entry left behind as a prunable orphan — the
  // BB-141 defect, reintroduced through the back door. Unreachable in
  // production, where `herdrExecutor()` always derives a root, and every other
  // probe test passes one, so nothing covered the fallback at all.
  it('rootless: a registered worktree is still seen as registered', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bb-293-rootless-'));
    const calls: string[][] = [];
    const gitCalls: GitCall[] = [];
    const exec = makeFakeHerdr(calls, {
      'worktree list': JSON.stringify({ result: { worktrees: [] } }),
    });
    const target = join(dir, 'wt');
    mkdirSync(target);
    const executor = herdrTeardown(
      {}, // no root — the fallback this test exists for
      exec,
      undefined,
      undefined,
      // git's porcelain lists the MAIN worktree first, then the linked one.
      gitWithList(
        `worktree ${dir}\nbranch refs/heads/main\n\n` +
          `worktree ${target}\nbranch refs/heads/bakers/bb-1-t\n`,
        gitCalls,
      ),
    );

    await expect(
      executor.removeWorktree('bakers/bb-1-t', target),
    ).resolves.toBe('removed');

    // Registration was seen, so the teardown is GIT-AWARE: git drops the admin
    // entry instead of a raw reclaim orphaning it.
    expect(
      gitCalls.some((g) => g.args[0] === 'worktree' && g.args[1] === 'remove'),
    ).toBe(true);
    expect(existsSync(target)).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });
});
