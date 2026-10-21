import { rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterEach } from 'vitest';

const leftoverDirs = new Set<string>();

afterEach(() => {
  for (const dir of leftoverDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  leftoverDirs.clear();
});

/** Skip the post-`started` exit window when a test plants `started`. */
export const INSTANT_WATCH = { timeoutMs: 0, pollMs: 1 } as const;

/**
 * Test fake: pretend the launch wrapper started (agent still running).
 * Pair with {@link INSTANT_WATCH} so watchLaunch does not wait out the
 * production exit window after the planted marker.
 */
export function plantStarted(args: string[]): void {
  if (args[0] !== 'pane' || args[1] !== 'run') return;
  const typed = args[3] ?? '';
  if (!typed.startsWith("sh '") || !typed.endsWith("'")) return;
  const dir = dirname(typed.slice(4, -1));
  leftoverDirs.add(dir);
  try {
    writeFileSync(join(dir, 'started'), 'started');
  } catch {
    // no launch dir (not a scripted pane run)
  }
}
