import type { Preset } from '@bakers-build/conductor/contract';
import { type TailscaleOptions, tailscaleHook } from './index.js';

export const scopes: Preset['scopes'] = ['machine'];
export const hooks: Preset['hooks'] = (acc, options) => [
  ...acc,
  tailscaleHook(options as TailscaleOptions),
];
