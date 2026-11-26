// Under an isolating runtime the host runs only code the run cannot write:
// every project hook and provision command must start in a protected path.

import { posix } from 'node:path';

const INTERPRETERS = new Set(['bash', 'sh', 'node']);

/** The script a host command starts: its first word, or the word after `bash`, `sh` or `node`. */
export function hostCommandEntry(command: string): string | undefined {
  const [first, second] = command
    .trim()
    .split(/[\s;&|]+/)
    .filter(Boolean);
  return first !== undefined && INTERPRETERS.has(first) ? second : first;
}

/**
 * The `[key, command]` pairs whose entry point lies outside `.bakers` and
 * `protectedPaths`, with the roots they were checked against. Only the entry
 * is checked: what that script calls is the project's responsibility.
 */
export function unprotectedEntryPoints(
  commands: Iterable<readonly [key: string, command: string]>,
  protectedPaths: readonly string[],
): { key: string; command: string; roots: string[] }[] {
  const roots = ['.bakers', ...protectedPaths].map((path) =>
    posix.normalize(path),
  );
  const found: { key: string; command: string; roots: string[] }[] = [];
  for (const [key, command] of commands) {
    const entry = hostCommandEntry(command);
    const path = entry === undefined ? undefined : posix.normalize(entry);
    if (
      path === undefined ||
      !roots.some((root) => path === root || path.startsWith(`${root}/`))
    )
      found.push({ key, command, roots });
  }
  return found;
}
