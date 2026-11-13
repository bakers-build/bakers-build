// BB-224 (Finding 6, decision 6): the conductor CONFIG CONTRACT lives here, in
// `@bakers-build/conductor`, not in `@bakers-build/core`. It is typed BY the
// conductor-surface plugin interfaces (`remote: RemotePlugin`, …), so it had to
// move with them — otherwise the surface-agnostic kernel would have to edge the
// engine, violating the acyclic rule "core has zero @bakers-build/* edges".

import type { AgentRoutes } from '@bakers-build/core';
import type { DropSHPlugin } from 'dropsh/plugin';
import type { ResolvedBbProjectContext } from './bakers-project-context.js';
import type { BbProjectSelection } from './cli/project-context.js';
import type { MarketplaceDeclaration } from './plugins/agent-home.js';
import type { HookListener } from './plugins/executor.js';
import type { LoadedInbox } from './plugins/message.js';
import type {
  AgentCandidate,
  ExecutorPlugin,
  RemotePlugin,
  ResolvedAgent,
  WorkspacePlugin,
} from './plugins/plugins.js';
import type { Ticket } from './plugins/remote.js';
import type { RuntimePlugin } from './plugins/runtime.js';
import type {
  ProvisionHook,
  ProvisionRuns,
  ToolRegistry,
} from './plugins/tools.js';

/** Normalized single conductor. */
export interface ConductorSettings {
  /** Display label, sent once at registration: `<machine label> · <project>[/<variant>]`. */
  label: string;
  /**
   * Conductor registration key (bb_conductor.conductor_id), derived at load
   * time as `<machine_id>-<project>-<variant>` and never written to a config.
   * Absent until `bakers init` gave the machine its UUID.
   */
  conductor_id?: string;
  /** The selected config file's stem: `conductor` for `project.config.js`. */
  variant: string;
  /** This machine's display label (`machine.config.js` label). */
  machine_label?: string;
  connection_url?: string | null;
  /** Project name (bb_project.name); resolved at registration. */
  project: string;
  /**
   * Workflow states this conductor serves. An empty list means it serves every
   * claimable state in its project; a non-empty list narrows it to those
   * states (BB-207).
   */
  states: string[];
  /**
   * Agent prompt template - the bakers.build run contract, NOT project workflow. Bounds
   * the agent to exactly one state and tells it to release + stop, keeping run
   * mechanics out of the repo's WORKFLOW.md. Placeholders: `{identifier}`,
   * `{state}`, `{runUuid}`, `{ticketUuid}`. Defaults to `DEFAULT_AGENT_PROMPT`.
   */
  prompt: string;
  /**
   * Machine preview-link policy. True when `machine.config.js` sets `tunnel: true`.
   * Runtime-derived; ticket and project env cannot override it.
   */
  tunnel?: boolean;
  /** This machine's UUID (bb_machine.host_key), from `machine.config.js` machine_id. */
  host_key?: string;
  poll_interval_ms: number;
  lease_seconds: number;
  /**
   * Local opt-out of transcript upload at finalize. Default true.
   *
   * The server's per-run policy (`FinalizableRun.runLogStorageAllowed`)
   * decides first; `false` here keeps this conductor's transcripts local even
   * where the server allows storage, and `true` cannot override a denial.
   * Metrics are unaffected: the footprint is derived from the agent's own
   * session files in this process, never from the uploaded log.
   */
  capture_logs?: boolean;
  /** Project shell commands, one per slot; run after the addon listeners. */
  hooks?: {
    after_create?: string;
    before_run?: string;
    after_run?: string;
    after_done?: string;
    /** Runs once in a ticket's worktree when a poll sees it frozen. */
    on_freeze?: string;
    /** Runs once in a ticket's worktree when a poll sees it unfrozen. */
    on_resume?: string;
    /** Never runs on its own: offered to runs as the `provision_up(profile?)` tool. */
    provision_up?: ProvisionHook;
  };
  /** Control-plane site settings used for dropsh and agent env. */
  site: { base_url: string; jsonapi_prefix: string };
  /** Absolute path of the loaded config. */
  config_path: string;
  /**
   * `oven start --foreground` restarts itself when a file in `watch_paths`
   * changes. Default true.
   */
  restart_on_change?: boolean;
  /** The files and addon build dirs this config was loaded from. */
  watch_paths?: { files: string[]; dirs: string[] };
  /** Where each slot's plugin came from, for `bakers conductor check`. */
  slot_sources?: Partial<SlotSources>;
}

/** Where a resolved server, executor or worktree plugin came from. */
export type SlotSource =
  | 'machine'
  | 'slot'
  | 'addons'
  | 'connection'
  | 'default';
export interface SlotSources {
  server: SlotSource;
  executor: SlotSource;
  worktree: SlotSource;
}

/** Whole project.config.js (dropsh-superset): site + named plugin slots. */
export interface ConductorFileConfig extends ConductorSettings {
  bakers: BbProjectSelection;
  resolved_bakers?: ResolvedBbProjectContext;
  remote: RemotePlugin;
  executor: ExecutorPlugin;
  /** Effective addon-derived catalog after machine overlays and filters. */
  agents: AgentCandidate[];
  enabled_agents: string[];
  disabled_agents: string[];
  default_agent: string;
  routes: AgentRoutes;
  /** Replaces the shipped label/default resolution for this project. */
  selectAgent?: (candidates: ResolvedAgent[], ticket: Ticket) => ResolvedAgent;
  workspace: WorkspacePlugin;
  /** Where agent processes run (the `runtime` slot); absent means on the host. */
  runtime?: RuntimePlugin;
  /** The project's agent plugin marketplaces; empty when it declares none. */
  marketplaces: MarketplaceDeclaration[];
  /**
   * Addon lifecycle listeners from the conductor `addons[]` `hooks`
   * accumulator (BB-599), validated at load. Kept apart from the shell
   * `hooks` strings. Absent means none.
   */
  hookListeners?: HookListener[];
  /**
   * Addons with contract-2 inbox messages from the conductor `addons[]`,
   * validated at load (BB-661). Absent means none.
   */
  inboxAddons?: LoadedInbox[];
  /** Agent tools from the conductor `addons[]` `tools` exports. Absent means none. */
  tools?: ToolRegistry;
  /** The `provision_up` runs, stopped at ticket end and conductor stop. Absent without the hook. */
  provisioning?: Pick<ProvisionRuns, 'stop'>;
  /** dropsh-layer plugins (auth etc.); separate from the bakers.build slots. */
  plugins?: DropSHPlugin[];
}

/**
 * BB-201 split config model: the ENGINE half of a conductor config —
 * everything a `project.config.js` carries EXCEPT the connection (`site`) and
 * the auth `plugins`, which now live in a separate connection file
 * (`BbConnectionConfig`). `loadConductorConfig` returns this; the conductor
 * command composes it with the connection (`composeConductorConfig`) into the
 * full `ConductorFileConfig` the engine consumes.
 */
export type ConductorEngineConfig = Omit<
  ConductorFileConfig,
  'site' | 'plugins' | 'remote'
> & {
  /** Absent when the project names no server; the connection or the default fills it. */
  remote?: RemotePlugin;
};
