import type { BbPreset } from '@bakers-build/core';

/** Opt-in UI entry only; the normal connection already provides the renderer. */
export const uiEntries: BbPreset['uiEntries'] = (acc) => [
  ...acc,
  '@bakers-build/addon-bakers-ui/react-experiment',
];
