// herdr-core contributes the executor; its project workspace comes from Git.
import type { Preset } from '@bakers-build/conductor/contract';
import { herdrCoreExecutor } from './index.js';

export const executors: Preset['executors'] = (acc, opts) => [
  ...acc,
  herdrCoreExecutor(opts as Parameters<typeof herdrCoreExecutor>[0]),
];

export const scopes: Preset['scopes'] = ['machine', 'project'];

export const addons: Preset['addons'] = ['@bakers-build/addon-workspace-git'];
