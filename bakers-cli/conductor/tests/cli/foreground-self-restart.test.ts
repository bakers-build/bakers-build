import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
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
import { resolveCliVersion } from '@bakers-build/core';
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
describe('bakers conductor start --foreground self-restart', () => {
  let home: string;
  const originalHome = process.env.BAKERS_HOME;
  const originalLog = process.env.BAKERS_CONDUCTOR_LOG;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'bakers-fg-restart-'));
    process.env.BAKERS_HOME = join(home, '.bakers');
    process.env.BAKERS_CONDUCTOR_LOG = 'file';
    mkdirSync(process.env.BAKERS_HOME);
    secrets = join(process.env.BAKERS_HOME, '.bakers.env');
  });

  let secrets: string;
  const OLD = 'old-secret-value';
  const NEW = 'new-secret-value';
  function writeSecrets(text: string, mode = 0o600): void {
    writeFileSync(secrets, text);
    chmodSync(secrets, mode);
  }

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
    if (originalHome === undefined) delete process.env.BAKERS_HOME;
    else process.env.BAKERS_HOME = originalHome;
    if (originalLog === undefined) delete process.env.BAKERS_CONDUCTOR_LOG;
    else process.env.BAKERS_CONDUCTOR_LOG = originalLog;
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

  describe('when the secrets file changes', () => {
    it('on any write that loads, drains without offline and re-execs without a config check, logging no value', async () => {
      writeSecrets(`TOKEN=${OLD}\nGONE=${OLD}\n`);
      const remote = new TickRemote();
      const h = harness(remote, async () => undefined);
      remote.onTick = (n) => {
        if (n === 1) {
          writeSecrets(`TOKEN=${NEW}\nADDED=${NEW}\n`);
          void h.change([secrets]);
        }
      };

      await h.run();

      expect(h.execve).toHaveBeenCalledTimes(1);
      expect(h.checks).toBe(0);
      expect(remote.statusWrites).toEqual([]);
      expect(log()).toContain('secrets file changed; restarting conductor');
      expect(log()).not.toContain(OLD);
      expect(log()).not.toContain(NEW);
    });

    it('keeps serving on a file that fails to load, logs the file and fix without values, and restarts on the next valid write', async () => {
      writeSecrets(`TOKEN=${OLD}\n`);
      const remote = new TickRemote();
      const h = harness(remote, async () => undefined);
      remote.onTick = (n) => {
        if (n === 1) {
          writeSecrets(`TOKEN ${NEW}\n`);
          void h.change([secrets]);
        }
        if (n === 3) {
          writeSecrets(`TOKEN=${NEW}\n`, 0o644);
          void h.change([secrets]);
        }
        if (n === 5) {
          writeSecrets(`TOKEN=${NEW}\n`);
          void h.change([secrets]);
        }
      };

      await h.run();

      expect(remote.ticks).toBeGreaterThanOrEqual(5);
      expect(h.execve).toHaveBeenCalledTimes(1);
      const kept = 'keeping the running conductor on its last good secrets';
      expect(log()).toContain(
        `${secrets}: line 1: expected KEY=value; ${kept}`,
      );
      expect(log()).toContain(`chmod 600 ${secrets}; ${kept}`);
      expect(log()).not.toContain(OLD);
      expect(log()).not.toContain(NEW);
    });

    it('does not restart for a config change while the secrets file fails to load', async () => {
      writeSecrets(`TOKEN=${OLD}\n`);
      const remote = new TickRemote();
      const h = harness(remote, async () => undefined);
      remote.onTick = (n) => {
        if (n === 1) {
          writeSecrets(`TOKEN ${NEW}\n`);
          void h.change([CHANGED, secrets]);
        }
        if (n === 3) process.emit('SIGTERM');
      };

      await h.run();

      expect(h.execve).not.toHaveBeenCalled();
      expect(log()).toContain(
        'keeping the running conductor on its last good secrets',
      );
    });

    it('re-checks a held-back config change once the secrets file loads again', async () => {
      writeSecrets(`TOKEN=${OLD}\n`);
      const remote = new TickRemote();
      const h = harness(remote, async () => undefined);
      remote.onTick = (n) => {
        if (n === 1) {
          writeSecrets(`TOKEN ${OLD}\n`);
          void h.change([CHANGED, secrets]);
        }
        if (n === 3) {
          writeSecrets(`TOKEN=${OLD}\n`);
          void h.change([secrets]);
        }
        if (n === 6) process.emit('SIGTERM');
      };

      await h.run();

      expect(h.checks).toBe(1);
      expect(h.execve).toHaveBeenCalledTimes(1);
      expect(log()).toContain(
        `${CHANGED}, ${secrets} changed; checking config`,
      );
    });

    it('does not restart for a new CLI version while the secrets file fails to load', async () => {
      writeSecrets(`TOKEN=${OLD}\n`);
      const remote = new TickRemote();
      const versions = ['99.0.0', '99.0.0'];
      const h = harness(remote, async () => undefined, {}, true, {
        readCliVersion: () => {
          const next = versions.shift();
          if (next === undefined) process.emit('SIGTERM');
          else writeSecrets(`TOKEN ${NEW}\n`);
          return next ?? resolveCliVersion();
        },
        migrateConfig: async () => undefined,
      });

      await h.run();

      expect(h.execve).not.toHaveBeenCalled();
      expect(log()).toContain(
        'keeping the running conductor on its last good secrets',
      );
    });

    it('during a pending CLI upgrade, a valid write restarts only after migrate and check', async () => {
      writeSecrets(`TOKEN=${OLD}\n`);
      const remote = new TickRemote();
      const calls: string[] = [];
      let reads = 0;
      const h = harness(
        remote,
        async () => {
          calls.push('check');
          return undefined;
        },
        {},
        true,
        {
          readCliVersion: () => {
            reads += 1;
            // Read 2 refuses the upgrade on the broken file; read 3 fixes it.
            if (reads === 1) writeSecrets(`TOKEN ${NEW}\n`);
            if (reads === 3) {
              writeSecrets(`TOKEN=${NEW}\n`);
              void h.change([secrets]);
            }
            if (reads === 10) process.emit('SIGTERM');
            return '99.0.0';
          },
          migrateConfig: async () => {
            calls.push('migrate');
            return undefined;
          },
        },
      );
      h.execve.mockImplementation(() => calls.push('execve'));

      await h.run();

      expect(calls).toEqual(['migrate', 'check', 'execve']);
    });

    it('names the secrets file beside a config change in the same window', async () => {
      writeSecrets(`TOKEN=${OLD}\n`);
      const remote = new TickRemote();
      const h = harness(remote, async () => undefined);
      remote.onTick = (n) => {
        if (n === 1) void h.change([CHANGED, secrets]);
      };

      await h.run();

      expect(h.execve).toHaveBeenCalledTimes(1);
      expect(log()).toContain(
        `${CHANGED}, ${secrets} changed; checking config`,
      );
    });
  });

  describe('after the installed CLI version changes', () => {
    const START = resolveCliVersion();

    /** Reads `versions` in turn; when they run out, stops the conductor. */
    function reads(...versions: string[]) {
      return vi.fn(() => {
        const next = versions.shift();
        if (next === undefined) {
          process.emit('SIGTERM');
          return START;
        }
        return next;
      });
    }

    it('on two equal new reads, migrates, checks, then re-execs itself', async () => {
      const remote = new TickRemote();
      const calls: string[] = [];
      const h = harness(
        remote,
        async () => {
          calls.push('check');
          return undefined;
        },
        { watch_paths: undefined },
        true,
        {
          readCliVersion: reads('99.0.0', '99.0.0'),
          migrateConfig: async () => {
            calls.push('migrate');
            return undefined;
          },
        },
      );
      h.execve.mockImplementation(() => calls.push('execve'));

      await h.run();

      expect(calls).toEqual(['migrate', 'check', 'execve']);
      expect(remote.statusWrites).toEqual([]);
      expect(log()).toContain(`CLI version changed ${START} → 99.0.0`);
      expect(log()).toContain('config check passed; restarting conductor');
    });

    function watch(
      versions: string[],
      results: { migrate?: string[]; check?: string[] } = {},
      over: Partial<ConductorFileConfig> = {},
    ) {
      const remote = new TickRemote();
      const counts = { migrate: 0, check: 0 };
      const h = harness(
        remote,
        async () => {
          counts.check += 1;
          return results.check?.shift();
        },
        { watch_paths: undefined, ...over },
        true,
        {
          readCliVersion: reads(...versions),
          migrateConfig: async () => {
            counts.migrate += 1;
            return results.migrate?.shift();
          },
        },
      );
      return { remote, counts, h };
    }

    it('ignores a half-written install: one new read, then the old one again', async () => {
      const { remote, counts, h } = watch(['99.0.0', START, START]);
      await h.run();
      expect(counts.migrate).toBe(0);
      expect(h.execve).not.toHaveBeenCalled();
      expect(remote.statusWrites).toEqual([['mid-fg', 'offline']]);
    });

    it('leaves the conductor alone when the version is unchanged or unreadable', async () => {
      const { counts, h } = watch([START, START, '0.0.0', '0.0.0']);
      await h.run();
      expect(counts.migrate).toBe(0);
      expect(h.execve).not.toHaveBeenCalled();
    });

    it('on a failed migration, logs the step and recovery and retries only on a newer version', async () => {
      const { counts, h } = watch(
        ['99.0.0', '99.0.0', '99.0.0', '99.0.0', '99.0.1', '99.0.1'],
        { migrate: ['schema 7 unknown', 'schema 8 unknown'] },
      );
      await h.run();
      expect(counts.migrate).toBe(2);
      expect(counts.check).toBe(0);
      expect(h.execve).not.toHaveBeenCalled();
      expect(log()).toContain(
        `config upgrade failed; keeping the running conductor on ${START}: schema 7 unknown`,
      );
      expect(log()).toContain(
        'Recover with `bakers config upgrade --scope all --yes`, then `bakers oven start --force`',
      );
    });

    it('on a failed check after the migration, logs the check step and keeps serving', async () => {
      const { counts, h } = watch(['99.0.0', '99.0.0', '99.0.0'], {
        check: ['SyntaxError: Unexpected token }'],
      });
      await h.run();
      expect(counts).toEqual({ migrate: 1, check: 1 });
      expect(h.execve).not.toHaveBeenCalled();
      expect(log()).toContain(
        `config check failed; keeping the running conductor on ${START}: SyntaxError`,
      );
    });

    it('only warns when restart_on_change is false', async () => {
      const { counts, h } = watch(
        ['99.0.0', '99.0.0', '99.0.0'],
        {},
        {
          restart_on_change: false,
        },
      );
      await h.run();
      expect(counts.migrate).toBe(0);
      expect(h.execve).not.toHaveBeenCalled();
      expect(log().match(/restart_on_change is off/g)).toHaveLength(1);
    });
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
    extra: Partial<BbCliDeps> = {},
  ) {
    let trigger: ((paths: string[]) => Promise<void>) | undefined;
    const h = {
      checks: 0,
      watched: false,
      closed: false,
      execve: vi.fn(),
      change: (paths = [CHANGED]) =>
        trigger ? trigger(paths) : Promise.resolve(),
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
          ...extra,
        };
        await buildConductorProgram(deps).parseAsync(
          ['conductor', 'start', '--foreground', '--no-update-check'],
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
      config_path: join(home, 'project.config.js'),
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
