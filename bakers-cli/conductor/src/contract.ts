// BB-224 (Finding 6): the CONDUCTOR-SURFACE CONTRACT, exposed as the
// runtime-light subpath `@bakers-build/conductor/contract`.
//
// This is the module a conductor-surface addon (`addons/remote-drupal`,
// `addons/workspace-git`, `addons/herdr`, `addons/claude`, …) imports. It carries
// ONLY the surface interfaces, the config contract, the preset view, and the two
// tiny runtime helpers (`emptyAgentFootprint`, the `select*` slot selectors) — it
// imports NO engine, NO commander, NO dropsh runtime. Importing it therefore
// costs an addon nothing at boot, unlike the package main (`@bakers-build/conductor`),
// which pulls the whole run engine + the `conductor` command plugin.
//
// The package main re-exports everything here too, so `import type { BbRemote }
// from '@bakers-build/conductor'` keeps working for type-only consumers.

export {
  AmbiguousProjectNameError,
  type ResolvedBbProjectContext,
  resolveBbProjectContext,
} from './bakers-project-context.js';
export {
  type AgentFootprint,
  type AgentRunIdentity,
  type BbAgent,
  CONDUCTOR_TOKEN_ENV,
  CONDUCTOR_TOOLS_SERVER,
  DEFAULT_ENV_DENY,
  emptyAgentFootprint,
  matchesEnvDeny,
  type RunEnvPolicy,
} from './plugins/agent.js';
export {
  detectKnownOverrides,
  type KnownOptionSpec,
  type KnownOverrides,
  type KnownScalarKind,
  type ResolvedSecurity,
  resolveAgentCliOptions,
  resolveSecurityOptions,
  type SandboxOptions,
  SECURITY_MODES,
  type SecurityMode,
  type SecurityOptions,
  validateAgentArgs,
  validateOptionalBoolean,
  validateOptionalString,
} from './plugins/agent-args.js';
export type {
  BbExecutor,
  ExecutorCapabilities,
  HookContext,
  HookListener,
  HookListenerContext,
  HookListenerFn,
  HookName,
  HookResult,
  SpawnedSession,
  SpawnRunInput,
  WorktreeTeardown,
} from './plugins/executor.js';
export type {
  DiscoveredInbox,
  InboxMessageHandler,
  InboxMessageRequest,
  InboxMessages,
  LoadedInbox,
} from './plugins/message.js';
export {
  loadInbox,
  validateRequestPayload,
} from './plugins/message.js';
export type {
  AgentCandidate,
  AgentPlugin,
  ExecutorDeps,
  ExecutorPlugin,
  RemotePlugin,
  ResolvedAgent,
  WorkspacePlugin,
} from './plugins/plugins.js';
export {
  resolveAgent,
  selectAgent,
  selectAgents,
  selectExecutor,
  selectRemote,
  selectWorkspace,
} from './plugins/plugins.js';
export {
  type ConductorAddonEntry,
  type ConductorContributions,
  narrowConductorContributions,
  type Preset,
} from './plugins/preset.js';
export type { HerdrHost } from './plugins/process-host.js';
export type {
  ActiveRun,
  AddonDefinitionV2,
  AddonRegistration,
  BbRemote,
  ClaimedRun,
  ClaimOptions,
  ClaimWithheld,
  ConductorRegistration,
  ConductorStatus,
  FinalizableRun,
  FrozenTicket,
  InboxMessage,
  InboxSnapshot,
  RunMetrics,
  RunWriteAttributes,
  Ticket,
  TicketMetric,
  UncleanTicket,
} from './plugins/remote.js';
export { ConductorTakeoverRequired } from './plugins/remote.js';
export {
  installCommand,
  lastLine,
  type SandboxHost,
  type SandboxPreflight,
  sandboxFailures,
  systemSandboxHost,
} from './plugins/sandbox-preflight.js';
export type {
  AddonTools,
  ToolBinding,
  ToolDefinition,
  ToolHandler,
  ToolRequest,
  ToolResult,
} from './plugins/tools.js';
export type {
  BbWorkspace,
  EnsuredWorkspace,
} from './plugins/workspace.js';
export type {
  ConductorEngineConfig,
  ConductorFileConfig,
  ConductorSettings,
} from './types.js';
