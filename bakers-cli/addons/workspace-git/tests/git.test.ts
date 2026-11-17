import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GitWorkspace } from '../src/index.js';

// Fake git runner: records argv, echoes the checked ref name and emulates
// `worktree add` creating the leaf dir.
function recordingGit(record: string[][]) {
  return async (args: string[]): Promise<string | undefined> => {
    record.push(args);
    if (args.includes('check-ref-format')) return `${args.at(-1)}\n`;
    const addIdx = args.indexOf('add');
    if (addIdx !== -1) {
      mkdirSync(args[addIdx + 1] as string, { recursive: true });
    }
    return undefined;
  };
}

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();
const ident = ['-c', 'user.name=test', '-c', 'user.email=test@test'];

function repo(): string {
  const root = join(mkdtempSync(join(tmpdir(), 'bakers-ws-')), 'repo');
  mkdirSync(root);
  git(root, 'init', '-q', '-b', 'main');
  writeFileSync(join(root, 'README'), 'base');
  git(root, 'add', '.');
  git(root, ...ident, 'commit', '-qm', 'base');
  return root;
}

describe('GitWorkspace', () => {
  it('checks out the ticket branch under <root>/.bakers-worktrees/<branch>', async () => {
    const root = repo();

    const ws = await new GitWorkspace({ root }).ensure(
      'HERDRAPP-1',
      'feat/herdrapp-1-x',
    );

    expect(ws.path).toBe(join(root, '.bakers-worktrees', 'feat/herdrapp-1-x'));
    expect(ws.created).toBe(true);
    expect(git(ws.path, 'branch', '--show-current')).toBe('feat/herdrapp-1-x');
    expect(git(root, 'branch', '--list', 'bakers/*')).toBe('');
    expect(existsSync(`${root}-worktrees`)).toBe(false);
  });

  it('requires a branch before it runs git or creates a path', async () => {
    const root = mkdtempSync(join(tmpdir(), 'bakers-ws-'));
    const calls: string[][] = [];
    const ws = new GitWorkspace({ root, runGit: recordingGit(calls) });

    await expect(ws.ensure('GL-9')).rejects.toThrow(/requires a branch/);
    expect(calls).toEqual([]);
    expect(readdirSync(root)).toEqual([]);
  });

  it.each([
    'feat/../x',
    '../x',
    '/abs',
    '-x',
    '.hidden',
    'a b',
    '@{-1}',
  ])('rejects the branch %j before it creates anything', async (branch) => {
    const root = repo();

    await expect(
      new GitWorkspace({ root }).ensure('GL-9', branch),
    ).rejects.toThrow(/invalid branch name/);
    expect(existsSync(join(root, '.bakers-worktrees'))).toBe(false);
    expect(git(root, 'branch', '--format=%(refname:short)')).toBe('main');
  });

  it('places new worktrees in worktreeDir, relative to root or absolute', async () => {
    const root = mkdtempSync(join(tmpdir(), 'bakers-ws-'));
    const abs = mkdtempSync(join(tmpdir(), 'bakers-wt-'));
    const at = (worktreeDir: string) =>
      new GitWorkspace({ root, worktreeDir, runGit: recordingGit([]) })
        .ensure('GL-9', 'feat/gl-9-x')
        .then((w) => w.path);

    expect(await at('wt')).toBe(join(root, 'wt', 'feat/gl-9-x'));
    expect(await at(abs)).toBe(join(abs, 'feat/gl-9-x'));
  });

  it("reuses the branch's existing worktree where it lives, unmoved", async () => {
    const root = repo();
    const old = `${root}-worktrees/GL-9`;
    git(root, 'worktree', 'add', '-qb', 'feat/gl-9-x', old);

    const ws = await new GitWorkspace({ root }).ensure('GL-9', 'feat/gl-9-x');

    expect(ws).toMatchObject({ path: old, created: false });
    expect(existsSync(join(root, '.bakers-worktrees'))).toBe(false);
  });

  it('checks out an existing ticket branch without resetting it', async () => {
    const root = repo();
    git(root, 'checkout', '-qb', 'feat/gl-9-x');
    writeFileSync(join(root, 'work'), 'done');
    git(root, 'add', '.');
    git(root, ...ident, 'commit', '-qm', 'work');
    const tip = git(root, 'rev-parse', 'HEAD');
    git(root, 'checkout', '-q', 'main');

    const ws = await new GitWorkspace({ root }).ensure('GL-9', 'feat/gl-9-x');

    expect(git(ws.path, 'rev-parse', 'HEAD')).toBe(tip);
  });

  it('loads WORKFLOW.md as instructions when present', async () => {
    const root = repo();
    writeFileSync(join(root, 'WORKFLOW.md'), 'do the thing');
    git(root, 'add', '.');
    git(root, ...ident, 'commit', '-qm', 'workflow');

    const ws = await new GitWorkspace({ root }).ensure('GL-2', 'feat/gl-2');
    expect(ws.instructions?.text).toBe('do the thing');
    expect(ws.instructions?.path).toBe(join(ws.path, 'WORKFLOW.md'));
    expect(ws.instructions?.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is idempotent: created on first ensure, reused after', async () => {
    const root = repo();
    const manager = new GitWorkspace({ root });

    const fresh = await manager.ensure('GL-1', 'feat/gl-1');
    const reused = await manager.ensure('GL-1', 'feat/gl-1');

    expect(reused.path).toBe(fresh.path);
    expect(fresh.created).toBe(true);
    expect(reused.created).toBe(false);
  });
});
