export type * from '@bakers-build/core';
// BB-216: the connection-config schema version + its regex reader. BB-230:
// the host's `bakers config upgrade` intro prints the `from → to` pair from these.
export {
  BB_CONFIG_SCHEMA_VERSION,
  readConfigSchemaVersion,
} from './cli/config-schema.js';
// BB-201: the conductor is now a COMMAND PLUGIN mounted by the `@bakers-build/bakers`
// host, not the CLI entrypoint. `main`/`runBbCli` are gone; the default export
// is the `BbCommandPlugin`, exposed here as `./commands/conductor` too.
export {
  type BbCliDeps,
  default as conductorCommandPlugin,
  runConductorCli,
} from './commands/conductor.js';
// BB-218: the balanced strip is exported for the host/tests + reuse.
export {
  composeConductorConfig,
  DEFAULT_AGENT_PROMPT,
  loadConductorConfig,
  resolveConfigPath,
  stripLegacyConnectionFromConfigSource,
} from './config.js';
// BB-224 (Finding 6): this package now OWNS the conductor-surface contract —
// the interfaces, the config types, the preset view and the slot selectors — and
// re-exports the whole of it here. The runtime-light subpath
// `@bakers-build/conductor/contract` is the one an ADDON should import (this main
// entry pulls the engine + the command plugin). The built-in IMPLEMENTATIONS it
// used to re-export from the deleted `@bakers-build/core/plugins` barrel now live in
// their own addons (`@bakers-build/addon-remote-drupal`,
// `@bakers-build/addon-workspace-git`, `@bakers-build/addon-fake`) and are deliberately NOT
// re-exported: the engine must not edge an addon (acyclic layer rule).
export * from './contract.js';
export { Conductor } from './core/conductor.js';
