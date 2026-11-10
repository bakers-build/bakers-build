// The foreground conductor restarts itself when a file it loaded changes:
// its config files, the machine config, or a configured addon's build. This
// module only watches, debounces and serializes; the caller decides whether a
// change becomes a restart (config check, drain, execve).

import { type FSWatcher, watch } from 'node:fs';
import { basename, dirname, join } from 'node:path';

/** What the running conductor loaded: single files and addon build dirs. */
export interface WatchPaths {
  files: string[];
  dirs: string[];
}

/**
 * Call `trigger` with the last changed path after `debounceMs` without a
 * further change. Files are watched through their parent directory, so an
 * editor's rename-replace save and a newly created file both count; dirs are
 * watched recursively. At most one trigger runs at a time; changes during one
 * re-arm the debounce once it returns.
 */
export function watchForRestart(
  paths: WatchPaths,
  trigger: (path: string) => Promise<void>,
  debounceMs = 2000,
): { close(): void } {
  const watchers: FSWatcher[] = [];
  let timer: NodeJS.Timeout | undefined;
  let last: string | undefined;
  let running = false;
  let pending = false;
  let closed = false;

  const fire = async (): Promise<void> => {
    timer = undefined;
    running = true;
    try {
      await trigger(last as string);
    } finally {
      running = false;
      if (pending && !closed) {
        pending = false;
        arm();
      }
    }
  };
  const arm = () => {
    clearTimeout(timer);
    timer = setTimeout(() => void fire(), debounceMs);
  };
  const changed = (path: string) => {
    if (closed) return;
    last = path;
    if (running) pending = true;
    else arm();
  };
  const tryWatch = (
    dir: string,
    recursive: boolean,
    on: (f: string) => void,
  ) => {
    try {
      watchers.push(
        watch(dir, { recursive, persistent: false }, (_e, f) => {
          if (f) on(f.toString());
        }),
      );
    } catch {
      // A missing directory (no machine config yet, unbuilt addon) is not watched.
    }
  };

  const byDir = new Map<string, Set<string>>();
  for (const file of paths.files) {
    const names = byDir.get(dirname(file)) ?? new Set<string>();
    names.add(basename(file));
    byDir.set(dirname(file), names);
  }
  for (const [dir, names] of byDir)
    tryWatch(dir, false, (f) => {
      if (names.has(f)) changed(join(dir, f));
    });
  for (const dir of new Set(paths.dirs))
    tryWatch(dir, true, (f) => changed(join(dir, f)));

  return {
    close() {
      closed = true;
      clearTimeout(timer);
      for (const w of watchers) w.close();
    },
  };
}
