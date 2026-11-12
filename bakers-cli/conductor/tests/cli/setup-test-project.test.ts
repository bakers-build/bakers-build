import { execFileSync, spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'bakers-setup-'));
  roots.push(root);
  mkdirSync(join(root, '.bakers/scripts'), { recursive: true });
  mkdirSync(join(root, '.ddev'));
  mkdirSync(join(root, 'bin'));
  writeFileSync(join(root, '.ddev/config.yaml'), 'name: isolated\n');
  return root;
}
describe('test workspace setup', () => {
  it('refuses to reinstall a bootstrapped site missing the requested project', () => {
    const root = fixture();
    execFileSync('git', ['init', '-q', root]);
    cpSync(
      resolve('../.bakers/scripts/setup-test-project.sh'),
      join(root, '.bakers/scripts/setup-test-project.sh'),
    );
    writeFileSync(
      join(root, 'bin/ddev'),
      `#!/bin/bash
printf '%s\\n' "$*" >> "$TRACE"
case "$*" in
  'describe -j') echo '{"raw":{"name":"isolated","status":"running","httpurl":"https://isolated.ddev.site"}}' ;;
  'drush --version') echo 'Drush 13' ;;
  'drush status --field=bootstrap') echo Successful ;;
  'drush php:eval'*) echo no ;;
  *) echo 'UNEXPECTED SIDE EFFECT' >&2; exit 99 ;;
esac
`,
      { mode: 0o755 },
    );
    const result = spawnSync(
      'bash',
      ['.bakers/scripts/setup-test-project.sh'],
      {
        cwd: root,
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${root}/bin:${process.env.PATH}`,
          TRACE: join(root, 'trace'),
        },
      },
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('No data was changed');
    expect(result.stderr).toContain('ddev init --provider recipe-test');
    expect(readFileSync(join(root, 'trace'), 'utf8')).not.toMatch(
      /init|start|pull/,
    );
  });

  function playground() {
    const root = mkdtempSync(join(tmpdir(), 'bakers-playground-'));
    roots.push(root);
    const put = (path: string, text: string) => {
      mkdirSync(resolve(root, path, '..'), { recursive: true });
      writeFileSync(join(root, path), text, { mode: 0o755 });
    };
    execFileSync('git', ['init', '-qb', 'develop', root]);
    cpSync(resolve('../.bakers/scripts'), join(root, '.bakers/scripts'), {
      recursive: true,
    });
    cpSync(
      resolve('../tests/fixtures/bakers-playground'),
      join(root, 'tests/fixtures/bakers-playground'),
      { recursive: true },
    );
    put('.ddev/config.yaml', 'name: control-plane\n');
    put('bin/ddev', '#!/bin/bash\nprintf "%s\\n" "$*" >> "$TRACE"\nexit 1\n');
    put('bin/pnpm', '#!/bin/bash\nexit 99\n');
    put('bakers-cli/bin/bakers', '#!/bin/bash\nexit 99\n');
    for (const unit of [
      'host',
      'core',
      'conductor',
      ...[
        'herdr',
        'herdr-core',
        'workspace-git',
        'claude',
        'codex',
        'remote-drupal',
        'essentials',
        'ports',
      ].map((n) => `addons/${n}`),
    ]) {
      mkdirSync(join(root, 'bakers-cli', unit, 'src'), { recursive: true });
      put(
        `bakers-cli/${unit}/dist/src/${unit === 'host' ? 'host' : 'index'}.js`,
        '',
      );
    }
    mkdirSync(join(root, 'home'));
    return root;
  }
  const gitEnv = {
    GIT_AUTHOR_NAME: 'test',
    GIT_AUTHOR_EMAIL: 'test@example.test',
    GIT_COMMITTER_NAME: 'test',
    GIT_COMMITTER_EMAIL: 'test@example.test',
  };
  function setupWorkspace(root: string) {
    return spawnSync(
      'bash',
      ['.bakers/scripts/setup-test-project.sh', '--workspace-only'],
      {
        cwd: root,
        encoding: 'utf8',
        env: {
          ...process.env,
          ...gitEnv,
          HOME: join(root, 'home'),
          PATH: `${root}/bin:${process.env.PATH}`,
          TRACE: join(root, 'trace'),
        },
      },
    );
  }

  it('rejects a dangling playground overlay symlink before writing its target', () => {
    const root = playground();
    const first = setupWorkspace(root);
    expect(first.status, first.stderr).toBe(0);
    const overlay = join(
      root,
      'workspaces/bakers-playground/.ddev/config.worktree.yaml',
    );
    const outside = join(root, 'outside-overlay');
    rmSync(overlay);
    symlinkSync(outside, overlay);
    expect(setupWorkspace(root).status).not.toBe(0);
    expect(existsSync(outside)).toBe(false);
  });

  it('reuses a pre-migration playground clone and keeps its local commits', () => {
    const root = playground();
    expect(setupWorkspace(root).status).toBe(0);
    const workspace = join(root, 'workspaces/bakers-playground');
    const git = (...args: string[]) =>
      execFileSync('git', ['-C', workspace, ...args], {
        encoding: 'utf8',
        env: { ...process.env, ...gitEnv },
      }).trim();
    // A clone seeded before the migration has no helper of its own.
    git('rm', '-q', '.bakers/scripts/setup-worktree.mjs');
    git('commit', '-qm', 'local work');
    const head = git('rev-parse', 'HEAD');
    rmSync(join(workspace, '.env.ddev'));
    const result = setupWorkspace(root);
    expect(result.status, result.stderr).toBe(0);
    expect(git('rev-parse', 'HEAD')).toBe(head);
    expect(readFileSync(join(workspace, '.env.ddev'), 'utf8')).toMatch(
      /^DDEV_WORKTREE_NAME=bakers-pg-[0-9a-f]{8}$/m,
    );
  });
});
