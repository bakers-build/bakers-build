import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import type { ToolRequest } from '@bakers-build/conductor/contract';
import { validateArgs } from '@bakers-build/message';
import { describe, expect, it } from 'vitest';
import type { ForgeBackend, ForgeCheck, ForgePr } from '../src/backend.js';
import { mergeRule } from '../src/config.js';
import { tools as presetTools } from '../src/preset.js';
import { FORGE_TOOL_DEFINITIONS } from '../src/tool-definitions.js';
import { FORGE_NEEDS_RUN, forgeTools, toolsFor } from '../src/tools.js';
import { type GitFixture, git, gitFixture } from './git-fixture.js';

const SECRET = 'tok-SECRET-123';

function fakeBackend(options: {
  remote?: string;
  prs?: ForgePr[];
  checks?: ForgeCheck[];
  blocker?: string;
  failWith?: string;
  /** What the forge does on merge, e.g. a real merge on the fixture remote. */
  onMerge?: () => void;
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
    checks: async (ref, base) => {
      calls.push(`checks:${ref}:${base}`);
      return options.checks ?? [];
    },
    mergeBlocker: async () => options.blocker,
    merge: async (pr, o) => {
      calls.push(
        `merge:${pr.number}:${o.method}:${o.deleteSource}:${o.subject}\n${o.body}`,
      );
      options.onMerge?.();
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

const green: ForgeCheck[] = [
  { name: 'required', status: 'success', required: true },
  { name: 'optional', status: 'failure', required: false },
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

  it('forge_checks reports rows, required flags and the overall status of the PR head', async () => {
    const { backend, calls } = fakeBackend({
      prs: [pr()],
      checks: [...green, { name: 'e2e', status: 'pending', required: true }],
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
          checks: [{ name: 'required', status: 'pending', required: true }],
        },
        {},
        /required \(pending\)/,
      ],
      [
        {
          prs: [pr()],
          checks: [{ name: 'required', status: 'failure', required: true }],
        },
        {},
        /required \(failure\)/,
      ],
      [
        {
          prs: [pr()],
          checks: [{ name: 'required', status: 'missing', required: true }],
        },
        {},
        /required \(missing\)/,
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

  describe('promotion', () => {
    const DEPLOY = { ...RUN, type: 'deployment' };
    const SETTINGS = {
      merge: { main: { method: 'merge', delete_source: false } },
    };
    const TITLE = 'chore(release): 1.2.3';
    const promoPr = (headSha: string) =>
      pr({ head: 'next', base: 'main', title: TITLE, headSha });
    const promo = (sha: string, extra: Record<string, unknown> = {}) => ({
      promote_to: 'main',
      expected_sha: sha,
      ...extra,
    });

    /** A plain clone of the fixture remote, outside the planted config. */
    const scratch = (f: GitFixture) => {
      const dir = mkdtempSync(join(f.root, 'scratch-'));
      git(f.root, 'clone', '-q', `file://${f.remote}`, dir);
      return dir;
    };
    /** A feature lands on the remote's next: the release candidate. */
    const advanceNext = (f: GitFixture) => {
      const dir = scratch(f);
      git(dir, 'checkout', '-q', 'next');
      const sha = f.commit(dir, 'candidate');
      git(dir, 'push', '-q', 'origin', 'next');
      return sha;
    };
    /** What the forge's merge-commit merge of `source` into main does. */
    const mergeIntoMain = (f: GitFixture, source: string) => () => {
      const dir = scratch(f);
      git(dir, 'checkout', '-q', 'main');
      git(dir, 'merge', '-q', '--no-ff', '-m', 'merge', `origin/${source}`);
      git(dir, 'push', '-q', 'origin', 'main');
    };
    const writes = (calls: string[]) =>
      calls.filter((c) => /^(create|update|merge):/.test(c));

    it('is described on forge_pr_upsert, forge_checks and forge_merge', () => {
      const sha = 'a'.repeat(40);
      for (const name of ['forge_pr_upsert', 'forge_checks', 'forge_merge'])
        expect(
          validateArgs(FORGE_TOOL_DEFINITIONS[name]!.input, {
            ...(name === 'forge_pr_upsert' ? { title: TITLE } : {}),
            ...promo(sha),
          }).ok,
          name,
        ).toBe(true);
      expect(
        validateArgs(FORGE_TOOL_DEFINITIONS.forge_merge!.input, promo('abc'))
          .ok,
      ).toBe(false);
    });

    it('forge_pr_upsert opens base_branch into the target, then updates the same PR', async () => {
      const f = gitFixture();
      const sha = advanceNext(f);
      const { backend, calls } = fakeBackend({ remote: f.remote });
      const tools = forgeTools({
        backend: async () => backend,
        settings: SETTINGS,
      });
      const call = async () =>
        JSON.parse(
          (
            await tools.forge_pr_upsert!(
              request({ title: TITLE, ...promo(sha) }, f.clone, DEPLOY),
            )
          ).text,
        );
      expect(await call()).toMatchObject({
        url: 'https://forge/pr/1',
        target: 'main',
        created: true,
      });
      expect((await call()).created).toBe(false);
      expect(writes(calls)).toEqual([
        `create:next->main:${TITLE}`,
        `update:1:${TITLE}`,
      ]);
    });

    it('forge_checks reports the required checks of the promotion PR', async () => {
      const f = gitFixture();
      const sha = advanceNext(f);
      const { backend, calls } = fakeBackend({
        remote: f.remote,
        prs: [promoPr(sha)],
        checks: green,
      });
      const tools = forgeTools({
        backend: async () => backend,
        settings: SETTINGS,
      });
      const out = JSON.parse(
        (await tools.forge_checks!(request(promo(sha), f.clone, DEPLOY))).text,
      );
      expect(out).toMatchObject({ ref: sha, base: 'main', overall: 'success' });
      expect(calls).toContain(`checks:${sha}:main`);
    });

    it("forge_merge merges by merge commit, keeps next and verifies the target's second parent", async () => {
      const f = gitFixture();
      const sha = advanceNext(f);
      const { backend, calls } = fakeBackend({
        remote: f.remote,
        prs: [promoPr(sha)],
        checks: green,
        onMerge: mergeIntoMain(f, 'next'),
      });
      const out = JSON.parse(
        (
          await forgeTools({
            backend: async () => backend,
            settings: SETTINGS,
          }).forge_merge!(request(promo(sha), f.clone, DEPLOY))
        ).text,
      );
      expect(out).toMatchObject({
        merged: true,
        into: 'main',
        method: 'merge',
        source_deleted: false,
        promoted: true,
        second_parent: sha,
      });
      expect(writes(calls)).toEqual([
        `merge:1:merge:false:${TITLE}\nMerged-by: bakers.build\nref:BB-7`,
      ]);
    });

    it('forge_merge reports a target whose second parent is not the frozen SHA, naming both', async () => {
      const f = gitFixture();
      const sha = advanceNext(f);
      const other = f.remoteSha('feat/bb-1-parent')!;
      const { backend } = fakeBackend({
        remote: f.remote,
        prs: [promoPr(sha)],
        checks: green,
        onMerge: mergeIntoMain(f, 'feat/bb-1-parent'),
      });
      const err = await forgeTools({
        backend: async () => backend,
        settings: SETTINGS,
      }).forge_merge!(request(promo(sha), f.clone, DEPLOY)).catch(
        (e: Error) => e.message,
      );
      expect(err).toContain(`main^2 is ${other}`);
      expect(err).toContain(sha);
    });

    it('forge_merge refuses a PR head other than the frozen SHA, and a required check not green', async () => {
      const f = gitFixture();
      const sha = advanceNext(f);
      const cases: [Parameters<typeof fakeBackend>[0], RegExp][] = [
        [
          { prs: [promoPr('f'.repeat(40))], checks: green },
          /head is f{40}, not the expected_sha/,
        ],
        [
          {
            prs: [promoPr(sha)],
            checks: [{ name: 'required', status: 'pending', required: true }],
          },
          /required \(pending\)/,
        ],
      ];
      for (const [options, error] of cases) {
        const { backend, calls } = fakeBackend({
          remote: f.remote,
          ...options,
        });
        await expect(
          forgeTools({
            backend: async () => backend,
            settings: SETTINGS,
          }).forge_merge!(request(promo(sha), f.clone, DEPLOY)),
        ).rejects.toThrow(error);
        expect(writes(calls)).toEqual([]);
      }
    });

    it('refuses a ticket that is not a deployment, on every promotion tool, with no forge call', async () => {
      const sha = 'a'.repeat(40);
      for (const ticket of [{ ...RUN, type: 'feature' }, RUN])
        for (const name of ['forge_pr_upsert', 'forge_checks', 'forge_merge']) {
          const { backend, calls } = fakeBackend({ prs: [promoPr(sha)] });
          const tools = forgeTools({
            backend: async () => backend,
            settings: SETTINGS,
          });
          await expect(
            tools[name]!(
              request({ title: TITLE, ...promo(sha) }, '/nonexistent', ticket),
            ),
          ).rejects.toThrow(/only a deployment ticket may promote/);
          expect(calls).toEqual([]);
        }
    });

    it('refuses a target without a merge rule of method merge, with no forge call', async () => {
      const sha = 'a'.repeat(40);
      for (const settings of [
        {},
        { merge: { main: { method: 'squash', delete_source: true } } },
        { merge: { '*': { method: 'merge', delete_source: false } } },
      ]) {
        const { backend, calls } = fakeBackend({});
        await expect(
          forgeTools({ backend: async () => backend, settings })
            .forge_pr_upsert!(
            request({ title: TITLE, ...promo(sha) }, '/nonexistent', DEPLOY),
          ),
        ).rejects.toThrow(/'main' has no merge rule with method 'merge'/);
        expect(calls).toEqual([]);
      }
    });

    it('refuses when base_branch moved past expected_sha, naming both SHAs', async () => {
      const f = gitFixture();
      const frozen = f.remoteSha('next')!;
      const moved = advanceNext(f);
      for (const name of ['forge_pr_upsert', 'forge_checks', 'forge_merge']) {
        const { backend, calls } = fakeBackend({
          remote: f.remote,
          prs: [promoPr(frozen)],
          checks: green,
        });
        const err = await forgeTools({
          backend: async () => backend,
          settings: SETTINGS,
        })[name]!(
          request({ title: TITLE, ...promo(frozen) }, f.clone, DEPLOY),
        ).catch((e: Error) => e.message);
        expect(err).toContain(`origin/next is at ${moved}`);
        expect(err).toContain(frozen);
        expect(calls).toEqual([]);
      }
    });

    it('refuses a malformed promotion, and an open base_branch PR into another target', async () => {
      const sha = 'a'.repeat(40);
      for (const args of [
        { promote_to: 'main' },
        promo('abc'),
        promo(sha, { branch: 'feat/bb-7-work' }),
        promo(sha, { ref: 'main' }),
      ]) {
        const { backend, calls } = fakeBackend({});
        await expect(
          forgeTools({ backend: async () => backend, settings: SETTINGS })
            .forge_checks!(request(args, '/nonexistent', DEPLOY)),
        ).rejects.toThrow(/promote_to needs expected_sha/);
        expect(calls).toEqual([]);
      }

      const f = gitFixture();
      const frozen = advanceNext(f);
      const { backend, calls } = fakeBackend({
        remote: f.remote,
        prs: [pr({ head: 'next', base: 'other' })],
      });
      await expect(
        forgeTools({ backend: async () => backend, settings: SETTINGS })
          .forge_pr_upsert!(
          request({ title: TITLE, ...promo(frozen) }, f.clone, DEPLOY),
        ),
      ).rejects.toThrow(/targets 'other', not 'main'/);
      expect(writes(calls)).toEqual([]);
    });
  });
});
