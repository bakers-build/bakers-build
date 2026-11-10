// One `addons` entry wires both slots; the Orca executor also adopts any other
// workspace's git worktree. The entry's `with` reaches both factories; each
// reads only the keys it knows.
import type { Preset } from '@bakers-build/conductor/contract';
import { orcaExecutor, orcaWorkspace } from './index.js';

export const executors: Preset['executors'] = (acc, opts) => [
  ...acc,
  orcaExecutor(opts as Parameters<typeof orcaExecutor>[0]),
];

export const worktrees: Preset['worktrees'] = (acc, opts) => [
  ...acc,
  orcaWorkspace(opts as Parameters<typeof orcaWorkspace>[0]),
];

export const scopes: Preset['scopes'] = ['machine', 'project'];
