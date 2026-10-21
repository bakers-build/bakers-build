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
  emptyAgentFootprint,
  type BbAgent,
} from './plugins/agent.js';
export {
  detectKnownOverrides,
  type KnownOptionSpec,
  type KnownOverrides,
  type KnownScalarKind,
  resolveAgentCliOptions,
  validateAgentArgs,
  validateOptionalBoolean,
  validateOptionalString,
} from './plugins/agent-args.js';
export type {
  ExecutorCapabilities,
  BbExecutor,
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
  ClaimedRun,
  ClaimOptions,
  ClaimWithheld,
  ConductorRegistration,
  ConductorStatus,
  FinalizableRun,
  FrozenTicket,
  BbRemote,
  InboxMessage,
  InboxSnapshot,
  RunMetrics,
  RunWriteAttributes,
  Ticket,
  TicketMetric,
  UncleanTicket,
} from './plugins/remote.js';
export type {
  EnsuredWorkspace,
  BbWorkspace,
} from './plugins/workspace.js';
export type {
  ConductorEngineConfig,
  ConductorFileConfig,
  ConductorSettings,
} from './types.js';
