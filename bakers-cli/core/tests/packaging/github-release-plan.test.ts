import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';

it('allocates next above the published high-water mark and binds it to the source commit', () => {
  const dir = mkdtempSync(join(tmpdir(), 'github-release-plan-'));
  try {
    const git = (...args: string[]) =>
      execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
    git('init', '-q');
    git(
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@example.test',
      'commit',
      '--allow-empty',
      '-qm',
      'feat: initial',
    );
    git('tag', 'v0.1.0');
    const sha = git('rev-parse', 'HEAD');
    writeFileSync(
      join(dir, 'npm'),
      '#!/bin/sh\necho \'["0.1.0","0.1.1-next.5"]\'\n',
      { mode: 0o755 },
    );
    execFileSync(
      process.execPath,
      [
        new URL('../../../scripts/github-release-plan.mjs', import.meta.url)
          .pathname,
        'next',
        sha,
        join(dir, 'plan.json'),
      ],
      {
        cwd: dir,
        env: { ...process.env, PATH: `${dir}:${process.env.PATH}` },
      },
    );
    expect(
      JSON.parse(readFileSync(join(dir, 'plan.json'), 'utf8')),
    ).toMatchObject({
      head: sha,
      commit: sha,
      channel: 'next',
      version: '0.1.1-next.6',
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
