import {
  composeConductorConfig,
  loadConductorConfig,
  selectRemote,
} from '@bakers-build/conductor';
import type {
  BbRemote,
  ConductorFileConfig,
} from '@bakers-build/conductor/contract';
import {
  type BbCommandHost,
  type BbCommandPlugin,
  loadBbConfig,
  resolveConfigPath,
} from '@bakers-build/core';
import type { Command } from 'commander';
import { registerDeployment } from './deployment.js';

// BB-224 (Finding 7): `deployment` is its own COMMAND-surface addon, no longer
// a side-registration of the `conductor` command plugin. The release-batch
// gathering (`src/deployment.ts`) was already fully dependency-inverted — it
// takes the remote, the project and the cwd as thunks — so this module only has
// to reproduce the thunks the conductor command plugin used to pass, over the
// same split-config resolution:
//   engine half     `conductor.config.js` via `loadConductorConfig`
//   connection half `bakers.config.js`      via `loadBbConfig`
// composed by `composeConductorConfig`, with the remote picked by `selectRemote`.
//
// The `@bakers-build/conductor` import is the package MAIN (engine + config loader),
// not the runtime-light `./contract` subpath — that cost is paid only when a
// `bakers deployment …` subcommand actually dispatches, because the host mounts
// this module lazily (the `./preset` accumulator is what `bakers --help` reads).

/** Resolve + compose the full conductor config (engine + connection halves). */
async function resolveConfig(
  host: BbCommandHost,
): Promise<ConductorFileConfig> {
  const engine = await loadConductorConfig(resolveConfigPath());
  const connection = await loadBbConfig(host, {});
  return composeConductorConfig(engine, connection);
}

/** The `deployment` command plugin the host mounts (`bakers deployment …`). */
const deploymentCommandPlugin: BbCommandPlugin = {
  kind: 'command',
  name: 'deployment',
  describe: 'release / deployment helpers',
  register(program: Command, host: BbCommandHost): void {
    registerDeployment(
      program,
      async (): Promise<BbRemote> => selectRemote(await resolveConfig(host)),
      async (): Promise<string> => (await resolveConfig(host)).project,
      () => process.cwd(),
    );
  },
};

export default deploymentCommandPlugin;
export {
  type GatherResult,
  gatherBatch,
  parseIdentifiers,
  registerDeployment,
} from './deployment.js';
