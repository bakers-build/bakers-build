import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  chmodSync,
  lstatSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
} from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { promisify } from 'node:util';

type GitExec = (file: string, args: string[]) => Promise<{ stdout: string }>;
const run = promisify(execFile);

/** Quarantine only repositories host Git follows through the index, never symlinks. */
export async function quarantinePlanted(
  workspace: string,
  gitCommonDir: string,
  exec: GitExec = (file, args) => run(file, args),
): Promise<string[]> {
  const ws = realpathSync(workspace);
  const modules = join(gitCommonDir, 'modules') + sep;
  const moved: string[] = [];
  const git = (...args: string[]) =>
    exec('git', ['-C', ws, '-c', 'core.fsmonitor=false', ...args]);
  const quarantineIndex = async () => {
    // A planted index.lock or oversized index must not leave unsafe entries active.
    const { stdout: indexPath } = await git('rev-parse', '--git-path', 'index');
    const index = resolve(ws, indexPath.trim());
    const parent = dirname(index);
    chmodSync(parent, statSync(parent).mode | 0o700);
    renameSync(index, `${index}.bakers-quarantine-${randomUUID()}`);
    moved.push(index);
  };
  let stdout: string;
  try {
    ({ stdout } = await git('ls-files', '--stage', '-z'));
  } catch {
    await quarantineIndex();
    return moved;
  }
  let unresolved = false;
  const links = new Set(
    stdout.split('\0').flatMap((line) => {
      const match = /^160000 [0-9a-f]+ [0-3]\t(.+)$/s.exec(line);
      return match?.[1] ? [match[1]] : [];
    }),
  );
  linksLoop: for (const name of links) {
    try {
      const parts = name.split('/');
      if (
        parts.some(
          (part) =>
            !part ||
            part === '.' ||
            part === '..' ||
            part.toLowerCase() === '.git',
        )
      )
        throw new Error(`unsafe gitlink: ${name}`);
      let path = ws;
      for (const part of [...parts, '.git']) {
        path = join(path, part);
        const entry = lstatSync(path, { throwIfNoEntry: false });
        if (!entry) continue linksLoop; // An uninitialised submodule has no config to execute.
        if (entry.isSymbolicLink()) throw new Error(`symlink: ${name}`);
      }
      if (lstatSync(path).isFile()) {
        const target = /^gitdir:\s*(.+)$/m.exec(
          readFileSync(path, 'utf8'),
        )?.[1];
        if (
          target &&
          realpathSync(resolve(ws, name, target.trim())).startsWith(modules)
        )
          continue;
      }
      renameSync(path, `${path}.bakers-quarantine-${randomUUID()}`);
      moved.push(path);
    } catch {
      // If inspection or rename fails, stop host Git following this entry instead.
      try {
        await git('update-index', '--force-remove', '--', name);
        moved.push(name);
      } catch {
        unresolved = true;
      }
    }
  }
  if (unresolved) await quarantineIndex();
  return moved;
}
