// Rex contributes the executor; its project workspace comes from Git.
import type { Preset } from '@bakers-build/conductor/contract';
import { rexExecutor } from './index.js';

export const executors: Preset['executors'] = (acc, opts) => [
  ...acc,
  rexExecutor(opts as Parameters<typeof rexExecutor>[0]),
];

export const scopes: Preset['scopes'] = ['machine', 'project'];

export const addons: Preset['addons'] = ['@bakers-build/addon-workspace-git'];
