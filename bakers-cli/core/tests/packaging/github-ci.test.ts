import { execFileSync, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const read = (path: string) =>
  readFileSync(new URL(`../../../../${path}`, import.meta.url), 'utf8');

// Jobs that run after the merge (push) and before main, not on PRs into next.
const AFTER_MERGE = ['image_gate', 'tui_musl', 'release_rehearsal'];

// WarpBuild tiers; a repository variable set to '["self-hosted","github-runner-1"]' sends a tier back.
const CHECKS_RUNNER = `\${{ fromJSON(vars.RUNNER_CHECKS || '"warp-ubuntu-latest-x64-2x"') }}`;
const AFTER_MERGE_RUNNER = `\${{ fromJSON(vars.RUNNER_AFTER_MERGE || '"warp-ubuntu-latest-x64-4x"') }}`;
const IMAGE_GATE_RUNNER = `\${{ fromJSON(vars.RUNNER_IMAGE_GATE || '"warp-ubuntu-latest-x64-16x"') }}`;

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
    expect(job['runs-on']).toBe(AFTER_MERGE_RUNNER);
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
    expect(job['runs-on']).toBe(AFTER_MERGE_RUNNER);
    expect(workflow.jobs.transfer['runs-on']).toBe(AFTER_MERGE_RUNNER);
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
  it('runs PR checks on the small and after-merge jobs on the larger WarpBuild tier without publication authority', () => {
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
      'composer_audit',
      'compose_render',
      'pm_bot',
      'conductor',
      'runtime_bwrap',
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
      expect(job['runs-on'], name).toBe(
        name === 'image_gate'
          ? IMAGE_GATE_RUNNER
          : AFTER_MERGE.includes(name)
            ? AFTER_MERGE_RUNNER
            : CHECKS_RUNNER,
      );
    for (const name of required) {
      const job = workflow.jobs[name];
      expect(job.permissions).toBeUndefined();
      // After-merge jobs run on push, dispatch and PRs into main; the rest already ran in the PR.
      expect(job.if, name).toBe(
        AFTER_MERGE.includes(name)
          ? "github.event_name != 'pull_request' || github.base_ref == 'main'"
          : "github.event_name != 'push'",
      );
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

  it('requires a real Bubblewrap lifecycle probe outside the unit-test container', () => {
    const workflow = parse(read('.github/workflows/checks.yml'));
    const job = workflow.jobs.runtime_bwrap;
    expect(job).toBeDefined();
    expect(job.container).toBeUndefined();
    expect(job.env.BAKERS_TEST_BWRAP_REQUIRED).toBe('1');
    expect(workflow.jobs.required.needs).toContain('runtime_bwrap');
    const commands = job.steps
      .map((step: { run?: string }) => step.run ?? '')
      .join('\n');
    expect(commands).toContain('bubblewrap');
    expect(commands).toContain('conductor/tests/core/conductor-bwrap.test.ts');
  });

  it('runs the self-host lifecycle on a disposable WarpBuild runner and names no old runner in any workflow', () => {
    const workflow = parse(read('.github/workflows/self-host-lifecycle.yml'));
    expect(workflow.jobs.lifecycle['runs-on']).toBe(
      'warp-ubuntu-latest-x64-4x',
    );
    const files = readdirSync(
      new URL('../../../../.github/workflows/', import.meta.url),
    ).filter((file) => file.endsWith('.yml'));
    expect(files.length).toBeGreaterThan(3);
    for (const file of files)
      expect(read(`.github/workflows/${file}`), file).not.toMatch(
        /github-runner-1|blacksmith/,
      );
  });

  it('runs the after-merge jobs on every push, dispatch and PR into main, never on PRs into next', () => {
    const workflow = parse(read('.github/workflows/checks.yml'));
    const gate = workflow.jobs.image_gate.if;
    expect(gate).toBe(
      "github.event_name != 'pull_request' || github.base_ref == 'main'",
    );
    // The push run's tested images are what release.yml deploys (develop from next, app from main).
    expect(
      workflow.jobs.image_gate.steps.find(
        (s: { name?: string }) => s.name === 'Export tested runtime images',
      ).if,
    ).toBe("${{ github.event_name == 'push' }}");
    expect(
      existsSync(
        new URL(
          '../../../../.github/workflows/scheduled-checks.yml',
          import.meta.url,
        ),
      ),
    ).toBe(false);
    // `required` decides with the same expressions which skipped jobs are acceptable.
    const env = workflow.jobs.required.steps[0].env;
    expect(env.AFTER_MERGE_REQUIRED).toBe(`\${{ ${gate} }}`);
    for (const name of AFTER_MERGE) expect(workflow.jobs[name].if).toBe(gate);
    expect(env.CHECKS_REQUIRED).toBe(`\${{ ${workflow.jobs.phpcs.if} }}`);
  });

  it.each([
    [
      'PR into next: image_gate skipped',
      'skipped',
      'success',
      'true',
      'false',
      0,
    ],
    [
      'PR into main: image_gate skipped',
      'skipped',
      'success',
      'true',
      'true',
      1,
    ],
    [
      'PR into next: image_gate failed',
      'failure',
      'success',
      'true',
      'false',
      1,
    ],
    ['PR into main: all passed', 'success', 'success', 'true', 'true', 0],
    ['PR: a check skipped', 'success', 'skipped', 'true', 'false', 1],
    ['push: only image_gate ran', 'success', 'skipped', 'false', 'true', 0],
    ['push: image_gate failed', 'failure', 'skipped', 'false', 'true', 1],
    ['push: image_gate skipped', 'skipped', 'skipped', 'false', 'true', 1],
  ])('required: %s', (_case, gate, other, checks, gateRequired, status) => {
    const step = parse(read('.github/workflows/checks.yml')).jobs.required
      .steps[0];
    const result = spawnSync('sh', ['-c', step.run], {
      env: {
        ...process.env,
        RESULTS: JSON.stringify({
          image_gate: { result: gate },
          tui_musl: { result: gate },
          release_rehearsal: { result: gate },
          phpcs: { result: other },
        }),
        CHECKS_REQUIRED: checks,
        AFTER_MERGE_REQUIRED: gateRequired,
      },
    });
    expect(result.status).toBe(status);
  });

  it('files failures of next pushes and dispatches as a bakers.build ticket', () => {
    const workflow = parse(read('.github/workflows/checks.yml'));
    const job = workflow.jobs.report_failure;
    expect(job.needs.sort()).toEqual(workflow.jobs.required.needs.sort());
    for (const guard of [
      'always()',
      "contains(needs.*.result, 'failure')",
      "github.ref == 'refs/heads/next'",
      "github.event_name == 'push'",
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
    expect(step.env).toMatchObject({
      WORKFLOW: 'GitHub checks',
      BRANCH: 'next',
    });
  });

  it('files a failed release on next or main as its own bakers.build ticket', () => {
    const workflow = parse(read('.github/workflows/release.yml'));
    const job = workflow.jobs.report_failure;
    expect(job.needs).toBe('release');
    for (const guard of [
      'always()',
      "needs.release.result == 'failure'",
      '"next"',
      '"main"',
      'github.event.workflow_run.head_branch',
    ])
      expect(job.if).toContain(guard);
    // container: jobs fail on the self-hosted runner a tier can be sent back to.
    expect(job.container).toBeUndefined();
    expect(job['runs-on']).toBe(CHECKS_RUNNER);
    expect(job.steps[0].with).toMatchObject({
      ref: '${{ github.event.workflow_run.head_sha }}',
      'persist-credentials': false,
    });
    const step = job.steps.find((s: { run?: string }) =>
      s.run?.includes('github-failure-ticket.sh'),
    );
    expect(step.env).toMatchObject({
      WORKFLOW: 'GitHub release',
      BRANCH: '${{ github.event.workflow_run.head_branch }}',
      FAILED_JOBS: 'release',
      GITHUB_SHA: '${{ github.event.workflow_run.head_sha }}',
      BB_CI_CLIENT_ID: '${{ secrets.BB_CI_CLIENT_ID }}',
      BB_CI_CLIENT_SECRET: '${{ secrets.BB_CI_CLIENT_SECRET }}',
    });
    expect(step.run).toContain('--secret-env BB_CI_CLIENT_SECRET');
    expect(step.run).not.toContain('$BB_CI_CLIENT_SECRET');
  });

  describe('a release overtaken by a newer push', () => {
    const HEAD = 'd7cd4407e607021c45f125966109a83f386afebf';
    const NEWER = '274e1b11465985b58c356e17c45dea9a0ea6101a';
    const root = new URL('../../../../', import.meta.url).pathname;

    // Stub gh prints STUB_SHA or exits STUB_GH_STATUS; stub docker records its calls.
    const run = (script: string, stub: { sha?: string; ghStatus?: number }) => {
      const dir = mkdtempSync(join(tmpdir(), 'release-head-'));
      try {
        const bin = join(dir, 'bin');
        execFileSync('mkdir', [bin]);
        writeFileSync(
          join(bin, 'gh'),
          '#!/bin/sh\n[ "${STUB_GH_STATUS:-0}" = 0 ] || exit "$STUB_GH_STATUS"\nprintf "%s\\n" "$STUB_SHA"\n',
          { mode: 0o755 },
        );
        writeFileSync(
          join(bin, 'docker'),
          `#!/bin/sh\necho "$*" >> ${join(dir, 'docker.log')}\n`,
          { mode: 0o755 },
        );
        const githubEnv = join(dir, 'github_env');
        writeFileSync(githubEnv, '');
        const result = spawnSync(
          'bash',
          ['-e', '-o', 'pipefail', '-c', script],
          {
            cwd: root,
            encoding: 'utf8',
            env: {
              ...process.env,
              PATH: `${bin}:${process.env.PATH}`,
              GITHUB_ENV: githubEnv,
              GITHUB_REPOSITORY: 'bakers-build/bakers-build',
              RELEASE_BRANCH: 'next',
              RELEASE_HEAD: HEAD,
              GH_TOKEN: 'token',
              GITHUB_ACTOR: 'ci',
              STUB_SHA: stub.sha ?? '',
              STUB_GH_STATUS: String(stub.ghStatus ?? 0),
            },
          },
        );
        const dockerLog = join(dir, 'docker.log');
        return {
          ...result,
          githubEnv: readFileSync(githubEnv, 'utf8'),
          docker: existsSync(dockerLog) ? readFileSync(dockerLog, 'utf8') : '',
        };
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    };
    const headCheck = 'bash scripts/ci/github-release-head.sh';

    it('lets the current head proceed', () => {
      const result = run(headCheck, { sha: HEAD });
      expect(result.status).toBe(0);
      expect(result.stdout.trim()).toBe('current');
      expect(result.githubEnv).toBe('');
    });

    it('stops a superseded head without failing and marks the rest of the job skipped', () => {
      const result = run(headCheck, { sha: NEWER });
      expect(result.status).toBe(0);
      expect(result.stdout.trim()).toBe('superseded');
      expect(result.githubEnv).toContain('RELEASE_SUPERSEDED=1');
    });

    it.each([
      ['the branch ref cannot be read', { ghStatus: 1 }],
      ['the branch ref is empty', { sha: '' }],
    ])('fails when %s', (_case, stub) => {
      const result = run(headCheck, stub);
      expect(result.status).not.toBe(0);
      expect(result.githubEnv).not.toContain('RELEASE_SUPERSEDED');
    });

    it('checks the head only through the script and skips every later step once superseded', () => {
      const raw = read('.github/workflows/release.yml');
      expect(raw).not.toContain('git/ref/heads');
      const steps: { name?: string; if?: string }[] =
        parse(raw).jobs.release.steps;
      const first = steps.findIndex(
        (s) => s.name === 'Check branch and candidate',
      );
      expect(first).toBeGreaterThan(-1);
      for (const step of steps.slice(first + 1)) {
        if (step.if === 'always()') continue;
        expect(step.if, step.name).toContain("env.RELEASE_SUPERSEDED != '1'");
      }
    });

    it('promotes no image digest when the branch moved on during the release', () => {
      const promote = parse(
        read('.github/workflows/release.yml'),
      ).jobs.release.steps.find(
        (s: { name?: string }) => s.name === 'Promote verified image digests',
      );
      const result = run(promote.run, { sha: NEWER });
      expect(result.status).toBe(0);
      expect(result.docker).toBe('');
      expect(result.githubEnv).toContain('RELEASE_SUPERSEDED=1');
    });
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
