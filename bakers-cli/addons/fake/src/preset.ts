// BB-215/BB-224: the fake fixture addon self-declares the whole
// deterministic conductor triple via its `./preset` — executor + workspace +
// remote — so tests and e2e can wire a complete conductor from a single addons[]
// entry. BB-224 folded the remote + workspace impls IN from `@bakers-build/core`
// (which now ships no implementations), so the old
// `import { fakeWorkspace } from '@bakers-build/core/plugins'` is gone.
import type { Preset } from '@bakers-build/conductor/contract';
import { fakeInbox } from './inbox.js';
import { fakeExecutor, fakeRemote, fakeWorkspace } from './index.js';

export const executors: Preset['executors'] = (acc, opts) => [
  ...acc,
  fakeExecutor(opts as Parameters<typeof fakeExecutor>[0]),
];

export const workspaces: Preset['workspaces'] = (acc) => [
  ...acc,
  fakeWorkspace(),
];

export const remotes: Preset['remotes'] = (acc, opts) => [
  ...acc,
  fakeRemote(opts as Parameters<typeof fakeRemote>[0]),
];

export const inbox: Preset['inbox'] = fakeInbox;

// Conductor wiring of one project: list this addon in .bakers/conductor.config.js addons[].
export const scopes: Preset['scopes'] = ['project'];
