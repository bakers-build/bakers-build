// BB-676 spec v2 — host-listener discovery only. Container discovery belongs
// to the configured claimer packages (`bakers ports` must not fire `docker`
// itself). This file does exactly one thing: `ss -ltnpH` plus `/proc/<pid>` —
// no external binary beyond `ss`, no root.
//
// The parsers are pure and exported so a test drives them with captured
// output; the orchestrator takes an injected `run`/`processInfo` so no real
// socket is ever read in a test.

import {
  parseSocketListeners,
  type SocketListener,
} from '@bakers-build/addon-docker-compose';
import type { RawDiagnostic, RawDiscovery, RawPort } from './types.js';

// `@bakers-build/addon-docker-compose` is the one home of the `ss` parser.
export { parseSocketListeners, type SocketListener };

/** The injected seams for host-listener discovery. */
export interface HostDiscoveryDeps {
  /** Run a command, capturing stdout; `ok` is false when it could not run. */
  run(
    cmd: string,
    args: string[],
    cwd?: string,
  ): Promise<{ stdout: string; ok: boolean }>;
  /**
   * A process's working directory and command line — `/proc/<pid>/cwd` and
   * `/proc/<pid>/cmdline`. `deleted` is the `(deleted)` suffix `readlink`
   * reports when the directory is gone (the orphan signal), and `cmdline` is
   * what names the service: the socket table gives only `node`, and `node` is
   * Storybook, Vite and a dozen other things.
   */
  processInfo(
    pid: number,
  ): Promise<{ path: string; deleted: boolean; cmdline: string } | null>;
}

/** Is `path` inside `worktree` (or the worktree itself)? */
function underWorktree(path: string, worktree: string): boolean {
  const root = worktree.replace(/\/+$/, '');
  return path === root || path.startsWith(`${root}/`);
}

/**
 * Discover this worktree's host listeners (AC1): `ss -ltnpH`, dedupe PIDs
 * before reading `/proc` (one read per pid), match owner against the
 * worktree. `list` calls only this — no Docker, no Cloudflare, no mutation.
 */
export async function discoverHostPorts(
  worktree: string,
  deps: HostDiscoveryDeps,
): Promise<RawDiscovery> {
  const diagnostics: RawDiagnostic[] = [];
  const ports: RawPort[] = [];

  // C3: a listener is only THIS worktree's observation when its owning
  // process's cwd resolves under it. A foreign worktree's listener (another
  // ticket, the main checkout) is not included at all — not even as an
  // orphan, because it was never ours. A pid-less row (no permission to see
  // the owner) cannot be attributed to any worktree, so it is also excluded
  // here, with a diagnostic recording that evidence was incomplete.
  // macOS compatibility: `ss`/`/proc` are Linux-only (ticket scope: "Linux
  // discovery") — there is no BSD/macOS equivalent attempted here (lsof/
  // netstat parity is out of scope). Rather than let a raw `ENOENT` surface
  // as "ss -ltnpH failed" with no further context, name the real cause when
  // we know it, so this reads as an honest platform limitation rather than a
  // mysterious probe failure. Container-routed services are unaffected —
  // the Linux VM behind Docker Desktop still answers these probes fine
  // in-container; only THIS host-process scan is skipped.
  const host = await deps.run('ss', ['-ltnpH']);
  if (!host.ok) {
    diagnostics.push({
      source: 'host',
      wholePass: true,
      message:
        process.platform !== 'linux'
          ? `host-process discovery requires Linux (\`ss\`/\`/proc\`), not available on ${process.platform}; container-routed services are still discoverable`
          : '`ss -ltnpH` failed',
    });
    return { ports, diagnostics };
  }

  const listeners = parseSocketListeners(host.stdout);
  const pids = [
    ...new Set(
      listeners
        .map((l) => l.pid)
        .filter((pid): pid is number => pid !== undefined),
    ),
  ];
  const infoByPid = new Map<
    number,
    { path: string; deleted: boolean; cmdline: string } | null
  >();
  await Promise.all(
    pids.map(async (pid) => infoByPid.set(pid, await deps.processInfo(pid))),
  );
  for (const listener of listeners) {
    if (listener.pid === undefined) {
      diagnostics.push({
        source: 'host',
        message: `listening port ${listener.port} has no visible owner (permission?); evidence incomplete`,
      });
      continue;
    }
    const info = infoByPid.get(listener.pid) ?? null;
    // cloudflared is the transport, never a service to tunnel (BB-500).
    if (info?.cmdline.toLowerCase().includes('cloudflared')) continue;
    if (!info) {
      diagnostics.push({
        source: 'host',
        message: `pid ${listener.pid} on port ${listener.port} vanished before its cwd could be read`,
      });
      continue;
    }
    // A deleted cwd under this worktree is a genuine orphan (kept, no rule);
    // a deleted or live cwd under a DIFFERENT worktree is simply not this
    // worktree's listener.
    if (!underWorktree(info.path, worktree)) continue;
    ports.push({
      worktree,
      hostAddress: listener.address,
      hostPort: listener.port,
      pid: listener.pid,
      cmdline: info.cmdline,
      cwd: info.path,
      cwdDeleted: info.deleted,
      listening: true,
      exposed: 'unknown',
    });
  }

  return { ports, diagnostics };
}
