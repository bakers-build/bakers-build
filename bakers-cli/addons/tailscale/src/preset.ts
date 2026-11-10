import type { Preset } from '@bakers-build/conductor/contract';
import { tailscaleHook, type TailscaleOptions } from './index.js';

export const scopes: Preset['scopes'] = ['machine'];
export const hooks: Preset['hooks'] = (acc, options) => [...acc, tailscaleHook(options as TailscaleOptions)];
