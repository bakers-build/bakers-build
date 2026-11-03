import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';

it('imports only the tested source run and refuses a changed archive before loading Docker', () => {
  const dir = mkdtempSync(join(tmpdir(), 'image-transfer-'));
  const script = (name: string) =>
    new URL(`../../../../scripts/ci/github-image-${name}.sh`, import.meta.url)
      .pathname;
  try {
    writeFileSync(join(dir, 'git'), '#!/bin/sh\necho tree123\n', {
      mode: 0o755,
    });
    writeFileSync(
      join(dir, 'docker'),
      `#!/bin/bash
printf '%s\\n' "$*" >> "$CALLS"
if [ "$1 $2" = 'image inspect' ]; then
  case "$3" in
    bakers-gate/php:local) id=php;; bakers-gate/nginx:local) id=nginx;; bakers-gate/docs:local) id=docs;;
  esac
  printf '[{"Id":"sha256:%s","RootFS":{"Layers":["sha256:layer"]}}]\\n' "$id"
elif [ "$1" = save ]; then printf 'image archive';
elif [ "$1" = load ]; then cat >/dev/null;
fi
`,
      { mode: 0o755 },
    );
    const env = {
      ...process.env,
      PATH: `${dir}:${process.env.PATH}`,
      CALLS: join(dir, 'calls'),
      GITHUB_SHA: 'abc123',
      GITHUB_RUN_ID: '123',
      GITHUB_RUN_ATTEMPT: '2',
      RELEASE_HEAD: 'abc123',
      SOURCE_RUN_ID: '123',
      SOURCE_RUN_ATTEMPT: '2',
    };
    const run = (mode: string, extra = {}) =>
      spawnSync('bash', [script(mode)], {
        cwd: dir,
        env: { ...env, ...extra },
        encoding: 'utf8',
      });
    expect(run('export').status).toBe(0);
    expect(run('import').status).toBe(0);
    writeFileSync(env.CALLS, '');
    expect(run('import', { SOURCE_RUN_ATTEMPT: '1' }).status).not.toBe(0);
    expect(readFileSync(env.CALLS, 'utf8')).toBe('');
    expect(run('import', { RELEASE_HEAD: 'different' }).status).not.toBe(0);
    expect(readFileSync(env.CALLS, 'utf8')).toBe('');
    writeFileSync(join(dir, 'verified-images/images.tar.gz'), 'tampered');
    expect(run('import').status).not.toBe(0);
    expect(readFileSync(env.CALLS, 'utf8')).toBe('');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
