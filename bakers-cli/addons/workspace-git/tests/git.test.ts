import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GitWorkspace } from '../src/index.js';

// Fake git runner: records argv and emulates `worktree add` creating the leaf dir.
function recordingGit(record: string[][]) {
  return async (args: string[]): Promise<void> => {
    record.push(args);
    const addIdx = args.indexOf('add');
    if (addIdx !== -1) {
      mkdirSync(args[args.length - 1] as string, { recursive: true });
    }
  };
}

describe('GitWorkspace', () => {
  it('derives the workspace key by normalizing unsafe characters', () => {
    const manager = new GitWorkspace({ root: '/tmp/x' });
    expect(manager.keyFor('GL-123')).toBe('GL-123');
    expect(manager.keyFor('weird/../Path Stuff!')).toBe('weird_.._Path_Stuff_');
    expect(manager.keyFor('a/b')).toBe('a_b');
  });

  it('adds a git worktree under <root>-worktrees with branch bakers/<key>', async () => {
    const root = mkdtempSync(join(tmpdir(), 'bakers-ws-'));
    const git: string[][] = [];
    const manager = new GitWorkspace({ root, runGit: recordingGit(git) });

    const ws = await manager.ensure('GL-9');

    expect(ws.path).toBe(join(`${root}-worktrees`, 'GL-9'));
    expect(ws.instructions).toBeNull();
    expect(existsSync(ws.path)).toBe(true);
    expect(git).toHaveLength(1);
    expect(git[0]).toEqual([
      '-C',
      root,
      'worktree',
      'add',
      '--force',
      '-B',
      'bakers/GL-9',
      join(`${root}-worktrees`, 'GL-9'),
    ]);
  });

  it('puts the title slug in the branch but keeps the worktree key stable', async () => {
    const root = mkdtempSync(join(tmpdir(), 'bakers-ws-'));
    const git: string[][] = [];
    const manager = new GitWorkspace({ root, runGit: recordingGit(git) });

    const ws = await manager.ensure('bb-7ea7b5', 'Readable herdr tab names');

    // Worktree dir key stays identifier-only → reuse is unaffected.
    expect(ws.path).toBe(join(`${root}-worktrees`, 'bb-7ea7b5'));
    // Branch carries the readable slug, no run/uuid fragment.
    const branchIdx = git[0].indexOf('-B');
    expect(git[0][branchIdx + 1]).toBe(
      'bakers/bb-7ea7b5-readable-herdr-tab-names',
    );
  });

  it('omits the trailing separator when there is no title', async () => {
    const root = mkdtempSync(join(tmpdir(), 'bakers-ws-'));
    const git: string[][] = [];
    const manager = new GitWorkspace({ root, runGit: recordingGit(git) });

    await manager.ensure('GL-9');

    const branchIdx = git[0].indexOf('-B');
    expect(git[0][branchIdx + 1]).toBe('bakers/GL-9');
  });

  it('renders a project-supplied branch template (config-driven)', () => {
    const manager = new GitWorkspace({
      root: '/tmp/x',
      branchPrefix: 'wt/',
      branchTemplate: '{branchPrefix}{titleSlug}--{key}',
    });
    expect(manager.branchFor('GL-9', 'Some Title')).toBe('wt/some-title--GL-9');
  });

  it('loads WORKFLOW.md as instructions when present', async () => {
    const root = mkdtempSync(join(tmpdir(), 'bakers-ws-'));
    const git: string[][] = [];
    const manager = new GitWorkspace({
      root,
      runGit: async (args) => {
        git.push(args);
        const path = args[args.length - 1] as string;
        mkdirSync(path, { recursive: true });
        writeFileSync(join(path, 'WORKFLOW.md'), 'do the thing');
      },
    });

    const ws = await manager.ensure('GL-2');
    expect(ws.instructions).not.toBeNull();
    expect(ws.instructions?.text).toBe('do the thing');
    expect(ws.instructions?.path).toBe(join(ws.path, 'WORKFLOW.md'));
    expect(ws.instructions?.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is idempotent: an existing worktree is reused without a new add', async () => {
    const root = mkdtempSync(join(tmpdir(), 'bakers-ws-'));
    const git: string[][] = [];
    const manager = new GitWorkspace({ root, runGit: recordingGit(git) });

    const first = await manager.ensure('GL-9');
    const second = await manager.ensure('GL-9');

    expect(second.path).toBe(first.path);
    expect(git).toHaveLength(1);
  });

  // BB-84: the workspace no longer invokes hooks — it only reports whether it
  // created a fresh worktree so the executor can run after_create just once.
  it('reports created=true on a fresh worktree and created=false on reuse', async () => {
    const root = mkdtempSync(join(tmpdir(), 'bakers-ws-'));
    const manager = new GitWorkspace({ root, runGit: recordingGit([]) });

    const fresh = await manager.ensure('GL-1');
    const reused = await manager.ensure('GL-1');

    expect(fresh.created).toBe(true);
    expect(reused.created).toBe(false);
  });

  it('rejects identifiers that normalize to empty or dot-leading keys', async () => {
    const manager = new GitWorkspace({
      root: '/tmp/x',
      runGit: recordingGit([]),
    });
    await expect(manager.ensure('')).rejects.toThrow(/invalid workspace/);
    await expect(manager.ensure('.')).rejects.toThrow(/invalid workspace/);
    await expect(manager.ensure('..')).rejects.toThrow(/invalid workspace/);
    await expect(manager.ensure('.hidden')).rejects.toThrow(
      /invalid workspace/,
    );
  });

  it('removes a worktree via git worktree remove', async () => {
    const root = mkdtempSync(join(tmpdir(), 'bakers-ws-'));
    const git: string[][] = [];
    const manager = new GitWorkspace({ root, runGit: recordingGit(git) });

    await manager.ensure('GL-9');
    git.length = 0;
    await manager.remove('GL-9');

    expect(git[0]).toEqual([
      '-C',
      root,
      'worktree',
      'remove',
      '--force',
      join(`${root}-worktrees`, 'GL-9'),
    ]);
  });
});
