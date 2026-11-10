import type { MessageDefinition, MessageResult } from '@bakers-build/message';

/** A contract-2 addon's wire registration shape (BB-661). */
export interface AddonDefinitionV2 {
  name: string;
  version: string;
  contract: 2;
  label?: string;
  icon?: string;
  messages: Record<string, MessageDefinition>;
}

export interface ConductorRegistration {
  /** Conductor process registration key (bb_conductor.conductor_id). */
  id: string;
  /** This machine's UUID (bb_machine.host_key / MachineContext.machine_id). */
  host_key?: string;
  /** This machine's display label; names a newly created bb_machine. */
  machine_label?: string;
  project: string;
  /** Empty = serve all claimable states in the project (BB-207). */
  states: string[];
  workspace: string;
  label: string;
  /**
   * The pid of the serve-loop process, when this conductor *is* that process.
   *
   * Absent from a registration sent by `poll` or `reap`, which build a
   * Conductor and exit within seconds — reporting their pid would overwrite a
   * running conductor's with a short-lived one. Absent likewise means "leave
   * whatever is stored alone", never "clear it".
   */
  last_pid?: number;
  /**
   * The stem of the config file this conductor was started from (`conductor`
   * for the default, `shop` for `shop.conductor.config.js`) — what
   * `--conductor <name>` selects. Together with `workspace` it identifies one
   * conductor in a repo that holds several.
   */
  conductor_name?: string;
  /**
   * The answer to {@link ConductorTakeoverRequired}: take over this conductor
   * (its UUID), or register another one (`create_new`).
   */
  adopt?: string;
  create_new?: boolean;
}

/**
 * A registration the control plane refused because this machine, project and
 * variant already have a conductor under another id. `adoptable` are the
 * UUIDs it offers; the message says how to decide.
 */
export class ConductorTakeoverRequired extends Error {
  override readonly name = 'ConductorTakeoverRequired';
  constructor(
    message: string,
    readonly adoptable: string[],
  ) {
    super(message);
  }
}

export interface ClaimOptions {
  leaseSeconds: number;
  conductorId: string;
}

export interface ClaimedRun {
  runUuid: string;
  runId: number;
  ticketUuid: string;
  stateAtStart: string;
  handler: string;
}

export interface Ticket {
  uuid: string;
  identifier: string;
  title: string;
  state: string;
  branchName: string;
  /** Branch the ticket's work is based on (computed server-side): parent branch, project default, or 'main'. */
  baseBranch?: string;
  /**
   * Effective environment variables (BB-99), resolved server-side along the
   * parent_id chain (child wins) as canonical `.env`-style `KEY=value` lines.
   * The conductor parses this, strips reserved keys, overlays the core BB_*
   * vars, and injects the result into the agent run env AND the workspace hooks.
   * Omitted when the ticket (and its ancestors) set none. Values may be secret.
   */
  effectiveEnvVars?: string;
  issueUrl?: string;
  /** BB-495: the ticket's project, so a dispatched agent can name it on its own calls. */
  projectId?: string;
  projectName?: string;
  /**
   * BB-495: the project's workspace, resolved through `bb_project.group_id.workspace_id`.
   * Omitted when the project or its group carries no resolvable workspace.
   */
  workspaceId?: string;
  workspaceName?: string;
  /** The ticket type term name (`feature`, `bug`, …), sideloaded for the required-skills check. */
  type?: string;
  /** The recipe term name (`matt`, …): the run requires the skill `bb-recipe-<recipe>`. */
  recipe?: string;
  /** Ticket label term names (`label` bundle), sideloaded for agent selection. Empty when none. */
  labels: string[];
  /** Ticket environments (bb_environment refs), each as name + tier, sideloaded for agent selection. Empty when none. */
  environments: { name: string; tier: string }[];
}

export interface ActiveRun {
  runUuid: string;
  /** Numeric run id (drupal_internal__id); names the run's terminal. */
  runId: number;
  ticketUuid: string;
  ticketIdentifier: string;
  branchName: string;
  state: string;
  stateAtStart: string;
  /** Absolute path of the per-run git worktree, or '' when unset. */
  worktreePath: string;
}

export interface ConductorStatus {
  id: string;
  project: string;
  label: string;
  status: string;
  lastSeen: number;
  load: number;
  /**
   * The checkout root the conductor last registered from (BB-450 D3) — the
   * top of the working tree, not its `.bakers` config directory. Empty when
   * never reported. A record written before BB-450 still carries the
   * legacy `.bakers` value until its next heartbeat rewrites it.
   */
  workspaceRoot: string;
  /** Lease expiry (unix seconds); with lastSeen it derives liveness. 0 = unset. */
  leaseExpiresAt: number;
  maxParallel: number;
  /** The last pid the conductor's serve loop reported, if any (BB-232). */
  lastPid?: number;
  /** The config stem it was started from, as `--conductor <name>` takes it. */
  conductorName?: string;
  /**
   * The MachineContext host stem (bb_machine.host_key) this record last
   * heartbeat with (BB-450 AC-4) — `signalVerifiedProcess()` compares it
   * against this machine's own, so lifecycle commands can never signal a
   * conductor on another host. Empty when never reported.
   */
  hostKey?: string;
}

export interface FinalizableRun {
  runUuid: string;
  /** The run's terminal state; a `cancelled` run is stopped like a `done` one. */
  state: 'done' | 'cancelled';
  /** Numeric run id (the `#<runId>` tab-label token); scopes the run's tab-close at finalise (BB-183). */
  runId: number;
  /**
   * The run's ticket and the state it started in, read from the run record so
   * a restarted conductor can rebuild the `after_run` context (BB-599).
   * '' / undefined when unset.
   */
  ticketUuid?: string;
  stateAtStart?: string;
  /** Absolute path of the per-run git worktree, or '' when unset. */
  worktreePath: string;
  /** Id of the agent that ran (BB-144); routes footprint parsing at finalize. '' / undefined when unset. */
  agent?: string;
  /**
   * When the run started (bb_run.started_at), read back purely as a lower
   * bound for transcript selection (BB-473) — an agent with no session-id
   * mechanism (codex, opencode) discards any transcript older than this so a
   * prior run's leftover transcript in the same worktree can never be
   * finalised onto this run. NOT used to (re)compute `duration_s`, which
   * stays transcript-derived (BB-151). '' / undefined when unset.
   */
  startedAt?: string;
  /**
   * The server's current run-log policy for this run (workspace opt-in AND
   * the operator flag), read fresh on every finalize query. Only `true`
   * allows uploading the transcript; absent (an older server) means no.
   */
  runLogStorageAllowed?: boolean;
}

/**
 * The attributes the conductor writes in the single PATCH that closes a run:
 * the effort footprint parsed from the transcript, and the runtime that
 * produced it. The runtime members are optional because a value that cannot be
 * resolved is omitted from the payload entirely rather than sent as a
 * placeholder — an absent key leaves the field NULL on the server, which is a
 * readable "not resolved", where an empty string would read as an answer.
 */
export interface RunMetrics {
  tokens: number;
  duration_s: number;
  agent_turns: number;
  tool_calls: number;
  user_prompts: number;
  user_prompt_words: number;
  /** Active agent time in seconds; the human wait is `duration_s - active_s`. */
  active_s: number;
  /** The harness package id that drove the session, e.g. `claude`. */
  harness?: string;
  /** The model the chosen candidate pins, when configured; otherwise the raw
   * model id the transcript records, e.g. `claude-opus-5`. */
  model?: string;
  /** The candidate's configured exact model version, when configured;
   * otherwise the raw model id the transcript records for the turn that
   * ran. */
  model_version?: string;
}

/** One `bb_metric` row of a ticket's `metrics` field, in the fixed output format. */
export interface TicketMetric {
  name: string;
  /** The number as a string with exactly 4 decimals, e.g. `"71.0000"`. */
  value: string;
  unit: string | null;
  /**
   * Unix seconds, shared by every row of one measurement; rows read back from
   * the server may carry it as an RFC 3339 string.
   */
  recorded: number | string;
}

/**
 * A closed ticket whose worktree has not yet been torn down — the
 * conductor's teardown work list, driven by the durable `cleaned_up` flag
 * (BB-89). Since BB-451 the server closes every terminal ticket on its own
 * save, so "finished" collapses to `closed = 1`; `cleaned_up=0` (or never
 * written at all) means the herdr worktree still needs reclaiming. The
 * reconciliation is NOT scoped to a conductor's machine_id, so it also
 * surfaces tickets whose conductor was down at close or whose `conductor_id`
 * was reassigned.
 */
export interface UncleanTicket {
  ticketUuid: string;
  /** The ticket's git branch — the key herdr resolves the worktree by. */
  branchName: string;
  /** The ticket's workflow state (`done`, `cancelled`, …), '' when unset. */
  state: string;
  /** The branch the ticket's merge request targets, '' when unset. */
  baseBranch: string;
  /** Whether the ticket's `links` hold a merge request (title `MR`). */
  hasMr: boolean;
  /**
   * Absolute path of the ticket's worktree (from its latest run's
   * `worktree_path`), or '' when unresolved. The cwd the teardown runs in.
   */
  worktreePath: string;
  /**
   * UUID of the ticket's latest run — the one {@link worktreePath} came from —
   * or '' when the ticket has no run with a path. The record teardown notes are
   * written to (BB-293). Resolved by the same query that resolves the path,
   * so it costs no extra round-trip.
   */
  runUuid: string;
}

/** An open, frozen ticket of this conductor and where its worktree is. */
export interface FrozenTicket {
  ticketUuid: string;
  identifier: string;
  /** Latest run's worktree path, or '' when unresolved. */
  worktreePath: string;
}

/** Extra conductor-writable bb_run attributes (besides state/lease). */
export interface RunWriteAttributes {
  /** Absolute path of the per-run git worktree (set by the conductor). */
  worktree_path?: string;
  /** Id of the agent the conductor chose for this run (BB-144), for footprint routing. */
  agent?: string;
  /**
   * Timestamp of THIS dispatch attempt (BB-473 round 4), re-stamped on
   * every `markRunning` call — including a re-dispatch of an already-run
   * ticket. Read back as `FinalizableRun.startedAt` and used as a lower
   * bound at finalise for agents with no session mechanism at all.
   *
   * Whole seconds since the epoch (`Math.floor(Date.now() / 1000)`),
   * matching every other timestamp this method's caller writes (`heartbeat`,
   * `closed_date`) — NOT a fractional-second ISO string. `bb_run.started_at`
   * is a Drupal `timestamp` field, whose normalizer accepts `U` (epoch
   * seconds), ISO 8601 or RFC 3339, none of which carries a fractional
   * component; a fractional string is silently rejected by the JSON:API
   * write (review round 4, Critical 1) and takes `worktree_path`/`agent` down
   * with it, since all three are on the same PATCH.
   */
  startedAt?: string | number;
}

/** Eligible work withheld by the authoritative machine admission budget. */
export interface ClaimWithheld {
  reason: 'machine_capacity';
  occupancy: number;
  capacity: number;
  /** Running runs have no fixed release deadline. */
  retryAt: null;
}

/** One pending inbox message for this conductor. */
export interface InboxMessage {
  /** The message entity's UUID. */
  id: string;
  /** `<addon>.<message key>`, e.g. `ports.tunnel`. */
  messageId: string;
  /** The responsible handler's version at send time (recorded only). */
  version: string;
  ticketUuid: string;
  payload: Record<string, unknown>;
  /** The ticket's newest worktree on this conductor, null when none. */
  worktreePath: string | null;
  /** The sender's user UUID; absent when the server sends none. */
  requestedBy?: string;
}

/** The inbox poll: this conductor's pending messages. */
export interface InboxSnapshot {
  messages: InboxMessage[];
}

/** The server's answer to an addon registration. */
export interface AddonRegistration {
  accepted: Array<{ name: string; version: string; id: string }>;
  rejected: Array<{ name: string; version: string; error: string }>;
}

/**
 * The site's own MCP tools (`/mcp`, `tool_api__<tool>`), reached with the
 * conductor's credentials. `call` throws with the site's text when the tool
 * reports an error.
 */
export interface SiteToolClient {
  list(): Promise<
    Array<{
      name: string;
      description?: string;
      inputSchema: Record<string, unknown>;
    }>
  >;
  call(
    name: string,
    args: Record<string, unknown>,
  ): Promise<{ content: unknown[]; structuredContent?: unknown }>;
  close(): Promise<void>;
}

export interface BbRemote {
  /** The site's tools, served to agent runs on the `bakers` MCP server; absent: none. */
  siteTools?: SiteToolClient;
  /** POSTs heartbeat registration; returns the Drupal entity uuid. */
  registerConductor(reg: ConductorRegistration): Promise<string>;
  /**
   * Records a heartbeat server-side: POSTs the heartbeat resource
   * (recreating a vanished registration), refreshes last_seen/lease/load,
   * and brings the conductor online. Keyed on conductor_id, so it never
   * 404s — the self-heal lives on the server, not the client. Returns the
   * resulting status (`online` | `offline`).
   */
  heartbeat(
    reg: ConductorRegistration,
    currentLoad: number,
    leaseSeconds?: number,
  ): Promise<string>;
  getConductorStatus(conductorId: string): Promise<string | null>;
  setConductorStatus(conductorId: string, status: 'offline'): Promise<void>;
  listConductors(owner?: 'me'): Promise<ConductorStatus[]>;
  activeRunCount(conductorId: string): Promise<number>;
  /**
   * Shared host capacity for this `host_key` (bb_machine, BB-353 D5).
   * After a heartbeat that reported this process's load, `currentLoad` is the
   * sum of online conductors on the machine (peers + self). Null when the
   * machine row or its budget is unreadable — callers claim nothing.
   */
  machineCapacity(
    hostKey: string,
  ): Promise<{ maxParallel: number; currentLoad: number } | null>;
  fetchActiveRuns(conductorId: string): Promise<ActiveRun[]>;
  claimNext(claim: ClaimOptions): Promise<ClaimedRun | ClaimWithheld | null>;
  getTicket(ticketUuid: string): Promise<Ticket>;
  /**
   * BB-495: every `bb_workspace` uuid the dispatching identity can reach —
   * dispatch exports this as `BB_WORKSPACE_IDS` so the agent knows the full
   * radius it may name, not only the point it starts standing on.
   */
  getReachableWorkspaces(): Promise<string[]>;
  /** Returns the run's worktree_path, or '' when unset. */
  getRunWorktree(runUuid: string): Promise<string>;
  /**
   * Returns the identifier of the run's ticket, or '' when unresolved. Lets the
   * release path derive the tab matching ref (the ticket identifier) from a run
   * uuid alone.
   */
  getRunTicketIdentifier(runUuid: string): Promise<string>;
  /**
   * Returns the branch_name of the run's ticket, or '' when unresolved. Used
   * by dispatch for the per-(branch,state) herdr tab model.
   */
  getRunTicketBranchName(runUuid: string): Promise<string>;
  markRunning(runUuid: string, attrs?: RunWriteAttributes): Promise<void>;
  /**
   * Terminalise a run to the `failed` state on a dispatch/setup error (BB-149).
   * PATCHes state=failed, records the failure detail in `error_log`, and closes
   * the run (closed + closed_date). `failed` is a terminal sibling of `expired`
   * (dispatch error vs lease lapse), so the run stops counting toward capacity
   * and its ticket is no longer blocked by the single-active-run gate — instead
   * of the old "leave it `claimed` to expire after ~300s" silent stall. The
   * failure is visible immediately and its cause is recorded.
   */
  markFailed(runUuid: string, errorLog: string): Promise<void>;
  /** Publishes one Markdown comment (type `comment`) on the ticket. */
  publishTicketComment(ticketUuid: string, body: string): Promise<void>;
  /**
   * Runs this conductor owns that are state in (done, cancelled) but not yet
   * closed — the conductor's one-shot finalisation work list. Cancelled runs
   * retain their transcript while their agent tab is stopped and closed.
   */
  fetchFinalizableRuns(conductorId: string): Promise<FinalizableRun[]>;
  /**
   * Finalise a run: set closed + closed_date, (when non-empty) log, and (when
   * given) the per-run footprint metrics (BB-132). No state change — the run
   * is already terminal.
   */
  finalizeRun(uuid: string, log: string, metrics?: RunMetrics): Promise<void>;
  /**
   * Closed tickets (closed=1) whose worktree is not yet torn down
   * (cleaned_up=0, or never written at all) — the conductor's teardown work
   * list (BB-89). Since BB-451 the server closes every terminal ticket on
   * its own save, so this asks one question — closed but not cleaned up —
   * with no workflow-state reasoning left in it. Driven by the durable
   * `cleaned_up` flag AND scoped to the reaping conductor (BB-121): only
   * tickets assigned to `conductorId` are loaded, so every ticket on the list
   * is unambiguously this conductor's — a missing worktree means "already torn
   * down on this host", not "belongs to another host". The same query backs
   * the live tick and the standalone `bakers oven clean`. Empty once every
   * closed ticket this conductor owns is cleaned.
   */
  fetchUncleanedTickets(conductorId: string): Promise<UncleanTicket[]>;
  /**
   * Mark a ticket's worktree torn down: set cleaned_up=true so it drops off the
   * {@link fetchUncleanedTickets} work list. Written ONLY after a verified
   * teardown, so a teardown miss leaves cleaned_up=0 and the next reconciliation
   * retries — one miss never orphans the workspace, and a re-run on an
   * already-cleaned ticket is a no-op (it is no longer on the list).
   */
  markTicketCleanedUp(uuid: string): Promise<void>;
  /**
   * Replace the ticket's `metrics` rows whose name starts with `namespace`
   * by `rows`, keeping every other row: one read and one PATCH of `metrics`
   * alone. The server keeps `metrics` writable on a closed ticket until it is
   * cleaned up, so the reaper calls this before teardown.
   */
  replaceTicketMetrics(
    uuid: string,
    namespace: string,
    rows: TicketMetric[],
  ): Promise<void>;
  /**
   * Open tickets assigned to this conductor that are frozen, each with its
   * latest run's worktree path ('' when none). Drives `on_freeze`/`on_resume`.
   */
  fetchFrozenTickets(conductorId: string): Promise<FrozenTicket[]>;
  /**
   * Append one diagnostic line to a run's log (BB-293) — how the reaper
   * records what it found on the run record itself, not only in this machine's
   * process log. Touches `log` alone: the run is already closed, and its
   * lifecycle fields are not this call's business. An empty `runUuid` writes
   * nothing.
   */
  appendRunNote(runUuid: string, note: string): Promise<void>;
  /**
   * Resolve a ticket identifier (e.g. "BB-134") to its uuid+title within a
   * project, or null when no such ticket exists. Used by the
   * `bakers deployment tickets` helper to turn commit-message identifiers into tickets.
   */
  resolveTicketByIdentifier(
    project: string,
    identifier: string,
  ): Promise<{ uuid: string; title: string } | null>;
  /**
   * Registers this conductor's addon definitions: each is upserted by name and
   * version and lists this conductor; rejected ones carry the server's reason.
   */
  registerAddons(
    conductorId: string,
    definitions: Array<AddonDefinitionV2>,
  ): Promise<AddonRegistration>;
  /** The conductor's pending inbox messages. */
  fetchInbox(conductorId: string): Promise<InboxSnapshot>;
  /** Answers an inbox message (by message UUID). */
  writeInboxResult(
    messageUuid: string,
    status: 'running' | 'done' | 'failed',
    result?: MessageResult,
  ): Promise<void>;
}
