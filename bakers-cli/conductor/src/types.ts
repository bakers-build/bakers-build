// BB-224 (Finding 6, decision 6): the conductor CONFIG CONTRACT lives here, in
// `@bakers-build/conductor`, not in `@bakers-build/core`. It is typed BY the
// conductor-surface plugin interfaces (`remote: RemotePlugin`, …), so it had to
// move with them — otherwise the surface-agnostic kernel would have to edge the
// engine, violating the acyclic rule "core has zero @bakers-build/* edges".

import type { AgentRoutes } from '@bakers-build/core';
import type { DropSHPlugin } from 'dropsh/plugin';
import type { ResolvedBbProjectContext } from './bakers-project-context.js';
import type { BbProjectSelection } from './cli/project-context.js';
import type { HookListener } from './plugins/executor.js';
import type { LoadedInbox } from './plugins/message.js';
import type {
  AgentCandidate,
  ExecutorPlugin,
  RemotePlugin,
  ResolvedAgent,
  WorkspacePlugin,
} from './plugins/plugins.js';
import type { HerdrHost } from './plugins/process-host.js';
import type { Ticket } from './plugins/remote.js';

/** Normalized single conductor. */
export interface ConductorSettings {
  /**
   * This machine's UUID (`machine.config.js` machine_id, lowercase). Absent
   * until `bakers init` wrote it; registration then fails naming `bakers init`.
   */
  machine_id?: string;
  /** This machine's display label (`machine.config.js` label). */
  machine_label?: string;
  /**
   * The selected config file's stem: `conductor` for `conductor.config.js`,
   * `shop` for `shop.conductor.config.js`. With the machine and the project it
   * keys the conductor on the server.
   */
  variant: string;
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
   * Host concurrent-run budget. Sourced from machine context max_parallel
   * (BB-353); engine-config leftovers are ignored with a warning.
   */
  max_parallel: number;
  /**
   * Machine preview-link policy. True when `machine.config.js` sets `tunnel: true`.
   * Runtime-derived; ticket and project env cannot override it.
   */
  tunnel?: boolean;
  poll_interval_ms: number;
  lease_seconds: number;
  /**
   * Whether to upload the agent transcript at finalize. Default true.
   *
   * Turning it off keeps this conductor's runs out of the log store entirely —
   * for a machine whose transcripts are large, uninteresting, or subject to a
   * local policy. Metrics are unaffected: the footprint is derived from the
   * agent's own session files in this process, never from the uploaded log.
   *
   * Client-side by design. It lets an operator opt out; it is not a policy the
   * server enforces, so a conductor running an older build still uploads.
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
  };
  /** Control-plane site settings used for dropsh and agent env. */
  site: { base_url: string; jsonapi_prefix: string };
  /** Absolute path of the loaded config. */
  config_path: string;
}

/** Whole conductor.config.js (dropsh-superset): site + named plugin slots. */
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
  /**
   * Conductor process host from the `processHosts` accumulator (last wins).
   * Absent when no addon contributed one — `bakers oven start` then fails
   * with the existing no-herdr hint.
   */
  processHost?: HerdrHost;
  /** dropsh-layer plugins (auth etc.); separate from the bakers.build slots. */
  plugins?: DropSHPlugin[];
}

/**
 * BB-201 split config model: the ENGINE half of a conductor config —
 * everything a `conductor.config.js` carries EXCEPT the connection (`site`) and
 * the auth `plugins`, which now live in a separate `bakers.config.js`
 * (`BbConnectionConfig`). `loadConductorConfig` returns this; the conductor
 * command composes it with the connection (`composeConductorConfig`) into the
 * full `ConductorFileConfig` the engine consumes.
 */
export type ConductorEngineConfig = Omit<
  ConductorFileConfig,
  'site' | 'plugins'
>;
