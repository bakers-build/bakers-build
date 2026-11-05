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
    'pm_bot',
    'coder_pm_bot',
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
  it('runs all gates on the self-hosted runner without publication authority', () => {
    const workflow = parse(read('.github/workflows/checks.yml'));
    expect(Object.keys(workflow.on)).toEqual([
      'push',
      'pull_request',
      'workflow_dispatch',
    ]);
    // Dispatched runs (scheduled or manual) must not be cancelled by a push to `next`.
    expect(workflow.concurrency.group).toContain(
      "github.event_name == 'workflow_dispatch'",
    );
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
      'pm_bot',
      'coder_pm_bot',
      'conductor',
      'tui',
      'tui_musl',
      'web_ui',
      'image_gate',
      'release_rehearsal',
    ];
    expect(workflow.jobs.required.needs.sort()).toEqual(required.sort());
    for (const [name, job] of Object.entries<Record<string, unknown>>(
      workflow.jobs,
    ))
      expect(job['runs-on'], name).toEqual(['self-hosted', 'github-runner-1']);
    for (const name of required) {
      const job = workflow.jobs[name];
      expect(job.permissions).toBeUndefined();
      if (name !== 'image_gate') expect(job.if).toBeUndefined();
      expect(job.steps[0].with['persist-credentials']).toBe(false);
    }
    const source = read('.github/workflows/checks.yml');
    expect(source).not.toMatch(
      /pull_request_target|blacksmith|packages: write|npm publish|docker push/,
    );
    const { report_failure, ...others } = workflow.jobs;
    expect(JSON.stringify(others)).not.toContain('secrets.');
    expect(report_failure).toBeDefined();
    expect(workflow.jobs.required.if).toBe('always()');
    expect(workflow.jobs.required.steps[0].run).toContain('success');
  });

  it('runs image_gate on dispatch and into main, never for next', () => {
    const workflow = parse(read('.github/workflows/checks.yml'));
    const gate = workflow.jobs.image_gate.if;
    for (const clause of [
      "github.event_name == 'workflow_dispatch'",
      "github.base_ref == 'main'",
      "github.ref == 'refs/heads/main'",
    ])
      expect(gate).toContain(clause);
    expect(gate).not.toContain('next');
    // The schedule lives in scheduled-checks.yml, which dispatches this workflow.
    expect(read('.github/workflows/checks.yml')).not.toContain(
      "event_name == 'schedule'",
    );
    // `required` decides with the same expression whether a skipped image_gate is acceptable.
    expect(workflow.jobs.required.steps[0].env.IMAGE_GATE_REQUIRED).toBe(
      `\${{ ${gate} }}`,
    );
  });

  it.each([
    ['image_gate skipped into next', 'skipped', 'success', 'false', 0],
    ['image_gate skipped into main', 'skipped', 'success', 'true', 1],
    ['image_gate failed into next', 'failure', 'success', 'false', 1],
    ['image_gate passed into main', 'success', 'success', 'true', 0],
    ['another job skipped', 'success', 'skipped', 'false', 1],
  ])('required: %s', (_case, gate, other, gateRequired, status) => {
    const step = parse(read('.github/workflows/checks.yml')).jobs.required
      .steps[0];
    const result = spawnSync('sh', ['-c', step.run], {
      env: {
        ...process.env,
        RESULTS: JSON.stringify({
          image_gate: { result: gate },
          phpcs: { result: other },
        }),
        IMAGE_GATE_REQUIRED: gateRequired,
      },
    });
    expect(result.status).toBe(status);
  });

  it('files failures of dispatched next runs as a bakers.build ticket', () => {
    const workflow = parse(read('.github/workflows/checks.yml'));
    const job = workflow.jobs.report_failure;
    expect(job.needs.sort()).toEqual(workflow.jobs.required.needs.sort());
    for (const guard of [
      'always()',
      "contains(needs.*.result, 'failure')",
      "github.ref == 'refs/heads/next'",
      "github.event_name == 'workflow_dispatch'",
    ])
      expect(job.if).toContain(guard);
    expect(job.steps[0].with['persist-credentials']).toBe(false);
    const step = job.steps.find((s: { run?: string }) =>
      s.run?.includes('github-failure-ticket.sh'),
    );
    expect(step.env).toMatchObject({
      BB_CI_CLIENT_ID: '${{ secrets.BB_CI_CLIENT_ID }}',
      BB_CI_CLIENT_SECRET: '${{ secrets.BB_CI_CLIENT_SECRET }}',
    });
    expect(step.run).toMatch(/npm install -g @bakers-build\/bakers@\d/);
    expect(step.run).toContain('--auth-type client_credentials');
    expect(step.run).toContain('--base-url https://app.bakers.build');
    expect(step.run).toContain('--secret-env BB_CI_CLIENT_SECRET');
    expect(step.run).not.toContain('$BB_CI_CLIENT_SECRET');
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
      'pm_bot',
      'coder_pm_bot',
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

describe('scheduled GitHub checks', () => {
  type Run = { conclusion: string | null };
  // Runs the dispatcher's github-script body against a fake API with the given earlier runs.
  async function tick(runs: Run[]) {
    const workflow = parse(read('.github/workflows/scheduled-checks.yml'));
    const step = workflow.jobs.dispatch.steps.find((s: { uses?: string }) =>
      s.uses?.startsWith('actions/github-script@'),
    );
    const listed: unknown[] = [];
    const dispatched: unknown[] = [];
    const github = {
      rest: {
        actions: {
          listWorkflowRuns: async (args: unknown) => {
            listed.push(args);
            return { data: { total_count: runs.length, workflow_runs: runs } };
          },
          createWorkflowDispatch: async (args: unknown) => {
            dispatched.push(args);
          },
        },
      },
    };
    const context = { repo: { owner: 'o', repo: 'r' }, sha: 'abc123' };
    const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
    await new AsyncFunction('github', 'context', 'core', step.with.script)(
      github,
      context,
      { info() {} },
    );
    return { listed, dispatched };
  }

  it('ticks every 2 hours on the self-hosted runner with only actions access', () => {
    const workflow = parse(read('.github/workflows/scheduled-checks.yml'));
    expect(Object.keys(workflow.on)).toEqual(['schedule']);
    expect(workflow.on.schedule).toEqual([{ cron: '0 */2 * * *' }]);
    expect(workflow.permissions).toEqual({ actions: 'write' });
    expect(workflow.jobs.dispatch['runs-on']).toEqual([
      'self-hosted',
      'github-runner-1',
    ]);
  });

  it('dispatches GitHub checks on next when the head commit is untested', async () => {
    const { listed, dispatched } = await tick([]);
    expect(listed).toEqual([
      expect.objectContaining({
        owner: 'o',
        repo: 'r',
        workflow_id: 'checks.yml',
        branch: 'next',
        event: 'workflow_dispatch',
        head_sha: 'abc123',
      }),
    ]);
    expect(dispatched).toEqual([
      { owner: 'o', repo: 'r', workflow_id: 'checks.yml', ref: 'next' },
    ]);
  });

  it.each([
    ['success'],
    ['failure'],
    [null],
  ])('skips a head commit whose dispatched run ended %s', async (conclusion) => {
    expect((await tick([{ conclusion }])).dispatched).toEqual([]);
  });

  it('retests a head commit whose only run was cancelled', async () => {
    expect((await tick([{ conclusion: 'cancelled' }])).dispatched).toHaveLength(
      1,
    );
  });
});
