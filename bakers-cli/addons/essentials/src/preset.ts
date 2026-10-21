// BB-215: the essentials meta-addon self-declares its connection contributions
// via `./preset`. It pulls the essentials into the connection surface through a
// single entry — the children are returned flat, exactly as the default-export
// aggregator does, so each child stays a distinct plugin. The children are
// essentials' OWN deps (imported in `children.ts`, resolved from this package's
// node_modules), so no fragile transitive resolution from the config's bases.
//
// BB-351 made `@bakers-build/addon-workspace` one of those children, and it was the
// only one that read an option. BB-495 removed it, so no child reads an option
// any more: `opts` is still the GLOBAL options `loadBbConfig` hands every
// preset, but nothing here consumes them. `workspace_id` is optional in the
// connection config and reaches `bakers ui` alone.

import type { BbPreset } from '@bakers-build/core';
import { type EssentialsOptions, essentialChildren } from './children.js';

export const connectionPlugins: BbPreset<EssentialsOptions>['connectionPlugins'] =
  (acc, opts) => [
    ...acc,
    ...essentialChildren((opts ?? {}) as EssentialsOptions),
  ];
