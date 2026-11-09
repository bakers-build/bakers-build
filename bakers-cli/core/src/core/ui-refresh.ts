import { existsSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** The `bakers ui` refresh signal's basename inside a `.bakers` dir; the UI watches it. */
export const UI_REFRESH_FILE = 'ui-refresh';

/**
 * Tell any `bakers ui` watching `bakersDir` that its data may be stale: set the
 * signal file's mtime, creating it if needed. A missing dir is skipped and
 * nothing throws, because a failed signal must never fail its caller (a run).
 */
export function bumpUiRefresh(bakersDir: string): void {
  if (!existsSync(bakersDir)) return;
  const file = join(bakersDir, UI_REFRESH_FILE);
  try {
    const now = new Date();
    utimesSync(file, now, now);
  } catch {
    try {
      writeFileSync(file, '');
    } catch {
      // Unwritable `.bakers`: the UI just stays on `R`.
    }
  }
}
