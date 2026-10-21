// BB-351: the workspace addon self-declares its CONNECTION contribution
// through the standard `./preset` export.
//
// It is never listed in a config by hand — `@bakers-build/addon-essentials` carries
// it as a preset child, so every connection loads it. Its uuid arrives as a
// GLOBAL option: `loadBbConfig` reads the connection config's top-level,
// required `workspace_id` and hands it to every preset as `opts`. The guard
// below therefore only ever fires for a hand-built discovery that bypasses that
// loader, in which case contributing nothing is right — the plugin would have
// no uuid to inject.
import type { BbPreset } from '@bakers-build/core';
import { type WorkspaceOptions, workspacePlugin } from './index.js';

export const connectionPlugins: BbPreset<WorkspaceOptions>['connectionPlugins'] =
  (acc, opts) => {
    const o = (opts ?? {}) as WorkspaceOptions;
    if (typeof o.workspace_id !== 'string' || o.workspace_id.trim() === '') {
      return acc;
    }
    return [...acc, workspacePlugin(o)];
  };
