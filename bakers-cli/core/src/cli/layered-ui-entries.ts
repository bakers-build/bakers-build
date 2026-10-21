// BB-562: the machine and project config layers contribute UI addons.
//
// `uiEntries` used to exist on the connection surface alone, so a tab bound to
// a MACHINE (ports/tunnels) had to be declared in the file that carries
// credentials. These two layers read their own `addons[]` with the accumulator
// set narrowed to `uiEntries`: a conductor config's remote/executor/workspace
// contributions are NOT re-run here, and neither layer may contribute a dropsh
// connection plugin — an auth plugin without `site.base_url` is meaningless.
//
// No `@bakers-build/conductor` edge: only `.addons` is read off the imported module.
import type { ConductorLogger } from '../core/logger.js';
import type { AddonScope } from '../plugins/preset.js';
import {
  discoverScoped,
  readConfigAddons,
  scopeAddons,
} from '../plugins/scoped-addons.js';

export {
  machineUiConfigPath,
  projectConductorConfigPath,
} from '../plugins/scoped-addons.js';

export interface LayeredUiEntryLayer {
  /** Absolute path of the config file the entries came from. */
  path: string;
  /** Unresolved `uiEntries` specifiers contributed by that file's `addons[]`. */
  entries: string[];
  /** The resolution bases that layer's specifiers must be resolved against. */
  bases: string[];
}

/**
 * Read the machine and project `addons[]` as one effective list (each addon's
 * declared scopes, machine wins — `scopeAddons`) and return each scope's
 * UNRESOLVED `uiEntries` specifiers. An addon listed in both files renders
 * once, from the machine layer.
 *
 * Every resolution failure here is soft, and deliberately so: these layers are
 * an optional extra, and a machine whose config names an addon it does not
 * have must still be able to run `bakers dropsh`. The caller resolves each
 * layer's specifiers against that layer's own `bases` — an addon installed
 * beside `~/.bakers` is invisible to a project config's bases.
 */
export async function readUiEntryLayers(opts: {
  machine: { path: string; bases: string[] };
  project?: { path: string; bases: string[] };
  logger?: ConductorLogger;
}): Promise<{ machine: LayeredUiEntryLayer; project?: LayeredUiEntryLayer }> {
  const scopes: Array<[AddonScope, { path: string; bases: string[] }]> = [
    ['machine', opts.machine],
  ];
  if (opts.project) scopes.push(['project', opts.project]);
  const inputs = await Promise.all(
    scopes.map(async ([scope, file]) => ({
      scope,
      ...file,
      entries: await readConfigAddons(file.path),
    })),
  );
  const logger = opts.logger ? { logger: opts.logger } : {};
  const { addons } = await scopeAddons(inputs, {
    unresolved: 'skip',
    ...logger,
  });
  const layer = async (
    scope: AddonScope,
    file: { path: string; bases: string[] },
  ): Promise<LayeredUiEntryLayer> => {
    const own = addons.filter((a) => a.scope === scope);
    const discovered = await discoverScoped(own, 'connection', {
      only: ['uiEntries'],
      unresolved: 'skip',
      source: file.path,
      ...logger,
    });
    return {
      path: file.path,
      entries: discovered.uiEntries,
      bases: file.bases,
    };
  };
  return {
    machine: await layer('machine', opts.machine),
    ...(opts.project ? { project: await layer('project', opts.project) } : {}),
  };
}
