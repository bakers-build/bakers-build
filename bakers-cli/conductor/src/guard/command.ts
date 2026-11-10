import { fileURLToPath } from 'node:url';
import { shellQuote } from '@bakers-build/core';

/** The built hook script beside this module. */
const GUARD_HOOK_SCRIPT = fileURLToPath(new URL('./hook.js', import.meta.url));

/** The hook command a harness runs: the conductor's own node and the hook script. */
export function guardHookCommand(): string {
  return `${shellQuote(process.execPath)} ${shellQuote(GUARD_HOOK_SCRIPT)}`;
}

/**
 * What `bakers agents` shows per agent: `partial` while the harness's hook is
 * unproven against the real harness; a harness without the guard reports `not_applied`.
 */
export type GuardState = 'active' | 'partial' | 'off' | 'not_applied';
