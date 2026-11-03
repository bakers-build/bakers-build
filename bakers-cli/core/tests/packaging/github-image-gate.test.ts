import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
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
      '#!/bin/bash\nprintf "%s:%s\\n" "${COMPOSE_PROJECT_NAME:-images}" "$*" >> "$CALLS"\nif [[ -n "$FAIL_AT" && "$*" == *"$FAIL_AT"* ]]; then exit 9; fi\n',
      { mode: 0o755 },
    );
    writeFileSync(join(dir, 'git'), '#!/bin/sh\necho 0123456789abcdef\n', {
      mode: 0o755,
    });
    mkdirSync(join(dir, 'tests/contract'), { recursive: true });
    writeFileSync(
      join(dir, 'tests/contract/pm-bot-image.sh'),
      '#!/bin/bash\nprintf "images:pm-bot-image.sh %s\\n" "$*" >> "$CALLS"\nif [[ -n "$FAIL_AT" && "pm-bot-image.sh" == *"$FAIL_AT"* ]]; then exit 9; fi\n',
    );
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
  it('tests built images, recipe first, then a separate config database', () => {
    const result = gate();
    expect(result.status).toBe(0);
    expect(result.calls).toContain('run --name phpunit');
    expect(result.calls).toContain('--processes 8');
    expect(
      result.calls.indexOf('github-recipe:compose run --rm install'),
    ).toBeLessThan(
      result.calls.indexOf('github-config:compose run --rm install'),
    );
    expect(result.calls).toContain(
      'github-config:compose down -v --remove-orphans',
    );
    expect(result.calls).not.toMatch(/docker (push|login)|compose pull/);
  });
  it('builds the PM bot image from pm-bot/ and checks that same image before the browser suite', () => {
    const result = gate();
    expect(result.status).toBe(0);
    expect(result.calls).toMatch(
      /build .*-t bakers-gate\/pm-bot:local pm-bot\n/,
    );
    expect(result.calls).toContain(
      'images:pm-bot-image.sh bakers-gate/pm-bot:local',
    );
    expect(result.calls.indexOf('pm-bot-image.sh')).toBeLessThan(
      result.calls.indexOf('github-recipe:compose run --rm install'),
    );
  });
  it.each([
    'build --target php',
    'run --name phpunit',
    'compose run --name github-browser',
    'pm-bot-image.sh',
  ])('fails closed when %s fails', (failure) => {
    const result = gate(failure);
    expect(result.status).not.toBe(0);
    expect(result.calls).not.toContain(
      'github-config:compose run --rm install',
    );
    if (failure.includes('browser'))
      expect(result.calls).toContain(
        'github-recipe:compose down -v --remove-orphans',
      );
  });
});
