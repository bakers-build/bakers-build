import { spawn as nodeSpawn } from 'node:child_process';
import {
  machineContextPath,
  readMachineContext,
  type SignalOutcome,
  signalVerifiedProcess,
} from '@bakers-build/core';
import type { DropshClient } from '../../../types.js';
import { fetchConductorLastSeen } from './conductors.js';

/** What a cockpit action reports back to its row. */
export interface ConductorActionResult {
  ok: boolean;
  message: string;
}

/** A detached child launch, injected so tests spawn nothing. */
export interface SpawnRequest {
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string | undefined>;
}

/**
 * The platform seams the cockpit's conductor actions stand on.
 *
 * `spawn` settles when the child has really been forked, or rejects when it
 * could not be. It is not `void`, because the failure that actually happens —
 * `ENOENT`, `EACCES` — arrives on an `'error'` EVENT a tick after the call
 * returns, and a caller with nothing to await can neither report it nor even
 * survive it (BB-232 review finding F2).
 */
export interface ConductorProcessDeps {
  spawn?: (request: SpawnRequest) => void | Promise<void>;
  signal?: (input: {
    pid: number | undefined;
    hostKey: string | undefined;
    thisHostKey: string;
    signal: NodeJS.Signals;
  }) => SignalOutcome;
  /**
   * This machine's own host_key (MachineContext.machine_id), read once per
   * stop. Injected for tests; defaults to the real `~/.bakers/machine.config.js`
   * (BB-450 D1 — `signalVerifiedProcess` refuses a `host_key` mismatch, so a
   * stop needs this machine's own value to compare against).
   */
  thisHostKey?: () => Promise<string>;
  /**
   * BB-477 AC-5: how `start` learns whether the spawn actually came online,
   * injected so tests need no timers or network. Defaults to
   * {@link fetchConductorLastSeen} against the real control plane.
   */
  fetchLastSeen?: (
    client: DropshClient,
    id: string,
  ) => Promise<number | undefined>;
  sleep?: (ms: number) => Promise<void>;
  /** Bounded poll budget; small defaults so a real failure resolves quickly. */
  heartbeatPollAttempts?: number;
  heartbeatPollIntervalMs?: number;
}

export interface ConductorProcessHost {
  start(input: {
    workspaceRoot: string;
    conductorName: string | undefined;
    /** The row's `host_key` (BB-450 review B5) — verified against this
     *  machine's own before anything is spawned. */
    hostKey: string | undefined;
    /**
     * BB-477 AC-5: the conductor's own record id and its `last_seen`
     * captured before the spawn, and the client to poll with. Present only
     * when the caller can observe the outcome — absent, `start` reports the
     * spawn as before and never claims to have seen it come online.
     */
    id?: string | undefined;
    priorLastSeen?: number | undefined;
    client?: DropshClient | undefined;
  }): Promise<ConductorActionResult>;
  stop(input: {
    pid: number | undefined;
    hostKey: string | undefined;
  }): Promise<ConductorActionResult>;
  /**
   * THIS machine's own `host_key` (BB-450 B10) — the same value `start`/
   * `stop` already verify against, exposed so the Conductors screens can key
   * their `mine` row projection and their `actions()` gate on the identical
   * seam rather than resolving it a second, divergent way.
   */
  thisHostKey(): Promise<string>;
}

/**
 * This machine's host_key, from the same MachineContext the CLI reads.
 *
 * Exported so the Conductors screens (BB-450 B10) can key their view-only
 * marking and their `actions()` gate on IDENTITY — this row's `host_key`
 * against this machine's own — rather than on `isLocal`'s filesystem check,
 * which two machines whose checkouts share a path can both satisfy.
 */
export async function defaultThisHostKey(): Promise<string> {
  const ctx = await readMachineContext(machineContextPath());
  return ctx.machine_id ?? '';
}

/**
 * Start and stop a conductor from the cockpit.
 *
 * Start runs the same `bakers oven start` a human runs, in the conductor's
 * own workspace — rather than reimplementing the lifecycle in the TUI process.
 * How that command backgrounds itself (herdr, or a bare foreground child) is
 * not this screen's business, and keeping one implementation means the cockpit
 * cannot drift from the command line.
 *
 * Stop is a verified signal, never a spawn: the process already exists, and
 * asking a child to find it would only add a way to get it wrong.
 */
export function createConductorProcessHost(
  deps: ConductorProcessDeps = {},
): ConductorProcessHost {
  const spawn = deps.spawn ?? defaultSpawn;
  const signal = deps.signal ?? signalVerifiedProcess;
  const thisHostKey = deps.thisHostKey ?? defaultThisHostKey;
  const fetchLastSeen = deps.fetchLastSeen ?? fetchConductorLastSeen;
  const sleep =
    deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const heartbeatPollAttempts = deps.heartbeatPollAttempts ?? 5;
  const heartbeatPollIntervalMs = deps.heartbeatPollIntervalMs ?? 1000;

  return {
    thisHostKey,
    async start({
      workspaceRoot,
      conductorName,
      hostKey,
      id,
      priorLastSeen,
      client,
    }) {
      // BB-450 review B5: the only gate this used to have was `isLocal` — a
      // filesystem check on `workspaceRoot`, which answers "does this path
      // exist on THIS disk", not "is this THIS machine's conductor". Two
      // machines whose checkouts share a path (the ordinary case for one
      // operator with several) make that a false positive: pressing `s` on a
      // ROW naming another machine's conductor silently started this
      // machine's OWN one instead, composed from `workspaceRoot` alone with no
      // identity at all. `stop` never had this hole — it already runs through
      // `signalVerifiedProcess`'s `host_key` check downstream — so `start`
      // gets the same verification here, the one place both actions now share.
      const expected = await thisHostKey();
      if (!hostKey || hostKey !== expected) {
        return {
          ok: false,
          message: `conductor's host_key (${hostKey ?? '(none)'}) is not this machine's (${expected}) — refusing to start a conductor on another host`,
        };
      }
      try {
        // Awaited, so "starting …" is claimed only once the fork has really
        // happened — and so an `'error'` event becomes a reported failure
        // instead of an unhandled one.
        await spawn({
          command: 'bakers',
          args: ['oven', 'start'],
          cwd: workspaceRoot,
          env: {
            ...process.env,
            // Target by NAME and let core resolve it — the stem→file mapping
            // has exactly one owner, and it is not this screen.
            ...(conductorName ? { BB_CONDUCTOR: conductorName } : {}),
            // Cleared, not merely unset: an inherited value beats
            // $BB_CONDUCTOR in core's resolution, so a shell that exported it
            // would make this button start a DIFFERENT conductor — silently,
            // since both are valid configs and neither errors.
            BB_CONDUCTOR_CONFIG: '',
          },
        });
        // BB-477 AC-5: `spawn` settling only proves the fork happened, not
        // that a foreground conductor is running under it — the herdr pane
        // boundary this ticket's other fix crosses can still leave a row
        // silently offline. Watch for a genuinely NEW heartbeat (never the
        // stale one already on the row) over a bounded budget before telling
        // the operator this succeeded, the same distinction the CLI's own
        // `waitForFreshHeartbeat` makes.
        if (id && client) {
          for (let attempt = 0; attempt < heartbeatPollAttempts; attempt += 1) {
            await sleep(heartbeatPollIntervalMs);
            const lastSeen = await fetchLastSeen(client, id);
            if (
              lastSeen !== undefined &&
              (priorLastSeen === undefined || lastSeen > priorLastSeen)
            ) {
              return {
                ok: true,
                message: `starting ${conductorName ?? 'conductor'} in ${workspaceRoot}`,
              };
            }
          }
          return {
            ok: false,
            message: `${conductorName ?? 'conductor'} did not come online — spawned in ${workspaceRoot} but no fresh heartbeat arrived`,
          };
        }
        return {
          ok: true,
          message: `starting ${conductorName ?? 'conductor'} in ${workspaceRoot}`,
        };
      } catch (err) {
        return {
          ok: false,
          message: `could not start: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    },

    async stop({ pid, hostKey }) {
      const outcome = signal({
        pid,
        hostKey,
        thisHostKey: await thisHostKey(),
        signal: 'SIGTERM',
      });
      return outcome.ok
        ? {
            ok: true,
            message: `stopped pid ${outcome.pid}; it writes its own offline as it exits`,
          }
        : { ok: false, message: outcome.message };
    },
  };
}

/**
 * The real launch: detached and fully disowned.
 *
 * `bakers ui` must not become the conductor's parent — the operator quits the
 * cockpit far more often than they stop a conductor, and a child tied to this
 * process would die with it. The streams are ignored for the same reason a
 * separate logger exists: anything the child printed would land on the TUI's
 * frame.
 *
 * The `'error'` listener is not defensive tidiness, it is the whole point
 * (BB-232 review finding F2). `child_process.spawn` does not throw on a
 * missing or unexecutable binary: it returns a child object and emits `'error'`
 * asynchronously. An EventEmitter with no `'error'` listener THROWS that event,
 * out of a tick nobody is in — so `bakers` missing from the TUI's `PATH`, or a
 * `workspaceRoot` deleted since the last 5 s read, took the whole cockpit down.
 *
 * Node guarantees exactly one of `'spawn'` / `'error'`, so the promise always
 * settles. The listener deliberately stays attached afterwards: a post-spawn
 * `'error'` on a settled promise is a harmless no-op, and removing it would
 * restore the crash for the rarer case.
 *
 * Exported so the real child is covered by a test — with a binary that cannot
 * exist, so the suite never starts a conductor.
 */
export function defaultSpawn(request: SpawnRequest): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const child = nodeSpawn(request.command, request.args, {
      cwd: request.cwd,
      env: request.env,
      detached: true,
      stdio: 'ignore',
    });
    child.on('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}
