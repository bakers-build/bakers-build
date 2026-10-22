// The one place that says which plugins `@bakers-build/addon-essentials` pulls in.
//
// It exists because essentials is reachable through TWO config forms that must
// not drift: the legacy `plugins: [{ plugin: '@bakers-build/addon-essentials' }]`
// descriptor, which constructs this package's DEFAULT EXPORT, and the
// Storybook-style `addons: ['@bakers-build/addon-essentials']`, which runs its
// `./preset`. Both call this function, so a child added here appears on both.

import { nameRefsPlugin } from '@bakers-build/addon-name-refs';
import { jsonapiSchemaPlugin } from '@dropsh/plugin-jsonapi-schema';
import { markdownPlugin } from '@dropsh/plugin-markdown';
import type { DropSHPlugin } from 'dropsh/plugin';

/** Options essentials forwards to the children that take any. */
export interface EssentialsOptions {
  /**
   * BB-495: no longer read. The ambient-workspace filler moved to `bakers ui`,
   * which attaches `@bakers-build/addon-workspace` itself; the dropsh request path
   * carries authentication and nothing else, so the caller names the workspace
   * on the call instead of a config value stamping it in.
   */
  workspace_id?: string;
}

/**
 * The config-free essentials: markdown renderer, authoritative JSON:API schema
 * and BB-403's name resolver, which lives in its own
 * `@bakers-build/addon-name-refs` package. Exactly three plugins, regardless of
 * `opts` (BB-495).
 */
export function essentialChildren(
  _opts: EssentialsOptions = {},
): DropSHPlugin[] {
  return [markdownPlugin(), jsonapiSchemaPlugin(), nameRefsPlugin()];
}
