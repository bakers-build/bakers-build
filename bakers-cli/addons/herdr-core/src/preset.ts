// herdr-core contributes an executor only: the worktree comes from any
// workspace (e.g. `@bakers-build/addon-workspace-git`). It has no hook
// listeners, so a machine may list it as well as a project.
import type { Preset } from '@bakers-build/conductor/contract';
import { herdrCoreExecutor } from './index.js';

export const executors: Preset['executors'] = (acc, opts) => [
  ...acc,
  herdrCoreExecutor(opts as Parameters<typeof herdrCoreExecutor>[0]),
];

export const scopes: Preset['scopes'] = ['machine', 'project'];
