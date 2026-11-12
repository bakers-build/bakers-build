import type { Preset } from '@bakers-build/conductor/contract';
import { type BwrapOptions, runtimeBwrap } from './index.js';

export const scopes: Preset['scopes'] = ['machine'];
export const runtimes: Preset['runtimes'] = (acc, options) => [
  ...acc,
  runtimeBwrap(options as BwrapOptions | undefined),
];
