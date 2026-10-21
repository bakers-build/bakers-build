// BB-201: the `bakers` plugin-host contract + the split-config helpers.
export type { BbCommandHost, BbCommandPlugin } from './cli/commands.js';
export {
  type ConfigInventory,
  type ConfigInventoryOptions,
  inventoryConfig,
} from './cli/config-inventory.js';
export {
  type ConfigOnlineOptions,
  createBbConnectionClient,
  createBbConnectionContext,
  hasStoredBbSession,
  verifyConfigConnections,
} from './cli/config-online.js';
export type {
  ConfigChange,
  ConfigFileKind,
  ConfigFileReport,
  ConfigFinding,
  ConfigFindingCode,
  ConfigLayer,
  ConfigLocation,
  ConfigOperation,
  ConfigReport,
  ConfigScope,
} from './cli/config-report.js';
export {
  configRecheckCommand,
  finalizeConfigReport,
} from './cli/config-report.js';
// BB-230: the comment-aware config-SOURCE scanner. Owned by the kernel so the
// content-gated legacy connection read (`findBbConfig`) and the conductor's
// BB-218 strip pass share one answer to "which top-level properties does this
// config source declare?" — core is layer 0 and cannot import the conductor's copy.
export {
  type ConfigSourceInspection,
  type ConfigSourceProperty,
  declaresTopLevelKey,
  findDefaultExportObject,
  inspectConfigSource,
  matchDelimiter,
  type PropEntry,
  readKey,
  scanTopLevelProperties,
  scanToTopLevelComma,
  skipBlockComment,
  skipLineComment,
  skipString,
  skipTrivia,
} from './cli/config-source.js';
export type {
  BbConfigResolution,
  BbConfigSource,
} from './cli/bakers-dir.js';
export {
  findConfigProjectBbDir,
  findBbConfig,
  findBbDir,
  findProjectBbDir,
  homeBbDir,
  resolveConfigPath,
  resolveBbConfigPath,
  stemForConfigFile,
} from './cli/bakers-dir.js';
export {
  HOME_IMPORT_EXPRESSION_PATTERN,
  importConfig,
} from './cli/import-config.js';
export {
  type LayeredUiEntryLayer,
  machineUiConfigPath,
  projectConductorConfigPath,
  readUiEntryLayers,
} from './cli/layered-ui-entries.js';
export {
  type EffectiveConnectionField,
  type BbConnectionConfig,
  BbConnectionConfigError,
  type BbConnectionGlobals,
  type BbConnectionLoadOptions,
  type BbConnectionSelection,
  loadBbConfig,
  loadBbConnectionBootstrap,
  reportLoadedBbConfigFields,
  resolveBbConnectionSelection,
} from './cli/load-bakers-config.js';
export {
  type AgentRoutes,
  legacyMachineContextPath,
  type MachineContext,
  machineContextPath,
  readMachineContext,
  resolveMachineContextPath,
} from './cli/machine-context.js';
export { corePackageRoot } from './cli/paths.js';
export { resolveModuleEslintStyle } from './cli/resolve-module.js';
export {
  checkForUpdate,
  declineUpdate,
  defaultUpdateCachePath,
  fetchLatestVersion,
  fetchUpdateNotice,
  BB_PACKAGE,
  printVersionLine,
  REGISTRY_LATEST_URL,
  resolveCliVersion,
  UNKNOWN_VERSION,
  UPDATE_CHECK_TTL_MS,
  type UpdateCheckOptions,
  type UpdateCheckResult,
  updateNotice,
} from './cli/version-check.js';
export {
  discoverBbWorkspaces,
  loadReadyBbConnection,
  resolveWorkspaceSelector,
  type WorkspaceChoice,
  type WorkspaceRecoveryOptions,
  workspaceSearchCommand,
} from './cli/workspace-recovery.js';
export {
  configHomeOf,
  defaultRootGitExec,
  deriveCheckoutRoot,
  type RootGitExec,
} from './core/checkout-root.js';
export { conductorId } from './core/conductor-id.js';
export {
  CommandRunner,
  ExecError,
  exec,
  setDefaultCommandRunner,
} from './core/exec.js';
export {
  type ConductorLiveness,
  type ConductorLivenessInput,
  deriveConductorLiveness,
  toUnixSeconds,
} from './core/liveness.js';
export { type ConductorLogger, createLogger } from './core/logger.js';
export {
  defaultProcProbe,
  type ProcProbe,
  type SignalFailureReason,
  type SignalOutcome,
  type SignalVerifiedInput,
  signalVerifiedProcess,
  type VerifyOutcome,
  type VerifyProcessInput,
  verifyConductorProcess,
} from './core/proc.js';
export { shellQuote } from './core/shell.js';
export { DEFAULT_SLUG_MAX_LENGTH, slugify } from './core/slug.js';
// BB-215: the Storybook-style preset contract + the shared addon discovery.
// BB-224 (Finding 6): SURFACE-AGNOSTIC only. The conductor-surface interfaces
// (`BbRemote`/`BbExecutor`/`BbWorkspace`/`BbAgent`, the four `*Plugin`
// interfaces, `ExecutorDeps`, `AgentCandidate`/`ResolvedAgent`, the `select*`
// selectors), the config contract (`ConductorSettings`/`ConductorFileConfig`/
// `ConductorEngineConfig`) and every built-in IMPLEMENTATION have moved out of
// this kernel — the contract to `@bakers-build/conductor` (subpath
// `@bakers-build/conductor/contract`), the impls to their own addons
// (`@bakers-build/addon-remote-drupal`, `@bakers-build/addon-workspace-git`,
// `@bakers-build/addon-auth-basic`, `@bakers-build/addon-fake`). `loadInstructions` moved to
// `@bakers-build/addon-workspace-git`. Core ships NO plugin implementations.
export {
  AddonUnresolvedError,
  discoverAddons,
  loadAddonPreset,
  type ResolvedConductorSlots,
  resolveConductorSlots,
} from './plugins/discover-addons.js';
export {
  type AddonEntry,
  type AddonScope,
  type CommandDescriptor,
  type DiscoveredContributions,
  emptyContributions,
  type BbPreset,
  type BbSurface,
  type OpaqueAccumulator,
  PRESET_FUNCTION_KEYS,
  SURFACE_KEYS,
} from './plugins/preset.js';
export {
  type AddonScopeFinding,
  type AddonScopeInput,
  discoverScoped,
  type EffectiveAddon,
  readConfigAddons,
  readEffectiveAddon,
  scopeAddons,
} from './plugins/scoped-addons.js';
// BB-194 AC-2: the agent-host contract (`AgentLaunchHost` / `HostedAgent` /
// `supportsAgentHost`) is likewise NOT here — it is the TUI renderer's own plugin
// seam (`@bakers-build/addon-bakers-ui`), and herdr types its impl locally.
export {
  deriveProjectTriples,
  type EmptyLoaderShape,
  type ExpandedLoad,
  expandLoad,
  type IndentedLoadSite,
  type InputDecl,
  measureEmptyLoader,
  parseStepValues,
  readSkillWhen,
  type SkillContract,
  type SkillWhen,
  StepContractError,
  type StepContractErrorCode,
  type StepValues,
  type Triple,
  validateLoad,
  type WhenValue,
  WORKFLOW_CLAIMABLE_STATES,
  WORKFLOW_STEPS,
  type WorkflowStep,
} from './workflow/step-contract.js';
