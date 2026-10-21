// BB-475 — the ports command, declared for `bakers --help` without loading it.
//
// The same lazy-mount shape dropsh and deployment use: `describe` shows in help
// with no import, and the `plugin` module loads only when `bakers ports …` runs
// (BB-201). In a conductor's `addons[]` the same package contributes its
// `inbox` (contract 2, see below): the `tunnel` message's Markdown result is
// rendered in the ticket's addon card in the web UI and in `bakers ui`, and the
// handler runs on the conductor's machine.

import type { Preset } from '@bakers-build/conductor/contract';
import type { BbPreset } from '@bakers-build/core';

export const commands: BbPreset['commands'] = (acc) => [
  ...acc,
  {
    name: 'ports',
    plugin: '@bakers-build/addon-ports',
    describe:
      "list a ticket worktree's running services and share them over a tunnel",
  },
];

// Addon identity is `(workspace, name, version)` with no contract in the
// key: `inbox` is the package's only message export (BB-661).
export const inbox: Preset['inbox'] = {
  contract: 2,
  label: 'Ports',
  messages: {
    tunnel: { label: 'Share tunnels', access: 'view' },
  },
  handlers: (options) =>
    import('./inbox.js').then((m) => m.handlersFor(options)),
};

// Configurable on either level; the machine entry's with wins.
export const scopes: BbPreset['scopes'] = ['machine', 'project'];

// Merge and check the entry's own settings (services, all_node, transport).
export { checkWith, mergeWith } from './service-config.js';
