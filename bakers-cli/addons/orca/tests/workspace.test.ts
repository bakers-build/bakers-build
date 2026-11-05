import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ConductorLogger } from '@bakers-build/core';
import { afterEach, describe, expect, it } from 'vitest';
import { OrcaWorkspace, orcaWorkspace } from '../src/workspace.js';
import { fakeOrca, notFound } from './fakes.js';

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

function tmpRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'orca-ws-'));
  roots.push(root);
  return root;
}

/** A scripted git: `refs` are the refs that `rev-parse --verify` knows. */
function fakeGit(opts: { refs?: string[]; porcelain?: string } = {}) {
  const calls: string[][] = [];
  const git = async (args: string[]) => {
    calls.push(args);
    if (args.includes('--porcelain')) return opts.porcelain ?? '';
    if (args.includes('@{u}')) return 'origin/develop\n';
    if (args.includes('--verify')) {
      const ref = args[args.length - 1]?.replace(/\^\{commit\}$/, '');
      if (ref && (opts.refs ?? []).includes(ref)) return 'abc\n';
      throw new Error('unknown revision');
    }
    return '';
  };
  return { git, calls };
}

const noSleep = async () => {};

function workspace(
  root: string,
  orca: ReturnType<typeof fakeOrca>['orca'],
  git: ReturnType<typeof fakeGit>['git'],
  extra: Partial<ConstructorParameters<typeof OrcaWorkspace>[0]> = {},
) {
  return new OrcaWorkspace({
    root,
    execOrca: orca,
    execGit: git,
    sleep: noSleep,
    ...extra,
  });
}

function worktreeAdds(calls: string[][]): string[][] {
  return calls.filter((c) => c.includes('worktree') && c.includes('add'));
}

describe('OrcaWorkspace.ensure', () => {
  it('fails before touching git when the Orca runtime is not reachable', async () => {
    const root = tmpRoot();
    const { orca } = fakeOrca({
      status: () => ({ runtime: { reachable: false, state: 'not_running' } }),
    });
    const { git, calls } = fakeGit();
    await expect(
      workspace(root, orca, git).ensure('BAKERS-1', 'feat/x'),
    ).rejects.toThrow(/not reachable \(state: not_running\)/);
    expect(calls).toEqual([]);
  });

  it('registers an unknown repo and shows its external worktrees', async () => {
    const root = tmpRoot();
    const { orca, calls } = fakeOrca({ 'repo list': () => ({ repos: [] }) });
    await workspace(root, orca, fakeGit().git).ensure('BAKERS-1', 'feat/x');
    expect(calls).toContainEqual(['repo', 'add', '--path', root]);
    expect(calls).toContainEqual([
      'repo',
      'set',
      '--repo',
      `path:${root}`,
      '--external-worktree-visibility',
      'show',
    ]);
  });

  it('does not re-add a repo Orca already knows', async () => {
    const root = tmpRoot();
    const { orca, calls } = fakeOrca({
      'repo list': () => ({ repos: [{ path: root }] }),
    });
    await workspace(root, orca, fakeGit().git).ensure('BAKERS-1', 'feat/x');
    expect(calls.some((c) => c[0] === 'repo' && c[1] === 'add')).toBe(false);
  });

  it('creates a fresh branch from the base ref and reports created=true', async () => {
    const root = tmpRoot();
    const { orca, calls } = fakeOrca();
    const { git, calls: gitCalls } = fakeGit();
    const result = await workspace(root, orca, git).ensure(
      'BAKERS-1',
      'feat/x',
    );
    const path = join(root, '.bakers-worktrees', 'feat/x');
    expect(result.path).toBe(path);
    expect(result.created).toBe(true);
    expect(worktreeAdds(gitCalls)).toEqual([
      ['-C', root, 'worktree', 'add', '-b', 'feat/x', path, 'origin/develop'],
    ]);
    expect(calls).toContainEqual([
      'worktree',
      'show',
      '--worktree',
      `path:${path}`,
    ]);
  });

  it('checks out an existing local branch without -b or -B', async () => {
    const root = tmpRoot();
    const { git, calls } = fakeGit({ refs: ['refs/heads/feat/x'] });
    await workspace(root, fakeOrca().orca, git).ensure('BAKERS-1', 'feat/x');
    const path = join(root, '.bakers-worktrees', 'feat/x');
    expect(worktreeAdds(calls)).toEqual([
      ['-C', root, 'worktree', 'add', path, 'feat/x'],
    ]);
  });

  it('checks out a branch that only exists on origin without tracking it', async () => {
    const root = tmpRoot();
    const { git, calls } = fakeGit({ refs: ['refs/remotes/origin/feat/x'] });
    await workspace(root, fakeOrca().orca, git).ensure('BAKERS-1', 'feat/x');
    const path = join(root, '.bakers-worktrees', 'feat/x');
    expect(worktreeAdds(calls)).toEqual([
      ['-C', root, 'worktree', 'add', '-b', 'feat/x', path, 'origin/feat/x'],
    ]);
  });

  it('sets branch.autoSetupMerge=false in the root and gives the run push.default=current', async () => {
    const root = tmpRoot();
    execFileSync('git', ['init', '-q', root]);
    const ws = await workspace(root, fakeOrca().orca, fakeGit().git).ensure(
      'BAKERS-1',
      'feat/x',
    );
    expect(
      execFileSync('git', ['-C', root, 'config', 'branch.autoSetupMerge'], {
        encoding: 'utf8',
      }).trim(),
    ).toBe('false');
    const env = ws.env ?? {};
    const last = Number(env.GIT_CONFIG_COUNT) - 1;
    expect(env[`GIT_CONFIG_KEY_${last}`]).toBe('push.default');
    expect(env[`GIT_CONFIG_VALUE_${last}`]).toBe('current');
  });

  it('tracks a branch that only exists on origin with autoSetupMerge: true', async () => {
    const root = tmpRoot();
    const { git, calls } = fakeGit({ refs: ['refs/remotes/origin/feat/x'] });
    const ws = await workspace(root, fakeOrca().orca, git, {
      autoSetupMerge: true,
    }).ensure('BAKERS-1', 'feat/x');
    expect(ws.env).toBeUndefined();
    const path = join(root, '.bakers-worktrees', 'feat/x');
    expect(worktreeAdds(calls)).toEqual([
      [
        '-C',
        root,
        'worktree',
        'add',
        '--track',
        '-b',
        'feat/x',
        path,
        'origin/feat/x',
      ],
    ]);
  });

  it('reuses a registered worktree on disk without applying the open layout', async () => {
    const root = tmpRoot();
    const path = join(root, '.bakers-worktrees', 'feat/x');
    mkdirSync(path, { recursive: true });
    const { git, calls: gitCalls } = fakeGit({
      porcelain: `worktree ${root}\nbranch refs/heads/develop\n\nworktree ${path}\nbranch refs/heads/feat/x\n`,
    });
    const { orca, calls } = fakeOrca();
    const ws = workspace(root, orca, git);
    const result = await ws.ensure('BAKERS-1', 'feat/x');
    expect(result.created).toBe(false);
    expect(worktreeAdds(gitCalls)).toEqual([]);
    await ws.applyOpenLayout(path, {
      identifier: 'BAKERS-1',
      branch: 'feat/x',
      title: 'T',
    });
    expect(calls.some((c) => c[0] === 'terminal')).toBe(false);
  });

  it('waits until Orca adopts the new worktree', async () => {
    const root = tmpRoot();
    let shows = 0;
    const { orca } = fakeOrca({
      'worktree show': () => {
        shows++;
        if (shows < 3) notFound();
        return { worktree: {} };
      },
    });
    await expect(
      workspace(root, orca, fakeGit().git).ensure('BAKERS-1', 'feat/x'),
    ).resolves.toBeDefined();
    expect(shows).toBe(3);
  });

  it('gives up when Orca never adopts the worktree', async () => {
    const root = tmpRoot();
    const { orca } = fakeOrca({ 'worktree show': () => notFound() });
    await expect(
      workspace(root, orca, fakeGit().git, { adoptTimeoutMs: 3000 }).ensure(
        'BAKERS-1',
        'feat/x',
      ),
    ).rejects.toThrow(/Orca did not pick up worktree .* within 3s/);
  });
});

describe('OrcaWorkspace.applyOpenLayout', () => {
  const ctx = {
    identifier: 'BAKERS-1',
    branch: 'feat/x',
    title: 'Fix the labels',
  };

  it('opens the ticket overview terminal on a freshly created worktree', async () => {
    const root = tmpRoot();
    const { orca, calls } = fakeOrca();
    const ws = workspace(root, orca, fakeGit().git);
    const { path } = await ws.ensure('BAKERS-1', 'feat/x');
    await ws.applyOpenLayout(path, ctx);
    expect(calls).toContainEqual([
      'terminal',
      'create',
      '--worktree',
      `path:${path}`,
      '--title',
      'BAKERS-1 · Fix the labels',
      '--command',
      'bakers ui --ticket BAKERS-1',
    ]);
  });

  it('opens nothing with open: {}', async () => {
    const root = tmpRoot();
    const { orca, calls } = fakeOrca();
    const ws = workspace(root, orca, fakeGit().git, { open: {} });
    const { path } = await ws.ensure('BAKERS-1', 'feat/x');
    await ws.applyOpenLayout(path, ctx);
    expect(calls.some((c) => c[0] === 'terminal')).toBe(false);
  });

  it('logs and swallows a failing terminal create', async () => {
    const root = tmpRoot();
    const warnings: unknown[] = [];
    const logger: ConductorLogger = {
      debug() {},
      info() {},
      warn(obj: object) {
        warnings.push(obj);
      },
      error() {},
    };
    const { orca } = fakeOrca({
      'terminal create': () => {
        throw new Error('boom');
      },
    });
    // tmpRoot() is no repository; count only layout warnings.
    const ws = workspace(root, orca, fakeGit().git, {
      logger,
      autoSetupMerge: true,
    });
    const { path } = await ws.ensure('BAKERS-1', 'feat/x');
    await expect(ws.applyOpenLayout(path, ctx)).resolves.toBeUndefined();
    expect(warnings).toHaveLength(1);
  });
});

describe('orcaWorkspace factory', () => {
  it('derives the root from the git common dir', async () => {
    const plugin = orcaWorkspace({ execGit: async () => '/parent/.git\n' });
    expect(plugin.id).toBe('orca');
    const ws = await plugin.createWorkspace({
      config_path: '/parent/.bakers-worktrees/x/.bakers/conductor.config.js',
    } as never);
    expect((ws as unknown as { root: string }).root).toBe('/parent');
  });
});
