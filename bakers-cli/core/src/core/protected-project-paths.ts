import { realpathSync } from 'node:fs';
import { resolve, sep } from 'node:path';

/** Host-executed files must exist at stable worktree paths before dispatch. */
export function protectedProjectPaths(
  workspace: string,
  paths: readonly string[],
): string[] {
  const root = realpathSync(workspace);
  return [...new Set(['.bakers', ...paths])].map((path) => {
    if (
      !path ||
      path.startsWith('/') ||
      path.split(/[\\/]/).includes('..') ||
      path.includes('\0')
    )
      throw new Error(`Invalid protected project path: ${path}`);
    const absolute = resolve(root, path);
    const actual = realpathSync(absolute);
    if (!actual.startsWith(root + sep) || actual !== absolute)
      throw new Error(
        `Protected project path escapes or redirects its worktree: ${path}`,
      );
    return absolute;
  });
}
