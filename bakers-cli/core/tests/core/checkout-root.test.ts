import { describe, expect, it } from 'vitest';
import {
  configHomeOf,
  deriveCheckoutRoot,
} from '../../src/core/checkout-root.js';

/** A recorded git invocation: (args, cwd). */
type GitCall = { args: string[]; cwd: string };

/** Recording git exec: captures (args, cwd) and returns the canned stdout. */
function recordingGit(calls: GitCall[], stdout: string) {
  return async (args: string[], cwd: string): Promise<string> => {
    calls.push({ args, cwd });
    return stdout;
  };
}

describe('deriveCheckoutRoot', () => {
  it('derives the main clone from git --git-common-dir when run inside a linked worktree', async () => {
    // A checked-in .bakers/ makes config discovery walk up to the worktree-local
    // config; its dirname IS the linked worktree — the bug (BB-177).
    const configPath =
      '/parent/.bakers-worktrees/x/.bakers/conductor.config.js';
    const calls: GitCall[] = [];
    const root = await deriveCheckoutRoot(configPath, {
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

  it('derives the plain-checkout root the same way when not inside a linked worktree', async () => {
    const configPath = '/repo/.bakers/conductor.config.js';
    const calls: GitCall[] = [];
    const root = await deriveCheckoutRoot(configPath, {
      execGit: recordingGit(calls, '/repo/.git\n'),
    });
    expect(root).toBe('/repo');
  });

  it('lets an explicit override win and never invokes git', async () => {
    const calls: GitCall[] = [];
    const root = await deriveCheckoutRoot(
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
    const root = await deriveCheckoutRoot(
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
    const root = await deriveCheckoutRoot(undefined, {
      execGit: async () => '/never/.git',
    });
    expect(root).toBe(process.cwd());
  });
});

describe('configHomeOf', () => {
  it('derives <checkout root>/.bakers', () => {
    expect(configHomeOf('/repo')).toBe('/repo/.bakers');
  });
});
