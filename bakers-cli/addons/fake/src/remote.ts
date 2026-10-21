// BB-224 (Finding 6, decision 8): the in-memory fake remote — formerly
// `@bakers-build/core`'s `plugins/remote/fake.ts` — folded into the fake FIXTURE addon,
// which now ships the whole deterministic conductor triple (remote + workspace +
// executor). Workspace-only: never published.

import type {
  ActiveRun,
  AddonDefinitionV2,
  AddonRegistration,
  ClaimedRun,
  ClaimOptions,
  ConductorFileConfig,
  ConductorRegistration,
  ConductorStatus,
  FinalizableRun,
  FrozenTicket,
  BbRemote,
  InboxMessage,
  InboxSnapshot,
  RemotePlugin,
  RunMetrics,
  RunWriteAttributes,
  Ticket,
  TicketMetric,
  UncleanTicket,
} from '@bakers-build/conductor/contract';
import type { MessageResult } from '@bakers-build/message';

const ACTIVE = ['claimed', 'running'];

export interface FakeSeedRun {
  runUuid: string;
  /** Numeric (drupal_internal__id) run id. Defaults to a stable 1-based counter when omitted. */
  id?: number;
  ticketUuid: string;
  stateAtStart: string;
  /** Override the initial state (defaults to stateAtStart). */
  state?: string;
  handler?: string;
  worktreePath?: string;
  closed?: boolean;
  /** Id of the agent that ran (BB-144) — routes footprint parsing at finalize. */
  agent?: string;
}

export interface FakeSeedTicket {
  identifier: string;
  title: string;
  state: string;
  branchName?: string;
  /** Computed base branch (parent branch / project default / 'main'). */
  baseBranch?: string;
  /** Effective env vars (parent-chain resolved) as `.env`-style lines. */
  effectiveEnvVars?: string;
  url?: string;
  workflow?: string;
  /** BB-495: project/workspace context, mirroring the drupal remote's resolved fields. */
  projectId?: string;
  projectName?: string;
  workspaceId?: string;
  workspaceName?: string;
  /** Label term names sideloaded for agent selection (BB-144). */
  labels?: string[];
  /** Environments sideloaded for agent selection (BB-144). */
  environments?: { name: string; tier: string }[];
  /** Whether the ticket is already closed (its lifecycle wound up). */
  closed?: boolean;
  /** Whether the ticket's worktree is already torn down (cleaned_up flag). */
  cleanedUp?: boolean;
  /** Whether the ticket's links hold a merge request. */
  hasMr?: boolean;
  /** The ticket's `metrics` rows. */
  metrics?: TicketMetric[];
  /**
   * machine_id of the conductor this ticket is assigned to (BB-121). Omit to
   * mean "belongs to the querying conductor" (the common case for reaper tests);
   * set an explicit value to test conductor-scoping, or `''` for unassigned.
   */
  conductorId?: string;
  /** Whether the ticket is frozen (held out of claiming). */
  frozen?: boolean;
}

export interface FakeRemoteSeed {
  runs?: FakeSeedRun[];
  tickets?: Record<string, FakeSeedTicket>;
}

interface RunRecord {
  runUuid: string;
  runId: number;
  ticketUuid: string;
  handler: string;
  state: string;
  stateAtStart: string;
  worktreePath?: string;
  agent?: string;
  log?: string;
  closed?: boolean;
  startedAt?: string;
}

export interface MarkRunningCall {
  runUuid: string;
  attrs?: {
    worktree_path?: string;
    agent?: string;
    startedAt?: string | number;
  };
}

export interface FinalizeRunCall {
  runUuid: string;
  log: string;
  metrics?: RunMetrics;
}

/** One recorded {@link FakeBbRemote.appendRunNote} call (BB-293). */
export interface AppendRunNoteCall {
  runUuid: string;
  note: string;
}

export interface MarkFailedCall {
  runUuid: string;
  errorLog: string;
}

interface FakeMachineState {
  maxParallel: number;
  /** Per-conductor load contributions; machine current_load is their sum. */
  conductorLoads: Map<string, number>;
}

export class FakeBbRemote implements BbRemote {
  readonly calls: {
    markRunning: MarkRunningCall[];
    markFailed: MarkFailedCall[];
    finalizeRun: FinalizeRunCall[];
    markCleanedUp: string[];
    appendRunNote: AppendRunNoteCall[];
  } = {
    markRunning: [],
    markFailed: [],
    finalizeRun: [],
    markCleanedUp: [],
    appendRunNote: [],
  };

  /**
   * Override for reconcile tests: when set, `fetchActiveRuns` returns this
   * list verbatim instead of deriving it from the internal runs map.
   */
  activeRuns: ActiveRun[] | null = null;

  private readonly runs = new Map<string, RunRecord>();
  /** Claim queue — public so unit tests can enqueue without re-seeding runs. */
  readonly queue: ClaimedRun[] = [];
  private readonly tickets: Record<string, FakeSeedTicket>;
  private conductorStatus = 'online';
  /** Stable counter for assigning numeric ids to unseeded runs. */
  private runIdCounter = 0;
  /** Host machines keyed by host_key (BB-353 D5 shared budget). */
  private readonly machines = new Map<string, FakeMachineState>();

  /** Addon definitions as last registered. */
  registeredAddons: AddonDefinitionV2[] = [];
  /** Addon name → rejection reason, for registration tests. */
  readonly rejectAddons = new Map<string, string>();
  /** Inbox messages; one leaves the pending list once answered terminally. */
  private readonly inbox: InboxMessage[] = [];
  /** Every result write, in order. */
  readonly results: Array<{
    id: string;
    status: string;
    result?: MessageResult;
  }> = [];
  /** `name@version` → the id of its stored addon row. */
  private readonly addonIds = new Map<string, string>();
  /** How many addon rows were deleted; new rows get a fresh id. */
  private deletedAddons = 0;

  constructor(seed: FakeRemoteSeed = {}) {
    this.tickets = seed.tickets ?? {};
    for (const r of seed.runs ?? []) {
      const handler = r.handler ?? 'code';
      // Use the seeded id when provided; otherwise assign a deterministic counter.
      const runId = r.id ?? ++this.runIdCounter;
      this.runs.set(r.runUuid, {
        runUuid: r.runUuid,
        runId,
        ticketUuid: r.ticketUuid,
        handler,
        state: r.state ?? r.stateAtStart,
        stateAtStart: r.stateAtStart,
        ...(r.worktreePath !== undefined
          ? { worktreePath: r.worktreePath }
          : {}),
        ...(r.agent !== undefined ? { agent: r.agent } : {}),
        ...(r.closed !== undefined ? { closed: r.closed } : {}),
      });
      this.queue.push({
        runUuid: r.runUuid,
        runId,
        ticketUuid: r.ticketUuid,
        stateAtStart: r.stateAtStart,
        handler,
      });
    }
  }

  async registerConductor(reg: ConductorRegistration): Promise<string> {
    this.conductorStatus = 'online';
    // Ensure the host machine exists so machineCapacity is readable after
    // registration even before the first heartbeat with a non-zero load.
    this.touchMachine(reg.host_key ?? reg.id, reg.id, 0, reg.max_parallel);
    return 'fake-conductor-uuid';
  }

  async heartbeat(
    reg: ConductorRegistration,
    currentLoad: number,
    _leaseSeconds?: number,
  ): Promise<string> {
    // Mirrors the server: a heartbeat always brings the conductor online and
    // replaces this conductor's contribution to machine.current_load (D5).
    this.conductorStatus = 'online';
    this.touchMachine(
      reg.host_key ?? reg.id,
      reg.id,
      currentLoad,
      reg.max_parallel,
    );
    return this.conductorStatus;
  }

  async getConductorStatus(_conductorId: string): Promise<string | null> {
    return this.conductorStatus;
  }

  async setConductorStatus(
    _conductorId: string,
    status: 'offline',
  ): Promise<void> {
    this.conductorStatus = status;
  }

  async listConductors(_owner?: 'me'): Promise<ConductorStatus[]> {
    return [];
  }

  async activeRunCount(_conductorId: string): Promise<number> {
    return this.internalActiveRuns().length;
  }

  /**
   * Test orchestration only: flips a run's state to `done` so a later
   * `tick()` finalises it (BB-473 round 4) — used to drive a run through
   * TWO real dispatches (a re-dispatch of the same runUuid, exercising the
   * `sessionExists` guard for real) before its single finalise, which is the
   * shape review round 3 asked the regression be written at. No public
   * `BbRemote` method flips state to `done` client-side — the server does,
   * on the agent's own PATCH — so this exists purely for the fake.
   */
  markDone(runUuid: string): void {
    const r = this.runs.get(runUuid);
    if (r) {
      r.state = 'done';
    }
  }

  /**
   * Seed peer/host load for multi-conductor budget tests (BB-353 D5).
   * Uses a synthetic peer key so a later heartbeat for the real conductor
   * replaces only that conductor's contribution and keeps the peer load.
   */
  seedMachineLoad(
    hostKey: string,
    opts: { currentLoad: number; maxParallel?: number },
  ): void {
    const m = this.machines.get(hostKey) ?? {
      maxParallel: opts.maxParallel ?? 1,
      conductorLoads: new Map<string, number>(),
    };
    m.conductorLoads.set('__peer__', opts.currentLoad);
    if (opts.maxParallel !== undefined) {
      m.maxParallel = opts.maxParallel;
    }
    this.machines.set(hostKey, m);
  }

  async machineCapacity(
    hostKey: string,
  ): Promise<{ maxParallel: number; currentLoad: number } | null> {
    const m = this.machines.get(hostKey);
    if (!m) return null;
    let currentLoad = 0;
    for (const load of m.conductorLoads.values()) {
      currentLoad += load;
    }
    return { maxParallel: m.maxParallel, currentLoad };
  }

  private touchMachine(
    hostKey: string,
    conductorId: string,
    load: number,
    maxParallel: number,
  ): void {
    const existing = this.machines.get(hostKey);
    if (existing) {
      // BB-464 D2 (mirrored): the budget is set once, at machine creation,
      // and never rewritten by a later heartbeat — otherwise two conductors
      // configured with different max_parallel values flip the host budget
      // back and forth with whichever process heartbeat last.
      existing.conductorLoads.set(conductorId, load);
      return;
    }
    this.machines.set(hostKey, {
      maxParallel:
        Number.isFinite(maxParallel) && maxParallel >= 1 ? maxParallel : 1,
      conductorLoads: new Map<string, number>([[conductorId, load]]),
    });
  }

  async fetchActiveRuns(_conductorId: string): Promise<ActiveRun[]> {
    if (this.activeRuns !== null) {
      return this.activeRuns;
    }
    return this.internalActiveRuns().map((r) => {
      const ticket = this.tickets[r.ticketUuid];
      const identifier = ticket?.identifier ?? '';
      const branchName =
        ticket?.branchName ??
        (identifier ? `bakers/${identifier.toLowerCase()}` : '');
      return {
        runUuid: r.runUuid,
        ticketUuid: r.ticketUuid,
        ticketIdentifier: identifier,
        branchName,
        state: r.state,
        stateAtStart: r.stateAtStart,
        worktreePath: r.worktreePath ?? '',
      };
    });
  }

  async claimNext(_claim: ClaimOptions): Promise<ClaimedRun | null> {
    return this.queue.shift() ?? null;
  }

  async getTicket(ticketUuid: string): Promise<Ticket> {
    const t = this.tickets[ticketUuid];
    if (!t) {
      throw new Error(`fake remote: ticket ${ticketUuid} not seeded`);
    }
    const branchName = t.branchName ?? `bakers/${t.identifier.toLowerCase()}`;
    return {
      uuid: ticketUuid,
      identifier: t.identifier,
      title: t.title,
      state: t.state,
      branchName,
      ...(t.baseBranch ? { baseBranch: t.baseBranch } : {}),
      ...(t.effectiveEnvVars ? { effectiveEnvVars: t.effectiveEnvVars } : {}),
      ...(t.url ? { issueUrl: t.url } : {}),
      ...(t.projectId ? { projectId: t.projectId } : {}),
      ...(t.projectName ? { projectName: t.projectName } : {}),
      ...(t.workspaceId ? { workspaceId: t.workspaceId } : {}),
      ...(t.workspaceName ? { workspaceName: t.workspaceName } : {}),
      labels: t.labels ?? [],
      environments: t.environments ?? [],
    };
  }

  async getReachableWorkspaces(): Promise<string[]> {
    return [
      ...new Set(
        Object.values(this.tickets)
          .map((t) => t.workspaceId)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
  }

  async getRunWorktree(runUuid: string): Promise<string> {
    return this.runs.get(runUuid)?.worktreePath ?? '';
  }

  async getRunTicketIdentifier(runUuid: string): Promise<string> {
    const ticketUuid = this.runs.get(runUuid)?.ticketUuid;
    if (!ticketUuid) {
      return '';
    }
    return this.tickets[ticketUuid]?.identifier ?? '';
  }

  async getRunTicketBranchName(runUuid: string): Promise<string> {
    const ticketUuid = this.runs.get(runUuid)?.ticketUuid;
    if (!ticketUuid) {
      return '';
    }
    const ticket = this.tickets[ticketUuid];
    if (!ticket) {
      return '';
    }
    return ticket.branchName ?? `bakers/${ticket.identifier.toLowerCase()}`;
  }

  async markRunning(
    runUuid: string,
    attrs?: RunWriteAttributes,
  ): Promise<void> {
    this.calls.markRunning.push({
      runUuid,
      ...(attrs
        ? {
            attrs: {
              ...(attrs.worktree_path
                ? { worktree_path: attrs.worktree_path }
                : {}),
              ...(attrs.agent ? { agent: attrs.agent } : {}),
              ...(attrs.startedAt ? { startedAt: attrs.startedAt } : {}),
            },
          }
        : {}),
    });
    const run = this.runs.get(runUuid);
    if (run) {
      run.state = 'running';
      if (attrs?.worktree_path) {
        run.worktreePath = attrs.worktree_path;
      }
      if (attrs?.agent) {
        run.agent = attrs.agent;
      }
      if (attrs?.startedAt !== undefined) {
        // Mirrors the real remote's round trip (review round 4, Critical 1):
        // written as epoch seconds, read back as an ISO string — a number
        // here is normalised the same way so a test can pass either shape.
        run.startedAt =
          typeof attrs.startedAt === 'number'
            ? new Date(attrs.startedAt * 1000).toISOString()
            : attrs.startedAt;
      }
    }
  }

  async markFailed(runUuid: string, errorLog: string): Promise<void> {
    this.calls.markFailed.push({ runUuid, errorLog });
    const run = this.runs.get(runUuid);
    if (run) {
      run.state = 'failed';
      run.closed = true;
    }
  }

  async fetchFinalizableRuns(_conductorId: string): Promise<FinalizableRun[]> {
    return [...this.runs.values()]
      .filter(
        (r) => (r.state === 'done' || r.state === 'cancelled') && !r.closed,
      )
      .map((r) => ({
        runUuid: r.runUuid,
        runId: r.runId,
        ticketUuid: r.ticketUuid,
        stateAtStart: r.stateAtStart,
        worktreePath: r.worktreePath ?? '',
        agent: r.agent ?? '',
        ...(r.startedAt ? { startedAt: r.startedAt } : {}),
      }));
  }

  async finalizeRun(
    runUuid: string,
    log: string,
    metrics?: RunMetrics,
  ): Promise<void> {
    this.calls.finalizeRun.push({
      runUuid,
      log,
      ...(metrics ? { metrics } : {}),
    });
    const run = this.runs.get(runUuid);
    if (run) {
      run.closed = true;
      if (log) run.log = log;
    }
  }

  async fetchUncleanedTickets(conductorId: string): Promise<UncleanTicket[]> {
    // Scoped to the querying conductor (BB-121). A seed without an explicit
    // `conductorId` defaults to the querying conductor (the common reaper-test
    // case); an explicit value scopes it, and `''` models an unassigned ticket.
    // Since BB-451 the server closes every terminal ticket on its own save,
    // so this asks one question — closed but not cleaned up — with no
    // workflow-state reasoning left in it; `!t.cleanedUp` is true for both an
    // explicit `false` and a never-written (`undefined`) flag, covering the
    // real remote's two separate queries in one fixture-level check.
    return Object.entries(this.tickets)
      .filter(
        ([, t]) =>
          t.closed &&
          !t.cleanedUp &&
          (t.conductorId ?? conductorId) === conductorId,
      )
      .map(([ticketUuid, t]) => ({
        ticketUuid,
        branchName: t.branchName ?? `bakers/${t.identifier.toLowerCase()}`,
        state: t.state,
        baseBranch: t.baseBranch ?? '',
        hasMr: t.hasMr ?? false,
        ...this.latestRun(ticketUuid),
      }));
  }

  async fetchFrozenTickets(conductorId: string): Promise<FrozenTicket[]> {
    return Object.entries(this.tickets)
      .filter(
        ([, t]) =>
          t.frozen &&
          !t.closed &&
          (t.conductorId ?? conductorId) === conductorId,
      )
      .map(([ticketUuid, t]) => ({
        ticketUuid,
        identifier: t.identifier,
        worktreePath: this.latestRun(ticketUuid).worktreePath,
      }));
  }

  async appendRunNote(runUuid: string, note: string): Promise<void> {
    this.calls.appendRunNote.push({ runUuid, note });
    const run = this.runs.get(runUuid);
    if (!run) {
      return;
    }
    run.log = run.log ? `${run.log}\n${note}` : note;
  }

  async replaceTicketMetrics(
    uuid: string,
    namespace: string,
    rows: TicketMetric[],
  ): Promise<void> {
    const t = this.tickets[uuid];
    if (t) {
      t.metrics = [
        ...(t.metrics ?? []).filter((m) => !m.name.startsWith(namespace)),
        ...rows,
      ];
    }
  }

  async markTicketCleanedUp(uuid: string): Promise<void> {
    this.calls.markCleanedUp.push(uuid);
    const t = this.tickets[uuid];
    if (t) {
      t.cleanedUp = true;
    }
  }

  async resolveTicketByIdentifier(
    _project: string,
    identifier: string,
  ): Promise<{ uuid: string; title: string } | null> {
    const hit = Object.entries(this.tickets).find(
      ([, t]) => t.identifier === identifier,
    );
    return hit ? { uuid: hit[0], title: hit[1].title ?? '' } : null;
  }

  /**
   * UUID + worktree path of the ticket's most recently seeded run carrying a
   * path, or empty strings when none (BB-293 — the reaper notes an absent
   * teardown on that run).
   */
  private latestRun(ticketUuid: string): {
    runUuid: string;
    worktreePath: string;
  } {
    let latest = { runUuid: '', worktreePath: '' };
    for (const r of this.runs.values()) {
      if (r.ticketUuid === ticketUuid && r.worktreePath) {
        latest = { runUuid: r.runUuid, worktreePath: r.worktreePath };
      }
    }
    return latest;
  }

  async registerAddons(
    _conductorId: string,
    definitions: AddonDefinitionV2[],
  ): Promise<AddonRegistration> {
    this.registeredAddons = definitions;
    const out: AddonRegistration = { accepted: [], rejected: [] };
    for (const d of definitions) {
      const error = this.rejectAddons.get(d.name);
      if (error) out.rejected.push({ name: d.name, version: d.version, error });
      else {
        const key = `${d.name}@${d.version}`;
        // A row created after a delete gets a new id, as on the server.
        const suffix = this.deletedAddons ? `-${this.deletedAddons}` : '';
        const id =
          this.addonIds.get(key) ?? `addon-${d.name}-${d.version}${suffix}`;
        this.addonIds.set(key, id);
        out.accepted.push({ name: d.name, version: d.version, id });
      }
    }
    return out;
  }

  /** Queues an inbox message for the next poll. */
  enqueue(message: InboxMessage): void {
    this.inbox.push(message);
  }

  async fetchInbox(_conductorId: string): Promise<InboxSnapshot> {
    const answered = new Set(
      this.results.filter((r) => r.status !== 'running').map((r) => r.id),
    );
    return {
      messages: this.inbox.filter((m) => !answered.has(m.id)),
    };
  }

  async writeInboxResult(
    messageUuid: string,
    status: 'running' | 'done' | 'failed',
    result?: MessageResult,
  ): Promise<void> {
    this.results.push({
      id: messageUuid,
      status,
      ...(result ? { result } : {}),
    });
  }

  /** Drops a stored addon row, as an administrator's delete would. */
  deleteAddon(addonUuid: string): void {
    for (const [key, id] of this.addonIds) {
      if (id === addonUuid) this.addonIds.delete(key);
    }
    this.deletedAddons++;
  }

  /** The run's log as recorded so far — the read side of appendRunNote. */
  runLog(runUuid: string): string {
    return this.runs.get(runUuid)?.log ?? '';
  }

  private internalActiveRuns(): RunRecord[] {
    return [...this.runs.values()].filter((r) => ACTIVE.includes(r.state));
  }
}

export function fakeRemote(seed: FakeRemoteSeed = {}): RemotePlugin {
  const remote = new FakeBbRemote(seed);
  return {
    kind: 'remote',
    id: 'fake',
    requiredModules: [],
    async createRemote(_config: ConductorFileConfig) {
      return remote;
    },
  };
}
