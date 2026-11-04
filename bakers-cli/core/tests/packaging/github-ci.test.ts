import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const read = (path: string) =>
  readFileSync(new URL(`../../../../${path}`, import.meta.url), 'utf8');

describe('GitHub migration checks', () => {
  it('disables every GitLab publisher and deploy job before GitHub takes ownership', () => {
    const old = parse(read('.gitlab-ci.yml'));
    for (const job of [
      'promote',
      'release_images',
      'publish:npm',
      'publish:npm:next',
      'deploy',
      'release',
    ]) {
      expect(old[job].rules[0]).toEqual({
        if: '$RELEASE_OWNER == "github"',
        when: 'never',
      });
    }
  });

  it('publishes only successful same-repository branch pushes after exclusive handover', () => {
    const workflow = parse(read('.github/workflows/release.yml'));
    expect(workflow.on.workflow_run.branches).toEqual(['next', 'main']);
    expect(workflow.on.pull_request).toBeUndefined();
    const job = workflow.jobs.release;
    for (const guard of [
      "vars.RELEASE_OWNER == 'github'",
      "workflow_run.event == 'push'",
      "workflow_run.conclusion == 'success'",
      'workflow_run.head_repository.full_name == github.repository',
    ])
      expect(job.if).toContain(guard);
    expect(workflow.concurrency['cancel-in-progress']).toBe(false);
    expect(job.environment).toBe('release');
    const imported = job.steps.find(
      (step: { uses?: string; with?: { 'run-id'?: string } }) =>
        step.uses?.startsWith('actions/download-artifact@') &&
        step.with?.['run-id'],
    );
    expect(imported.with['run-id']).toBe('${{ github.event.workflow_run.id }}');
    expect(imported.with.name).toContain('workflow_run.run_attempt');
    const releaseCommands = job.steps
      .map((step: { run?: string }) => step.run ?? '')
      .join('\n');
    expect(releaseCommands).not.toContain('github-image-gate.sh');
    expect(releaseCommands).toContain('github-image-import.sh');
    expect(releaseCommands).toContain('github-image-label.sh');

    const names = job.steps.map((step: { name?: string }) => step.name);
    expect(names.indexOf('Deploy and smoke-check')).toBeGreaterThan(
      names.indexOf('Publish verified public images'),
    );
    expect(names.indexOf('Publish complete npm package set')).toBeGreaterThan(
      names.indexOf('Deploy and smoke-check'),
    );
    expect(names).toContain('Tag stable candidate and publish release notes');
    expect(
      job.steps.some(
        (step: { uses?: string; if?: string }) =>
          step.uses?.startsWith('actions/download-artifact@') &&
          step.if?.includes('run_attempt'),
      ),
    ).toBe(true);
  });

  it('limits registry rehearsal to an explicit branch and publishes only after the image gate', () => {
    const workflow = parse(read('.github/workflows/registry-rehearsal.yml'));
    expect(workflow.on.push.branches).toEqual(['ci/ghcr-rehearsal']);
    expect(workflow.on.pull_request).toBeUndefined();
    const job = workflow.jobs.registry;
    expect(job['runs-on']).toEqual(['self-hosted', 'github-runner-1']);
    expect(job.permissions).toEqual({ contents: 'read', packages: 'write' });
    const commands = job.steps
      .map((step: { run?: string }) => step.run || '')
      .join('\n');
    expect(
      commands.indexOf('bash scripts/ci/github-image-gate.sh'),
    ).toBeLessThan(
      commands.indexOf('bash scripts/ci/github-registry-rehearsal.sh'),
    );
    expect(
      job.steps.find(
        (step: { name?: string }) =>
          step.name === 'Publish and pull private images',
      ).if,
    ).toBeUndefined();
  });

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
      'push',
      'pull_request',
      'workflow_dispatch',
    ]);
    expect(workflow.permissions).toEqual({ contents: 'read' });
    expect(workflow.on.push.branches).toEqual(['next', 'main']);
    const required = [
      'branch_policy',
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
      expect(job['runs-on']).toBe(
        name === 'image_gate'
          ? 'blacksmith-8vcpu-ubuntu-2404'
          : 'blacksmith-4vcpu-ubuntu-2404',
      );
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
