import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { SpawnRunInput } from '@bakers-build/conductor/contract';
import { type ConductorLogger, ExecError } from '@bakers-build/core';
import { afterEach, describe, expect, it } from 'vitest';
import rexExecutor, {
  defaultRex,
  RexExecutor,
  RexNotFound,
  RexServerUnreachable,
  sessionLabel,
} from '../src/index.js';
import { addons, executors, scopes } from '../src/preset.js';

const INSTANT_WATCH = { timeout_ms: 0, poll_ms: 1 } as const;
const SESSION = 'session:0f6d2c1e-0000-4000-8000-000000000001';

function rexError(exitCode: number): ExecError {
  return new ExecError('rex', [], exitCode, 'rex failed');
}

/**
 * A scripted `rex`: records every call and answers by the command word. `new`
 * plays the launch wrapper (writes `started`) unless told the agent exited.
 */
function fakeRex(
  opts: {
    version?: string;
    sessions?: { session_id: string; label: string }[];
    exitAtOnce?: boolean;
    fail?: Partial<Record<string, Error>>;
  } = {},
) {
  const calls: string[][] = [];
  const rex = async (args: string[]): Promise<string> => {
    calls.push(args);
    const word = args[0] === 'session' ? `session ${args[1]}` : args[0];
    const failure = opts.fail?.[word ?? ''];
    if (failure) throw failure;
    if (word === 'version') {
      return `rex ${opts.version ?? '0.1.0-snapshot.2531'}\ncommit: c67cc2d\n`;
    }
    if (word === 'new') {
      const dir = dirname(args.at(-1) as string);
      writeFileSync(join(dir, 'started'), 'started');
      if (opts.exitAtOnce) writeFileSync(join(dir, 'exit'), 'exit 1\n');
      return JSON.stringify({
        session_id: SESSION,
        initial_windows: [{ window_id: 'window:1', block_ids: ['block:1'] }],
      });
    }
    if (word === 'ls') return JSON.stringify({ sessions: opts.sessions ?? [] });
    if (word === 'capture') return 'agent says hi\n';
    return '';
  };
  return { rex, calls };
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
      identifier: 'BAKERS-354',
      title: 'Rex executor',
      branchName: 'feat/bakers-354-conductor-exec',
      state: 'working',
    },
    run: { uuid: 'run-uuid', id: 7, handler: 'claude' },
    workspacePath: '/repo/.bakers-worktrees/feat/bakers-354',
    instructions: null,
    command: 'claude --resume',
    env: { SECRET_TOKEN: 'hunter2' },
    ...overrides,
  };
}

/** The launch wrapper path `startRun` passed to `rex new`. */
function wrapPathOf(calls: string[][]): string {
  return calls.find((c) => c[0] === 'new')?.at(-1) as string;
}

describe('RexExecutor', () => {
  it('is a persistent executor with id rex', () => {
    const ex = new RexExecutor({});
    expect(ex.id).toBe('rex');
    expect(ex.capabilities()).toEqual({ persistent: true });
  });
});

describe('RexExecutor.startRun', () => {
  it('starts the agent in a labelled Rex session in the worktree and returns its id', async () => {
    const { rex, calls } = fakeRex();
    const ex = new RexExecutor({ launch_watch: INSTANT_WATCH }, rex);
    await expect(ex.startRun(input())).resolves.toEqual({
      sessionRef: SESSION,
    });
    const wrap = wrapPathOf(calls);
    expect(calls).toContainEqual([
      'new',
      'BAKERS-354-7 feat/bakers-354-conductor-exec',
      '--cwd',
      '/repo/.bakers-worktrees/feat/bakers-354',
      '--shell',
      'none',
      '--json',
      '--',
      'sh',
      wrap,
    ]);
    // The env travels in the 0600 launch script, never in argv.
    expect(calls.flat().join(' ')).not.toContain('hunter2');
  });

  it('rejects an invalid environment variable name before starting anything', async () => {
    const { rex, calls } = fakeRex();
    const ex = new RexExecutor({ launch_watch: INSTANT_WATCH }, rex);
    await expect(
      ex.startRun(input({ env: { 'BAD-NAME': 'x' } })),
    ).rejects.toThrow(/invalid environment variable name for rex: BAD-NAME/);
    expect(calls.some((c) => c[0] === 'new')).toBe(false);
  });

  it('fails fast with an upgrade message for rex older than 0.1.0', async () => {
    const { rex, calls } = fakeRex({ version: '0.0.9' });
    await expect(
      new RexExecutor({ launch_watch: INSTANT_WATCH }, rex).startRun(input()),
    ).rejects.toThrow(/rex 0\.0\.9 is too old.*0\.1\.0/);
    expect(calls.some((c) => c[0] === 'new')).toBe(false);
  });

  it('accepts a snapshot build of the minimum version', async () => {
    const { rex } = fakeRex({ version: '0.1.0-snapshot.2531' });
    await expect(
      new RexExecutor({ launch_watch: INSTANT_WATCH }, rex).startRun(input()),
    ).resolves.toBeDefined();
  });

  it('an unreachable server rejects with its message and removes the launch script', async () => {
    const { rex, calls } = fakeRex({
      fail: { new: new RexServerUnreachable() },
    });
    await expect(
      new RexExecutor({ launch_watch: INSTANT_WATCH }, rex).startRun(input()),
    ).rejects.toThrow(/Rex server unreachable.*rex server install/);
    expect(existsSync(dirname(wrapPathOf(calls)))).toBe(false);
    // Nothing started, so there is no session to kill.
    expect(calls.some((c) => c[0] === 'session')).toBe(false);
  });

  it('a launch that exits at once fails the run, reports the screen and kills the session', async () => {
    const { rex, calls } = fakeRex({ exitAtOnce: true });
    await expect(
      new RexExecutor({ launch_watch: INSTANT_WATCH }, rex).startRun(input()),
    ).rejects.toThrow(/exit 1\n.*agent says hi/s);
    expect(calls).toContainEqual(['capture', '-s', SESSION, '--trim']);
    expect(calls).toContainEqual(['session', 'kill', SESSION]);
    expect(existsSync(dirname(wrapPathOf(calls)))).toBe(false);
  });
});

describe('defaultRex', () => {
  const path = process.env.PATH;
  afterEach(() => {
    process.env.PATH = path;
  });

  /** Puts a `rex` script on an otherwise empty PATH; `$DIR` is its directory. */
  function rexOnPath(script: string): string {
    const dir = mkdtempSync(join(tmpdir(), 'fake-rex-'));
    const bin = join(dir, 'rex');
    writeFileSync(bin, `#!/bin/sh\nDIR='${dir}'\n${script}\n`);
    chmodSync(bin, 0o755);
    process.env.PATH = dir;
    return dir;
  }

  it('without rex on PATH rejects with an install message', async () => {
    process.env.PATH = mkdtempSync(join(tmpdir(), 'no-rex-'));
    const err = await defaultRex(['version']).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RexNotFound);
    expect(String(err)).toMatch(/rex not found on PATH: install Rex 0\.1\.0/);
  });

  it('never autostarts a server and maps exit 4 to an unreachable server', async () => {
    const dir = rexOnPath('echo "$@" > "$DIR/args"; exit 4');
    const err = await defaultRex(['ls', '--json']).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RexServerUnreachable);
    expect(readFileSync(join(dir, 'args'), 'utf8').trim()).toBe(
      '--autostart=false ls --json',
    );
  });

  it('keeps any other failure as the exec error', async () => {
    rexOnPath('exit 3');
    const err = await defaultRex(['session', 'kill', SESSION]).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ExecError);
    expect((err as ExecError).exitCode).toBe(3);
  });
});

describe('sessionLabel', () => {
  it('is <identifier>-<runId> <branch>', () => {
    expect(sessionLabel('BAKERS-354', 7, 'feat/x')).toBe('BAKERS-354-7 feat/x');
  });
});

describe('RexExecutor.cleanupRun', () => {
  it('kills, by full id, every session of this run only (duplicate labels included)', async () => {
    const { rex, calls } = fakeRex({
      sessions: [
        { session_id: 'session:a', label: 'B-7 feat/x' },
        { session_id: 'session:b', label: 'B-7 feat/x' },
        { session_id: 'session:c', label: 'B-8 feat/x' },
        { session_id: 'session:d', label: 'B-7 feat/y' },
        { session_id: 'session:e', label: 'B-17 feat/x' },
        { session_id: 'session:f', label: 'scratch' },
      ],
    });
    await new RexExecutor({}, rex).cleanupRun('feat/x', 7);
    expect(calls).toEqual([
      ['ls', '--json'],
      ['session', 'kill', 'session:a'],
      ['session', 'kill', 'session:b'],
    ]);
  });

  it('treats an already-gone session (exit 3) as done, without a warning', async () => {
    const { rex } = fakeRex({
      sessions: [{ session_id: 'session:a', label: 'B-7 feat/x' }],
      fail: { 'session kill': rexError(3) },
    });
    const { logger, warnings } = spyLogger();
    await expect(
      new RexExecutor({}, rex, logger).cleanupRun('feat/x', 7),
    ).resolves.toBeUndefined();
    expect(warnings).toEqual([]);
  });

  it('warns when nothing matched', async () => {
    const { rex } = fakeRex({ sessions: [] });
    const { logger, warnings } = spyLogger();
    await new RexExecutor({}, rex, logger).cleanupRun('feat/x', 7);
    expect(warnings).toEqual([
      'no Rex session found for this run; its agent may still be running',
    ]);
  });

  it('is best-effort: an unreachable server is logged, never thrown', async () => {
    const { rex } = fakeRex({ fail: { ls: new RexServerUnreachable() } });
    const { logger, warnings } = spyLogger();
    await expect(
      new RexExecutor({}, rex, logger).cleanupRun('feat/x', 7),
    ).resolves.toBeUndefined();
    expect(warnings).toEqual(['Rex cleanup failed (best-effort)']);
  });
});

describe('RexExecutor.stopRun', () => {
  it('is a no-op', async () => {
    const { rex, calls } = fakeRex();
    await new RexExecutor({}, rex).stopRun('feat/x');
    expect(calls).toEqual([]);
  });
});

describe('rexExecutor factory and preset', () => {
  it('builds the executor plugin', async () => {
    const plugin = rexExecutor({ command: 'codex' });
    expect(plugin.kind).toBe('executor');
    expect(plugin.id).toBe('rex');
    const { logger } = spyLogger();
    const ex = await plugin.createExecutor({} as never, { logger });
    expect(ex.id).toBe('rex');
  });

  it('contributes the executor with a Git workspace, on the machine and the project', () => {
    expect(executors?.([], {}).map((p) => p.id)).toEqual(['rex']);
    expect(scopes).toEqual(['machine', 'project']);
    expect(addons).toEqual(['@bakers-build/addon-workspace-git']);
  });
});
