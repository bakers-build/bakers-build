import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ToolRequest } from '@bakers-build/conductor/contract';
import { createRunClone, loadRunClone, saveRunClone } from '@bakers-build/core';
import { validateArgs } from '@bakers-build/message';
import { afterEach, describe, expect, it } from 'vitest';
import type { ForgeBackend, ForgeCheck, ForgePr } from '../src/backend.js';
import { mergeRule } from '../src/config.js';
import { tools as presetTools } from '../src/preset.js';
import { FORGE_TOOL_DEFINITIONS } from '../src/tool-definitions.js';
import {
  FORGE_NEEDS_RUN,
  forgeTools,
  overall,
  toolsFor,
} from '../src/tools.js';
import { git, gitFixture, markerRan } from './git-fixture.js';

const SECRET = 'tok-SECRET-123';

function fakeBackend(options: {
  remote?: string;
  prs?: ForgePr[];
  checks?: ForgeCheck[];
  blocker?: string;
  failWith?: string;
}) {
  const calls: string[] = [];
  const prs = [...(options.prs ?? [])];
  const backend: ForgeBackend = {
    id: 'fake',
    secrets: () => [SECRET],
    gitAuth: async () => ({
      url: `file://${options.remote ?? '/nonexistent'}`,
      header: `Authorization: Bearer ${SECRET}`,
    }),
    findOpenPr: async (head) => {
      calls.push(`find:${head}`);
      if (options.failWith) throw new Error(options.failWith);
      return prs.find((p) => p.head === head);
    },
    createPr: async ({ head, base, title }) => {
      calls.push(`create:${head}->${base}:${title}`);
      const pr = {
        number: prs.length + 1,
        url: `https://forge/pr/${prs.length + 1}`,
        head,
        base,
        title,
        headSha: 'h',
      };
      prs.push(pr);
      return pr;
    },
    updatePr: async (pr, { title }) => {
      calls.push(`update:${pr.number}:${title}`);
      return { ...pr, title };
    },
    openPrsWithBase: async (base) => prs.filter((p) => p.base === base),
    checks: async (ref, base, opts) => {
      calls.push(`checks:${ref}:${base}${opts?.allRuns ? ':all' : ''}`);
      return options.checks ?? [];
    },
    mergeBlocker: async () => options.blocker,
    merge: async (pr, o) => {
      calls.push(
        `merge:${pr.number}:${o.method}:${o.deleteSource}:${o.subject}\n${o.body}`,
      );
    },
    isMerged: async () => true,
  };
  return { backend, calls };
}

const RUN = {
  identifier: 'BB-7',
  branchName: 'feat/bb-7-work',
  baseBranch: 'next',
};

function request(
  args: Record<string, unknown>,
  worktreePath = '/nonexistent',
  ticket: ToolRequest['ticket'] = RUN,
): ToolRequest {
  return {
    worktreePath,
    ...(ticket ? { ticket } : {}),
    args,
    signal: new AbortController().signal,
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    callTool: async () => ({ text: '' }),
  };
}

const pr = (over: Partial<ForgePr> = {}): ForgePr => ({
  number: 1,
  url: 'https://forge/pr/1',
  head: 'feat/bb-7-work',
  base: 'next',
  title: 'feat(cli): forge tools',
  headSha: 'abc',
  ...over,
});

const row = (
  name: string,
  status: ForgeCheck['status'],
  required: boolean,
  over: Partial<ForgeCheck> = {},
): ForgeCheck => ({
  name,
  status,
  required,
  conclusion: null,
  run_id: null,
  job_id: null,
  run_started_at: null,
  ...over,
});

const green: ForgeCheck[] = [
  row('required', 'success', true),
  row('optional', 'failure', false),
];

describe('forge tools', () => {
  it('serves the five tools through the preset', () => {
    expect(Object.keys(presetTools!.tools).sort()).toEqual([
      'forge_checks',
      'forge_fetch',
      'forge_merge',
      'forge_pr_upsert',
      'forge_push',
    ]);
  });

  it('fails closed without a backend', () => {
    expect(() => toolsFor({})).toThrow(
      /with\.backend\.use must name a forge backend/,
    );
    expect(() => toolsFor(undefined)).toThrow(/backend\.use/);
  });

  it('refuses a call without the run binding, and no tool accepts a base, target or ticket', async () => {
    const { backend, calls } = fakeBackend({});
    const tools = forgeTools({ backend: async () => backend, settings: {} });
    for (const name of Object.keys(FORGE_TOOL_DEFINITIONS)) {
      await expect(
        tools[name]!(
          request({ title: 'feat: x' }, '/nonexistent', { identifier: 'BB-7' }),
        ),
      ).rejects.toThrow(FORGE_NEEDS_RUN);
      for (const arg of ['base', 'target', 'ticket', 'base_branch'])
        expect(
          validateArgs(FORGE_TOOL_DEFINITIONS[name]!.input, { [arg]: 'main' })
            .ok,
        ).toBe(false);
    }
    expect(calls).toEqual([]);
  });

  it('forge_push refuses branches the run does not own, naming the pattern', async () => {
    const { backend } = fakeBackend({});
    const tools = forgeTools({ backend: async () => backend, settings: {} });
    for (const branch of [
      'main',
      'next',
      'feat/other',
      'feat/bb-7-workx',
      'feat/bb-7-work-',
    ])
      await expect(tools.forge_push!(request({ branch }))).rejects.toThrow(
        "only 'feat/bb-7-work' and 'feat/bb-7-work-<suffix>' may be used",
      );
  });

  it('forge_fetch and forge_push work on the clone through the backend remote', async () => {
    const f = gitFixture();
    const { backend } = fakeBackend({ remote: f.remote });
    const tools = forgeTools({ backend: async () => backend, settings: {} });
    const fetched = JSON.parse(
      (
        await tools.forge_fetch!(
          request({ branches: 'feat/bb-1-parent' }, f.clone),
        )
      ).text,
    );
    expect(fetched.fetched.map((r: { name: string }) => r.name)).toEqual([
      'next',
      'feat/bb-1-parent',
    ]);
    const pushed = JSON.parse(
      (await tools.forge_push!(request({}, f.clone))).text,
    );
    expect(f.remoteSha('feat/bb-7-work')).toBe(pushed.sha);
    expect(git(f.clone, 'rev-parse', 'feat/bb-7-work')).toBe(pushed.sha);
  });

  it('forge_pr_upsert refuses a bad title before any backend call', async () => {
    const { backend, calls } = fakeBackend({});
    let loads = 0;
    const tools = forgeTools({
      backend: async () => {
        loads++;
        return backend;
      },
      settings: {},
    });
    for (const title of ['Add stuff', 'Draft: feat: x'])
      await expect(tools.forge_pr_upsert!(request({ title }))).rejects.toThrow(
        /Conventional Commits/,
      );
    expect(calls).toEqual([]);
    expect(loads).toBe(0);
  });

  it('forge_pr_upsert creates into the derived base, then updates instead of creating again', async () => {
    const { backend, calls } = fakeBackend({});
    const tools = forgeTools({ backend: async () => backend, settings: {} });
    const first = JSON.parse(
      (
        await tools.forge_pr_upsert!(
          request({ title: 'feat: x', branch: 'feat/bb-7-work-2' }),
        )
      ).text,
    );
    expect(first).toMatchObject({ target: 'feat/bb-7-work', created: true });
    const second = JSON.parse(
      (
        await tools.forge_pr_upsert!(
          request({ title: 'feat(cli)!: y', branch: 'feat/bb-7-work-2' }),
        )
      ).text,
    );
    expect(second.created).toBe(false);
    expect(calls.filter((c) => c.startsWith('create'))).toEqual([
      'create:feat/bb-7-work-2->feat/bb-7-work:feat: x',
    ]);
    expect(calls).toContain('update:1:feat(cli)!: y');
  });

  it("a deployment run opens and merges its branch into target_branch by that target's rule", async () => {
    const deploy = {
      identifier: 'BB-9',
      branchName: 'release/bb-9',
      baseBranch: 'next',
      targetBranch: 'main',
    };
    const settings = {
      merge: {
        main: { method: 'merge', delete_source: false },
        '*': { method: 'squash', delete_source: true },
      },
    };
    const { backend, calls } = fakeBackend({ checks: green });
    const tools = forgeTools({ backend: async () => backend, settings });
    const opened = JSON.parse(
      (
        await tools.forge_pr_upsert!(
          request({ title: 'chore(release): 1.2.3' }, '/nonexistent', deploy),
        )
      ).text,
    );
    expect(opened).toMatchObject({ target: 'main', created: true });
    const merged = JSON.parse(
      (await tools.forge_merge!(request({}, '/nonexistent', deploy))).text,
    );
    expect(merged).toMatchObject({
      into: 'main',
      method: 'merge',
      source_deleted: false,
    });
    expect(calls).toContain('create:release/bb-9->main:chore(release): 1.2.3');
    expect(calls).toContain(
      'merge:1:merge:false:chore(release): 1.2.3\nMerged-by: bakers.build\nref:BB-9',
    );
  });

  it('forge_checks reports rows, required flags and the overall status of the PR head', async () => {
    const { backend, calls } = fakeBackend({
      prs: [pr()],
      checks: [...green, row('e2e', 'pending', true)],
    });
    const tools = forgeTools({ backend: async () => backend, settings: {} });
    const out = JSON.parse((await tools.forge_checks!(request({}))).text);
    expect(out).toMatchObject({ ref: 'abc', base: 'next', overall: 'pending' });
    expect(out.checks).toHaveLength(3);
    expect(calls).toContain('checks:abc:next');
    const any = JSON.parse(
      (await tools.forge_checks!(request({ ref: 'main' }))).text,
    );
    expect(any.ref).toBe('main');
    await tools.forge_checks!(request({ all_runs: true }));
    expect(calls).toContain('checks:abc:next:all');
  });

  it('forge_merge refuses: not owned, no PR, wrong target, bad title, conflict, required check not green', async () => {
    const cases: [
      Parameters<typeof fakeBackend>[0],
      Record<string, unknown>,
      RegExp,
    ][] = [
      [{ prs: [pr()] }, { branch: 'next' }, /not owned/],
      [{ prs: [] }, {}, /no open PR\/MR/],
      [
        { prs: [pr({ base: 'main' })] },
        {},
        /targets 'main', but .* merges into 'next'/,
      ],
      [{ prs: [pr({ title: 'Add stuff' })] }, {}, /Conventional Commits/],
      [{ prs: [pr()], blocker: 'merge conflict' }, {}, /merge conflict/],
      [
        {
          prs: [pr()],
          checks: [row('required', 'pending', true)],
        },
        {},
        /required \(pending\)/,
      ],
      [
        {
          prs: [pr()],
          checks: [row('required', 'failure', true)],
        },
        {},
        /required \(failure\)/,
      ],
      [
        {
          prs: [pr()],
          checks: [row('required', 'missing', true)],
        },
        {},
        /required \(missing\)/,
      ],
      [
        {
          prs: [pr()],
          checks: [row('required', 'success', true, { conclusion: 'skipped' })],
        },
        {},
        /required \(skipped\)/,
      ],
      [
        { prs: [pr()], checks: [row('build', 'failure', false)] },
        {},
        /no required checks reported/,
      ],
      [
        {
          prs: [pr()],
          checks: [
            row('ci', 'success', true),
            row('required', 'failure', false, { conclusion: 'failure' }),
          ],
        },
        {},
        /required \(failure\)/,
      ],
    ];
    for (const [options, args, error] of cases) {
      const { backend, calls } = fakeBackend(options);
      const tools = forgeTools({ backend: async () => backend, settings: {} });
      await expect(tools.forge_merge!(request(args))).rejects.toThrow(error);
      expect(calls.some((c) => c.startsWith('merge:'))).toBe(false);
    }
  });

  it('forge_merge sends the rule explicitly with Merged-by and the final ref: line, and keeps a source others target', async () => {
    const settings = {
      merge: {
        main: { method: 'merge', delete_source: false },
        '*': { method: 'squash', delete_source: true },
      },
    };
    const one = fakeBackend({ prs: [pr()], checks: green });
    const out = JSON.parse(
      (
        await forgeTools({ backend: async () => one.backend, settings })
          .forge_merge!(request({}))
      ).text,
    );
    expect(out).toMatchObject({
      merged: true,
      into: 'next',
      method: 'squash',
      source_deleted: true,
    });
    expect(one.calls).toContain(
      'merge:1:squash:true:feat(cli): forge tools\nMerged-by: bakers.build\nref:BB-7',
    );

    const variant = pr({
      number: 2,
      url: 'https://forge/pr/2',
      head: 'feat/bb-7-work-2',
      base: 'feat/bb-7-work',
    });
    const kept = fakeBackend({ prs: [pr(), variant], checks: green });
    const keptOut = JSON.parse(
      (
        await forgeTools({ backend: async () => kept.backend, settings })
          .forge_merge!(request({}))
      ).text,
    );
    expect(keptOut).toMatchObject({
      source_deleted: false,
      source_kept_for: ['https://forge/pr/2'],
    });

    expect(mergeRule(settings, 'main')).toEqual({
      method: 'merge',
      delete_source: false,
    });
    expect(mergeRule({}, 'next')).toEqual({
      method: 'squash',
      delete_source: true,
    });
  });

  it('never returns the token in a result or an error', async () => {
    const failing = fakeBackend({ failWith: `401 for token ${SECRET}` });
    const tools = forgeTools({
      backend: async () => failing.backend,
      settings: {},
    });
    const err = await tools.forge_checks!(request({})).catch(
      (e: Error) => e.message,
    );
    expect(err).toContain('[redacted]');
    expect(err).not.toContain(SECRET);

    const f = gitFixture();
    const ok = fakeBackend({ remote: f.remote });
    const live = forgeTools({ backend: async () => ok.backend, settings: {} });
    const results = [
      (await live.forge_fetch!(request({}, f.clone))).text,
      (await live.forge_push!(request({}, f.clone))).text,
      await live.forge_push!(
        request({ branch: 'feat/bb-7-work-9' }, f.clone),
      ).catch((e: Error) => e.message),
    ];
    for (const text of results) expect(text).not.toContain(SECRET);
  });

  it('redacts a token the backend mints only during the call', async () => {
    const minted = 'ghs_MINTED_LATE';
    let token: string | undefined;
    const { backend } = fakeBackend({});
    const late: ForgeBackend = {
      ...backend,
      secrets: () => (token ? [token] : []),
      findOpenPr: async () => {
        token = minted;
        throw new Error(`401 for token ${minted}`);
      },
    };
    const tools = forgeTools({ backend: async () => late, settings: {} });
    const err = await tools.forge_checks!(request({})).catch(
      (e: Error) => e.message,
    );
    expect(err).toBe('401 for token [redacted]');
  });
});

describe('overall', () => {
  it.each([
    ['failure', row('ci', 'failure', true, { conclusion: 'failure' }), 'failure'],
    ['cancelled', row('ci', 'failure', true, { conclusion: 'cancelled' }), 'failure'],
    ['timed_out', row('ci', 'failure', true, { conclusion: 'timed_out' }), 'failure'],
    ['skipped', row('ci', 'success', true, { conclusion: 'skipped' }), 'failure'],
    ['pending', row('ci', 'pending', true), 'pending'],
    ['missing', row('ci', 'missing', true), 'pending'],
  ] as const)('a required %s check is never success', (_, check, want) => {
    expect(overall([row('lint', 'success', true), check])).toBe(want);
  });

  it('reports no_required_checks, not success, when no check is required', () => {
    expect(overall([])).toBe('no_required_checks');
    expect(overall([row('build', 'success', false)])).toBe('no_required_checks');
  });

  it('counts a check named required as required even when unflagged', () => {
    expect(overall([row('required', 'failure', false)])).toBe('failure');
    expect(overall([row('required', 'success', false)])).toBe('success');
  });

  it('is success when every required check is green, whatever the others say', () => {
    expect(overall(green)).toBe('success');
  });
});

describe('forge tools for a run clone', () => {
  const ident = ['-c', 'user.name=t', '-c', 'user.email=t@example.test'];
  let cacheHome: string | undefined;
  afterEach(() => {
    if (cacheHome === undefined) delete process.env.XDG_CACHE_HOME;
    else process.env.XDG_CACHE_HOME = cacheHome;
  });

  /** The fixture's clone is the parent repository; the run works in its own clone of the ticket branch. */
  function cloned() {
    const f = gitFixture();
    // The parent is the operator's own repository: drop the fixture's planted
    // config there, so the marker proves only what the run's directory caused.
    for (const key of [
      'core.hooksPath',
      'core.fsmonitor',
      'core.sshCommand',
      'remote.origin.pushurl',
      `url.file://${f.evil}.insteadOf`,
    ])
      git(f.clone, 'config', '--unset', key);
    rmSync(join(f.clone, '.git/hooks'), { recursive: true });
    cacheHome = process.env.XDG_CACHE_HOME;
    process.env.XDG_CACHE_HOME = join(f.root, 'cache');
    const workspace = join(f.root, 'run-workspace');
    const record = createRunClone({
      parent: f.clone,
      workspace,
      branch: RUN.branchName,
      target: 'next',
    });
    saveRunClone({ ...record, protectedPaths: ['.bakers'] });
    const run = (...args: string[]) =>
      git(
        workspace,
        `--git-dir=${record.gitDir}`,
        `--work-tree=${workspace}`,
        ...args,
      );
    const commit = (path: string) => {
      mkdirSync(join(workspace, path, '..'), { recursive: true });
      writeFileSync(join(workspace, path), 'run work');
      run('add', '-A');
      run(...ident, 'commit', '-qm', path);
      return run('rev-parse', 'HEAD');
    };
    // What a run could plant in its own Git directory.
    const plant = () => {
      const touch = `sh -c 'echo ran >> ${f.marker}'`;
      writeFileSync(
        join(record.gitDir, 'config'),
        `[core]\n\tfsmonitor = ${touch}\n\thooksPath = ${join(record.gitDir, 'hooks')}\n\tsshCommand = ${touch}\n`,
      );
      mkdirSync(join(record.gitDir, 'hooks'), { recursive: true });
      for (const hook of ['reference-transaction', 'pre-push', 'post-update'])
        writeFileSync(
          join(record.gitDir, 'hooks', hook),
          `#!/bin/sh\necho ran >> ${f.marker}\n`,
          { mode: 0o755 },
        );
    };
    const { backend } = fakeBackend({ remote: f.remote });
    const tools = forgeTools({ backend: async () => backend, settings: {} });
    return { f, workspace, record, run, commit, plant, tools };
  }

  it('forge_fetch fetches into the parent and refreshes the run origin refs without the run config', async () => {
    const { f, workspace, record, run, plant, tools } = cloned();
    const seed = join(f.root, 'seed');
    git(seed, 'checkout', '-q', 'next');
    const moved = f.commit(seed, 'moved-target');
    git(seed, 'push', '-q', `file://${f.remote}`, 'next');
    const ticket = run('rev-parse', 'HEAD');
    plant();

    const result = JSON.parse(
      (await tools.forge_fetch!(request({}, workspace))).text,
    );

    expect(result.fetched).toContainEqual({ name: 'next', sha: moved });
    expect(git(f.clone, 'rev-parse', 'origin/next')).toBe(moved);
    rmSync(join(record.gitDir, 'config'));
    rmSync(join(record.gitDir, 'hooks'), { recursive: true });
    expect(run('rev-parse', 'origin/next')).toBe(moved);
    expect(run('cat-file', '-t', moved)).toBe('commit');
    expect(run('rev-parse', 'HEAD')).toBe(ticket);
    expect(markerRan(f)).toBe(false);
  });

  it('forge_push transfers the run commits to the parent branch, then pushes it', async () => {
    const { f, workspace, record, run, commit, plant, tools } = cloned();
    const tip = commit('feature.txt');
    plant();

    const result = JSON.parse(
      (await tools.forge_push!(request({}, workspace))).text,
    );

    expect(result).toEqual({ branch: RUN.branchName, sha: tip });
    expect(git(f.clone, 'rev-parse', RUN.branchName)).toBe(tip);
    expect(f.remoteSha(RUN.branchName)).toBe(tip);
    expect(loadRunClone(workspace)?.expected).toBe(tip);
    rmSync(join(record.gitDir, 'config'));
    expect(run('rev-parse', `origin/${RUN.branchName}`)).toBe(tip);
    expect(markerRan(f)).toBe(false);
  });

  it('forge_push rejects a commit that changes a protected path and pushes nothing', async () => {
    const { f, workspace, record, commit, tools } = cloned();
    commit('.bakers/provision.sh');

    await expect(tools.forge_push!(request({}, workspace))).rejects.toThrow(
      /protected path/,
    );

    expect(git(f.clone, 'rev-parse', RUN.branchName)).toBe(record.expected);
    expect(f.remoteSha(RUN.branchName)).toBeUndefined();
  });
});
