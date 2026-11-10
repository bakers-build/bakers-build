import { existsSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { SpawnRunInput } from '@bakers-build/conductor/contract';
import type { ConductorLogger } from '@bakers-build/core';
import { describe, expect, it } from 'vitest';
import herdrCoreExecutor, {
  HcNotFound,
  HerdrCoreExecutor,
  terminalName,
} from '../src/index.js';
import { executors, scopes, worktrees } from '../src/preset.js';

const INSTANT_WATCH = { timeout_ms: 0, poll_ms: 1 } as const;

/**
 * A scripted `hc`: records every call and answers by the command word. `run`
 * plays the launch wrapper (writes `started`) unless told the agent exited.
 */
function fakeHc(
  opts: {
    version?: string;
    missing?: boolean;
    terminals?: unknown;
    exitAtOnce?: boolean;
    failOn?: string;
  } = {},
) {
  const calls: string[][] = [];
  const hc = async (args: string[]): Promise<string> => {
    calls.push(args);
    if (opts.missing) throw new HcNotFound();
    if (args[0] === opts.failOn) throw new Error(`hc ${args[0]} failed`);
    if (args[0] === '--version') return `hc ${opts.version ?? '0.1.18'}\n`;
    if (args[0] === 'run') {
      const dir = dirname(args[args.length - 1] as string);
      writeFileSync(join(dir, 'started'), 'started');
      if (opts.exitAtOnce) writeFileSync(join(dir, 'exit'), 'exit 1\n');
      return JSON.stringify({
        id: 't7',
        name: args[args.indexOf('--name') + 1],
      });
    }
    // The envelope hc 0.1.18 prints for `ls --json` (pinned by a live run).
    if (args[0] === 'ls') {
      return JSON.stringify({
        hidden_finished: 0,
        terminals: opts.terminals ?? [],
      });
    }
    if (args[0] === 'read') return 'agent says hi';
    return '{}';
  };
  return { hc, calls };
}

function spyLogger() {
  const warnings: string[] = [];
  const logger: ConductorLogger = {
    debug() {},
    info() {},
    warn(_obj: object, msg?: string) {
      warnings.push(msg ?? '');
    },
    error() {},
  };
  return { logger, warnings };
}

function input(overrides: Partial<SpawnRunInput> = {}): SpawnRunInput {
  return {
    ticket: {
      uuid: 'u-1',
      identifier: 'BAKERS-109',
      title: 'New addon',
      branchName: 'feat/bakers-109-new-addon-herd',
      state: 'working',
    },
    run: { uuid: 'run-uuid', id: 4711, handler: 'claude' },
    workspacePath: '/repo/.bakers-worktrees/feat/bakers-109',
    instructions: null,
    command: 'claude --resume',
    env: { SECRET_TOKEN: 'hunter2' },
    ...overrides,
  };
}

describe('HerdrCoreExecutor', () => {
  it('is a persistent executor with id herdr-core and no workspace layout', () => {
    const ex = new HerdrCoreExecutor({});
    expect(ex.id).toBe('herdr-core');
    expect(ex.capabilities()).toEqual({ persistent: true });
    expect((ex as { openWorkspace?: unknown }).openWorkspace).toBeUndefined();
  });
});

describe('HerdrCoreExecutor.startRun', () => {
  it('starts the agent as a detached, labelled hc terminal in the worktree', async () => {
    const { hc, calls } = fakeHc();
    const ex = new HerdrCoreExecutor({ launch_watch: INSTANT_WATCH }, hc);
    await expect(ex.startRun(input())).resolves.toEqual({
      sessionRef: 'bakers-109-4711',
    });
    const run = calls.find((c) => c[0] === 'run') as string[];
    const script = run[run.length - 1] as string;
    expect(run).toEqual([
      'run',
      '--bg',
      '--no-parent',
      '--outlive-parent',
      '--cwd',
      '/repo/.bakers-worktrees/feat/bakers-109',
      '--name',
      'bakers-109-4711',
      '--label',
      'bakers.branch=feat/bakers-109-new-addon-herd',
      '--label',
      'bakers.run=4711',
      '--label',
      'bakers.ticket=BAKERS-109',
      '--json',
      'sh',
      script,
    ]);
    // The env travels in the 0600 launch script, never in argv; no --rm.
    expect(calls.flat().join(' ')).not.toContain('hunter2');
    expect(run).not.toContain('--rm');
  });

  it('fails fast with an install message when hc is missing', async () => {
    const { hc, calls } = fakeHc({ missing: true });
    await expect(
      new HerdrCoreExecutor({ launch_watch: INSTANT_WATCH }, hc).startRun(
        input(),
      ),
    ).rejects.toThrow(/hc not found.*install herdr-core/);
    expect(calls).toEqual([['--version']]);
  });

  it('fails fast with an upgrade message for hc older than 0.1.18', async () => {
    const { hc, calls } = fakeHc({ version: '0.1.17' });
    await expect(
      new HerdrCoreExecutor({ launch_watch: INSTANT_WATCH }, hc).startRun(
        input(),
      ),
    ).rejects.toThrow(/hc 0\.1\.17 is too old.*0\.1\.18/);
    expect(calls.some((c) => c[0] === 'run')).toBe(false);
  });

  it('accepts a newer hc', async () => {
    const { hc } = fakeHc({ version: '0.2.0' });
    await expect(
      new HerdrCoreExecutor({ launch_watch: INSTANT_WATCH }, hc).startRun(
        input(),
      ),
    ).resolves.toBeDefined();
  });

  it('a launch that exits at once fails the run, reports the screen and drops the terminal', async () => {
    const { hc, calls } = fakeHc({ exitAtOnce: true });
    const ex = new HerdrCoreExecutor({ launch_watch: INSTANT_WATCH }, hc);
    await expect(ex.startRun(input())).rejects.toThrow(/exit 1/);
    expect(calls).toContainEqual(['read', 'bakers-109-4711', '--lines', '40']);
    expect(calls).toContainEqual(['kill', 'bakers-109-4711', '--json']);
    expect(calls).toContainEqual(['rm', 'bakers-109-4711', '--json']);
    const run = calls.find((c) => c[0] === 'run') as string[];
    expect(existsSync(dirname(run[run.length - 1] as string))).toBe(false);
  });
});

describe('terminalName', () => {
  it('is lowercase, limited to a-z0-9-_ and at most 32 characters', () => {
    expect(terminalName('BAKERS-109', 4711)).toBe('bakers-109-4711');
    expect(terminalName('Shop.Ä/42', 7)).toBe('shop---42-7');
    const long = terminalName('A'.repeat(40), 123456);
    expect(long).toHaveLength(32);
    expect(long.endsWith('-123456')).toBe(true);
    expect(long).toMatch(/^[a-z0-9_-]+$/);
  });
});

describe('HerdrCoreExecutor.cleanupRun', () => {
  it('kills a live match and removes it; a finished one is only removed', async () => {
    const { hc, calls } = fakeHc({
      terminals: [
        { address: 't7', name: 'bakers-109-4711', state: 'live' },
        { address: 't8', name: 'bakers-109-4711', state: 'finished' },
      ],
    });
    await new HerdrCoreExecutor({}, hc).cleanupRun('feat/x', 4711);
    expect(calls).toEqual([
      [
        'ls',
        '--all',
        '--label',
        'bakers.branch=feat/x',
        '--label',
        'bakers.run=4711',
        '--json',
      ],
      ['kill', 't7', '--json'],
      ['rm', 't7', '--json'],
      ['rm', 't8', '--json'],
    ]);
  });

  it('touches only what hc listed for this run (siblings are filtered by label)', async () => {
    const { hc, calls } = fakeHc({
      terminals: [{ address: 't9', name: 'bakers-109-1', state: 'finished' }],
    });
    await new HerdrCoreExecutor({}, hc).cleanupRun('feat/x', 1);
    expect(calls.filter((c) => c[0] === 'kill' || c[0] === 'rm')).toEqual([
      ['rm', 't9', '--json'],
    ]);
  });

  it('warns when nothing matched', async () => {
    const { hc } = fakeHc({ terminals: [] });
    const { logger, warnings } = spyLogger();
    await new HerdrCoreExecutor({}, hc, logger).cleanupRun('feat/x', 1);
    expect(warnings).toEqual([
      'no herdr-core terminal found for this run; its agent may still be running',
    ]);
  });

  it('is best-effort: an hc failure is logged, never thrown', async () => {
    const { hc } = fakeHc({ failOn: 'ls' });
    const { logger, warnings } = spyLogger();
    await expect(
      new HerdrCoreExecutor({}, hc, logger).cleanupRun('feat/x', 1),
    ).resolves.toBeUndefined();
    expect(warnings).toEqual(['herdr-core cleanup failed (best-effort)']);
  });
});

describe('HerdrCoreExecutor.runAlive', () => {
  const lookup = [
    'ls',
    '--all',
    '--label',
    'bakers.branch=feat/x',
    '--label',
    'bakers.run=4711',
    '--json',
  ];

  it('is false when the run has no terminal', async () => {
    const { hc, calls } = fakeHc({ terminals: [] });
    expect(await new HerdrCoreExecutor({}, hc).runAlive('feat/x', 4711)).toBe(
      false,
    );
    expect(calls).toEqual([lookup]);
  });

  it('is false when its terminals have all finished', async () => {
    const { hc } = fakeHc({
      terminals: [{ address: 't8', name: 'n', state: 'finished' }],
    });
    expect(await new HerdrCoreExecutor({}, hc).runAlive('feat/x', 4711)).toBe(
      false,
    );
  });

  it('is true while a terminal of the run lives', async () => {
    const { hc } = fakeHc({
      terminals: [
        { address: 't8', name: 'n', state: 'finished' },
        { address: 't7', name: 'n', state: 'live' },
      ],
    });
    expect(await new HerdrCoreExecutor({}, hc).runAlive('feat/x', 4711)).toBe(
      true,
    );
  });

  it('rejects when hc cannot answer', async () => {
    await expect(
      new HerdrCoreExecutor({}, fakeHc({ failOn: 'ls' }).hc).runAlive(
        'feat/x',
        4711,
      ),
    ).rejects.toThrow('hc ls failed');
    await expect(
      new HerdrCoreExecutor({}, fakeHc({ missing: true }).hc).runAlive(
        'feat/x',
        4711,
      ),
    ).rejects.toBeInstanceOf(HcNotFound);
  });
});

describe('HerdrCoreExecutor.stopRun', () => {
  it('is a no-op', async () => {
    const { hc, calls } = fakeHc();
    await new HerdrCoreExecutor({}, hc).stopRun('feat/x');
    expect(calls).toEqual([]);
  });
});

describe('herdrCoreExecutor factory and preset', () => {
  it('builds the executor plugin', async () => {
    const plugin = herdrCoreExecutor({ command: 'codex' });
    expect(plugin.kind).toBe('executor');
    expect(plugin.id).toBe('herdr-core');
    const { logger } = spyLogger();
    const ex = await plugin.createExecutor({} as never, { logger });
    expect(ex.id).toBe('herdr-core');
  });

  it('contributes an executor only, listable on the machine and the project', () => {
    expect(executors?.([], {}).map((p) => p.id)).toEqual(['herdr-core']);
    expect(worktrees).toBeUndefined();
    expect(scopes).toEqual(['machine', 'project']);
  });
});
