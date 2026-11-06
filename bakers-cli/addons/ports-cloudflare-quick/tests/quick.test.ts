import type { TunnelDesiredRecord } from '@bakers-build/addon-ports/transport';
import { describe, expect, it } from 'vitest';
import {
  AmbiguousOwnershipError,
  buildArgs,
  isOwnedArgv,
  type ManagedProcessIdentity,
  parseLiveUrl,
  type QuickDeps,
  reconcileQuick,
  routeDirFor,
  sanitizeEnv,
} from '../src/quick.js';

function baseRecord(
  overrides: Partial<TunnelDesiredRecord> = {},
): TunnelDesiredRecord {
  return {
    worktree: '/work/bb-1',
    ticket: 'BB-1',
    key: 'storybook',
    service: 'http://127.0.0.1:6006',
    desired: 'present',
    applied: 'pending',
    ...overrides,
  };
}

/** A deterministic, in-memory stand-in for `/proc` + `cloudflared`: every
 *  spawn gets its own incrementing pid/startTime, every (pid, dir) owns a
 *  predictable log path, and nothing here touches real processes or files. */
function makeFakeDeps(
  options: { readonly seedLogUrl?: boolean; readonly urlWaitMs?: number } = {},
) {
  const processes = new Map<number, ManagedProcessIdentity>();
  const logs = new Map<string, string>();
  const files = new Map<string, string>();
  const createdDirs = new Set<string>();
  const killed: number[] = [];
  const spawnCalls: {
    readonly bin: string;
    readonly args: readonly string[];
  }[] = [];
  let nextPid = 100;
  let clock = 0;
  let findBinaryResult: string | null = '/usr/bin/cloudflared';
  let checkpointHook: (() => void) | undefined;

  const deps: QuickDeps = {
    spawn(bin, args, opts) {
      spawnCalls.push({ bin, args });
      const pid = nextPid++;
      const identity: ManagedProcessIdentity = {
        pid,
        exe: bin,
        argv: args,
        uid: 1000,
        startTime: clock++,
        bootId: 'boot-1',
      };
      processes.set(pid, identity);
      if (options.seedLogUrl !== false) {
        const configIdx = args.indexOf('--config');
        const configPath = args[configIdx + 1] as string;
        const logPath = configPath.replace('config.yaml', 'cloudflared.log');
        logs.set(
          logPath,
          `connection established\nhttps://route-${pid}.trycloudflare.com\n`,
        );
      }
      void opts;
      return { pid };
    },
    findBinary: async () => findBinaryResult,
    now: () => clock,
    sleep: async (ms) => {
      clock += ms;
    },
    readFile: async (path) => logs.get(path) ?? files.get(path) ?? null,
    writeFile: async (path, data) => {
      files.set(path, data);
    },
    mkdir: async (path) => {
      createdDirs.add(path);
    },
    listOwnedProcesses: async (dir) =>
      [...processes.values()].filter((p) => isOwnedArgv(p.argv, dir)),
    listGenerations: async (dir) => {
      const prefix = `${dir}/gen-`;
      const gens: number[] = [];
      for (const d of createdDirs) {
        if (d.startsWith(prefix)) {
          const n = Number(d.slice(prefix.length));
          if (Number.isInteger(n)) gens.push(n);
        }
      }
      return gens;
    },
    getProcessIdentity: async (pid) => processes.get(pid) ?? null,
    kill: (pid) => {
      killed.push(pid);
      processes.delete(pid);
    },
    waitExit: async (pid) => !processes.has(pid),
    bootId: async () => 'boot-1',
    env: { HOME: '/home/op', PATH: '/usr/bin' },
    urlWaitMs: options.urlWaitMs ?? 1_000,
    pollMs: 10,
    killWaitMs: 100,
  };

  return {
    deps,
    processes,
    logs,
    killed,
    spawnCalls,
    setBinary: (v: string | null) => {
      findBinaryResult = v;
    },
    setCheckpointHook: (fn: () => void) => {
      checkpointHook = fn;
    },
    runCheckpointHook: () => checkpointHook?.(),
    forgetProcess: (pid: number) => processes.delete(pid),
    setProcess: (pid: number, identity: ManagedProcessIdentity) =>
      processes.set(pid, identity),
    dropLog: (path: string) => logs.delete(path),
  };
}

describe('parseLiveUrl', () => {
  it('extracts a validated trycloudflare URL from log output', () => {
    expect(
      parseLiveUrl(
        '2026-10-16 INFO Your quick Tunnel has been created! Visit it at https://happy-cat-42.trycloudflare.com\n',
      ),
    ).toBe('https://happy-cat-42.trycloudflare.com');
  });

  it('rejects a non-trycloudflare URL even if log-spoofed to look legitimate', () => {
    const log =
      'INFO tunnel live at https://evil.example.com/trycloudflare.com\n';
    expect(parseLiveUrl(log)).toBeNull();
  });

  it('returns null when no URL is present yet', () => {
    expect(parseLiveUrl('starting tunnel...\n')).toBeNull();
  });
});

describe('buildArgs', () => {
  it('builds an explicit argv array with --no-tls-verify always explicit and a required --logfile (BB-681 review C2)', () => {
    const args = buildArgs(
      '/home/.bakers/ports/quick/abc/gen-1/config.yaml',
      '/home/.bakers/ports/quick/abc/gen-1/cloudflared.log',
      { service: 'http://127.0.0.1:6006' },
    );
    expect(args).toEqual([
      '--config',
      '/home/.bakers/ports/quick/abc/gen-1/config.yaml',
      '--no-autoupdate',
      '--logfile',
      '/home/.bakers/ports/quick/abc/gen-1/cloudflared.log',
      'tunnel',
      '--url',
      'http://127.0.0.1:6006',
      '--no-tls-verify=false',
    ]);
  });

  it('includes --http-host-header only when the rule carries one, and true when insecure', () => {
    const args = buildArgs(
      '/dir/gen-2/config.yaml',
      '/dir/gen-2/cloudflared.log',
      {
        service: 'http://127.0.0.1:443',
        hostHeader: 'site.local.test',
        insecureTls: true,
      },
    );
    expect(args).toContain('--no-tls-verify=true');
    expect(args).toEqual(
      expect.arrayContaining(['--http-host-header', 'site.local.test']),
    );
  });
});

describe('sanitizeEnv', () => {
  it('strips TUNNEL_* overrides but passes through unrelated vars and leaves HOME untouched', () => {
    const parent = {
      HOME: '/home/op',
      TUNNEL_NAME: 'someone-elses-tunnel',
      TUNNEL_ORIGIN_CERT: '/secret/cert.pem',
      PATH: '/usr/bin',
    };
    const out = sanitizeEnv(parent);
    expect(out.HOME).toBe('/home/op');
    expect(out.PATH).toBe('/usr/bin');
    expect(out.TUNNEL_NAME).toBeUndefined();
    expect(out.TUNNEL_ORIGIN_CERT).toBeUndefined();
  });
});

describe('routeDirFor', () => {
  it('never collides for two different routes', () => {
    const a = routeDirFor('/home', '/work/a', 'BB-1', 'storybook');
    const b = routeDirFor('/home', '/work/b', 'BB-1', 'storybook');
    const c = routeDirFor('/home', '/work/a', 'BB-1', 'web');
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
  });
});

describe('reconcileQuick', () => {
  it('spawns a managed process and reports the parsed URL as applied', async () => {
    const h = makeFakeDeps();
    const checkpoints: TunnelDesiredRecord[][] = [];
    const result = await reconcileQuick(
      [baseRecord()],
      h.deps,
      '/home/.bakers',
      {
        checkpoint: async (r) => void checkpoints.push(r.slice()),
      },
    );
    expect(result.ok).toBe(true);
    expect(result.records[0]?.applied).toBe('applied');
    expect(result.records[0]?.url).toMatch(
      /^https:\/\/route-\d+\.trycloudflare\.com$/,
    );
    expect(h.spawnCalls).toHaveLength(1);
    // Ownership checkpointed BEFORE the URL was known to be resolved — the
    // first checkpoint call recorded 'pending', proving the sequencing.
    expect(checkpoints[0]?.[0]?.applied).toBe('pending');
  });

  it('reuses an already-live matching owned process on a repeated up (no duplicate spawn)', async () => {
    const h = makeFakeDeps();
    const first = await reconcileQuick(
      [baseRecord()],
      h.deps,
      '/home/.bakers',
      {
        checkpoint: async () => {},
      },
    );
    const second = await reconcileQuick(
      [first.records[0] as TunnelDesiredRecord],
      h.deps,
      '/home/.bakers',
      { checkpoint: async () => {} },
    );
    expect(h.spawnCalls).toHaveLength(1);
    expect(second.records[0]?.url).toBe(first.records[0]?.url);
    expect(second.records[0]?.applied).toBe('applied');
  });

  it('ignores a direct container origin: same argv, and a changed one recreates nothing', async () => {
    const plain = makeFakeDeps();
    await reconcileQuick([baseRecord()], plain.deps, '/home/.bakers', {
      checkpoint: async () => {},
    });
    const h = makeFakeDeps();
    const first = await reconcileQuick(
      [{ ...baseRecord(), direct: 'http://172.18.0.19:80' }],
      h.deps,
      '/home/.bakers',
      { checkpoint: async () => {} },
    );
    expect(h.spawnCalls).toEqual(plain.spawnCalls);
    await reconcileQuick(
      [
        {
          ...(first.records[0] as TunnelDesiredRecord),
          direct: 'http://172.18.0.23:80',
        },
      ],
      h.deps,
      '/home/.bakers',
      { checkpoint: async () => {} },
    );
    expect(h.spawnCalls).toHaveLength(1);
  });

  it('recreates the route when the origin (service) changes, and the new URL may differ', async () => {
    const h = makeFakeDeps();
    const first = await reconcileQuick(
      [baseRecord()],
      h.deps,
      '/home/.bakers',
      {
        checkpoint: async () => {},
      },
    );
    const oldPid = (first.records[0]?.data as { pid: number } | undefined)!.pid;
    const changed = {
      ...(first.records[0] as TunnelDesiredRecord),
      service: 'http://127.0.0.1:9999',
    };
    const second = await reconcileQuick([changed], h.deps, '/home/.bakers', {
      checkpoint: async () => {},
    });
    expect(h.spawnCalls).toHaveLength(2);
    expect(h.killed).toContain(oldPid);
    expect(second.records[0]?.url).not.toBe(first.records[0]?.url);
    expect(second.records[0]?.applied).toBe('applied');
  });

  it('recreates the route when the owned process is confirmed dead, without killing anything', async () => {
    const h = makeFakeDeps();
    const first = await reconcileQuick(
      [baseRecord()],
      h.deps,
      '/home/.bakers',
      {
        checkpoint: async () => {},
      },
    );
    const oldPid = (first.records[0]?.data as { pid: number } | undefined)!.pid;
    h.forgetProcess(oldPid); // simulate the process having crashed
    const second = await reconcileQuick(
      [first.records[0] as TunnelDesiredRecord],
      h.deps,
      '/home/.bakers',
      { checkpoint: async () => {} },
    );
    expect(h.spawnCalls).toHaveLength(2);
    expect(h.killed).not.toContain(oldPid);
    expect(second.records[0]?.applied).toBe('applied');
  });

  // BB-681 review I2: a crash between spawning generation N+1 and
  // checkpointing it (or between checkpointing and the process's own next
  // reconcile) can leave an owned process whose pid no longer matches
  // `recorded` (the record's remembered pid died/was reused). The orphan
  // scan must run in THIS case too, not only when there is no recorded data
  // at all — otherwise a second, duplicate-routing process gets spawned
  // alongside the still-running orphan.
  it('adopts a live orphan sharing this route directory instead of spawning a duplicate, even when recorded data exists but its pid is dead (I2)', async () => {
    const h = makeFakeDeps();
    const first = await reconcileQuick(
      [baseRecord()],
      h.deps,
      '/home/.bakers',
      {
        checkpoint: async () => {},
      },
    );
    const recordedData = first.records[0]?.data as
      | { pid: number; routeDir: string }
      | undefined;
    if (!recordedData)
      throw new Error('expected recorded data after first reconcile');
    const oldPid = recordedData.pid;
    h.forgetProcess(oldPid); // the recorded pid is gone/reused
    // An orphan bearing the SAME route directory is still running (e.g. the
    // actual generation 2 process, spawned before a prior crash wiped out
    // the chance to checkpoint it under its own pid).
    const orphanPid = 9001;
    h.setProcess(orphanPid, {
      pid: orphanPid,
      exe: '/usr/bin/cloudflared',
      argv: [
        '--config',
        `${recordedData.routeDir}/gen-2/config.yaml`,
        'tunnel',
        '--url',
        'http://127.0.0.1:6006', // baseRecord()'s own service — same origin
        '--no-tls-verify=false',
      ],
      uid: 1000,
      startTime: 42,
      bootId: 'boot-1',
    });
    h.logs.set(
      `${recordedData.routeDir}/gen-2/cloudflared.log`,
      'connection established\nhttps://route-9001.trycloudflare.com\n',
    );
    const second = await reconcileQuick(
      [first.records[0] as TunnelDesiredRecord],
      h.deps,
      '/home/.bakers',
      { checkpoint: async () => {} },
    );
    expect(h.spawnCalls).toHaveLength(1); // no second spawn — adopted instead
    const secondData = second.records[0]?.data as { pid: number } | undefined;
    expect(secondData?.pid).toBe(orphanPid);
  });

  // BB-681 review I2 (remainder): an orphan bearing this route's
  // `--config` marker must still be checked against the DESIRED origin — a
  // stale service from a previous life must never be silently adopted.
  it('terminates and replaces an orphan whose actual origin no longer matches the desired one, instead of adopting it', async () => {
    const h = makeFakeDeps();
    const first = await reconcileQuick(
      [baseRecord()],
      h.deps,
      '/home/.bakers',
      {
        checkpoint: async () => {},
      },
    );
    const recordedData = first.records[0]?.data as
      | { pid: number; routeDir: string }
      | undefined;
    if (!recordedData)
      throw new Error('expected recorded data after first reconcile');
    h.forgetProcess(recordedData.pid);
    const staleOrphanPid = 9002;
    h.setProcess(staleOrphanPid, {
      pid: staleOrphanPid,
      exe: '/usr/bin/cloudflared',
      argv: [
        '--config',
        `${recordedData.routeDir}/gen-2/config.yaml`,
        'tunnel',
        '--url',
        'http://127.0.0.1:9999', // NOT baseRecord()'s service — stale origin
        '--no-tls-verify=false',
      ],
      uid: 1000,
      startTime: 42,
      bootId: 'boot-1',
    });
    const second = await reconcileQuick(
      [first.records[0] as TunnelDesiredRecord],
      h.deps,
      '/home/.bakers',
      { checkpoint: async () => {} },
    );
    expect(h.killed).toContain(staleOrphanPid);
    const secondData = second.records[0]?.data as { pid: number } | undefined;
    expect(secondData?.pid).not.toBe(staleOrphanPid);
    expect(second.records[0]?.applied).toBe('applied');
  });

  it('reports a missing binary as an error without spawning', async () => {
    const h = makeFakeDeps();
    h.setBinary(null);
    const result = await reconcileQuick(
      [baseRecord()],
      h.deps,
      '/home/.bakers',
      {
        checkpoint: async () => {},
      },
    );
    expect(result.ok).toBe(false);
    expect(result.records[0]?.applied).toBe('error');
    expect(result.records[0]?.error).toMatch(/cloudflared binary not found/);
    expect(h.spawnCalls).toHaveLength(0);
  });

  it('on a bounded URL-wait timeout, terminates ONLY the process just spawned by this attempt', async () => {
    const h = makeFakeDeps({ seedLogUrl: false, urlWaitMs: 50 });
    // An unrelated already-running process this reconcile must never touch.
    h.setProcess(7, {
      pid: 7,
      exe: '/usr/bin/cloudflared',
      argv: ['unrelated'],
      uid: 1000,
      startTime: 0,
      bootId: 'boot-1',
    });
    const result = await reconcileQuick(
      [baseRecord()],
      h.deps,
      '/home/.bakers',
      {
        checkpoint: async () => {},
      },
    );
    expect(result.ok).toBe(false);
    expect(result.records[0]?.applied).toBe('error');
    expect(result.records[0]?.error).toMatch(/timed out/);
    expect(h.killed).toHaveLength(1);
    expect(h.killed).not.toContain(7);
    // The spawned pid (100) is the one that got killed.
    expect(h.killed[0]).toBe(100);
  });

  it('recovers ownership of a process spawned by a crashed prior run (checkpoint never happened) without duplicating it', async () => {
    const h = makeFakeDeps({ seedLogUrl: false });
    const dir = routeDirFor('/home/.bakers', '/work/bb-1', 'BB-1', 'storybook');
    const configPath = `${dir}/gen-1/config.yaml`;
    const logPath = `${dir}/gen-1/cloudflared.log`;
    h.setProcess(55, {
      pid: 55,
      exe: '/usr/bin/cloudflared',
      argv: [
        '--config',
        configPath,
        '--no-autoupdate',
        'tunnel',
        '--url',
        'http://127.0.0.1:6006',
        '--no-tls-verify=false',
      ],
      uid: 1000,
      startTime: 5,
      bootId: 'boot-1',
    });
    h.logs.set(logPath, 'https://orphan.trycloudflare.com\n');
    const result = await reconcileQuick(
      [baseRecord({ data: undefined })],
      h.deps,
      '/home/.bakers',
      { checkpoint: async () => {} },
    );
    expect(h.spawnCalls).toHaveLength(0);
    expect(result.ok).toBe(true);
    expect(result.records[0]?.url).toBe('https://orphan.trycloudflare.com');
    expect((result.records[0]?.data as { pid: number } | undefined)!.pid).toBe(
      55,
    );
  });

  it('treats checkpoint failure as a failed attempt without killing the freshly spawned process', async () => {
    const h = makeFakeDeps();
    let calls = 0;
    const result = await reconcileQuick(
      [baseRecord()],
      h.deps,
      '/home/.bakers',
      {
        checkpoint: async () => {
          calls += 1;
          throw new Error('disk full');
        },
      },
    );
    expect(calls).toBeGreaterThan(0);
    expect(result.ok).toBe(false);
    expect(result.records[0]?.applied).toBe('error');
    expect(h.killed).toHaveLength(0);
    expect(h.spawnCalls).toHaveLength(1);
  });

  it('refuses an ambiguous recovered ownership match — never kills or spawns alongside it', async () => {
    const h = makeFakeDeps();
    const dir = routeDirFor('/home/.bakers', '/work/bb-1', 'BB-1', 'storybook');
    const configPath = `${dir}/gen-1/config.yaml`;
    const identity = (pid: number): ManagedProcessIdentity => ({
      pid,
      exe: '/usr/bin/cloudflared',
      argv: ['--config', configPath],
      uid: 1000,
      startTime: pid,
      bootId: 'boot-1',
    });
    h.setProcess(10, identity(10));
    h.setProcess(11, identity(11));
    const result = await reconcileQuick(
      [baseRecord({ data: undefined })],
      h.deps,
      '/home/.bakers',
      { checkpoint: async () => {} },
    );
    expect(result.ok).toBe(false);
    expect(result.records[0]?.error).toMatch(
      /AmbiguousOwnershipError|ambiguous/i,
    );
    expect(h.killed).toHaveLength(0);
    expect(h.spawnCalls).toHaveLength(0);
  });

  it('a UID mismatch (PID reused by a different process) is treated as "gone", never as a kill target', async () => {
    const h = makeFakeDeps();
    const first = await reconcileQuick(
      [baseRecord()],
      h.deps,
      '/home/.bakers',
      {
        checkpoint: async () => {},
      },
    );
    const recordedData = first.records[0]?.data as {
      pid: number;
      exe: string;
      argv: string[];
      uid: number;
      startTime: number;
      bootId: string;
    };
    // Simulate PID reuse: same pid number, now a wholly different process.
    h.setProcess(recordedData.pid, {
      pid: recordedData.pid,
      exe: '/usr/bin/some-other-program',
      argv: ['some-other-program'],
      uid: 42,
      startTime: 99999,
      bootId: 'boot-1',
    });
    const second = await reconcileQuick(
      [first.records[0] as TunnelDesiredRecord],
      h.deps,
      '/home/.bakers',
      { checkpoint: async () => {} },
    );
    expect(h.killed).not.toContain(recordedData.pid);
    expect(second.records[0]?.applied).toBe('applied');
    expect(h.spawnCalls).toHaveLength(2); // the original + the recreated one
  });

  it('down (`desired: absent`) terminates only an owned, revalidated process and then clears the tombstone', async () => {
    const h = makeFakeDeps();
    const first = await reconcileQuick(
      [baseRecord()],
      h.deps,
      '/home/.bakers',
      {
        checkpoint: async () => {},
      },
    );
    const pid = (first.records[0]?.data as { pid: number } | undefined)!.pid;
    const tombstone = {
      ...(first.records[0] as TunnelDesiredRecord),
      desired: 'absent' as const,
    };
    const result = await reconcileQuick([tombstone], h.deps, '/home/.bakers', {
      checkpoint: async () => {},
    });
    expect(h.killed).toContain(pid);
    expect(result.records).toHaveLength(0); // tombstone cleared
    expect(result.ok).toBe(true);
  });

  // BB-681 review R4-M1: `down`'s stale-record branch must scan for a
  // live orphan too, not only the no-recorded-data branch — a crash between
  // spawning generation N+1 and checkpointing it leaves `recorded` pointing
  // at a pid that's since been reused by something unrelated, while the
  // actual owned process is still running under the route directory. Only
  // the record check would misread that as "already gone" and drop the
  // tombstone while the orphan keeps serving its tunnel forever.
  it('down scans for and terminates an owned orphan when the recorded pid no longer matches', async () => {
    const h = makeFakeDeps();
    const first = await reconcileQuick(
      [baseRecord()],
      h.deps,
      '/home/.bakers',
      {
        checkpoint: async () => {},
      },
    );
    const recordedData = first.records[0]!.data as {
      pid: number;
      startTime: number;
    };
    // Simulate PID reuse: the recorded pid now belongs to an unrelated
    // process with a different identity, but the ACTUAL owned process is
    // still alive (re-spawn it under a fresh pid, same route dir/argv).
    const orphanArgs = h.spawnCalls[0]!.args;
    h.processes.set(recordedData.pid, {
      pid: recordedData.pid,
      exe: '/usr/bin/some-other-binary',
      argv: ['--unrelated'],
      uid: 1000,
      startTime: 99999,
      bootId: 'boot-1',
    });
    const orphanPid = 999;
    h.processes.set(orphanPid, {
      pid: orphanPid,
      exe: '/usr/bin/cloudflared',
      argv: orphanArgs,
      uid: 1000,
      startTime: 1,
      bootId: 'boot-1',
    });

    const tombstone = {
      ...(first.records[0] as TunnelDesiredRecord),
      desired: 'absent' as const,
    };
    const result = await reconcileQuick([tombstone], h.deps, '/home/.bakers', {
      checkpoint: async () => {},
    });

    expect(h.killed).toContain(orphanPid);
    expect(result.records).toHaveLength(0);
    expect(result.ok).toBe(true);
  });

  // BB-681 review N7: the route directory (hashed from worktree+ticket+
  // key) outlives `down` — `recorded` alone going back to `undefined` must
  // never cause a RE-UP to reuse the same `gen-N` directory/log a previous
  // life already wrote, or `waitForUrl` could read that dead generation's
  // stale URL as if it belonged to the new process.
  it('a route recreated after down always gets a fresh, never-before-used generation directory', async () => {
    const h = makeFakeDeps();
    const first = await reconcileQuick(
      [baseRecord()],
      h.deps,
      '/home/.bakers',
      {
        checkpoint: async () => {},
      },
    );
    const firstArgs = h.spawnCalls[0]!.args;
    const firstConfig = firstArgs[firstArgs.indexOf('--config') + 1];

    const tombstone = {
      ...(first.records[0] as TunnelDesiredRecord),
      desired: 'absent' as const,
    };
    await reconcileQuick([tombstone], h.deps, '/home/.bakers', {
      checkpoint: async () => {},
    });

    // Re-up from scratch: no recorded data at all, exactly as a fresh
    // `bakers ports up mailpit` after `down` sees it.
    const second = await reconcileQuick(
      [baseRecord()],
      h.deps,
      '/home/.bakers',
      {
        checkpoint: async () => {},
      },
    );
    const secondArgs = h.spawnCalls[1]!.args;
    const secondConfig = secondArgs[secondArgs.indexOf('--config') + 1];

    expect(secondConfig).not.toBe(firstConfig);
    expect(second.records[0]?.applied).toBe('applied');
    expect(second.records[0]?.url).not.toBe(first.records[0]?.url);
  });

  it('aborting mid-wait stops cleanly without killing the legitimately started process', async () => {
    const h = makeFakeDeps({ seedLogUrl: false, urlWaitMs: 10_000 });
    const controller = new AbortController();
    // Abort takes effect on the very first poll — the fake `sleep` resolves
    // immediately, so the loop re-checks `signal.aborted` right away.
    controller.abort();
    const result = await reconcileQuick(
      [baseRecord()],
      h.deps,
      '/home/.bakers',
      {
        signal: controller.signal,
        checkpoint: async () => {},
      },
    );
    expect(result.ok).toBe(false);
    expect(h.killed).toHaveLength(0);
    expect(h.spawnCalls).toHaveLength(1);
  });
});

describe('isOwnedArgv', () => {
  it("matches only argv carrying this route dir's --config path", () => {
    expect(
      isOwnedArgv(
        ['--config', '/home/.bakers/ports/quick/abc/gen-1/config.yaml'],
        '/home/.bakers/ports/quick/abc',
      ),
    ).toBe(true);
    expect(
      isOwnedArgv(
        ['--config', '/home/.bakers/ports/quick/other/gen-1/config.yaml'],
        '/home/.bakers/ports/quick/abc',
      ),
    ).toBe(false);
    expect(
      isOwnedArgv(['tunnel', 'run'], '/home/.bakers/ports/quick/abc'),
    ).toBe(false);
  });
});

void AmbiguousOwnershipError;
