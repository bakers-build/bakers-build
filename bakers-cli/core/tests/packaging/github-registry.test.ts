import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';

it('refuses an existing public package before registry login or push', () => {
  const dir = mkdtempSync(join(tmpdir(), 'registry-visibility-'));
  try {
    writeFileSync(
      join(dir, 'curl'),
      `#!/bin/bash
while [[ $# -gt 0 ]]; do
  if [[ "$1" == -o ]]; then shift; echo '{"visibility":"public"}' > "$1"; fi
  shift
done
printf 200
`,
      { mode: 0o755 },
    );
    writeFileSync(join(dir, 'docker'), '#!/bin/sh\necho called > "$CALLS"\n', {
      mode: 0o755,
    });
    writeFileSync(join(dir, 'calls'), '');
    const result = spawnSync(
      'bash',
      [
        new URL(
          '../../../../scripts/ci/github-registry-rehearsal.sh',
          import.meta.url,
        ).pathname,
      ],
      {
        cwd: dir,
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${dir}:${process.env.PATH}`,
          CALLS: join(dir, 'calls'),
          GH_TOKEN: 'fixture',
          GITHUB_REPOSITORY: 'example/repo',
          GITHUB_SHA: 'abc',
          GITHUB_RUN_ID: '1',
        },
      },
    );
    expect(result.status).not.toBe(0);
    expect(readFileSync(join(dir, 'calls'), 'utf8')).toBe('');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
