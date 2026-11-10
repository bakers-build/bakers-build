import { execFileSync, spawn } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { shellQuote } from '@bakers-build/core';
import { afterEach, describe, expect, it } from 'vitest';
import { HerdrExecutor } from '../src/index.js';
import { watchLaunch, writeLaunchScript } from '../src/launch-script.js';
import { INSTANT_WATCH, plantStarted } from './plant-started.js';

const SESSION_ID = '14ccbe2a-7057-4d87-83d0-c40597171e88';
const SECRET = `s3cr3t-${'x'.repeat(2000)}`;
const PROMPT = 'p'.repeat(2500);

function fakeExec(calls: string[][], opts?: { plant?: boolean }) {
  return async (args: string[]): Promise<string> => {
    calls.push(args);
    if (opts?.plant !== false) plantStarted(args);
    if (args[0] === 'worktree' && args[1] === 'list') {
      return JSON.stringify({
        result: {
          worktrees: [
            {
              branch: 'b',
              path: '/repo/wt',
              open_workspace_id: 'ws-1',
            },
          ],
        },
      });
    }
    if (args[0] === 'tab' && args[1] === 'create') {
      return JSON.stringify({
        result: {
          root_pane: { pane_id: 'p-1' },
          tab: { tab_id: 'tab-1' },
        },
      });
    }
    if (args[0] === 'pane' && args[1] === 'read') {
      return 'Error: Invalid session ID. Must be a valid UUID.';
    }
    return JSON.stringify({ result: {} });
  };
}

function spawnOverCap() {
  return {
    ticket: {
      uuid: 't',
      identifier: 'BB-1',
      title: 'T',
      branchName: 'b',
      state: 'coding',
    },
    run: { id: 1, uuid: SESSION_ID, handler: 'code' },
    workspacePath: '/repo/wt',
    instructions: null,
    env: { BAKERS_URL: 'https://bakers.example', SECRET_DSN: SECRET },
    command: `claude '${PROMPT}' --session-id ${SESSION_ID}`,
  };
}

function typedPaneRun(calls: string[][]): string {
  const run = calls.find((c) => c[0] === 'pane' && c[1] === 'run');
  expect(run).toBeDefined();
  return run?.[3] ?? '';
}

/** Unwrap `sh 'path'` (POSIX single quotes, no nested quotes in tmp paths). */
function scriptPathFromTyped(typed: string): string {
  expect(typed.startsWith("sh '")).toBe(true);
  expect(typed.endsWith("'")).toBe(true);
  return typed.slice("sh '".length, -1);
}

const leftoverDirs: string[] = [];
afterEach(() => {
  for (const dir of leftoverDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  leftoverDirs.length = 0;
});

describe('HerdrExecutor.startRun launch script', () => {
  it('types a pane-run line under 1024 bytes while the script holds a >4096-byte command including the session id', async () => {
    const calls: string[][] = [];
    const executor = new HerdrExecutor(
      { command: 'claude', launch_watch: INSTANT_WATCH },
      fakeExec(calls),
    );
    await executor.startRun(spawnOverCap());

    const typed = typedPaneRun(calls);
    expect(Buffer.byteLength(typed)).toBeLessThan(1024);

    const wrapPath = scriptPathFromTyped(typed);
    leftoverDirs.push(dirname(wrapPath));
    const commandPath = join(dirname(wrapPath), 'command');
    const command = readFileSync(commandPath, 'utf8');
    expect(command).toContain(`--session-id ${SESSION_ID}`);
    expect(command).toContain(SECRET);
    expect(command).toContain(PROMPT);
    expect(Buffer.byteLength(command)).toBeGreaterThan(4096);
    expect(command).toBe(
      `BAKERS_URL='https://bakers.example' SECRET_DSN='${SECRET}' claude '${PROMPT}' --session-id ${SESSION_ID}`,
    );
  });

  it('keeps a secret env value out of the typed line and the pane-run exec log, with 0600/0700 modes', async () => {
    const calls: Array<{ args: string[]; opts?: unknown }> = [];
    const exec = async (
      args: string[],
      opts?: { redactArgs?: (a: string[]) => string[] },
    ): Promise<string> => {
      calls.push({ args, opts });
      plantStarted(args);
      if (args[0] === 'worktree' && args[1] === 'list') {
        return JSON.stringify({
          result: {
            worktrees: [
              {
                branch: 'b',
                path: '/repo/wt',
                open_workspace_id: 'ws-1',
              },
            ],
          },
        });
      }
      if (args[0] === 'tab' && args[1] === 'create') {
        return JSON.stringify({
          result: {
            root_pane: { pane_id: 'p-1' },
            tab: { tab_id: 'tab-1' },
          },
        });
      }
      return JSON.stringify({ result: {} });
    };
    const executor = new HerdrExecutor(
      { command: 'claude', launch_watch: INSTANT_WATCH },
      exec,
    );
    await executor.startRun(spawnOverCap());

    const run = calls.find((c) => c.args[0] === 'pane' && c.args[1] === 'run');
    expect(run).toBeDefined();
    const typed = run?.args[3] ?? '';
    expect(typed).not.toContain(SECRET);
    leftoverDirs.push(dirname(scriptPathFromTyped(typed)));

    const logged = run?.opts
      ? (run.opts as { redactArgs?: (a: string[]) => string[] }).redactArgs?.(
          run.args,
        )
      : run?.args;
    expect((logged ?? []).join(' ')).not.toContain(SECRET);

    const dir = dirname(scriptPathFromTyped(typed));
    const commandPath = join(dir, 'command');
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    expect(statSync(commandPath).mode & 0o777).toBe(0o600);
  });
});

describe('watchLaunch (real sh)', () => {
  it('rejects when the command exits immediately', async () => {
    const script = writeLaunchScript('exit 1');
    leftoverDirs.push(script.dir);
    try {
      execFileSync('sh', [script.wrapPath], { timeout: 2000 });
    } catch {
      // wrapper exits with the command's status; markers are the signal
    }
    await expect(
      watchLaunch(script, { timeout_ms: 500, poll_ms: 10 }),
    ).rejects.toThrow(/Launch failed: exit 1/);
  });

  it('resolves when the command keeps running past the watch window', async () => {
    const script = writeLaunchScript('sleep 30');
    leftoverDirs.push(script.dir);
    const child = spawn('sh', [script.wrapPath], {
      stdio: 'ignore',
      detached: true,
    });
    child.unref();
    try {
      await watchLaunch(script, { timeout_ms: 400, poll_ms: 20 });
    } finally {
      try {
        process.kill(-child.pid!, 'SIGTERM');
      } catch {
        child.kill('SIGTERM');
      }
    }
  });

  it('resolves when started appears after the short exit window and the agent keeps running', async () => {
    const script = writeLaunchScript('true');
    leftoverDirs.push(script.dir);
    const plant = setTimeout(() => {
      writeFileSync(script.startedPath, 'started');
    }, 250);
    try {
      await watchLaunch(script, {
        timeout_ms: 80,
        start_timeout_ms: 1000,
        poll_ms: 20,
      });
    } finally {
      clearTimeout(plant);
    }
  });
});

function runs(bin: string, args: string[]): boolean {
  try {
    execFileSync(bin, args, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/** A local dash, else docker's debian:stable-slim (`/bin/sh` is dash), else none. */
const DASH =
  ['dash', '/usr/bin/dash', '/bin/dash'].find((b) => runs(b, ['-c', 'true'])) ??
  (runs('docker', ['version']) ? 'docker' : undefined);

function dashEval(command: string): string {
  if (DASH && DASH !== 'docker') {
    return execFileSync(DASH, ['-c', 'eval "$1"', 'x', command], {
      encoding: 'utf8',
    });
  }
  const dir = mkdtempSync(join(tmpdir(), 'bakers-dash-'));
  leftoverDirs.push(dir);
  const cmdPath = join(dir, 'command');
  writeFileSync(cmdPath, command);
  return execFileSync(
    'docker',
    [
      'run',
      '--rm',
      '-v',
      `${dir}:${dir}`,
      'debian:stable-slim',
      'sh',
      '-c',
      `eval "$(cat -- '${cmdPath}')"`,
    ],
    { encoding: 'utf8', maxBuffer: 10_000_000 },
  );
}

describe('HerdrExecutor.startRun POSIX env quoting', () => {
  it('writes newline-bearing env values as POSIX single quotes, not ANSI-C', async () => {
    const calls: string[][] = [];
    const long = `${'y'.repeat(1000)}'${'z'.repeat(999)}`;
    const executor = new HerdrExecutor(
      { command: 'claude', launch_watch: INSTANT_WATCH },
      fakeExec(calls),
    );
    await executor.startRun({
      ...spawnOverCap(),
      env: { NL: 'a\nb', Q: long },
      // The prompt is quoted the way every agent plugin quotes it.
      command: `sh -c 'printf "%s|" "$NL"; printf "%s|" "$1"; printf "%s" "$Q"' x ${shellQuote("a\nit's")}`,
    });
    const wrapPath = scriptPathFromTyped(typedPaneRun(calls));
    leftoverDirs.push(dirname(wrapPath));
    const command = readFileSync(join(dirname(wrapPath), 'command'), 'utf8');
    expect(command).toContain("NL='a\nb'");
    expect(command).not.toMatch(/NL=\$'/);
    expect(command).toContain("Q='");
    expect(command).toContain("'\\''");
    expect(command).toContain(long.replaceAll("'", "'\\''"));
  });

  // Docker pulls/starts a container, far beyond vitest's 5s default.
  it.skipIf(!DASH)(
    'dash eval of the command file delivers a two-line env value, a 2000-byte quoted value and a multi-line prompt',
    { timeout: 60_000 },
    async () => {
      const calls: string[][] = [];
      const long = `${'y'.repeat(1000)}'${'z'.repeat(999)}`;
      const executor = new HerdrExecutor(
        { command: 'claude', launch_watch: INSTANT_WATCH },
        fakeExec(calls),
      );
      await executor.startRun({
        ...spawnOverCap(),
        env: { NL: 'a\nb', Q: long },
        // The prompt is quoted the way every agent plugin quotes it.
        command: `sh -c 'printf "%s|" "$NL"; printf "%s|" "$1"; printf "%s" "$Q"' x ${shellQuote("a\nit's")}`,
      });
      const wrapPath = scriptPathFromTyped(typedPaneRun(calls));
      leftoverDirs.push(dirname(wrapPath));
      const command = readFileSync(join(dirname(wrapPath), 'command'), 'utf8');
      const out = dashEval(command);
      expect(out).toBe(`a\nb|a\nit's|${long}`);
    },
  );

  // dash dies on SIGINT while waiting for the agent unless the wrapper traps it.
  it.skipIf(!DASH)(
    'writes the exit marker under dash when the wrapper receives SIGINT (Ctrl-C)',
    { timeout: 60_000 },
    () => {
      const script = writeLaunchScript('kill -INT $$; exit 3');
      leftoverDirs.push(script.dir);
      const [bin, args]: [string, string[]] =
        DASH === 'docker'
          ? [
              'docker',
              [
                'run',
                '--rm',
                '-v',
                `${script.dir}:${script.dir}`,
                'debian:stable-slim',
                'sh',
                script.wrapPath,
              ],
            ]
          : [DASH as string, [script.wrapPath]];
      try {
        execFileSync(bin, args, { stdio: 'ignore' });
      } catch {
        // the wrapper exits with the command's status
      }
      expect(readFileSync(script.exitPath, 'utf8')).toBe('exit 3\n');
    },
  );
});

describe('HerdrExecutor.startRun launch cleanup', () => {
  it('removes the launch directory when the wrapper never starts', async () => {
    const calls: string[][] = [];
    const exec = fakeExec(calls, { plant: false });
    const executor = new HerdrExecutor(
      {
        command: 'claude',
        launch_watch: { timeout_ms: 0, start_timeout_ms: 0, poll_ms: 1 },
      },
      exec,
    );
    const err = await executor.startRun(spawnOverCap()).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(
      /Launch failed: agent did not start/,
    );
    const typed = typedPaneRun(calls);
    leftoverDirs.push(dirname(scriptPathFromTyped(typed)));
    expect(existsSync(dirname(scriptPathFromTyped(typed)))).toBe(false);
  });
});

describe('HerdrExecutor.startRun launch watch', () => {
  it('rejects with the exit code and pane tail when the command exits immediately', async () => {
    const calls: string[][] = [];
    const exec = async (args: string[]): Promise<string> => {
      calls.push(args);
      if (args[0] === 'worktree' && args[1] === 'list') {
        return JSON.stringify({
          result: {
            worktrees: [
              {
                branch: 'b',
                path: '/repo/wt',
                open_workspace_id: 'ws-1',
              },
            ],
          },
        });
      }
      if (args[0] === 'tab' && args[1] === 'create') {
        return JSON.stringify({
          result: {
            root_pane: { pane_id: 'p-1' },
            tab: { tab_id: 'tab-1' },
          },
        });
      }
      if (args[0] === 'pane' && args[1] === 'run') {
        leftoverDirs.push(dirname(scriptPathFromTyped(args[3] ?? '')));
        try {
          execFileSync('sh', [scriptPathFromTyped(args[3] ?? '')], {
            timeout: 2000,
          });
        } catch {
          // wrapper exits with the command's status; watchLaunch reads markers
        }
        return JSON.stringify({ result: {} });
      }
      if (args[0] === 'pane' && args[1] === 'read') {
        return 'Error: Invalid session ID. Must be a valid UUID.';
      }
      return JSON.stringify({ result: {} });
    };
    const executor = new HerdrExecutor(
      { command: 'claude', launch_watch: { timeout_ms: 1500, poll_ms: 15 } },
      exec,
    );
    const err = await executor
      .startRun({ ...spawnOverCap(), command: 'exit 1', env: {} })
      .catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/Launch failed: exit 1/);
    expect((err as Error).message).toContain('Invalid session ID');
  });

  it('resolves when the command keeps running', async () => {
    const children: { pid?: number }[] = [];
    const exec = async (args: string[]): Promise<string> => {
      if (args[0] === 'worktree' && args[1] === 'list') {
        return JSON.stringify({
          result: {
            worktrees: [
              {
                branch: 'b',
                path: '/repo/wt',
                open_workspace_id: 'ws-1',
              },
            ],
          },
        });
      }
      if (args[0] === 'tab' && args[1] === 'create') {
        return JSON.stringify({
          result: {
            root_pane: { pane_id: 'p-1' },
            tab: { tab_id: 'tab-1' },
          },
        });
      }
      if (args[0] === 'pane' && args[1] === 'run') {
        leftoverDirs.push(dirname(scriptPathFromTyped(args[3] ?? '')));
        const child = spawn('sh', [scriptPathFromTyped(args[3] ?? '')], {
          stdio: 'ignore',
          detached: true,
        });
        child.unref();
        children.push(child);
        return JSON.stringify({ result: {} });
      }
      return JSON.stringify({ result: {} });
    };
    const executor = new HerdrExecutor(
      { command: 'claude', launch_watch: { timeout_ms: 400, poll_ms: 20 } },
      exec,
    );
    try {
      await executor.startRun({
        ...spawnOverCap(),
        command: 'sleep 30',
        env: {},
      });
    } finally {
      for (const child of children) {
        if (child.pid) {
          try {
            process.kill(-child.pid, 'SIGTERM');
          } catch {
            try {
              process.kill(child.pid, 'SIGTERM');
            } catch {
              // already gone
            }
          }
        }
      }
    }
  });
});
