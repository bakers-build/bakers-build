import { describe, expect, it } from 'vitest';
import { deriveHerdrRoot } from '../src/root-anchor.js';

/** A recorded git invocation: (args, cwd). */
type GitCall = { args: string[]; cwd: string };

/** Recording git exec: captures (args, cwd) and returns the canned stdout. */
function recordingGit(calls: GitCall[], stdout: string) {
  return async (args: string[], cwd: string): Promise<string> => {
    calls.push({ args, cwd });
    return stdout;
  };
}

describe('deriveHerdrRoot', () => {
  it('derives the main clone from git --git-common-dir when run inside a linked worktree', async () => {
    // A checked-in .bakers/ makes config discovery walk up to the worktree-local
    // config; its dirname IS the linked worktree — the bug (BB-177).
    const configPath =
      '/parent/.bakers-worktrees/x/.bakers/conductor.config.js';
    const calls: GitCall[] = [];
    const root = await deriveHerdrRoot(configPath, {
      execGit: recordingGit(calls, '/parent/.git\n'),
    });
    expect(root).toBe('/parent');
    // git was asked for the shared common dir, from the config dir.
    expect(calls).toHaveLength(1);
    expect(calls[0].args).toEqual([
      'rev-parse',
      '--path-format=absolute',
      '--git-common-dir',
    ]);
    expect(calls[0].cwd).toBe('/parent/.bakers-worktrees/x/.bakers');
  });

  it('lets an explicit override win and never invokes git', async () => {
    const calls: GitCall[] = [];
    const root = await deriveHerdrRoot(
      '/anywhere/.bakers/conductor.config.js',
      {
        override: '/explicit',
        execGit: recordingGit(calls, '/should/not/matter/.git'),
      },
    );
    expect(root).toBe('/explicit');
    expect(calls).toHaveLength(0);
  });

  it('falls back to dirname(config_path) when git fails (e.g. not a repo)', async () => {
    const root = await deriveHerdrRoot(
      '/some/repo/.bakers/conductor.config.js',
      {
        execGit: async () => {
          throw new Error('not a git repository');
        },
      },
    );
    expect(root).toBe('/some/repo/.bakers');
  });

  it('falls back to process.cwd() when there is no config_path', async () => {
    const root = await deriveHerdrRoot(undefined, {
      execGit: async () => '/never/.git',
    });
    expect(root).toBe(process.cwd());
  });
});
