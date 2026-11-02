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
 * BB-237 — `.ddev/worktree-post.sh` must run to its end.
 *
 * It aborts under `set -e` between the config copy and the sentinel: the
 * `perl -0pi -e "s#…#…#"` one-liner is written inside a bash DOUBLE-quoted
 * string, so bash expands the regex anchor `$#` (the positional-argument count)
 * before perl ever sees it. The substitution loses its closing delimiter and
 * perl dies with "Substitution replacement not terminated" (exit 255) — so
 * neither the BB-154 base_url rewrite nor `touch "${SENTINEL}"` runs.
 *
 * The convergence half of BB-237 (dispatch must not gate provisioning on
 * `ws.created`) is pinned beside the other dispatch-hook tests, in
 * `conductor.test.ts`.
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

/** A parent config whose exported object ends `,\n};\n` — the real shape. */
const PARENT_CONFIG = `export default {
  machine_id: 'cw-framework',
  base_url: 'https://develop.dev.bakers.build',
  oauth: {
    client_id: 'bakers-cw',
  },
};
`;

/**
 * Builds a real parent repo + linked worktree so the script's own
 * `git worktree list | head -1` resolves the parent. The worktree deliberately
 * carries NO `bakers-cli/package.json`, so the script skips the pnpm build and
 * exercises exactly the copy → resolve → rewrite → sentinel window.
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
  it('runs to its end: writes the sentinel and the worktree-local base_url', () => {
    const { parent, worktree } = makeWorktreeFixture();

    const { status, output } = runBootstrap(worktree);

    // AC-1: the bootstrap reached its LAST action.
    expect(status, `bootstrap aborted (exit ${status}):\n${output}`).toBe(0);
    expect(existsSync(join(worktree, '.bakers/.worktree-post-done'))).toBe(
      true,
    );

    // AC-2: the copied config points at THIS worktree's own DDEV site, and is
    // therefore no longer byte-identical to the parent's dev2 config.
    const copied = readFileSync(
      join(worktree, '.bakers/conductor.config.local.js'),
      'utf8',
    );
    expect(copied).not.toBe(
      readFileSync(join(parent, '.bakers/conductor.config.local.js'), 'utf8'),
    );
    expect(copied).toContain("base_url: 'https://bb-237-fixture.ddev.site'");
    // The rewrite appends base_url as the LAST key so it wins over the
    // inherited one; the file must still be a syntactically closed object.
    expect(copied.trimEnd().endsWith('};')).toBe(true);
    expect(
      copied.lastIndexOf('bb-237-fixture.ddev.site'),
      'the worktree URL must be the LAST base_url so it wins',
    ).toBeGreaterThan(copied.lastIndexOf('develop.dev.bakers.build'));
  });

  it('is a cheap no-op on a second run: the sentinel short-circuits it', () => {
    const { worktree } = makeWorktreeFixture();

    expect(runBootstrap(worktree).status).toBe(0);
    const afterFirst = readFileSync(
      join(worktree, '.bakers/conductor.config.local.js'),
      'utf8',
    );

    // AC-3: the second run exits 0, says it is skipping, and touches nothing.
    const second = runBootstrap(worktree);
    expect(second.status).toBe(0);
    expect(second.output).toMatch(/already done/);
    expect(second.output).not.toMatch(/Building bakers conductor CLI/);
    expect(
      readFileSync(join(worktree, '.bakers/conductor.config.local.js'), 'utf8'),
    ).toBe(afterFirst);
  });

  it('repairs a worktree that already has the parent config copied but not rewritten', () => {
    // BB-237 AC-7. The copy+rewrite block used to be gated as a whole on
    // "config absent", so the base_url rewrite only ever happened on the FIRST
    // copy. Every worktree damaged by the perl abort is in exactly the state
    // this fixture builds: the config IS copied (the `cp` ran) but still carries
    // the parent's shared dev2 base_url, and there is no sentinel. Re-running
    // the bootstrap there must repair the base_url, not just write the sentinel.
    const { parent, worktree } = makeWorktreeFixture();
    // Reproduce the damaged state: config copied verbatim, no sentinel.
    mkdirSync(join(worktree, '.bakers'), { recursive: true });
    writeFileSync(
      join(worktree, '.bakers/conductor.config.local.js'),
      readFileSync(join(parent, '.bakers/conductor.config.local.js'), 'utf8'),
      'utf8',
    );

    const { status, output } = runBootstrap(worktree);

    expect(status, `bootstrap aborted (exit ${status}):\n${output}`).toBe(0);
    expect(existsSync(join(worktree, '.bakers/.worktree-post-done'))).toBe(
      true,
    );
    const repaired = readFileSync(
      join(worktree, '.bakers/conductor.config.local.js'),
      'utf8',
    );
    expect(repaired).toContain("base_url: 'https://bb-237-fixture.ddev.site'");
    expect(
      repaired.lastIndexOf('bb-237-fixture.ddev.site'),
      'the worktree URL must be the LAST base_url so it wins',
    ).toBeGreaterThan(repaired.lastIndexOf('develop.dev.bakers.build'));
    expect(repaired.trimEnd().endsWith('};')).toBe(true);
  });

  it('rewrites the base_url idempotently — a forced re-run appends no duplicate key', () => {
    // BB-237: the rewrite is convergent, so it must also be a fixed point.
    // Forcing a rebuild (deleting the sentinel) must not stack a second
    // worktree-local base_url onto the config on every bootstrap.
    const { worktree } = makeWorktreeFixture();
    const config = join(worktree, '.bakers/conductor.config.local.js');

    expect(runBootstrap(worktree).status).toBe(0);
    const afterFirst = readFileSync(config, 'utf8');

    rmSync(join(worktree, '.bakers/.worktree-post-done'));
    expect(runBootstrap(worktree).status).toBe(0);

    expect(readFileSync(config, 'utf8')).toBe(afterFirst);
    expect(
      afterFirst.match(/bb-237-fixture\.ddev\.site/g)?.length,
      'exactly one worktree-local base_url',
    ).toBe(1);
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
