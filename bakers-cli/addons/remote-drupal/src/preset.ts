// BB-224: the remote-drupal addon self-declares its conductor `remote`
// contribution through the standard `./preset` export — the shipped default
// remote that `@bakers-build/core/builtins` used to contribute before it was deleted.
// One accumulator, no config-side kind wiring: name the package in a
// `project.config.js` `addons: []` and the Drupal remote wires itself.
import type { Preset } from '@bakers-build/conductor/contract';
import { drupalRemote } from './index.js';

export const servers: Preset['servers'] = (acc) => [...acc, drupalRemote()];

// Conductor wiring of one project: list this addon in .bakers/project.config.js addons[].
export const scopes: Preset['scopes'] = ['project'];
