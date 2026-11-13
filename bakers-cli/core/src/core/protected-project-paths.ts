import { lstatSync, readdirSync, realpathSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

/** Protect top-level entries so writable ancestors cannot rename protected files. */
export function protectedProjectPaths(
  workspace: string,
  paths: readonly string[],
): string[] {
  const root = realpathSync(workspace);
  const protectedRoots = [
    ...new Set(
      ['.bakers', ...paths].map((path) => {
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
        return join(root, relative(root, absolute).split(sep)[0] as string);
      }),
    ),
  ];
  const scan = (path: string): void => {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink())
      throw new Error(`Protected project tree contains a symlink: ${path}`);
    if (!stat.isFile() && !stat.isDirectory())
      throw new Error(
        `Protected project tree contains an unsupported file type: ${path}`,
      );
    if (stat.isFile() && stat.nlink > 1)
      throw new Error(`Protected project tree contains a hardlink: ${path}`);
    if (stat.isDirectory())
      for (const name of readdirSync(path)) scan(join(path, name));
  };
  for (const path of protectedRoots) scan(path);
  return protectedRoots;
}
