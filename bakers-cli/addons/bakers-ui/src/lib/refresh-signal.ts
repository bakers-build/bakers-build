import { statSync, watch } from 'node:fs';
import { join } from 'node:path';
import type { Debounce, WatchDirectory } from '../types.js';

/**
 * BB-376 — "the data behind this cockpit may be stale", as a file.
 *
 * The whole writer contract is `touch .bakers/ui-refresh`: one line, identical
 * from a shell, an agent, a git hook, or inside a project's web container — which
 * is the reason it is a file and not a signal to a pid. A signal does not cross
 * a container boundary, so a `drush` post-write hook could never reach a cockpit
 * on the host, while a file on the bind mount reaches both. A pid file would
 * also have a lifecycle to go wrong (a stale one eventually names a recycled
 * process) and would need reaping for a second cockpit in the same worktree.
 *
 * OFF IS ABSENT, not merely cheap: with no `.bakers` dir to watch — a cockpit
 * outside any project — this returns `undefined` and every call site is an
 * optional chain, exactly as `lib/input-trace.ts` is off without its env var.
 * The same is true of failure: an unwatchable directory switches the feature
 * off, because a convenience that can fell the cockpit is worse than no
 * convenience.
 */
export interface RefreshSignal {
  /** Stop watching and drop a pending reload. Called from the kernel's `finish()`. */
  close(): void;
}

/** The signal file's basename inside the watched `.bakers` dir. */
export const REFRESH_SIGNAL_FILE = 'ui-refresh';

/**
 * The coalescing window. Long enough that the several events one `touch`
 * produces are one reload, short enough that an operator reads it as immediate.
 */
export const REFRESH_DEBOUNCE_MS = 300;

/**
 * The signal file's identity as ONE comparable value: its mtime, or `null` when
 * the file is not there. The content is deliberately not read — that is what
 * keeps `touch` the whole writer contract.
 */
export type ReadToken = (path: string) => number | null;

export interface RefreshSignalDeps {
  /** The `.bakers` dir to watch — the kernel's `options.bakersDir`. Absent ⇒ off. */
  dir: string | undefined;
  /** Run the reload. Called at most once per window, and only on a real change. */
  onSignal: () => void;
  /**
   * Cancel-then-arm debounce. PASSED IN, not imported: `timerDebounce` lives in
   * `Widget/`, and `tests/boundary.test.ts` G6 keeps `lib/` below that layer.
   * The kernel resolves `options.debounce ?? timerDebounce`, which is the same
   * seam four form screens already read through.
   */
  debounce: Debounce;
  /** Default: `node:fs` `watch` on the directory. */
  watchDirectory?: WatchDirectory | undefined;
  /** Default: {@link statSync}'s `mtimeMs`, `null` on any error. */
  readToken?: ReadToken | undefined;
  /** Default: {@link REFRESH_DEBOUNCE_MS}. */
  debounceMs?: number | undefined;
}

/**
 * THE DIRECTORY, not the file (spec D2). An inode-bound watch does not survive
 * the write-temp-then-rename a careful writer performs, and it cannot be
 * established at all before the first `touch` creates the file. The directory is
 * guaranteed to exist — it is how `bakersDir` was found.
 *
 * `persistent: false` so the watcher never becomes the reason the process stays
 * alive; the kernel's own `done` promise owns that.
 */
const nodeWatchDirectory: WatchDirectory = (dir, onEvent) => {
  const watcher = watch(dir, { persistent: false }, (_event, filename) =>
    onEvent(typeof filename === 'string' ? filename : null),
  );
  // An EPERM or a vanished directory arrives as an event, not as a throw from
  // the constructor. Unhandled it is an uncaught error event on the process.
  watcher.on('error', () => watcher.close());
  return { close: () => watcher.close() };
};

const statToken: ReadToken = (path) => {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return null;
  }
};

export function createRefreshSignal(
  deps: RefreshSignalDeps,
): RefreshSignal | undefined {
  if (deps.dir === undefined || deps.dir === '') return undefined;

  const watchDirectory = deps.watchDirectory ?? nodeWatchDirectory;
  const readToken = deps.readToken ?? statToken;
  const windowMs = deps.debounceMs ?? REFRESH_DEBOUNCE_MS;
  const path = join(deps.dir, REFRESH_SIGNAL_FILE);

  // THE BASELINE. Whatever the file says at boot is not news: the cockpit has
  // just read its data, and a signal left over from a previous session must not
  // produce a reload on the first frame.
  let token = readToken(path);
  let cancel: (() => void) | undefined;

  let watcher: { close(): void };
  try {
    watcher = watchDirectory(deps.dir, (filename) => {
      if (filename !== REFRESH_SIGNAL_FILE) return;
      // Cancel-then-arm IS the debounce, and its behaviour under a CONTINUOUS
      // stream is deliberate: bumps closer together than one window never fire,
      // so an agent writing in a loop cannot storm the control plane, and
      // freshness returns the moment the stream pauses.
      cancel?.();
      cancel = deps.debounce(() => {
        cancel = undefined;
        // ONE stat per window, after the coalescing — `fs.watch` reports
        // several events per `touch`, and this is what makes them one read.
        const next = readToken(path);
        if (next === token) return;
        token = next;
        deps.onSignal();
      }, windowMs);
    });
  } catch {
    // A watch limit reached, a directory that disappeared between the walk-up
    // and here: the feature is off, the cockpit is not.
    return undefined;
  }

  return {
    close() {
      cancel?.();
      cancel = undefined;
      try {
        watcher.close();
      } catch {
        // Already gone. Teardown must not throw on the way out.
      }
    },
  };
}
