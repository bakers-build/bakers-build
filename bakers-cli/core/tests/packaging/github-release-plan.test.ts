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
// `latest` plans a --no-ff merge of a `feat:` commit; `gh` answers the commit→PR lookup for the
// merge with `pulls(head)` as JSON, or fails when `pulls` is absent.
function plan(
  npm: string,
  {
    channel = 'next',
    pulls,
  }: { channel?: 'next' | 'latest'; pulls?: (head: string) => unknown } = {},
) {
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
    if (channel === 'latest') {
      const id = ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test'];
      git('checkout', '-qb', 'next');
      git(...id, 'commit', '--allow-empty', '-qm', 'feat: shiny');
      git('checkout', '-q', '-');
      git(...id, 'merge', '--no-ff', '-qm', 'release', 'next');
    }
    const sha = git('rev-parse', 'HEAD');
    writeFileSync(join(dir, 'npm'), `#!/bin/sh\n${npm}\n`, { mode: 0o755 });
    if (pulls) writeFileSync(join(dir, 'pulls.json'), JSON.stringify(pulls(sha)));
    writeFileSync(
      join(dir, 'gh'),
      `#!/bin/sh\n[ "$*" = "api repos/o/r/commits/${sha}/pulls" ] && [ -f "${dir}/pulls.json" ] || exit 1\ncat "${dir}/pulls.json"\n`,
      { mode: 0o755 },
    );
    const result = spawnSync(
      process.execPath,
      [
        new URL('../../../scripts/github-release-plan.mjs', import.meta.url)
          .pathname,
        channel,
        sha,
        join(dir, 'plan.json'),
      ],
      {
        cwd: dir,
        encoding: 'utf8',
        env: {
          ...process.env,
          GITHUB_REPOSITORY: 'o/r',
          PATH: `${dir}:${process.env.PATH}`,
        },
      },
    );
    const written = existsSync(join(dir, 'plan.json'))
      ? JSON.parse(readFileSync(join(dir, 'plan.json'), 'utf8'))
      : undefined;
    const notes = existsSync(join(dir, 'plan.json.notes.md'))
      ? readFileSync(join(dir, 'plan.json.notes.md'), 'utf8')
      : undefined;
    return {
      status: result.status,
      stderr: result.stderr,
      sha,
      plan: written,
      notes,
    };
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

const prBody = [
  '## Summary',
  'x',
  '### Upgrade notes',
  'Run drush updb.',
  '### Known open issues',
  '- slow list',
  '## Footer',
  'f',
].join('\r\n');

it("appends the release PR's sections after the generated notes", () => {
  const result = plan('exit 1', {
    channel: 'latest',
    pulls: (head) => [
      { merge_commit_sha: '0'.repeat(40), body: '### Upgrade notes\nwrong' },
      { merge_commit_sha: head, body: prBody },
    ],
  });
  expect(result.status, result.stderr).toBe(0);
  expect(result.plan.version).toBe('0.2.0');
  expect(result.notes).toMatch(/^## \[0\.2\.0\]/);
  expect(result.notes).toMatch(
    /\* shiny.*\)\n\n### Upgrade notes\nRun drush updb\.\n\n### Known open issues\n- slow list\n$/s,
  );
  expect(result.notes).not.toMatch(/wrong|Summary|Footer/);
});

// Exactly the generated notes: they end with the `feat: shiny` line.
const generatedOnly = /^## \[0\.2\.0\][^#]*### Features\n\n\* shiny [^\n]*\)\n$/;

it('keeps the generated notes when no PR matches', () => {
  for (const pulls of [
    () => [],
    () => [{ merge_commit_sha: '0'.repeat(40), body: prBody }],
  ]) {
    const result = plan('exit 1', { channel: 'latest', pulls });
    expect(result.status, result.stderr).toBe(0);
    expect(result.notes).toMatch(generatedOnly);
  }
});

it('keeps the generated notes when the PR body has neither section', () => {
  for (const body of ['## Summary\nx\n### Batch\nb', null]) {
    const result = plan('exit 1', {
      channel: 'latest',
      pulls: (head) => [{ merge_commit_sha: head, body }],
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.notes).toMatch(generatedOnly);
  }
});

it('fails without a plan when the PR lookup fails', () => {
  const result = plan('exit 1', { channel: 'latest' });
  expect(result.status).not.toBe(0);
  expect(result.plan).toBeUndefined();
});
