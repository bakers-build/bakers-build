// BB-475 — the ports command, declared for `bakers --help` without loading it.
//
// The same lazy-mount shape dropsh and deployment use: `describe` shows in help
// with no import, and the `plugin` module loads only when `bakers ports …` runs
// (BB-201). In a conductor's `addons[]` the same package contributes its
// `inbox` (contract 2, see below): the `tunnel` message's Markdown result is
// rendered in the ticket's addon card in the web UI and in `bakers ui`, and the
// conductor answers it with the `ports_up` tool on its machine.

import type { Preset } from '@bakers-build/conductor/contract';
import type { BbPreset } from '@bakers-build/core';
import { PORTS_TOOL_DEFINITIONS } from './tool-definitions.js';

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
  // Shares every eligible service through the same tool agents use.
  bindings: { tunnel: { tool: 'ports_up', args: {} } },
};

// Configurable on either level; the machine entry's with wins.
export const scopes: BbPreset['scopes'] = ['machine', 'project'];

// Merge the entry's own settings across scopes (services, all_node, transport);
// options.schema.json describes them.
export { mergeWith } from './service-config.js';

// Agent tools the conductor serves to every run (and the CLI calls through
// it): the conductor is the only writer of the tunnel routes.
export const tools: Preset['tools'] = {
  contract: 1,
  tools: PORTS_TOOL_DEFINITIONS,
  handlers: (options) => import('./tools.js').then((m) => m.toolsFor(options)),
};
