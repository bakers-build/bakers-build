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
export const INSTANT_WATCH = { timeout_ms: 0, poll_ms: 1 } as const;

/**
 * Test fake: pretend the launch wrapper started (agent still running).
 * Pair with {@link INSTANT_WATCH} so watchLaunch does not wait out the
 * production exit window after the planted marker.
 */
export function plantStarted(args: string[]): void {
  if (args[0] !== 'pane' || args[1] !== 'run') return;
  const typed = args[3] ?? '';
  // `sh '<dir>/run.sh'`, or `'<dir>/<agent>'` for a launcher named after its agent.
  const quoted = typed.startsWith("sh '") ? typed.slice(3) : typed;
  if (!quoted.startsWith("'") || !quoted.endsWith("'")) return;
  const dir = dirname(quoted.slice(1, -1));
  leftoverDirs.add(dir);
  try {
    writeFileSync(join(dir, 'started'), 'started');
  } catch {
    // no launch dir (not a scripted pane run)
  }
}
