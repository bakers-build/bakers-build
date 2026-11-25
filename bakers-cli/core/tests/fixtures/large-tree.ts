import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ident = ['-c', 'user.name=test', '-c', 'user.email=test@test'];

/**
 * Commit on top of `base` a tree whose `ls-tree -r -z` listing exceeds Node's
 * 1 MiB default output buffer, optionally with a gitlink, without a checkout.
 * Returns the commit; `gitArgs` select the repository (e.g. `--git-dir=`).
 */
export function commitLargeTree(
  cwd: string,
  gitArgs: string[],
  base: string,
  gitlink = false,
): string {
  const scratch = mkdtempSync(join(tmpdir(), 'bb-large-tree-'));
  const env = { ...process.env, GIT_INDEX_FILE: join(scratch, 'index') };
  const git = (args: string[], input?: string) =>
    execFileSync('git', [...gitArgs, ...args], {
      cwd,
      env,
      input,
      encoding: 'utf8',
      maxBuffer: 1 << 30,
    }).trim();
  try {
    const blob = git(['hash-object', '-w', '--stdin'], 'x');
    const tip = git(['rev-parse', `${base}^{commit}`]);
    git(['read-tree', tip]);
    const dir = 'd'.repeat(100);
    let lines = '';
    for (let i = 0; i < 8000; i++) lines += `100644 ${blob}\t${dir}/f${i}\n`;
    if (gitlink) lines += `160000 ${tip}\tnested\n`;
    git(['update-index', '--index-info'], lines);
    const tree = git(['write-tree']);
    const commit = git([
      ...ident,
      'commit-tree',
      tree,
      '-p',
      tip,
      '-m',
      'large',
    ]);
    if (git(['ls-tree', '-r', '-z', commit]).length <= 1024 * 1024)
      throw new Error('large tree fixture: listing is not above 1 MiB');
    return commit;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
