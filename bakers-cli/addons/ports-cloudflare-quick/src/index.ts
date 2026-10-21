// BB-681 Task 4 — Quick Tunnel as a `PortsTransport`. See `quick.ts` for
// the pure reconcile logic; this file only wires real I/O (spawn, `/proc`,
// fs, clock) into `QuickDeps`, exactly as `addons/ports-cloudflare/src/
// index.ts` wires real `fetch` into `CloudflareDeps`.

import {
  execFile as execFileCallback,
  spawn as nodeSpawn,
} from 'node:child_process';
import {
  mkdir as fsMkdir,
  open as fsOpen,
  readdir as fsReaddir,
  readFile as fsReadFile,
  readlink as fsReadlink,
} from 'node:fs/promises';
import { promisify } from 'node:util';
import type { PortsTransport } from '@bakers-build/addon-ports/transport';
import {
  isOwnedArgv,
  type ManagedProcessIdentity,
  type QuickDeps,
  reconcileQuick,
} from './quick.js';

export {
  AmbiguousOwnershipError,
  buildArgs,
  configPathFor,
  generationFromConfigPath,
  identityEquals,
  isOwnedArgv,
  logPathFor,
  type ManagedProcessIdentity,
  originEquals,
  parseLiveUrl,
  type QuickDeps,
  type QuickOrigin,
  type QuickRouteData,
  reconcileQuick,
  routeDirFor,
  sanitizeEnv,
} from './quick.js';

const execFile = promisify(execFileCallback);
const EXEC_TIMEOUT_MS = 5_000;

/** The `@bakers-build/addon-ports` entry's `with.transport.with` for this transport — empty:
 *  `cloudflared` is always resolved from `PATH` (BB-681 review I6/over-
 *  engineering pass: no binary-path setting, per spec). */
function validateSettings(settings: unknown): void {
  if (settings === undefined || settings === null) return;
  if (typeof settings !== 'object' || Object.keys(settings).length > 0) {
    throw new Error(
      "the @bakers-build/addon-ports entry's with.transport.with for 'cloudflare-quick' must be empty — cloudflared is resolved from PATH",
    );
  }
}

const DATA_FIELDS = [
  'pid',
  'exe',
  'argv',
  'uid',
  'startTime',
  'bootId',
  'routeDir',
  'generation',
  'origin',
] as const;

/** Allowlisted provider state for this transport — thrown, never silently
 *  coerced, on anything outside this exact shape. */
function validateData(data: unknown): void {
  if (typeof data !== 'object' || data === null) {
    throw new Error('cloudflare-quick transport data must be an object');
  }
  const obj = data as Record<string, unknown>;
  const unknownKeys = Object.keys(obj).filter(
    (k) => !(DATA_FIELDS as readonly string[]).includes(k),
  );
  if (unknownKeys.length > 0) {
    throw new Error(
      `cloudflare-quick transport data has unknown field(s): ${unknownKeys.join(', ')}`,
    );
  }
}

async function readProcIdentity(
  pid: number,
): Promise<ManagedProcessIdentity | null> {
  try {
    const [exeLink, cmdlineRaw, statusRaw, statRaw] = await Promise.all([
      fsReadlink(`/proc/${pid}/exe`).catch(() => ''),
      fsReadFile(`/proc/${pid}/cmdline`, 'utf8'),
      fsReadFile(`/proc/${pid}/status`, 'utf8'),
      fsReadFile(`/proc/${pid}/stat`, 'utf8'),
    ]);
    const argv = cmdlineRaw.split('\0').filter((s) => s.length > 0);
    const uidMatch = /^Uid:\s+(\d+)/m.exec(statusRaw);
    const uid = uidMatch?.[1] ? Number(uidMatch[1]) : -1;
    const afterComm = statRaw.slice(statRaw.lastIndexOf(')') + 2);
    const startTime = Number(afterComm.split(' ')[19]);
    return {
      pid,
      exe: exeLink.replace(/ \(deleted\)$/, ''),
      argv,
      uid,
      startTime: Number.isFinite(startTime) ? startTime : -1,
      bootId: await readBootId(),
    };
  } catch {
    return null;
  }
}

let cachedBootId: string | null = null;
async function readBootId(): Promise<string> {
  if (cachedBootId) return cachedBootId;
  try {
    const stat = await fsReadFile('/proc/stat', 'utf8');
    const match = /^btime (\d+)/m.exec(stat);
    cachedBootId = match?.[1] ?? 'unknown';
  } catch {
    cachedBootId = 'unknown';
  }
  return cachedBootId;
}

async function listProcPids(): Promise<number[]> {
  const { readdir } = await import('node:fs/promises');
  try {
    const entries = await readdir('/proc');
    return entries
      .map((e) => Number(e))
      .filter((n) => Number.isInteger(n) && n > 0);
  } catch {
    return [];
  }
}

async function findCloudflaredBin(): Promise<string | null> {
  try {
    const { stdout } = await execFile('which', ['cloudflared'], {
      timeout: EXEC_TIMEOUT_MS,
    });
    const path = stdout.trim();
    return path || null;
  } catch {
    return null;
  }
}

/**
 * Real I/O deps for the Quick transport. `routeDir` scanning here walks
 * the WHOLE `/proc` table, which is fine at the process counts this addon
 * deals with (a handful of routes per machine) — a targeted index would be
 * the upgrade if that stops being true.
 * ponytail: full /proc scan per reconcile call, index by routeDir if this
 * ever needs to run against hundreds of routes.
 */
/** Exported for a real-process regression test (R4-M1/I2 ownership
 *  filtering); not part of the package's public contract. */
export function createNodeDeps(): QuickDeps {
  return {
    spawn(bin, args, opts) {
      const child = nodeSpawn(bin, args as string[], {
        cwd: opts.cwd,
        env: opts.env,
        detached: true,
        stdio: 'ignore',
      });
      child.unref();
      return { pid: child.pid ?? -1 };
    },
    findBinary: findCloudflaredBin,
    now: () => Date.now(),
    sleep: (ms, signal) =>
      new Promise((resolve) => {
        if (signal?.aborted) return resolve();
        const timer = setTimeout(resolve, ms);
        signal?.addEventListener(
          'abort',
          () => {
            clearTimeout(timer);
            resolve();
          },
          { once: true },
        );
      }),
    readFile: async (path) => {
      try {
        // ponytail: reads the whole file each poll; bound by rotating per
        // generation (never unbounded growth across restarts). A tail-only
        // reader is the upgrade if a single generation's log gets huge.
        return await fsReadFile(path, 'utf8');
      } catch {
        return null;
      }
    },
    writeFile: async (path, data) => {
      const fh = await fsOpen(path, 'w');
      try {
        await fh.writeFile(data);
      } finally {
        await fh.close();
      }
    },
    mkdir: async (path) => {
      await fsMkdir(path, { recursive: true });
    },
    listOwnedProcesses: async (dir) => {
      const pids = await listProcPids();
      const owned: ManagedProcessIdentity[] = [];
      const ownUid = process.getuid?.();
      for (const pid of pids) {
        const identity = await readProcIdentity(pid);
        if (!identity || !isOwnedArgv(identity.argv, dir)) continue;
        // BB-681 review R4 (I2 remainder): the `--config <dir>/…` argv
        // marker alone is a string any process could set — spoofable by
        // design, never sufficient to adopt or kill something. Require it
        // ALSO be a `cloudflared` executable run under our own uid before
        // trusting it as a candidate; otherwise a lookalike process (wrong
        // user, or not cloudflared at all) could be adopted as ours or,
        // worse, killed as a mismatched orphan.
        if (ownUid !== undefined && identity.uid !== ownUid) continue;
        if (!identity.exe.toLowerCase().includes('cloudflared')) continue;
        owned.push(identity);
      }
      return owned;
    },
    listGenerations: async (dir) => {
      try {
        const entries = await fsReaddir(dir, { withFileTypes: true });
        return entries
          .filter((e) => e.isDirectory())
          .map((e) => /^gen-(\d+)$/.exec(e.name)?.[1])
          .filter((n): n is string => n !== undefined)
          .map(Number);
      } catch {
        return [];
      }
    },
    getProcessIdentity: (pid) => readProcIdentity(pid),
    kill: (pid) => {
      try {
        process.kill(pid, 'SIGTERM');
      } catch {
        // already gone
      }
    },
    waitExit: async (pid, timeoutMs, signal) => {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        if (signal?.aborted) return false;
        const identity = await readProcIdentity(pid);
        if (!identity) return true;
        if (Date.now() >= deadline) return false;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    },
    bootId: readBootId,
    env: process.env,
    urlWaitMs: 15_000,
    pollMs: 250,
    killWaitMs: 5_000,
  };
}

/**
 * Default export factory consumed by `@bakers-build/addon-ports`'s
 * `loadPortsTransport`. No `zone` — Quick has no fixed `<ticket>-<key>.
 * <zone>` naming, unlike Named Cloudflare/frp.
 */
export default async function createTransport(
  settings: unknown,
  context: { readonly home: string },
): Promise<PortsTransport> {
  validateSettings(settings);
  const deps = createNodeDeps();
  const home = context.home;
  return {
    id: 'cloudflare-quick',
    identity: 'cloudflare-quick',
    validateData,
    reconcile: (records, { signal, checkpoint }) =>
      reconcileQuick(records, deps, home, { signal, checkpoint }),
  };
}
