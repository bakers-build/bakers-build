// BB-475 — the real seams behind discovery and transport, for the CLI.
//
// The I/O edge of the package: the `defaultSpawn` half of the conductor-host
// pattern. Everything here is substituted in tests; nothing here is unit-tested,
// exactly as `createConductorProcessHost`'s defaults are not — the seams exist so
// the LOGIC above them can be. `reap` and `discoverHostPorts` above carry the
// behaviour; this file only wires them to `child_process` and `/proc`.

import { execFile as execFileCallback } from 'node:child_process';
import { readFile, readlink, stat } from 'node:fs/promises';
import { promisify } from 'node:util';
import type { HttpProbe } from './claims.js';
import type { HostDiscoveryDeps } from './discovery.js';
import { nodeLockDeps } from './lock.js';
import { readTunnelState, type StateDeps } from './state.js';
import { nodeTunnelStateDeps } from './tunnel-state.js';

// `execFile`, never `exec`: no shell, so a value that ends up in an argument —
// notably a tunnel `target` derived from a DISCOVERED service address — cannot
// be interpreted as a shell metacharacter. The argv array is the whole point.
const execFile = promisify(execFileCallback);

// G: a paused/hung container must not hang `list`/`reap` (which holds the
// machine lock) forever — `docker exec`/`inspect`/`ps` all get a bounded
// deadline; a timeout is reported as a failed probe (surfaced as a
// diagnostic upstream), never left to hang.
const EXEC_TIMEOUT_MS = 5_000;

/** The filesystem seams for the state file. */
export const nodeStateDeps: StateDeps = {
  readFile: async (path) => {
    try {
      return await readFile(path, 'utf8');
    } catch {
      return null;
    }
  },
};

/** The discovery seams: `ss` and `/proc/<pid>`. */
export const nodeDiscoveryDeps: HostDiscoveryDeps = {
  run: async (cmd, args, cwd) => {
    try {
      const { stdout } = await execFile(cmd, args, {
        maxBuffer: 8 * 1024 * 1024,
        timeout: EXEC_TIMEOUT_MS,
        ...(cwd ? { cwd } : {}),
      });
      return { stdout, ok: true };
    } catch (err) {
      // A non-zero exit still carries stdout for a command like `docker inspect`
      // outside a project; hand it back so the parser can decide. `code` is
      // the numeric exit code when the process actually ran (e.g. 127 =
      // command not found inside the container); a spawn-level failure
      // carries a string errno instead, so only a number is surfaced.
      // `stderr` is also threaded through (BB-681 review I3): without it,
      // `isPermissionDenied126` can never fire against a REAL `docker exec`,
      // so every exit 126 reads as a missing binary even when the container
      // actually refused for a permission reason.
      const withOut = err as {
        stdout?: string;
        stderr?: string;
        code?: unknown;
      };
      const exitCode =
        typeof withOut.code === 'number' ? withOut.code : undefined;
      return {
        stdout: withOut.stdout ?? '',
        ok: false,
        ...(exitCode !== undefined ? { exitCode } : {}),
        ...(withOut.stderr ? { stderr: withOut.stderr } : {}),
      };
    }
  },
  processInfo: async (pid) => {
    try {
      const link = await readlink(`/proc/${pid}/cwd`);
      // The kernel appends ` (deleted)` to the symlink TARGET when the working
      // directory has been removed — the orphan signal (spec C3). `stat` on the
      // magic link resolves the CURRENT directory, so it throws ENOENT for a
      // reaped worktree; the two agree, and the stat is the reliable one.
      const cmdlineRaw = await readFile(`/proc/${pid}/cmdline`, 'utf8').catch(
        () => '',
      );
      const cmdline = cmdlineRaw.replace(/\0/g, ' ').trim();
      const deleted =
        link.endsWith(' (deleted)') ||
        !(await stat(`/proc/${pid}/cwd`)
          .then(() => true)
          .catch(() => false));
      return {
        path: link.replace(/ \(deleted\)$/, ''),
        deleted,
        cmdline,
      };
    } catch {
      return null;
    }
  },
};

/**
 * AC6 — `/proc/<pid>/stat`'s 22nd field (start time, in clock ticks since
 * boot): a stronger PID-reuse guard than cmdline/deleted-cwd alone, which
 * could coincidentally match a reused pid running a similar-looking process.
 * Pure and exported so the field-counting (the 2nd field is `(comm)`, which
 * may itself contain spaces/parens) is directly testable without `/proc`.
 */
export function parseProcStatStartTime(stat: string): number | null {
  const afterComm = stat.slice(stat.lastIndexOf(')') + 2);
  const fields = afterComm.split(' ');
  // Field 3 is state (already consumed above as field 2's successor is index
  // 0 here); starttime is the 22nd field overall, i.e. index 19 of this
  // remainder (22 - 3 = 19, since fields 1-2 are `pid`/`comm`).
  const startTime = Number(fields[19]);
  return Number.isFinite(startTime) ? startTime : null;
}

/** `null` when the process is gone or the field cannot be parsed — no
 *  process to compare a start time against either way. */
export async function processStartTime(pid: number): Promise<number | null> {
  try {
    return parseProcStatStartTime(await readFile(`/proc/${pid}/stat`, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * BB-681 Task 4 — a process whose cmdline carries ANY pluggable-transport
 * package's own ownership marker: `addon-ports-cloudflare-quick`'s private
 * per-route `--config <BAKERS_HOME>/ports/quick/<hash>/gen-<n>/config.yaml`,
 * or a Named Cloudflare connector's `tunnel run` invocation. This generic
 * legacy-reap scan predates per-route managed processes (BB-676) and its
 * only signal for "legacy" is `cmdline.includes('--url')` (see
 * `index.ts`'s reap handler) — which the new Quick package's OWN managed
 * processes also match, since they use the same `--url` flag. Without this
 * guard, generic reap would treat every quick-tunnel package process as an
 * orphan it's free to kill; the quick package owns its OWN revalidated
 * reap (`reconcileQuick`'s `desired: 'absent'` path) and this generic scan
 * must never duplicate or race it.
 */
export function isPluggableTransportManaged(cmdline: string): boolean {
  if (/\/ports\/quick\//.test(cmdline)) return true; // addon-ports-cloudflare-quick
  if (/\btunnel\s+run\b/.test(cmdline)) return true; // Named Cloudflare connector
  return false;
}

/**
 * BB-676 Task 4 — scans the process table for `cloudflared`, keeping
 * `cmdline` so a caller can tell a legacy `tunnel --url …` quick-tunnel
 * (reap's cleanup target) apart from the machine's named `tunnel run`
 * connector, which reap must never touch (plan review focus 4). BB-681
 * Task 4: also excludes anything `isPluggableTransportManaged` recognizes —
 * a pluggable transport's own managed process, never generic reap's to kill.
 */
export async function listCloudflaredProcesses(): Promise<
  {
    pid: number;
    cwd: string;
    deleted: boolean;
    cmdline: string;
    startTime: number | null;
  }[]
> {
  const { stdout } = await execFile('ps', ['-eo', 'pid,comm'], {
    timeout: EXEC_TIMEOUT_MS,
  }).catch(() => ({
    stdout: '',
  }));
  const processes: {
    pid: number;
    cwd: string;
    deleted: boolean;
    cmdline: string;
    startTime: number | null;
  }[] = [];
  for (const line of stdout.split('\n')) {
    if (!/cloudflared/.test(line)) continue;
    const pid = Number(line.trim().split(/\s+/)[0]);
    if (!Number.isInteger(pid) || pid <= 0) continue;
    const info = await nodeDiscoveryDeps.processInfo(pid);
    if (info && !isPluggableTransportManaged(info.cmdline))
      processes.push({
        pid,
        cwd: info.path,
        deleted: info.deleted,
        cmdline: info.cmdline,
        startTime: await processStartTime(pid),
      });
  }
  return processes;
}

/**
 * AC6 — read a worktree's OLD pre-BB-676 per-port quick-tunnel state
 * (`.bakers/ports-tunnels.json`, written by the `transport.ts`/`state.ts` path
 * this feature replaced) purely as migration evidence: a legacy-process
 * candidate whose pid appears here is additional corroboration reap may use,
 * never a replacement for the existing argv/owner/cwd checks. Never written
 * or removed by this addon. Absent or malformed reads as "no evidence", not
 * an error — a half-written or already-cleaned-up legacy file must not block
 * reap.
 */
export async function readLegacyTunnelPids(
  worktree: string,
): Promise<ReadonlySet<number>> {
  const state = await readTunnelState(worktree, nodeStateDeps);
  return new Set(state.tunnels.map((t) => t.pid));
}

/**
 * Is `pid` owned by this process's own user? Legacy reap must never kill
 * another user's process (plan review focus 4) — even an own-user match is
 * re-validated by the caller against fresh `processInfo` immediately before
 * `SIGTERM`, to close the PID-reuse race between listing and killing.
 */
export async function isOwnedByCurrentUser(pid: number): Promise<boolean> {
  try {
    const status = await readFile(`/proc/${pid}/status`, 'utf8');
    const match = /^Uid:\s+(\d+)/m.exec(status);
    return (
      match !== undefined &&
      match !== null &&
      Number(match[1]) === process.getuid?.()
    );
  } catch {
    return false;
  }
}

/** BB-676 Task 4 — a bounded, non-redirecting Storybook probe over real `fetch`. */
export const nodeHttpProbe: HttpProbe = async (url, opts) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'manual',
    });
    if (
      res.type === 'opaqueredirect' ||
      (res.status >= 300 && res.status < 400)
    )
      return null;
    const body = await res.text();
    return { ok: res.ok, status: res.status, body };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
};

/** Everything a command needs, bundled. */
export const nodeDeps = {
  ...nodeStateDeps,
  ...nodeDiscoveryDeps,
};

/** BB-681 Task 2 — everything `bringUpTunnel`/`takeDownTunnel`/`reapTunnels`
 *  need: state + lock I/O only. Provider I/O (e.g. Cloudflare's REST API)
 *  lives inside the configured transport package instead. */
export const nodeTunnelOpsDeps = {
  ...nodeTunnelStateDeps,
  ...nodeLockDeps,
};
