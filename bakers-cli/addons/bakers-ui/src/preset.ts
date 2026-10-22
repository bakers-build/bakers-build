// BB-215: the bakers-ui addon self-declares its connection contribution (the
// dropsh `tui` renderer) via `./preset`. Listed in a `bakers.config.js` addons[],
// it wires the TUI renderer with no `export:`; the entry `with` becomes the
// renderer options.
import type { BbPreset } from '@bakers-build/core';
import bakersUiPlugin from './index.js';

export const connectionPlugins: BbPreset['connectionPlugins'] = (acc, opts) => [
  ...acc,
  // The tui renderer plugin is a DropSHPlugin structurally (id + renderers);
  // its concrete renderer types are wider than dropsh's exported interface.
  bakersUiPlugin(
    opts as Parameters<typeof bakersUiPlugin>[0],
  ) as unknown as (typeof acc)[number],
];
