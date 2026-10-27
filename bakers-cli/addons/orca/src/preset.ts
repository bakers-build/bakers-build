// One `addons` entry wires both slots: the Orca executor only works on
// worktrees the Orca workspace created. The entry's `with` reaches both
// factories; each reads only the keys it knows.
import type { Preset } from '@bakers-build/conductor/contract';
import { orcaExecutor, orcaWorkspace } from './index.js';

export const executors: Preset['executors'] = (acc, opts) => [
  ...acc,
  orcaExecutor(opts as Parameters<typeof orcaExecutor>[0]),
];

export const workspaces: Preset['workspaces'] = (acc, opts) => [
  ...acc,
  orcaWorkspace(opts as Parameters<typeof orcaWorkspace>[0]),
];

export const scopes: Preset['scopes'] = ['project'];
