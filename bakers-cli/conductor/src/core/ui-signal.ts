import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  bumpUiRefresh,
  configHomeOf,
  UI_REFRESH_FILE,
} from '@bakers-build/core';

const EXCLUDE_LINE = `/.bakers/${UI_REFRESH_FILE}`;
/** Repos (by dir) already checked this process, so git runs once per dir. */
const excluded = new Set<string>();

/**
 * Keep the signal file out of `git status` in projects that don't ignore it:
 * one line in the repo's local `info/exclude`, never a tracked file.
 */
function ensureExcluded(dir: string): void {
  if (excluded.has(dir)) return;
  excluded.add(dir);
  try {
    const common = resolve(
      dir,
      execFileSync('git', ['rev-parse', '--git-common-dir'], {
        cwd: dir,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim(),
    );
    const file = join(common, 'info', 'exclude');
    const text = existsSync(file) ? readFileSync(file, 'utf8') : '';
    if (text.split('\n').includes(EXCLUDE_LINE)) return;
    mkdirSync(join(common, 'info'), { recursive: true });
    appendFileSync(
      file,
      `${text === '' || text.endsWith('\n') ? '' : '\n'}${EXCLUDE_LINE}\n`,
    );
  } catch {
    // Not a git dir, or unwritable: the file just shows as untracked.
  }
}

/** Touch `<dir>/.bakers/ui-refresh` so a `bakers ui` there reloads. Never throws. */
export function signalUi(dir: string): void {
  const bakersDir = configHomeOf(dir);
  if (!existsSync(bakersDir)) return;
  ensureExcluded(dir);
  bumpUiRefresh(bakersDir);
}
