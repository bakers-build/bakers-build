import type { Preset } from '@bakers-build/conductor/contract';
import type { RuntimeDockerOptions } from './backend.js';
import { runtimeDocker } from './index.js';

export const scopes: Preset['scopes'] = ['machine'];
export const runtimes: Preset['runtimes'] = (acc, options) => [
  ...acc,
  runtimeDocker(options as RuntimeDockerOptions | undefined),
];
