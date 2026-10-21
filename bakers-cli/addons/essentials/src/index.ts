import { composePlugins } from 'dropsh/plugin';
import { type EssentialsOptions, essentialChildren } from './children.js';

/**
 * Aggregator: pull the essentials in through a single `plugins[]` entry.
 * `composePlugins(...)` returns the flat child list; dropsh (>= 0.5.6) flattens
 * a plugins[] entry that resolves to an array into separate plugin entries, and
 * the conductor's own resolver does the same — so each child stays a distinct,
 * genuine plugin, indistinguishable from listing them one by one. No hand-merged
 * or presence-guarded composite hooks.
 *
 * `authProvider`-carrying plugins (oauth2, with per-profile credentials) are
 * deliberately NOT here — they stay explicit in the config (AC-4).
 *
 * BB-351 made `@bakers-build/addon-workspace` a child too, so an ambient workspace
 * was filled on every connection without any config naming it. BB-495 removed
 * it: the dropsh request path carries authentication and nothing else, and the
 * caller names the workspace on the call. `bakers ui` attaches that plugin to its
 * own chain instead, because a focused workspace is what makes its lists
 * readable. No child here reads an option any more.
 *
 * Add a new essential = add it in `children.ts` (+ a real dependency in
 * package.json). Existing configs naming only this aggregator pick it up (AC-5).
 */
export default (opts: EssentialsOptions = {}) =>
  composePlugins(...essentialChildren(opts));

export { type EssentialsOptions, essentialChildren } from './children.js';
