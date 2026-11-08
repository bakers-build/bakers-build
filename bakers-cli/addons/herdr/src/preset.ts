// BB-215: the herdr addon self-declares BOTH its conductor contributions —
// the spawn executor AND the per-ticket worktree workspace — through one
// `./preset`: listing `@bakers-build/addon-herdr` once in a conductor addons[]
// wires both slots. The executor also runs on any other workspace's worktree.
// The single entry `with` is handed to both factories; each reads only the
// option keys it knows.
import type { Preset } from '@bakers-build/conductor/contract';
import { herdrFrozenMarker } from './frozen-marker.js';
import { herdrExecutor, herdrWorkspace } from './index.js';
import { herdrProcessHost } from './process-host.js';

export const executors: Preset['executors'] = (acc, opts) => [
  ...acc,
  herdrExecutor(opts as Parameters<typeof herdrExecutor>[0]),
];

export const workspaces: Preset['workspaces'] = (acc, opts) => [
  ...acc,
  herdrWorkspace(opts as Parameters<typeof herdrWorkspace>[0]),
];

export const processHosts: Preset['processHosts'] = (acc) => [
  ...acc,
  herdrProcessHost,
];

export const hooks: Preset['hooks'] = (acc) => [...acc, herdrFrozenMarker];

// Hook listeners and the process host belong to one project (no machine hook
// listeners, BB-599). A machine picks herdr as its executor through the
// machine.config.js `executor` slot instead.
export const scopes: Preset['scopes'] = ['project'];
