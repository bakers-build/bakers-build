import { unprotectedEntryPoints } from '@bakers-build/core';
import type { ConductorSettings } from '../types.js';

export { hostCommandEntry } from '@bakers-build/core';

/**
 * Throws naming the first hook or provision command whose entry point lies
 * outside `protectedPaths`.
 */
export function assertProtectedEntryPoints(
  hooks: ConductorSettings['hooks'],
  protectedPaths: readonly string[],
): void {
  const commands = Object.entries(hooks ?? {}).flatMap(
    ([name, value]): [string, string][] =>
      typeof value === 'string'
        ? [[`hooks.${name}`, value]]
        : Object.entries(value ?? {}).map(([key, command]) => [
            `hooks.${name}.${key}`,
            typeof command === 'string' ? command : command.command,
          ]),
  );
  const [first] = unprotectedEntryPoints(commands, protectedPaths);
  if (first)
    throw new Error(
      `${first.key}: under an isolating runtime a host command must start with a script in a protected path (${first.roots.join(', ')}); got ${JSON.stringify(first.command)}`,
    );
}
