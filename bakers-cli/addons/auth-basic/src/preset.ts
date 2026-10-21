// BB-224: the auth-basic addon self-declares its CONNECTION contribution
// through the standard `./preset` export — the `{ basic }` branch the deleted
// `@bakers-build/core/builtins` preset used to own. It contributes nothing unless a
// `basic` token is supplied, so listing it unconditionally is harmless.
import type { BbPreset } from '@bakers-build/core';
import { basicAuthProvider } from './index.js';

/** Options for the auth-basic addon. */
export interface AuthBasicOptions {
  /** Inline HTTP Basic token (base64 `user:pass`). */
  basic?: string;
}

export const connectionPlugins: BbPreset['connectionPlugins'] = (
  acc,
  opts,
) => {
  const o = (opts ?? {}) as AuthBasicOptions;
  if (typeof o.basic !== 'string' || o.basic.trim() === '') return acc;
  // basicAuthProvider returns the dropsh auth-plugin shape ({ id, authProvider })
  // minus `requiredModules` (dropsh tolerates its absence for auth-only plugins).
  return [
    ...acc,
    basicAuthProvider(o.basic) as unknown as (typeof acc)[number],
  ];
};
