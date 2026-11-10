import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  emptyAgentFootprint,
  sandboxFailures,
} from '@bakers-build/conductor/contract';
import { describe, expect, it } from 'vitest';

const pluginRoot = new URL('..', import.meta.url);
const bakersPackagePath = new URL(
  '../../../host/package.json',
  import.meta.url,
);

async function loadOpencodeModule() {
  return import('../src/index.js');
}

describe('workspace package structure', () => {
  it('mirrors the expected agent plugin package layout', () => {
    const rootPath = pluginRoot.pathname;
    const pkg = JSON.parse(
      readFileSync(join(rootPath, 'package.json'), 'utf8'),
    ) as {
      name: string;
      exports: Record<string, string>;
      scripts: Record<string, string>;
      peerDependencies: Record<string, string>;
    };
    const tsconfig = JSON.parse(
      readFileSync(join(rootPath, 'tsconfig.json'), 'utf8'),
    ) as { extends: string };
    const bakersPkg = JSON.parse(readFileSync(bakersPackagePath, 'utf8')) as {
      dependencies: Record<string, string>;
    };

    expect(pkg.name).toBe('@bakers-build/addon-opencode');
    // BB-215: every addon now also ships the conventional ./preset subpath.
    expect(pkg.exports).toEqual({
      '.': './dist/src/index.js',
      './preset': './dist/src/preset.js',
    });
    expect(pkg.scripts).toMatchObject({
      build: 'tsc',
      typecheck: 'tsc --noEmit',
    });
    // BB-224 (Finding 6, decision 12): a conductor-surface addon peer-depends
    // on BOTH the kernel and the surface-contract package that owns the agent
    // interfaces (`@bakers-build/conductor`) — the new layered-DAG ratchet.
    expect(pkg.peerDependencies).toEqual({
      '@bakers-build/conductor': 'workspace:^',
      '@bakers-build/core': 'workspace:^',
    });
    expect(tsconfig.extends).toBe('../../tsconfig.base.json');
    expect(bakersPkg.dependencies['@bakers-build/addon-opencode']).toBe(
      'workspace:^',
    );
    expect(existsSync(join(rootPath, 'src/index.ts'))).toBe(true);
    expect(existsSync(join(rootPath, 'tests/opencode.test.ts'))).toBe(true);
  });
});

describe('default export', () => {
  it('is the same factory reference as the named `opencodeAgent` export', async () => {
    const mod = await loadOpencodeModule();
    expect(mod.default).toBe(mod.opencodeAgent);
  });

  it('builds an opencode agent plugin descriptor', async () => {
    const { default: opencodeAgent } = await loadOpencodeModule();
    expect(opencodeAgent().kind).toBe('agent');
    expect(opencodeAgent().id).toBe('opencode');
  });
});

describe('OpencodeAgent.launchCommand', () => {
  it('starts the interactive TUI with the initial prompt and auto-approve in yolo', async () => {
    const { OpencodeAgent } = await loadOpencodeModule();
    expect(
      new OpencodeAgent({ permissions: 'yolo' }).launchCommand('do the thing'),
    ).toBe("opencode --prompt 'do the thing' --auto");
  });

  it('includes the optional model', async () => {
    const { OpencodeAgent } = await loadOpencodeModule();
    expect(
      new OpencodeAgent({
        permissions: 'yolo',
        model: 'anthropic/claude-sonnet-4-20250514',
      }).launchCommand('do it'),
    ).toBe(
      "opencode --prompt 'do it' --model 'anthropic/claude-sonnet-4-20250514' --auto",
    );
  });

  it('returns bare opencode for an empty prompt', async () => {
    const { OpencodeAgent } = await loadOpencodeModule();
    expect(new OpencodeAgent({}).launchCommand('')).toBe('opencode');
  });

  it('POSIX-quotes a multi-line prompt for the sh-evaluated launch file', async () => {
    const { OpencodeAgent } = await loadOpencodeModule();
    const prompt = 'one\n\ntwo';
    const command = new OpencodeAgent({ permissions: 'yolo' }).launchCommand(
      prompt,
    );

    expect(command).toBe("opencode --prompt 'one\n\ntwo' --auto");
  });
});

describe('OpencodeAgent security', () => {
  const NO_SANDBOX =
    "OpenCode has no OS sandbox, so permissions: 'sandbox' cannot be enforced; leave permissions unset or set 'system' (your own OpenCode configuration) or 'yolo'";

  it('defaults to system: no auto-approval, no warning and no sandbox claim', async () => {
    const { OpencodeAgent } = await loadOpencodeModule();
    const agent = new OpencodeAgent();
    expect(agent.launchCommand('x')).toBe("opencode --prompt 'x'");
    expect(agent.launchWarnings).toBeUndefined();
    expect(agent.runEnvPolicy.drop).toBe(true);
    expect(await sandboxFailures([{ id: agent.id, agent }])).toEqual([]);
  });

  it('fails loading when sandbox mode is set explicitly', async () => {
    const { OpencodeAgent } = await loadOpencodeModule();
    expect(() => new OpencodeAgent({ permissions: 'sandbox' })).toThrow(
      NO_SANDBOX,
    );
    expect(
      () =>
        new OpencodeAgent({
          permissions: 'sandbox',
          sandbox: { network: ['*'] },
        }),
    ).toThrow(NO_SANDBOX);
  });

  it('yolo auto-approves and system adds no security flag', async () => {
    const { OpencodeAgent } = await loadOpencodeModule();
    expect(new OpencodeAgent({ permissions: 'yolo' }).launchCommand('x')).toBe(
      "opencode --prompt 'x' --auto",
    );
    expect(
      new OpencodeAgent({ permissions: 'system' }).launchCommand('x'),
    ).toBe("opencode --prompt 'x'");
  });

  it('drops ticket env vars except in yolo', async () => {
    const { OpencodeAgent } = await loadOpencodeModule();
    expect(new OpencodeAgent({ permissions: 'system' }).runEnvPolicy.drop).toBe(
      true,
    );
    expect(new OpencodeAgent({ permissions: 'yolo' }).runEnvPolicy.drop).toBe(
      false,
    );
  });

  it('applies the shared security validation and rejects custom', async () => {
    const { OpencodeAgent } = await loadOpencodeModule();
    const cases: [Record<string, unknown>, RegExp][] = [
      [{ skip_permissions: true }, /skip_permissions was removed/],
      [{ permissions: 'nope' }, /permissions must be one of/],
      [{ config: { a: 1 } }, /config is only valid with permissions: 'custom'/],
      [
        { sandbox: { network: ['*'] } },
        /sandbox is only valid with permissions: 'sandbox'/,
      ],
      [
        { permissions: 'sandbox', sandbox: { nope: [] } },
        /unknown sandbox key nope/,
      ],
      [
        { permissions: 'custom', config: { a: 1 } },
        /OpenCode has no config hand-off for permissions: 'custom'; use permissions: 'system'/,
      ],
    ];
    for (const [options, error] of cases) {
      expect(() => new OpencodeAgent(options as never)).toThrow(error);
    }
  });
});

function captureArgv(binary: string, command: string): string[] {
  const output = execFileSync(
    'bash',
    ['-c', `${binary}() { printf '%s\\0' "${binary}" "$@"; }; ${command}`],
    { encoding: 'utf8' },
  );
  return output.split('\0').slice(0, -1);
}

describe('OpencodeAgent args and unsupported effort', () => {
  it('appends args after --auto and ignores effort with a launch warning', async () => {
    const { OpencodeAgent } = await loadOpencodeModule();
    const agent = new OpencodeAgent({
      permissions: 'yolo',
      model: 'anthropic/claude-sonnet-4-20250514',
      effort: 'high',
      args: ['--foo', 'a b'],
    });
    expect(agent.launchWarnings).toEqual(['effort is unsupported and ignored']);
    expect(captureArgv('opencode', agent.launchCommand('task'))).toEqual([
      'opencode',
      '--prompt',
      'task',
      '--model',
      'anthropic/claude-sonnet-4-20250514',
      '--auto',
      '--foo',
      'a b',
    ]);
  });

  it('rejects reserved --prompt and --auto flags in every mode', async () => {
    const { OpencodeAgent } = await loadOpencodeModule();
    for (const security of [undefined, 'system', 'yolo'] as const) {
      expect(
        () => new OpencodeAgent({ permissions: security, args: ['--prompt'] }),
      ).toThrow(/reserved flag/);
      expect(
        () => new OpencodeAgent({ permissions: security, args: ['--auto'] }),
      ).toThrow(/reserved flag/);
    }
  });
});

const FIXTURE_STORAGE = new URL('fixtures/opencode-storage', import.meta.url)
  .pathname;

describe('defaultOpencodeStorageRoot', () => {
  it('honours XDG_DATA_HOME, else falls back to ~/.local/share (AC-1)', async () => {
    const { defaultOpencodeStorageRoot } = await loadOpencodeModule();
    const previous = process.env.XDG_DATA_HOME;
    try {
      process.env.XDG_DATA_HOME = '/xdg/data';
      expect(defaultOpencodeStorageRoot()).toBe('/xdg/data/opencode/storage');
      delete process.env.XDG_DATA_HOME;
      expect(defaultOpencodeStorageRoot()).toMatch(
        /\.local\/share\/opencode\/storage$/,
      );
    } finally {
      if (previous === undefined) {
        delete process.env.XDG_DATA_HOME;
      } else {
        process.env.XDG_DATA_HOME = previous;
      }
    }
  });
});

describe('OpencodeAgent.getRunLog', () => {
  it('finds the newest session for the worktree by its directory field (AC-1)', async () => {
    const { OpencodeAgent } = await loadOpencodeModule();
    const agent = new OpencodeAgent({}, FIXTURE_STORAGE);

    const log = await agent.getRunLog('/tmp/bakers-wt-opencode-A');
    const bundle = JSON.parse(log) as {
      session: { id: string; directory: string };
      messages: unknown[];
      parts: unknown[];
    };
    // ses_A matches the worktree directory and is the newest; ses_B (a
    // different directory) must not be picked.
    expect(bundle.session.id).toBe('ses_A');
    expect(bundle.session.directory).toBe('/tmp/bakers-wt-opencode-A');
    expect(bundle.messages).toHaveLength(3);
    expect(bundle.parts.length).toBeGreaterThan(0);
  });

  it("returns '' when no session's directory matches the worktree (AC-1)", async () => {
    const { OpencodeAgent } = await loadOpencodeModule();
    const agent = new OpencodeAgent({}, FIXTURE_STORAGE);
    await expect(agent.getRunLog('/tmp/no-such-worktree')).resolves.toBe('');
  });

  it("returns '' and never throws when the storage root is absent (AC-1)", async () => {
    const { OpencodeAgent } = await loadOpencodeModule();
    const agent = new OpencodeAgent({}, '/tmp/does-not-exist-opencode-storage');
    await expect(agent.getRunLog('/tmp/bakers-wt-opencode-A')).resolves.toBe(
      '',
    );
  });

  it('R4: never selects a session created before run.startedAt, even when it is the only/newest matching-directory session (BB-473)', async () => {
    const { mkdtemp, mkdir, writeFile, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { OpencodeAgent } = await loadOpencodeModule();
    const storageRoot = await mkdtemp(join(tmpdir(), 'bakers-opencode-'));
    try {
      const sessionDir = join(storageRoot, 'session', 'global');
      await mkdir(sessionDir, { recursive: true });
      // A leftover session from a PRIOR run in the same (reused) worktree —
      // matches the directory and is the only candidate, but predates this
      // run's start.
      await writeFile(
        join(sessionDir, 'ses_stale.json'),
        JSON.stringify({
          id: 'ses_stale',
          directory: '/tmp/bakers-wt-opencode-reused',
          time: { created: 1_000, updated: 1_000 },
        }),
      );
      const agent = new OpencodeAgent({}, storageRoot);
      const log = await agent.getRunLog('/tmp/bakers-wt-opencode-reused', {
        sessionId: 'r-1',
        startedAt: new Date(2_000),
      });
      expect(log).toBe('');
    } finally {
      await rm(storageRoot, { recursive: true, force: true });
    }
  });
});

describe('OpencodeAgent run log → footprint (end-to-end, AC-1/AC-2)', () => {
  it('parses the resolved session into a non-zero, correct footprint', async () => {
    const { OpencodeAgent } = await loadOpencodeModule();
    const agent = new OpencodeAgent({}, FIXTURE_STORAGE);

    const footprint = agent.parseFootprint(
      await agent.getRunLog('/tmp/bakers-wt-opencode-A'),
    );
    expect(footprint).toEqual({
      tokens: 4850, // a1 1650 + a2 3200 (every bucket incl. cache)
      duration_s: 10, // floor((1768658030000 - 1768658020000) / 1000)
      agent_turns: 2,
      tool_calls: 3, // 2 on a1 + 1 on a2 (reasoning/text parts ignored)
      user_prompts: 1,
      user_prompt_words: 6, // "please add the real footprint now"
      active_s: 0,
      model: 'kimi-for-coding/k3', // last assistant turn
    });
    expect(footprint.tokens).toBeGreaterThan(0);
    expect(footprint.agent_turns).toBeGreaterThan(0);
  });

  it('returns an empty footprint for an empty/garbage log', async () => {
    const { OpencodeAgent } = await loadOpencodeModule();
    const agent = new OpencodeAgent({});
    expect(agent.parseFootprint('')).toEqual(emptyAgentFootprint());
    expect(agent.parseFootprint('not json')).toEqual(emptyAgentFootprint());
  });
});

describe('OpencodeAgent shared run security', () => {
  it('ignores a shared mode and shows shared lists as not applied', async () => {
    const { opencodeAgent } = await loadOpencodeModule();
    const plugin = opencodeAgent({
      shared_permissions: {
        project: { mode: 'sandbox', sandbox: { allow_write: ['/x'] } },
      },
    } as never);
    expect(plugin.permissions?.mode).toEqual({
      value: 'system',
      source: 'agent',
    });
    expect(plugin.permissions?.not_applied).toEqual([
      { key: 'allow_write', source: 'project', reason: 'mode' },
    ]);
  });
});
