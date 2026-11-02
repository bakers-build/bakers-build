import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const read = (path: string) =>
  readFileSync(new URL(`../../../../${path}`, import.meta.url), 'utf8');

describe('GitHub migration checks', () => {
  it.each([
    'docs_pages',
    'conductor',
    'tui',
    'web_ui',
    'release_rehearsal',
  ])('%s prepares the mounted checkout for container Git and path consumers', (name) => {
    const workflow = parse(read('.github/workflows/checks.yml'));
    const setup = workflow.jobs[name].steps.find(
      (step: { name?: string }) => step.name === 'Prepare container workspace',
    );
    expect(setup).toBeDefined();
    const dir = mkdtempSync(join(tmpdir(), 'github-container-'));
    try {
      execFileSync('git', ['init', '-q', dir]);
      const env = {
        ...process.env,
        GIT_CONFIG_GLOBAL: join(dir, 'gitconfig'),
        GIT_CONFIG_NOSYSTEM: '1',
        GITHUB_ENV: join(dir, 'env'),
        CI_PROJECT_DIR: '/host/path/not/mounted',
      };
      expect(
        spawnSync(
          'git',
          ['config', '--global', '--get-all', 'safe.directory'],
          { cwd: dir, env },
        ).status,
      ).not.toBe(0);
      execFileSync('sh', ['-eu', '-c', setup.run], { cwd: dir, env });
      expect(
        execFileSync(
          'git',
          ['config', '--global', '--get-all', 'safe.directory'],
          {
            cwd: dir,
            env,
            encoding: 'utf8',
          },
        ).trim(),
      ).toBe(dir);
      expect(
        execFileSync('git', ['rev-parse', '--show-toplevel'], {
          cwd: dir,
          env,
          encoding: 'utf8',
        }).trim(),
      ).toBe(dir);
      expect(readFileSync(env.GITHUB_ENV, 'utf8')).toBe(
        `CI_PROJECT_DIR=${dir}\n`,
      );
      expect(readFileSync(env.GIT_CONFIG_GLOBAL, 'utf8')).not.toContain(
        'directory = *',
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it('runs all gates on disposable runners without publication authority', () => {
    const workflow = parse(read('.github/workflows/checks.yml'));
    expect(Object.keys(workflow.on)).toEqual([
      'pull_request',
      'workflow_dispatch',
    ]);
    expect(workflow.permissions).toEqual({ contents: 'read' });
    const required = [
      'phpcs',
      'phpmd',
      'phpstan',
      'bb_skill_version_gate',
      'docs_pages',
      'mr_title',
      'config_sync',
      'compose_render',
      'conductor',
      'tui',
      'tui_musl',
      'web_ui',
      'image_gate',
      'release_rehearsal',
    ];
    expect(workflow.jobs.required.needs.sort()).toEqual(required.sort());
    for (const name of required) {
      const job = workflow.jobs[name];
      expect(job['runs-on']).toBe('ubuntu-24.04');
      expect(job.permissions).toBeUndefined();
      expect(job.if).toBeUndefined();
      expect(job.steps[0].with['persist-credentials']).toBe(false);
    }
    const source = read('.github/workflows/checks.yml');
    expect(source).not.toMatch(
      /secrets\.|pull_request_target|self-hosted|packages: write|npm publish|docker push/,
    );
    expect(workflow.jobs.required.if).toBe('always()');
    expect(workflow.jobs.required.steps[0].run).toContain('success');
  });
  it('retains the existing validation commands', () => {
    const old = parse(read('.gitlab-ci.yml'));
    const workflow = parse(read('.github/workflows/checks.yml'));
    for (const name of [
      'phpcs',
      'phpmd',
      'phpstan',
      'docs_pages',
      'config_sync',
      'compose_render',
      'conductor',
      'tui',
      'tui_musl',
      'web_ui',
    ]) {
      const commands = workflow.jobs[name].steps
        .map((step: { run?: string }) => step.run ?? '')
        .join('\n');
      for (const command of old[name].script)
        expect(commands).toContain(
          name === 'phpstan'
            ? command.replace('--memory-limit 512M', '--memory-limit 1G')
            : command,
        );
    }
  });
});
