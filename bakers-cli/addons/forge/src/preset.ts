// The forge addon: five conductor tools a sandboxed run delivers through,
// while the token stays with the conductor. Without a forge entry no tool is
// served and runs deliver as before.

import type { Preset } from '@bakers-build/conductor/contract';
import type { BbPreset } from '@bakers-build/core';
import { FORGE_TOOL_DEFINITIONS } from './tool-definitions.js';

// Configurable on either level; the machine entry's with wins.
export const scopes: BbPreset['scopes'] = ['machine', 'project'];

// Merge the entry's own settings across scopes; options.schema.json describes them.
export { mergeWith } from './config.js';

export const tools: Preset['tools'] = {
  contract: 1,
  tools: FORGE_TOOL_DEFINITIONS,
  handlers: (options) => import('./tools.js').then((m) => m.toolsFor(options)),
};
