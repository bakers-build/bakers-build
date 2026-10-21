// BB-373: the discovery entry. NO UI IMPORT, and that is a hard rule rather
// than a preference: `discoverAddons` loads this module on every connection
// load, `bakers dropsh` included, and `@opentui/core` is megabytes of native Zig.
// What travels from here is the SPECIFIER of the entry module; the kernel is
// what imports it, once, and only when a TUI is actually being rendered (F2).
import type { BbPreset } from '@bakers-build/core';

export const uiEntries: BbPreset['uiEntries'] = (acc) => [
  ...acc,
  '@bakers-build/addon-bakers-ui-artifacts/ui',
];

// Configurable on either level; the machine entry's with wins.
export const scopes: BbPreset['scopes'] = ['machine', 'project'];
