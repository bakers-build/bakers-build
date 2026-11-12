// A real git fixture: a bare "forge" remote, a planted-config clone of it and
// a linked worktree. Tests reach the remote over file:// only.

import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ENV = {
  ...process.env,
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_AUTHOR_NAME: 't',
  GIT_AUTHOR_EMAIL: 't@example.test',
  GIT_COMMITTER_NAME: 't',
  GIT_COMMITTER_EMAIL: 't@example.test',
};

export function git(cwd: string, ...args: string[]): string {
  // The fixture's own calls ignore the planted hook and fsmonitor, so the
  // marker proves only what the code under test ran.
  const safe = ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false'];
  return execFileSync(
    'git',
    ['-c', 'protocol.file.allow=always', ...safe, ...args],
    {
      cwd,
      env: ENV,
      encoding: 'utf8',
    },
  ).trim();
}

export interface GitFixture {
  root: string;
  remote: string;
  evil: string;
  clone: string;
  worktree: string;
  marker: string;
  remoteSha(branch: string): string | undefined;
  commit(cwd: string, file: string): string;
}

export function gitFixture(): GitFixture {
  const root = mkdtempSync(join(tmpdir(), 'forge-git-'));
  const remote = join(root, 'remote.git');
  const evil = join(root, 'evil.git');
  const seed = join(root, 'seed');
  const clone = join(root, 'clone');
  const marker = join(root, 'MARKER');
  git(root, 'init', '--bare', '-q', '-b', 'main', remote);
  git(root, 'init', '--bare', '-q', '-b', 'main', evil);
  git(root, 'init', '-q', '-b', 'main', seed);
  const commit = (cwd: string, file: string) => {
    writeFileSync(join(cwd, file), `${file}\n`);
    git(cwd, 'add', file);
    git(cwd, 'commit', '-q', '-m', file);
    return git(cwd, 'rev-parse', 'HEAD');
  };
  commit(seed, 'a');
  git(seed, 'branch', 'next');
  git(seed, 'checkout', '-q', '-b', 'feat/bb-1-parent');
  commit(seed, 'parent');
  git(seed, 'tag', 'v1');
  git(
    seed,
    'push',
    '-q',
    `file://${remote}`,
    'main',
    'next',
    'feat/bb-1-parent',
  );
  git(root, 'clone', '-q', `file://${remote}`, clone);
  // A tag the clone does not have yet: forge_fetch must not bring it.
  git(seed, 'push', '-q', `file://${remote}`, 'v1');
  git(clone, 'checkout', '-q', '-b', 'feat/bb-7-work', 'origin/next');
  commit(clone, 'work');

  // Everything a prompt-injected run could plant in its clone.
  const hooks = join(root, 'hooks');
  mkdirSync(hooks);
  const script = `#!/bin/sh\necho ran >> ${marker}\nexit 0\n`;
  for (const name of ['pre-push', 'reference-transaction', 'post-update']) {
    for (const dir of [hooks, join(clone, '.git', 'hooks')]) {
      writeFileSync(join(dir, name), script);
      chmodSync(join(dir, name), 0o755);
    }
  }
  writeFileSync(join(root, 'fsmonitor.sh'), script);
  chmodSync(join(root, 'fsmonitor.sh'), 0o755);
  git(clone, 'config', 'core.hooksPath', hooks);
  git(clone, 'config', 'core.fsmonitor', join(root, 'fsmonitor.sh'));
  git(clone, 'config', 'core.sshCommand', `sh -c 'echo ran >> ${marker}'`);
  git(clone, 'config', 'remote.origin.pushurl', `file://${evil}`);
  git(clone, 'config', `url.file://${evil}.insteadOf`, `file://${remote}`);

  const worktree = join(root, 'wt');
  git(
    clone,
    'worktree',
    'add',
    '-q',
    '-b',
    'feat/bb-7-work-2',
    worktree,
    'feat/bb-7-work',
  );

  return {
    root,
    remote,
    evil,
    clone,
    worktree,
    marker,
    commit,
    remoteSha: (branch) => {
      try {
        return git(
          root,
          '--git-dir',
          remote,
          'rev-parse',
          '--verify',
          '-q',
          `refs/heads/${branch}`,
        );
      } catch {
        return undefined;
      }
    },
  };
}

export const markerRan = (f: GitFixture) => existsSync(f.marker);
