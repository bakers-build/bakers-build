import { execSync } from 'node:child_process';

export const Drush = {
  exec(command: string): string {
    let runner = 'drush';
    if (!process.env.DDEV_DOCROOT) {
      try {
        execSync('which drush', { stdio: 'ignore' });
      } catch {
        try {
          execSync('which ddev', { stdio: 'ignore' });
          runner = 'ddev drush';
        } catch {
          // Let native execution report the missing command, as before.
        }
      }
    }
    return execSync(`${runner} ${command}`, {
      cwd: process.env.DRUSH_CWD || process.cwd(), encoding: 'utf-8', stdio: 'pipe',
    });
  },
};

/**
 * Runs one PHP snippet through drush and returns its output.
 *
 * SINGLE QUOTES, and the reason is measured rather than stylistic: inside
 * double quotes the shell expands `$var` before drush sees the snippet, which
 * silently mangles every PHP variable. Inside single quotes nothing is expanded
 * and a leading backslash reaches PHP intact, so `\Drupal` must NOT be escaped
 * further. The one rule is that the snippet contains no single quote of its
 * own, which is why every PHP string below is double-quoted.
 */
export function php(snippet: string): string {
  if (snippet.includes("'")) {
    throw new Error('A drush snippet must not contain a single quote.');
  }
  return Drush.exec(`ev '${snippet}'`).trim();
}

/**
 * Runs a snippet that writes billing accounts, retrying a busy lock.
 *
 * Every billing-account write takes one global, non-waiting lock; a worker
 * writing at the same moment makes this one fail and roll back with
 * "Time data is being changed", so it is retried rather than reported.
 */
export async function phpUnderLock(snippet: string): Promise<string> {
  for (let attempt = 1; ; attempt++) {
    try {
      return php(snippet);
    } catch (error) {
      if (attempt >= 5 || !String(error).includes('Time data is being changed')) {
        throw error;
      }
      await new Promise(resolve => setTimeout(resolve, 500 * attempt));
    }
  }
}
