// Under an isolating runtime the host runs only code the run cannot write:
// every project hook and provision command must start in a protected path.

import { posix } from 'node:path';
import type { ConductorSettings } from '../types.js';

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
 * Throws naming the first hook or provision command whose entry point lies
 * outside `protectedPaths`. Only the entry is checked: what that script calls
 * is the project's responsibility.
 */
export function assertProtectedEntryPoints(
  hooks: ConductorSettings['hooks'],
  protectedPaths: readonly string[],
): void {
  const roots = ['.bakers', ...protectedPaths].map((path) =>
    posix.normalize(path),
  );
  for (const [name, value] of Object.entries(hooks ?? {})) {
    const commands: [string, string][] =
      typeof value === 'string'
        ? [[`hooks.${name}`, value]]
        : Object.entries(value ?? {}).map(([key, command]) => [
            `hooks.${name}.${key}`,
            command,
          ]);
    for (const [label, command] of commands) {
      const entry = hostCommandEntry(command);
      const path = entry === undefined ? undefined : posix.normalize(entry);
      if (
        path === undefined ||
        !roots.some((root) => path === root || path.startsWith(`${root}/`))
      )
        throw new Error(
          `${label}: under an isolating runtime a host command must start with a script in a protected path (${roots.join(', ')}); got ${JSON.stringify(command)}`,
        );
    }
  }
}
