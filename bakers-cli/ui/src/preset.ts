// BB-215: the ui addon self-declares its COMMAND contribution via `./preset`.
// This module is intentionally LIGHT — it returns a lazy CommandDescriptor and
// imports NO runtime, so the host can run every command addon's `commands`
// accumulator at boot (to list `bakers --help`) without importing the ui runtime
// (preserves the BB-201 lazy-mount). The descriptor's `plugin` is the module
// the host imports only when `bakers ui …` is actually dispatched.
import type { BbPreset } from '@bakers-build/core';

export const commands: BbPreset['commands'] = (acc) => [
  ...acc,
  {
    name: 'ui',
    plugin: '@bakers-build/ui',
    describe: 'interactive terminal UI: dashboard, projects, tickets',
  },
];
