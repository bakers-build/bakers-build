import { execFileSync, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';

// Runs the real plan script in a fixture repo tagged v0.1.0 with `npm` stubbed by the given shell body.
function plan(npm: string) {
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
    writeFileSync(join(dir, 'npm'), `#!/bin/sh\n${npm}\n`, { mode: 0o755 });
    const result = spawnSync(
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
        encoding: 'utf8',
        env: { ...process.env, PATH: `${dir}:${process.env.PATH}` },
      },
    );
    const written = existsSync(join(dir, 'plan.json'))
      ? JSON.parse(readFileSync(join(dir, 'plan.json'), 'utf8'))
      : undefined;
    return { status: result.status, stderr: result.stderr, sha, plan: written };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// What the real registry answers for a package that was never published.
const notFound = (code: string) =>
  `case "$2" in *addon-herdr-core) echo '{"error":{"code":"${code}","summary":"Not Found"}}'; echo "npm error code ${code}" >&2; exit 1;; esac`;

it('allocates next above the published high-water mark and binds it to the source commit', () => {
  const result = plan(`echo '["0.1.0","0.1.1-next.5"]'`);
  expect(result.status, result.stderr).toBe(0);
  expect(result.plan).toMatchObject({
    head: result.sha,
    commit: result.sha,
    channel: 'next',
    version: '0.1.1-next.6',
  });
});

it('treats a never-published package (npm E404) as having no versions', () => {
  const result = plan(`${notFound('E404')}\necho '["0.1.0","0.1.1-next.5"]'`);
  expect(result.status, result.stderr).toBe(0);
  expect(result.plan.version).toBe('0.1.1-next.6');
  expect(result.plan.snapshot['@bakers-build/addon-herdr-core']).toEqual([]);
});

it('still fails on any other npm view error', () => {
  const result = plan(`${notFound('E500')}\necho '["0.1.0"]'`);
  expect(result.status).not.toBe(0);
  expect(result.plan).toBeUndefined();
});
