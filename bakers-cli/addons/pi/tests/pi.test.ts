import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { emptyAgentFootprint } from '@bakers-build/conductor/contract';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const pluginRoot = new URL('..', import.meta.url);

async function loadPiModule() {
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
      peerDependencies: Record<string, string>;
    };
    const tsconfig = JSON.parse(
      readFileSync(join(rootPath, 'tsconfig.json'), 'utf8'),
    ) as { extends: string };

    expect(pkg.name).toBe('@bakers-build/addon-pi');
    expect(pkg.exports).toEqual({
      '.': './dist/src/index.js',
      './preset': './dist/src/preset.js',
    });
    expect(pkg.peerDependencies).toEqual({
      '@bakers-build/conductor': 'workspace:^',
      '@bakers-build/core': 'workspace:^',
    });
    expect(tsconfig.extends).toBe('../../tsconfig.base.json');
    expect(existsSync(join(rootPath, 'src/index.ts'))).toBe(true);
    expect(existsSync(join(rootPath, 'src/preset.ts'))).toBe(true);
    expect(existsSync(join(rootPath, 'tests/pi.test.ts'))).toBe(true);
  });
});

describe('default export', () => {
  it('is the same factory reference as the named `piAgent` export', async () => {
    const mod = await loadPiModule();
    expect(mod.default).toBe(mod.piAgent);
  });

  it('builds a pi agent plugin descriptor', async () => {
    const { default: piAgent } = await loadPiModule();
    expect(piAgent().kind).toBe('agent');
    expect(piAgent().id).toBe('pi');
  });
});

describe('PiAgent.launchCommand', () => {
  it('starts pi interactively with the positional prompt + pinned session dir', async () => {
    const { PiAgent } = await loadPiModule();
    const command = new PiAgent({}).launchCommand('do the thing');

    expect(command).toBe("pi 'do the thing' --session-dir .bakers/pi-sessions");
    expect(command).not.toContain('-p');
    expect(command).not.toContain('--print');
  });

  it('injects provider/model/thinking (in order) before --session-dir', async () => {
    const { PiAgent } = await loadPiModule();
    const command = new PiAgent({
      provider: 'kimi-coding',
      model: 'kimi-coding/k3',
      thinking: 'high',
    }).launchCommand('do it');

    expect(command).toBe(
      "pi 'do it' --provider 'kimi-coding' --model 'kimi-coding/k3' --thinking 'high' --session-dir .bakers/pi-sessions",
    );
  });

  it('appends --approve when opted in, after --session-dir', async () => {
    const { PiAgent } = await loadPiModule();
    const command = new PiAgent({ approve: true }).launchCommand('go');
    expect(command).toBe("pi 'go' --session-dir .bakers/pi-sessions --approve");
  });

  it('returns bare pi for an empty prompt', async () => {
    const { PiAgent } = await loadPiModule();
    expect(new PiAgent({}).launchCommand('')).toBe('pi');
  });

  it('POSIX-quotes a multi-line prompt for the sh-evaluated launch file', async () => {
    const { PiAgent } = await loadPiModule();
    const prompt = 'para one\n\npara two';
    const command = new PiAgent({}).launchCommand(prompt);

    expect(command).toBe(
      "pi 'para one\n\npara two' --session-dir .bakers/pi-sessions",
    );
  });

  it('R4: scopes --session-dir per-run when a run identity is given (BB-473)', async () => {
    const { PiAgent } = await loadPiModule();
    const command = new PiAgent({}).launchCommand('do the thing', {
      sessionId: 'run-abc',
    });
    expect(command).toBe(
      "pi 'do the thing' --session-dir .bakers/pi-sessions/run-abc",
    );
  });

  it('omits the run scope when no run is given (unchanged behaviour)', async () => {
    const { PiAgent } = await loadPiModule();
    expect(new PiAgent({}).launchCommand('x')).toBe(
      "pi 'x' --session-dir .bakers/pi-sessions",
    );
  });
});

describe('Pi security', () => {
  it.each([
    {},
    { permissions: 'system' },
  ] as const)('uses the ordinary launch for %j', async (options) => {
    const { PiAgent } = await loadPiModule();
    const agent = new PiAgent(options);
    expect(agent.launchCommand('task', { sessionId: 'run-abc' })).toBe(
      "pi 'task' --session-dir .bakers/pi-sessions/run-abc",
    );
    expect(agent.launchCommand('')).toBe('pi');
  });

  it('drops denied ticket env vars, with env_deny replacing the list', async () => {
    const { PiAgent } = await loadPiModule();
    expect(new PiAgent().runEnvPolicy.drop).toBe(true);
    expect(new PiAgent({ env_deny: ['FOO_*'] }).runEnvPolicy).toEqual({
      drop: true,
      deny: ['FOO_*'],
    });
  });

  it('loads only the configured extensions in custom mode', async () => {
    const { PiAgent } = await loadPiModule();
    const agent = new PiAgent({
      permissions: 'custom',
      config: { extensions: ['./sandbox.ts', 'builtin:gondolin'] },
      args: ['--verbose'],
    });
    expect(agent.launchCommand('task', { sessionId: 'run-abc' })).toBe(
      "pi 'task' --session-dir .bakers/pi-sessions/run-abc --no-extensions -e './sandbox.ts' -e 'builtin:gondolin' '--verbose'",
    );
    expect(agent.launchCommand('')).toBe(
      "pi --no-extensions -e './sandbox.ts' -e 'builtin:gondolin'",
    );
  });

  it.each([
    'sandbox',
    'yolo',
  ])('rejects security %s while loading the addon', async (security) => {
    const { piAgent } = await loadPiModule();
    expect(() => piAgent({ permissions: security })).toThrow(
      `Pi does not support permissions: '${security}'`,
    );
  });

  it.each([
    [
      'an unknown mode',
      { permissions: 'sandbbox' },
      /permissions must be one of/,
    ],
    ['null', { permissions: null }, /permissions must be a string/],
    ['custom without config', { permissions: 'custom' }, /requires config/],
    ['config outside custom', { config: { extensions: ['x'] } }, /only valid/],
    ['a sandbox block', { permissions: 'system', sandbox: {} }, /only valid/],
    ['no extensions', { permissions: 'custom', config: {} }, /extensions/],
    [
      'empty extensions',
      { permissions: 'custom', config: { extensions: [] } },
      /extensions/,
    ],
    [
      'a non-string extension',
      { permissions: 'custom', config: { extensions: [1] } },
      /extensions/,
    ],
    [
      'an unknown config key',
      { permissions: 'custom', config: { extensions: ['x'], tools: [] } },
      /nothing else/,
    ],
  ])('rejects %s', async (_name, options, error) => {
    const { piAgent } = await loadPiModule();
    expect(() => piAgent(options as never)).toThrow(error);
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

describe('PiAgent args and effort', () => {
  it('prefers effort over thinking and appends args after generated elements', async () => {
    const { PiAgent } = await loadPiModule();
    const command = new PiAgent({
      provider: 'kimi-coding',
      model: 'kimi-coding/k3',
      thinking: 'low',
      effort: 'high',
      args: ['--foo', 'a b'],
    }).launchCommand('task');
    expect(captureArgv('pi', command)).toEqual([
      'pi',
      'task',
      '--provider',
      'kimi-coding',
      '--model',
      'kimi-coding/k3',
      '--thinking',
      'high',
      '--session-dir',
      '.bakers/pi-sessions',
      '--foo',
      'a b',
    ]);
  });

  it('suppresses generated thinking when args carry --thinking', async () => {
    const { PiAgent } = await loadPiModule();
    const command = new PiAgent({
      thinking: 'low',
      args: ['--thinking', 'high'],
    }).launchCommand('x');
    expect(captureArgv('pi', command)).toEqual([
      'pi',
      'x',
      '--session-dir',
      '.bakers/pi-sessions',
      '--thinking',
      'high',
    ]);
  });

  it('rejects reserved session-dir and approve flags including attached shorts', async () => {
    const { PiAgent } = await loadPiModule();
    for (const flag of [
      '--session-dir',
      '--approve',
      '-a',
      '-afoo',
      '--no-approve',
      '-na',
    ]) {
      expect(() => new PiAgent({ args: [flag] })).toThrow(/reserved flag/);
    }
  });
});

describe('encodePiHomeSessionSlug', () => {
  it("matches pi's own home-session slug scheme (only `/` replaced)", async () => {
    const { encodePiHomeSessionSlug } = await loadPiModule();
    expect(encodePiHomeSessionSlug('/home/cw/projects/bakers')).toBe(
      '--home-cw-projects-bakers--',
    );
    expect(encodePiHomeSessionSlug('/tmp/pi-slugtest/sub.dir')).toBe(
      '--tmp-pi-slugtest-sub.dir--',
    );
  });
});

describe('PiAgent.getRunLog', () => {
  let work: string;
  beforeEach(() => {
    work = mkdtempSync(join(tmpdir(), 'pi-runlog-'));
  });
  afterEach(() => {
    rmSync(work, { recursive: true, force: true });
  });

  const writeJsonl = (dir: string, name: string, mtimeSec: number) => {
    mkdirSync(dir, { recursive: true });
    const full = join(dir, name);
    writeFileSync(full, '{"type":"session"}\n');
    utimesSync(full, mtimeSec, mtimeSec);
    return full;
  };

  it('reads the newest *.jsonl from the pinned <worktree>/.bakers/pi-sessions', async () => {
    const { PiAgent } = await loadPiModule();
    const worktree = join(work, 'wt');
    const pinned = join(worktree, '.bakers/pi-sessions');
    writeJsonl(pinned, 'old.jsonl', 1000);
    writeFileSync(join(pinned, 'newest.jsonl'), 'NEWEST\n');
    utimesSync(join(pinned, 'newest.jsonl'), 2000, 2000);
    writeFileSync(join(pinned, 'ignore.txt'), 'not jsonl\n');

    const agent = new PiAgent({}, join(work, 'home'));
    await expect(agent.getRunLog(worktree)).resolves.toBe('NEWEST\n');
  });

  it("falls back to pi's home session dir for the worktree cwd", async () => {
    const { PiAgent, encodePiHomeSessionSlug } = await loadPiModule();
    const worktree = join(work, 'wt2');
    const home = join(work, 'home2');
    const homeSessions = join(
      home,
      '.pi/agent/sessions',
      encodePiHomeSessionSlug(worktree),
    );
    mkdirSync(homeSessions, { recursive: true });
    writeFileSync(join(homeSessions, 's.jsonl'), 'FROM-HOME\n');

    const agent = new PiAgent({}, home);
    await expect(agent.getRunLog(worktree)).resolves.toBe('FROM-HOME\n');
  });

  it("returns '' when neither the pinned nor the home dir has a transcript", async () => {
    const { PiAgent } = await loadPiModule();
    const agent = new PiAgent({}, join(work, 'empty-home'));
    await expect(agent.getRunLog(join(work, 'nope'))).resolves.toBe('');
  });

  it('R4: given a run identity, reads the RUN-SCOPED session dir, not the shared one (BB-473)', async () => {
    const { PiAgent } = await loadPiModule();
    const worktree = join(work, 'wt3');
    const runScoped = join(worktree, '.bakers/pi-sessions', 'run-abc');
    const shared = join(worktree, '.bakers/pi-sessions');
    writeJsonl(shared, 'foreign.jsonl', 5000);
    mkdirSync(runScoped, { recursive: true });
    writeFileSync(join(runScoped, 'ours.jsonl'), 'OURS\n');

    const agent = new PiAgent({}, join(work, 'home'));
    await expect(
      agent.getRunLog(worktree, { sessionId: 'run-abc' }),
    ).resolves.toBe('OURS\n');
  });

  it('the home-dir fallback honours run.startedAt, so a PRIOR run left in the shared cwd-keyed dir cannot be selected (BB-473 finding 2)', async () => {
    const { PiAgent, encodePiHomeSessionSlug } = await loadPiModule();
    const worktree = join(work, 'wt4');
    const home = join(work, 'home4');
    const homeSessions = join(
      home,
      '.pi/agent/sessions',
      encodePiHomeSessionSlug(worktree),
    );
    // A leftover transcript from a PRIOR run in the same (reused) worktree —
    // it is the only home-dir match, so a plain newest-by-mtime fallback
    // would select it even though this run started after it stopped.
    writeJsonl(homeSessions, 'prior-run.jsonl', 1000);

    const agent = new PiAgent({}, home);
    const log = await agent.getRunLog(worktree, {
      sessionId: 'never-pinned',
      startedAt: new Date(2_000_000),
    });
    expect(log).toBe('');
  });
});

describe('PiAgent.parseFootprint', () => {
  it('returns emptyAgentFootprint() for an empty log', async () => {
    const { PiAgent } = await loadPiModule();
    expect(new PiAgent({}).parseFootprint('')).toEqual(emptyAgentFootprint());
  });
});
