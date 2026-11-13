import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const script = new URL(
  '../../../../scripts/ci/github-image-gate.sh',
  import.meta.url,
).pathname;
function gate(failure = '', overrides: Record<string, string> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'github-gate-'));
  try {
    writeFileSync(
      join(dir, 'docker'),
      '#!/bin/bash\nprintf "%s:%s%s\\n" "${COMPOSE_PROJECT_NAME:-images}" "${GATE_RUN_LOG_STORAGE:+run-log=$GATE_RUN_LOG_STORAGE }" "$*" >> "$CALLS"\nif [[ -n "$FAIL_AT" && "$*" == *"$FAIL_AT"* ]]; then exit 9; fi\n',
      { mode: 0o755 },
    );
    writeFileSync(join(dir, 'git'), '#!/bin/sh\necho 0123456789abcdef\n', {
      mode: 0o755,
    });
    const result = spawnSync('bash', [script], {
      cwd: dir,
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${dir}:${process.env.PATH}`,
        CALLS: join(dir, 'calls'),
        FAIL_AT: failure,
        GITHUB_SHA: '0123456789abcdef',
        GITHUB_REF_NAME: 'develop',
        GITHUB_RUN_ID: '10',
        GITHUB_RUN_ATTEMPT: '1',
        ...overrides,
      },
    });
    return {
      status: result.status,
      calls: readFileSync(join(dir, 'calls'), 'utf8'),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
describe('disposable image gate', () => {
  it('labels workflow_run images with the verified source instead of the default branch', () => {
    const result = gate('', {
      CI_SOURCE_SHA: 'fedcba9876543210',
      CI_SOURCE_REF: 'next',
      CI_RELEASE_VERSION: '0.1.1-next.7',
    });
    expect(result.status).toBe(0);
    expect(result.calls).toContain(
      'org.opencontainers.image.revision=fedcba9876543210',
    );
    expect(result.calls).toContain(
      'org.opencontainers.image.version=0.1.1-next.7',
    );
    expect(result.calls).toContain('CI_COMMIT_REF_NAME=next');
    expect(result.calls).not.toContain(
      'org.opencontainers.image.revision=0123456789abcdef',
    );
  });
  it('tests built images, recipe first, then a separate config database installed and updated by the deploy service', () => {
    const result = gate();
    expect(result.status).toBe(0);
    expect(result.calls).toContain('run --name phpunit');
    expect(result.calls).toContain('--processes 16 --log-junit /tmp/junit.xml');
    expect(result.calls).toContain('--workers=6');
    const install = result.calls.indexOf(
      'github-config:compose run --rm -e ADMIN_EMAIL=admin@example.test deploy\n',
    );
    expect(
      result.calls.indexOf('github-recipe:compose run --rm install'),
    ).toBeLessThan(install);
    expect(install).toBeGreaterThan(-1);
    // compose run does not wait for depends_on health; site-deploy.sh queries the database at once.
    const healthy = result.calls.indexOf(
      'github-config:compose up -d --wait db\n',
    );
    expect(healthy).toBeGreaterThan(-1);
    expect(healthy).toBeLessThan(install);
    expect(
      result.calls.indexOf('github-config:compose run --rm deploy\n', install),
    ).toBeGreaterThan(install);
    expect(result.calls).toContain(
      'github-config:compose down -v --remove-orphans',
    );
    expect(result.calls).not.toMatch(/docker (push|login)|compose pull/);
  });
  it('builds and inspects exactly the php, php-test, nginx, docs and e2e images', () => {
    const calls = gate().calls;
    const tags = (pattern: RegExp) =>
      [...calls.matchAll(pattern)].map((m) => m[1]).sort();
    const expected = ['docs', 'e2e', 'nginx', 'php', 'php-test'];
    expect(tags(/build .*-t bakers-gate\/(\S+):local/g)).toEqual(expected);
    expect(tags(/image inspect bakers-gate\/(\S+):local/g)).toEqual(expected);
  });
  it('runs the browser suite with run-log storage off, then recreates php with it on for the conductor suite', () => {
    const calls = gate().calls.split('\n');
    const browser = calls.findIndex((c) =>
      c.includes('compose run --name github-browser'),
    );
    const recreate = calls.findIndex((c) =>
      c.includes('--force-recreate php nginx'),
    );
    const integration = calls.findIndex((c) =>
      c.includes('compose run --name github-integration'),
    );
    expect(browser).toBeGreaterThan(-1);
    expect(recreate).toBeGreaterThan(browser);
    expect(integration).toBeGreaterThan(recreate);
    expect(calls[recreate]).toContain('run-log=1 ');
    expect(calls.filter((c) => c.includes('run-log='))).toHaveLength(1);
  });
  it.each([
    'build --target php',
    'run --name phpunit',
    'compose run --name github-browser',
    'compose run --name github-integration',
  ])('fails closed when %s fails', (failure) => {
    const result = gate(failure);
    expect(result.status).not.toBe(0);
    expect(result.calls).not.toContain('github-config:');
    if (failure.includes('browser'))
      expect(result.calls).toContain(
        'github-recipe:compose down -v --remove-orphans',
      );
  });
});
