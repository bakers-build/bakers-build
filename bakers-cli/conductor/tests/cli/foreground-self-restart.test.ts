import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { claudeAgent } from '@bakers-build/addon-claude';
import {
  FakeBbRemote,
  FakeExecutor,
  FakeWorkspace,
  fakeExecutor,
  fakeRemote,
  fakeWorkspace,
} from '@bakers-build/addon-fake';
import type {
  ConductorFileConfig,
  ConductorRegistration,
} from '@bakers-build/conductor/contract';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type BbCliDeps,
  buildConductorProgram,
} from '../../src/commands/conductor.js';
import { DEFAULT_AGENT_PROMPT } from '../../src/config.js';

vi.mock('dropsh', async (orig) => {
  const actual = await orig<typeof import('dropsh')>();
  return { ...actual, authStatus: vi.fn(async () => ({ loggedIn: true })) };
});

const CHANGED = '/project/.bakers/conductor.config.local.js';

/**
 * `oven start --foreground` restarts itself when a loaded file changes: a
 * passing config check drains the loop like SIGTERM, keeps the conductor
 * online and replaces the process in place; a failing one keeps it running.
 */
describe('bakers oven start --foreground self-restart', () => {
  let home: string;
  const originalHome = process.env.BB_HOME;
  const originalLog = process.env.BB_CONDUCTOR_LOG;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'bakers-fg-restart-'));
    process.env.BB_HOME = join(home, '.bakers');
    process.env.BB_CONDUCTOR_LOG = 'file';
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
    if (originalHome === undefined) delete process.env.BB_HOME;
    else process.env.BB_HOME = originalHome;
    if (originalLog === undefined) delete process.env.BB_CONDUCTOR_LOG;
    else process.env.BB_CONDUCTOR_LOG = originalLog;
  });

  it('on a passing check, drains, writes no offline and re-execs itself', async () => {
    const remote = new TickRemote();
    const h = harness(remote, async () => undefined);
    remote.onTick = (n) => {
      if (n === 1) void h.change();
    };

    await h.run();

    expect(h.checks).toBe(1);
    expect(h.closed).toBe(true);
    expect(remote.statusWrites).toEqual([]);
    expect(h.execve).toHaveBeenCalledTimes(1);
    const [file, args] = h.execve.mock.calls[0] as [string, string[]];
    expect(file).toBe(process.execPath);
    expect(args).toEqual([
      process.execPath,
      ...process.execArgv,
      ...process.argv.slice(1),
    ]);
    expect(log()).toContain(`${CHANGED} changed; checking config`);
    expect(log()).toContain('config check passed; restarting conductor');
  });

  it('on a failing check, logs the error and keeps serving; the next change re-checks', async () => {
    const remote = new TickRemote();
    const results = ['SyntaxError: Unexpected token }', undefined];
    const h = harness(remote, async () => results.shift());
    remote.onTick = (n) => {
      if (n === 1) void h.change();
      if (n === 3) void h.change(); // still serving after the failed check
    };

    await h.run();

    expect(h.checks).toBe(2);
    expect(remote.ticks).toBeGreaterThanOrEqual(3);
    expect(log()).toContain(
      'config check failed; keeping the running conductor',
    );
    expect(log()).toContain('SyntaxError: Unexpected token }');
    expect(h.execve).toHaveBeenCalledTimes(1);
  });

  it('a stop requested during a passing check stops: offline, no re-exec', async () => {
    const remote = new TickRemote();
    let pass: (v: undefined) => void = () => {};
    const h = harness(
      remote,
      () => new Promise<undefined>((resolve) => (pass = resolve)),
    );
    remote.onTick = (n) => {
      if (n === 1) void h.change();
      if (n === 2) {
        process.emit('SIGTERM');
        pass(undefined);
      }
    };

    await h.run();

    expect(h.checks).toBe(1);
    expect(h.execve).not.toHaveBeenCalled();
    expect(remote.statusWrites).toEqual([['mid-fg', 'offline']]);
  });

  it('a stop requested after a passing check, during the drain, stops: offline, no re-exec', async () => {
    const remote = new TickRemote();
    const h = harness(remote, async () => undefined);
    remote.onTick = (n) => {
      if (n === 1) void h.change().then(() => process.emit('SIGTERM'));
    };

    await h.run();

    expect(h.checks).toBe(1);
    expect(h.execve).not.toHaveBeenCalled();
    expect(remote.statusWrites).toEqual([['mid-fg', 'offline']]);
  });

  it('creates no watcher when restart_on_change is false', async () => {
    const remote = new TickRemote();
    remote.onTick = () => process.emit('SIGTERM');
    const h = harness(remote, async () => undefined, {
      restart_on_change: false,
    });

    await h.run();

    expect(h.watched).toBe(false);
    expect(remote.statusWrites).toEqual([['mid-fg', 'offline']]);
  });

  it('creates no watcher and warns once without process.execve', async () => {
    const remote = new TickRemote();
    remote.onTick = () => process.emit('SIGTERM');
    const h = harness(remote, async () => undefined, {}, false);
    const saved = Object.getOwnPropertyDescriptor(process, 'execve');
    Object.defineProperty(process, 'execve', {
      value: undefined,
      configurable: true,
    });
    try {
      await h.run();
    } finally {
      if (saved) Object.defineProperty(process, 'execve', saved);
      else delete (process as { execve?: unknown }).execve;
    }

    expect(h.watched).toBe(false);
    expect(
      log().match(/restart_on_change needs process\.execve/g),
    ).toHaveLength(1);
  });

  function log(): string {
    const files = readdirSync(home, { recursive: true, encoding: 'utf8' })
      .filter((f) => f.endsWith('log.txt'))
      .map((f) => readFileSync(join(home, f), 'utf8'));
    return files.join('\n');
  }

  function harness(
    remote: TickRemote,
    checkConfig: () => Promise<string | undefined>,
    over: Partial<ConductorFileConfig> = {},
    injectExecve = true,
  ) {
    let trigger: ((path: string) => Promise<void>) | undefined;
    const h = {
      checks: 0,
      watched: false,
      closed: false,
      execve: vi.fn(),
      change: () => (trigger ? trigger(CHANGED) : Promise.resolve()),
      run: async () => {
        const deps: BbCliDeps = {
          remote,
          config: makeConfig(over),
          executor: new FakeExecutor({ outcome: 'exited' }),
          workspace: new FakeWorkspace(),
          agents: [{ id: 'claude', agent: claudeAgent() }],
          watchForRestart: (_paths, onChange) => {
            h.watched = true;
            trigger = onChange;
            return {
              close: () => {
                h.closed = true;
              },
            };
          },
          checkConfig: async () => {
            h.checks += 1;
            return checkConfig();
          },
          ...(injectExecve ? { execve: h.execve } : {}),
        };
        await buildConductorProgram(deps).parseAsync(
          ['oven', 'start', '--foreground', '--no-update-check'],
          { from: 'user' },
        );
      },
    };
    return h;
  }

  function makeConfig(over: Partial<ConductorFileConfig>): ConductorFileConfig {
    return {
      site: { base_url: 'http://web', jsonapi_prefix: '/jsonapi' },
      remote: fakeRemote(),
      executor: fakeExecutor(),
      agent: [{ agent: claudeAgent() }],
      workspace: fakeWorkspace(),
      label: 'foreground restart test',
      project: 'bakers',
      states: ['working'],
      prompt: DEFAULT_AGENT_PROMPT,
      max_parallel: 1,
      poll_interval_ms: 5,
      lease_seconds: 300,
      conductor_id: 'mid-fg',
      config_path: join(home, 'conductor.config.js'),
      restart_on_change: true,
      watch_paths: { files: [CHANGED], dirs: [] },
      ...over,
    } as ConductorFileConfig;
  }
});

/** Counts heartbeats (one per serve tick) and hands each to the test. */
class TickRemote extends FakeBbRemote {
  ticks = 0;
  statusWrites: Array<[string, string]> = [];
  onTick: (n: number) => void = () => {};

  override async heartbeat(
    reg: ConductorRegistration,
    load: number,
    lease?: number,
  ): Promise<string> {
    const status = await super.heartbeat(reg, load, lease);
    this.ticks += 1;
    this.onTick(this.ticks);
    return status;
  }

  override async setConductorStatus(id: string, status: string): Promise<void> {
    this.statusWrites.push([id, status]);
  }
}
