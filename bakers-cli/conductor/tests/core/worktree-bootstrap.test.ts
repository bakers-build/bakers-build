import { execFileSync, spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

/**
 * BB-237 — `.ddev/worktree-post.sh` must run to its end and write its sentinel.
 * With `conductor.config.local.js` gone, the script copies only
 * `audience.local.md` from the parent and no longer rewrites a base_url.
 */

/** Walks up from this test file to the repo root (the dir that holds WORKFLOW.md). */
function repoRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, 'WORKFLOW.md'))) return dir;
    dir = dirname(dir);
  }
  throw new Error('WORKFLOW.md not found walking up from the test file');
}

const tmpRoots: string[] = [];

afterEach(() => {
  while (tmpRoots.length) {
    rmSync(tmpRoots.pop() as string, { recursive: true, force: true });
  }
});

/** The parent's retired local config: it must NOT reach the worktree. */
const PARENT_CONFIG = `export default { base_url: 'https://develop.dev.bakers.build' };\n`;
const PARENT_AUDIENCE = '# audience\n';

/**
 * Builds a real parent repo + linked worktree so the script's own
 * `git worktree list | head -1` resolves the parent. The worktree deliberately
 * carries NO `bakers-cli/package.json`, so the script skips the pnpm build and
 * exercises exactly the copy → sentinel window.
 */
function makeWorktreeFixture(): { parent: string; worktree: string } {
  const root = mkdtempSync(join(tmpdir(), 'bb-237-'));
  tmpRoots.push(root);
  const parent = join(root, 'parent with spaces');
  const worktree = join(root, 'wt');
  mkdirSync(parent, { recursive: true });
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: parent, encoding: 'utf8' });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'test');
  git('commit', '-q', '--allow-empty', '-m', 'root');
  mkdirSync(join(parent, '.bakers'), { recursive: true });
  writeFileSync(
    join(parent, '.bakers/conductor.config.local.js'),
    PARENT_CONFIG,
    'utf8',
  );
  writeFileSync(
    join(parent, '.bakers/audience.local.md'),
    PARENT_AUDIENCE,
    'utf8',
  );
  git('worktree', 'add', '-q', '-b', 'feat/bb-237-fixture', worktree);
  mkdirSync(join(worktree, '.ddev'));
  mkdirSync(join(worktree, 'scripts'));
  copyFileSync(
    join(repoRoot(), 'scripts/setup-worktree.mjs'),
    join(worktree, 'scripts/setup-worktree.mjs'),
  );
  writeFileSync(join(worktree, '.ddev/config.yaml'), 'name: bakers\n');
  writeFileSync(
    join(worktree, '.env.ddev'),
    'LOCAL="line\nPLAYWRIGHT_BASE_URL=https://wrong.example\n"\nDDEV_WORKTREE_NAME=bb-237-fixture\nPLAYWRIGHT_BASE_URL=https://bb-237-fixture.ddev.site\n',
    'utf8',
  );
  return { parent, worktree };
}

interface BootstrapResult {
  status: number;
  output: string;
}

function runBootstrap(worktree: string): BootstrapResult {
  const script = join(repoRoot(), '.ddev/worktree-post.sh');
  // spawnSync (not execFileSync) so BOTH streams are captured on the success
  // path too: the script's loud lines — the sentinel skip, the unresolvable-URL
  // WARN — are deliberately on stderr, and execFileSync returns only stdout
  // when the command exits 0, which would make a passing run unassertable.
  const r = spawnSync('bash', [script], {
    cwd: worktree,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return {
    status: r.status ?? -1,
    output: `${r.stdout ?? ''}${r.stderr ?? ''}`,
  };
}

describe('BB-237 worktree bootstrap completes (.ddev/worktree-post.sh)', () => {
  it('runs to its end: writes the sentinel, copies audience.local.md, not the retired local config', () => {
    const { worktree } = makeWorktreeFixture();

    const { status, output } = runBootstrap(worktree);

    expect(status, `bootstrap aborted (exit ${status}):\n${output}`).toBe(0);
    expect(existsSync(join(worktree, '.bakers/.worktree-post-done'))).toBe(
      true,
    );
    expect(
      readFileSync(join(worktree, '.bakers/audience.local.md'), 'utf8'),
    ).toBe(PARENT_AUDIENCE);
    expect(
      existsSync(join(worktree, '.bakers/conductor.config.local.js')),
    ).toBe(false);
  });

  it('is a cheap no-op on a second run: the sentinel short-circuits it', () => {
    const { worktree } = makeWorktreeFixture();

    expect(runBootstrap(worktree).status).toBe(0);
    const audience = join(worktree, '.bakers/audience.local.md');
    // A local edit after the first run must survive the second.
    writeFileSync(audience, '# edited\n', 'utf8');

    const second = runBootstrap(worktree);
    expect(second.status).toBe(0);
    expect(second.output).toMatch(/already done/);
    expect(second.output).not.toMatch(/Building bakers conductor CLI/);
    expect(readFileSync(audience, 'utf8')).toBe('# edited\n');
  });

  it('refreshes missing env before a sentinel and refuses an inconsistent identity', () => {
    const { worktree } = makeWorktreeFixture();
    expect(runBootstrap(worktree).status).toBe(0);
    rmSync(join(worktree, '.env.ddev'));
    expect(runBootstrap(worktree).status).toBe(0);
    expect(readFileSync(join(worktree, '.env.ddev'), 'utf8')).toContain(
      'DDEV_WORKTREE_NAME=bb-237-fixture',
    );
    writeFileSync(
      join(worktree, '.env.ddev'),
      'DDEV_WORKTREE_NAME=other-name\n',
    );
    expect(runBootstrap(worktree).status).not.toBe(0);
  });
  it('propagates workspace setup failure without a success sentinel', () => {
    const { worktree } = makeWorktreeFixture();
    writeFileSync(join(worktree, 'scripts/setup-test-project.sh'), 'exit 7\n');
    expect(runBootstrap(worktree).status).not.toBe(0);
    expect(existsSync(join(worktree, '.bakers/.worktree-post-done'))).toBe(
      false,
    );
  });
});
