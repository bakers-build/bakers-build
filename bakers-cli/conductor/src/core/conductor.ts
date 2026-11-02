import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import {
  type ConductorLogger,
  shellQuote,
  stemForConfigFile,
} from '@bakers-build/core';
import {
  type BbAgent,
  DEFAULT_ENV_DENY,
  matchesEnvDeny,
  type RunEnvPolicy,
} from '../plugins/agent.js';
import type {
  BbExecutor,
  HookListenerContext,
  HookName,
  HookResult,
  WorktreeTeardown,
} from '../plugins/executor.js';
import { type ResolvedAgent, resolveAgent } from '../plugins/plugins.js';
import type {
  BbRemote,
  ClaimedRun,
  ConductorRegistration,
  FinalizableRun,
  FrozenTicket,
  RunMetrics,
  Ticket,
  UncleanTicket,
} from '../plugins/remote.js';
import { sandboxFailures } from '../plugins/sandbox-preflight.js';
import type { BbWorkspace, EnsuredWorkspace } from '../plugins/workspace.js';
import type { ConductorFileConfig } from '../types.js';
import { ActionQueue } from './action-queue.js';
import { attemptFamily } from './attempt.js';
import { hostKeyOf } from './host-key.js';
import { InboxRuntime, runInbox } from './inbox-runtime.js';
import { measureMrChanges, mrChangesRows } from './mr-changes.js';

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * A run-env key is reserved when it names a conductor-provided core variable:
 * any `BB_*`, `WORKSPACE_ROOT`, or `TICKET_URL`. User `env_vars` may not
 * clobber these — the core vars always win (BB-99).
 */
function isReservedEnvKey(key: string): boolean {
  return (
    key.startsWith('BB_') || key === 'WORKSPACE_ROOT' || key === 'TICKET_URL'
  );
}

/** A portable environment variable name. */
const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * What a failed listener is logged as: the error's class name, never its
 * message — listener text may carry an env value (BB-599).
 */
function errorKind(err: unknown): string {
  return err instanceof Error ? err.name : typeof err;
}

/**
 * Parse the server-canonicalised effective env_vars (`KEY=value` lines, one per
 * line) into a map. The server already stripped comments/blank/malformed lines,
 * so this is deliberately minimal: split on the first `=`, keep a valid key.
 * Defensive against stray blank lines only — never throws.
 */
function parseEnvLines(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line === '') {
      continue;
    }
    const eq = line.indexOf('=');
    if (eq <= 0) {
      continue;
    }
    const key = line.slice(0, eq);
    if (!ENV_KEY.test(key)) {
      continue;
    }
    out[key] = line.slice(eq + 1);
  }
  return out;
}

/**
 * Resolve the environment a run executes in (BB-99): parse the ticket's
 * effective env_vars, drop any reserved key (loud warn — key NAME only, never
 * the value), then overlay the conductor's core vars so they always win.
 *
 * Values are potentially secret (e.g. a DB DSN): this function logs key names
 * only, never a value. The returned map is injected into BOTH the agent run env
 * and every workspace hook.
 */
export function resolveRunEnv(
  effectiveEnvVars: string | undefined,
  core: Record<string, string>,
  logger: ConductorLogger,
  scope: { ticket?: string; policy?: RunEnvPolicy } = {},
): Record<string, string> {
  const policy = scope.policy ?? { drop: true, deny: DEFAULT_ENV_DENY };
  const user = effectiveEnvVars ? parseEnvLines(effectiveEnvVars) : {};
  const clobbered: string[] = [];
  const denied: string[] = [];
  const safe: Record<string, string> = {};
  for (const [key, value] of Object.entries(user)) {
    if (isReservedEnvKey(key)) {
      clobbered.push(key);
      continue;
    }
    if (matchesEnvDeny(key, policy.deny)) {
      denied.push(key);
      if (policy.drop) continue;
    }
    safe[key] = value;
  }
  if (clobbered.length > 0) {
    logger.warn(
      { keys: clobbered },
      'ignored reserved keys in ticket env_vars (core vars win)',
    );
  }
  if (denied.length > 0) {
    logger.warn(
      { ticket: scope.ticket, keys: denied },
      policy.drop
        ? 'dropped denied keys from ticket env_vars (agent run-env policy)'
        : 'passed denied keys from ticket env_vars (agent security: yolo)',
    );
  }
  // Core vars overlay last — they can never be overridden.
  return { ...safe, ...core };
}

/**
 * Where a conductor keeps its own record of which worktrees have a
 * successfully completed `after_create` (BB-663), beside its config file —
 * same pattern as `frozenStateFile` — rather than inside the worktree. An
 * in-tree marker gets picked up by a stray `git add -A`/commit (review F1):
 * once merged, every checkout of that commit then LOOKS bootstrapped and
 * silently skips `after_create` forever. Keyed by worktree path, not by
 * conductor instance, so it survives both a conductor restart and a fresh
 * `Conductor` object dispatching into the same path.
 */
function bootstrapStateFileOf(config: ConductorFileConfig): string {
  const file = config.config_path;
  return join(dirname(file), `${basename(file, '.js')}.bootstrapped.json`);
}

function loadBootstrapState(file: string): Record<string, boolean> {
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
}

function hasSucceededAfterCreate(file: string, worktreePath: string): boolean {
  return loadBootstrapState(file)[worktreePath] === true;
}

/** Best-effort, like `saveFrozenSeen`: an unwritable state file must not wedge dispatch. */
function recordAfterCreateOutcome(
  file: string,
  worktreePath: string,
  ok: boolean,
): void {
  try {
    const state = loadBootstrapState(file);
    if (ok) state[worktreePath] = true;
    else delete state[worktreePath];
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify(state)}\n`);
  } catch {
    // best-effort: a later dispatch simply re-runs after_create.
  }
}

function renderPrompt(
  template: string,
  values: {
    identifier: string;
    state: string;
    runUuid: string;
    ticketUuid: string;
  },
): string {
  return template
    .replaceAll('{identifier}', values.identifier)
    .replaceAll('{state}', values.state)
    .replaceAll('{runUuid}', values.runUuid)
    .replaceAll('{ticketUuid}', values.ticketUuid);
}

export class Conductor {
  private uuid: string | null = null;
  /**
   * Frozen tickets seen on the last poll, by uuid, with the worktree their
   * hook ran in. Mirrored to `frozenStateFile` when one is given, so an
   * unfreeze while the conductor is down still gets its `on_resume` and a
   * restart does not repeat `on_freeze`; loaded on the first observation.
   */
  private frozenSeen: Map<
    string,
    { identifier: string; worktreePath: string }
  > | null = null;

  /** The addons with contract-2 inbox messages this conductor runs. */
  private readonly inboxAddons: InboxRuntime;

  /** The per-item work each tick enqueues. */
  private readonly queue: ActionQueue;

  /** Serializes git worktree add/remove: parallel ones fight over git locks. */
  private gitLock: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly config: ConductorFileConfig,
    private readonly remote: BbRemote,
    private readonly executor: BbExecutor,
    private readonly workspace: BbWorkspace,
    private readonly agents: ResolvedAgent[],
    private readonly logger: ConductorLogger,
    private readonly checkoutRoot = process.cwd(),
    private readonly frozenStateFile?: string,
  ) {
    this.inboxAddons = new InboxRuntime(
      config.inboxAddons ?? [],
      remote,
      logger,
      (ticket) => this.runEnv(ticket, undefined, ticket.state),
    );
    this.queue = new ActionQueue(logger);
  }

  private serialGit<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.gitLock.then(fn);
    this.gitLock = result.catch(() => {});
    return result;
  }

  /**
   * `conductor_id` is required and the loader throws without it (BB-353), so
   * there is no directory-derived fallback here (BB-450 D5) — that fallback
   * was the mechanism by which one checkout came to be registered under two
   * different ids.
   */
  get id() {
    const id = this.config.conductor_id ?? this.config.machine_id;
    if (id === undefined || id.trim() === '') {
      throw new Error('conductor config has no conductor_id');
    }
    return id;
  }

  /**
   * Host stem for bb_machine.host_key. Prefer config.host_key from
   * MachineContext.machine_id; fall back to a best-effort parse of the composed
   * conductor_id only when the loader could not supply the stem.
   */
  private get hostKey(): string {
    return hostKeyOf(this.config);
  }

  /**
   * Whether this instance is the serve-loop process itself (BB-232).
   *
   * Off by default so that only a caller which genuinely owns the process can
   * report a pid — see {@link claimServeProcess}.
   */
  private ownsServeProcess = false;

  /**
   * Declares that this instance runs *as* the conductor process, so its
   * registrations may carry the process identity a cockpit needs to stop it.
   *
   * Only `cmdStartForeground` calls this. `cmdPoll` and `cmdReap` also build a
   * Conductor and call start() + tick(), then exit; if they reported a pid,
   * every `bakers oven once` would overwrite the running conductor's pid
   * with its own short-lived one and the next stop would signal a dead — or
   * recycled — process. Making the report opt-in means those two commands
   * cannot do so even by accident.
   */
  claimServeProcess(): void {
    this.ownsServeProcess = true;
  }

  /** This conductor's registration payload, built from config. */
  private registration(): ConductorRegistration {
    const base: ConductorRegistration = {
      id: this.id,
      host_key: this.hostKey,
      project: this.config.project,
      states: this.config.states,
      workspace: this.checkoutRoot,
      label: this.config.label,
      max_parallel: this.config.max_parallel,
    };
    if (!this.ownsServeProcess) return base;
    return {
      ...base,
      last_pid: process.pid,
      ...(this.conductorName ? { conductor_name: this.conductorName } : {}),
    };
  }

  /**
   * The stem of the config file this conductor was loaded from.
   *
   * Derived through core's own mapping rather than by slicing the filename
   * here, so the CLI and the conductor cannot disagree about which files count
   * as a conductor config.
   */
  private get conductorName(): string | undefined {
    const path = this.config.config_path;
    return path ? stemForConfigFile(basename(path)) : undefined;
  }

  async start() {
    this.uuid = await this.remote.registerConductor(this.registration());
    this.logger.info(
      { conductorId: this.id, uuid: this.uuid, project: this.config.project },
      'conductor started',
    );
    try {
      await this.inboxAddons.register(this.id);
    } catch (err) {
      // Without addons nothing depends on it (and an older server has no
      // registration resource); with addons the tick retries it.
      const log = this.inboxAddons.empty ? this.logger.warn : this.logger.error;
      log.call(
        this.logger,
        { conductorId: this.id, err: String(err) },
        'addon registration failed',
      );
    }
    for (const line of await sandboxFailures(this.agents)) {
      this.logger.error({ conductorId: this.id }, line);
    }
  }

  /** One tick that also waits for its actions: `bakers oven once`, tests. */
  async tick(): Promise<void> {
    await this.produce();
    await this.queue.drain();
  }

  /** A failing list query must not stop the other steps or the claims. */
  private async step(name: string, fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
    } catch (err) {
      this.logger.warn(
        { conductorId: this.id, err: String(err) },
        `${name} query failed`,
      );
    }
  }

  /**
   * The tick body: heartbeat, the list queries and the claim loop. Every
   * per-item job becomes an action on the queue, so no slow item can delay
   * the heartbeat or the claims.
   */
  async produce(): Promise<void> {
    if (!this.uuid) throw new Error('not started');
    let count = await this.remote.activeRunCount(this.id);
    // A heartbeat is the server-side self-heal: it upserts by conductor_id (so
    // it never 404s and recreates a vanished registration) and refreshes the
    // lease — no client-side re-register, no separate status read. It also
    // recomputes bb_machine.current_load (peers + this process's load).
    await this.remote.heartbeat(
      this.registration(),
      count,
      this.config.lease_seconds,
    );
    // BB-353 D5: gate claims on the shared host budget, not only this
    // process's active runs. After the heartbeat above, machine.current_load
    // includes peers + self; each claim below increments the local view so
    // pending dispatches count without a second round-trip.
    const capacity = await this.remote.machineCapacity(this.hostKey);
    let machineLoad = capacity?.currentLoad ?? count;
    // BB-464 D3: gate on the MACHINE's own budget, not this conductor's
    // config — the machine row is the one authority a shared host agrees on;
    // falling back to config.max_parallel only when the row is unreadable.
    const maxParallel = capacity?.maxParallel ?? this.config.max_parallel;
    this.logger.info(
      {
        conductorId: this.id,
        active: count,
        machineLoad,
        capacity: maxParallel,
      },
      'conductor tick',
    );
    if (machineLoad > maxParallel) {
      // BB-464 D4: a breach is its own signal, not merely the reason no
      // further claim was made — this server-side ceiling (TicketClaimService)
      // is the actual guard; this is visibility into how it was reached.
      this.logger.warn(
        { conductorId: this.id, machineLoad, capacity: maxParallel },
        'machine over its shared host budget',
      );
    }
    // A hung action blocks only its ticket's lane; make it visible.
    this.queue.warnOverdue(this.config.lease_seconds * 1000);
    await this.step('finalize', () => this.enqueueFinalize());
    await this.step('reap', () => this.enqueueReap());
    await this.step('freeze', () => this.observeFreezes());
    await runInbox(
      this.remote,
      this.inboxAddons,
      this.id,
      this.logger,
      this.queue,
    );
    // A run that cannot start its sandbox would only fail and count against
    // the retry cap; claim nothing until every enabled agent can start.
    const unavailable =
      machineLoad < maxParallel ? await sandboxFailures(this.agents) : [];
    for (const line of unavailable) {
      this.logger.warn({ conductorId: this.id }, `claims withheld: ${line}`);
    }
    let claimed = 0;
    let withheld = unavailable.length > 0;
    while (!withheld && machineLoad < maxParallel) {
      const run = await this.remote.claimNext({
        leaseSeconds: this.config.lease_seconds,
        conductorId: this.id,
      });
      if (!run) break;
      if ('reason' in run) {
        withheld = true;
        this.logger.info(
          { conductorId: this.id, ...run, reportedLoad: machineLoad },
          'claim withheld: machine at capacity',
        );
        break;
      }
      this.logger.info(
        { conductorId: this.id, run: run.runUuid, ticket: run.ticketUuid },
        'claimed run',
      );
      this.queue.enqueue({
        key: `dispatch:${run.runUuid}`,
        lane: run.ticketUuid,
        run: () => this.dispatchOrFail(run),
      });
      count += 1;
      machineLoad += 1;
      claimed += 1;
    }
    if (claimed > 0) {
      // BB-464 AC 2: push this tick's claims into the machine row's load
      // immediately, so a peer conductor ticking next reads the up-to-date
      // figure instead of the pre-claim snapshot this tick started from. The
      // staleness window this closes is what let sequential ticks reach the
      // sum of both conductors' budgets rather than the shared ceiling.
      await this.remote.heartbeat(
        this.registration(),
        count,
        this.config.lease_seconds,
      );
    }
    if (claimed === 0 && !withheld) {
      this.logger.info(
        {
          conductorId: this.id,
          active: count,
          machineLoad,
          capacity: maxParallel,
        },
        machineLoad >= maxParallel
          ? 'at capacity, nothing claimed'
          : 'idle, nothing to claim',
      );
    }
  }

  /**
   * One-shot finalisation: for each of this conductor's runs that is state in
   * (done, cancelled) but not yet closed, read the agent transcript from its
   * worktree and write it as the final log, then mark the run closed. Keyed off
   * the durable terminal-state query — no in-memory state, so a restarted
   * conductor still finalises any unclosed run on its next tick.
   */
  private async enqueueFinalize(): Promise<void> {
    const runs = await this.remote.fetchFinalizableRuns(this.id);
    for (const r of runs) {
      this.queue.enqueue({
        key: `finalize:${r.runUuid}`,
        lane: r.ticketUuid || r.runUuid,
        run: () => this.finalizeOne(r),
      });
    }
  }

  /** Finalises one run; a failure is logged and retried next tick. */
  private async finalizeOne(r: FinalizableRun): Promise<void> {
    try {
      // Signal the agent to stop before capturing its log. Best-effort and
      // gated on the persistent capability (only hosted executors have a live
      // agent) — mirrors removeWorktree's gate. For herdr this is a no-op
      // (the tab-close in closeRunTab kills the PTY); a stop failure must
      // never block finalisation.
      const branch = this.executor.capabilities().persistent
        ? await this.remote.getRunTicketBranchName(r.runUuid)
        : '';
      if (branch) {
        try {
          await this.executor.stopRun(branch);
        } catch (err) {
          this.logger.warn(
            { run: r.runUuid, err: String(err) },
            'agent stop failed',
          );
        }
      }
      // BB-599: a failed capture must not skip the worker and sidecar
      // cleanup below, so it is held and re-thrown before the close write —
      // the run then stays unclosed and the next tick retries all of it.
      let captured: { log: string; metrics: RunMetrics } | undefined;
      let captureError: unknown;
      try {
        captured = await this.captureRun(r);
      } catch (err) {
        captureError = err;
      }
      // The transcript is captured, so killing the PTY is safe (BB-171).
      if (branch) await this.closeRunTab(branch, r.runUuid, r.runId);
      // BB-599: `after_run` fires at run end — after the worker is gone,
      // before the durable close. A failed close write repeats it next tick,
      // which is why listeners must be idempotent.
      await this.runFinalizeHook(r);
      if (!captured) throw captureError;
      // `?? true` is the default: an unset flag, and every config written
      // before this setting existed, keep uploading exactly as before.
      // `finalizeRun()` already spreads `...(log ? { log } : {})`, so an
      // empty string omits the attribute from the PATCH entirely — no
      // server change is needed and no empty log is written.
      const uploadedLog =
        (this.config.capture_logs ?? true) ? captured.log : '';
      await this.remote.finalizeRun(r.runUuid, uploadedLog, captured.metrics);
      this.logger.info(
        { run: r.runUuid, state: r.state, footprint: captured.metrics },
        'run finalised',
      );
    } catch (err) {
      this.logger.warn(
        { run: r.runUuid, err: String(err) },
        'run finalise failed',
      );
    }
  }

  /** Read the run's transcript and parse its footprint for the close write. */
  private async captureRun(
    r: FinalizableRun,
  ): Promise<{ log: string; metrics: RunMetrics }> {
    // Route to the agent that actually ran (BB-144): the persisted
    // run.agent id, falling back to the first candidate for a run written
    // before the field existed (empty id).
    const resolved =
      this.agents.find((a) => a.id === r.agent) ?? this.agents[0];
    if (!resolved) {
      throw new Error('no agent candidates configured for finalize');
    }
    // Scoped to this run's own identity (BB-473): the run's UUID as a
    // session id, its deterministic attempt family (review round 4,
    // Critical 2) so a re-dispatch resolves by WHICH attempt rather than
    // by a time window a sibling session could still beat, plus its
    // recorded start as a lower-bound tie-breaker for agents with no
    // session mechanism at all — so a foreign transcript left behind by
    // a resumed/re-dispatched/reused worktree can never be finalised
    // here.
    const log = r.worktreePath
      ? await resolved.agent.getRunLog(r.worktreePath, {
          sessionId: r.runUuid,
          attemptFamily: attemptFamily(r.runUuid),
          ...(r.startedAt ? { startedAt: r.startedAt } : {}),
        })
      : '';
    // Footprint (BB-132): the agent parses its own transcript for the
    // effort metrics AND its wall-clock duration_s (from the transcript's
    // first→last timestamps — BB-151). Deriving duration from the log
    // keeps it a single source with one format, avoiding the earlier
    // `started_at` re-read that mis-parsed the JSON:API ISO string to 0.
    // The conductor owns the run, so this write always lands (the agent
    // session could not).
    const parsed = resolved.agent.parseFootprint(log);
    // Runtime provenance beside the footprint: the harness that drove the
    // session, the model that actually ran, and the exact model id the
    // transcript records. All three ride the SAME close PATCH — no extra
    // write path, so the conductor-owner field access that already covers
    // the metrics covers these too.
    //
    // `model` and `model_version` each prefer an explicit configured pin
    // (`resolved.model` / `resolved.modelVersion`) when one is set — a
    // human's own answer beats a guess. Absent a pin, each falls back to
    // the raw, unmodified model id the transcript names (`parsed.model`)
    // rather than staying empty: that is the real model that ran, not a
    // fabricated placeholder. No per-harness splitting or abbreviation
    // happens on either source, which is what keeps the columns
    // comparable across harnesses. Each key is spread conditionally: an
    // unresolved value sends no key at all.
    const metrics: RunMetrics = {
      tokens: parsed.tokens,
      duration_s: parsed.duration_s,
      agent_turns: parsed.agent_turns,
      tool_calls: parsed.tool_calls,
      user_prompts: parsed.user_prompts,
      user_prompt_words: parsed.user_prompt_words,
      active_s: parsed.active_s,
      harness: resolved.id,
      ...(resolved.model !== undefined
        ? { model: resolved.model }
        : parsed.model !== undefined
          ? { model: parsed.model }
          : {}),
      ...(resolved.modelVersion !== undefined
        ? { model_version: resolved.modelVersion }
        : parsed.model !== undefined
          ? { model_version: parsed.model }
          : {}),
    };
    return { log, metrics };
  }

  /**
   * Close one run's tab. Run-scoped (BB-183): only the `#<runId>` tab, never
   * a sibling run's. Best-effort: a close failure never mislabels the run as
   * "finalise failed" or replaces a dispatch error.
   */
  private async closeRunTab(
    branch: string,
    runUuid: string,
    runId: number,
  ): Promise<void> {
    try {
      await this.executor.cleanupRun(branch, runId);
    } catch (err) {
      this.logger.warn(
        { run: runUuid, err: String(err) },
        'run tab cleanup failed',
      );
    }
  }

  /**
   * `after_run` for an ended run (BB-599), rebuilt from durable state: the
   * run record names its ticket and start state, and the env is resolved from
   * the CURRENT ticket — so a restarted conductor stops the same sidecars.
   * Like `after_done`, it needs the worktree directory to exist.
   */
  private async runFinalizeHook(r: FinalizableRun): Promise<void> {
    if (!r.worktreePath || !existsSync(r.worktreePath)) return;
    const ctx = await this.listenerContext(r.ticketUuid, r.worktreePath, {
      hook: 'after_run',
      run: { uuid: r.runUuid, id: r.runId },
      ...(r.stateAtStart ? { state: r.stateAtStart } : {}),
      agent: this.agents.find((a) => a.id === r.agent)?.agent,
    });
    await this.runSlot(
      'after_run',
      r.worktreePath,
      ctx?.ticket.identifier || r.ticketUuid || r.runUuid,
      ctx,
      ctx?.env,
    );
  }

  /**
   * Rebuild a listener context from the ticket's current record, or
   * `undefined` (logged) when it cannot be read — the caller still runs the
   * project shell hook, it only loses the addon listeners. Built even with no
   * listeners: the shell `after_run` takes its env from it.
   */
  private async listenerContext(
    ticketUuid: string | undefined,
    worktreePath: string,
    opts: {
      hook: HookName;
      run?: { uuid: string; id?: number };
      state?: string;
      /** The run's agent, whose env policy applies; omitted → the default. */
      agent?: BbAgent | undefined;
    },
  ): Promise<HookListenerContext | undefined> {
    try {
      if (!ticketUuid) throw new Error('run has no ticket');
      const ticket = await this.remote.getTicket(ticketUuid);
      return {
        worktreePath,
        ticket,
        state: opts.state ?? ticket.state,
        env: await this.runEnv(
          ticket,
          opts.run?.uuid,
          opts.state ?? ticket.state,
          opts.agent,
        ),
        ...(opts.run ? { run: opts.run } : {}),
      };
    } catch (err) {
      this.logger.warn(
        {
          hook: opts.hook,
          ticket: ticketUuid,
          run: opts.run?.uuid,
          err: String(err),
        },
        'hook listener context unavailable — listeners not run',
      );
      return undefined;
    }
  }

  private get listeners() {
    return this.config.hookListeners ?? [];
  }

  /**
   * Run one lifecycle slot (BB-599): every addon listener in accumulator
   * order, awaited, then the project shell hook through the executor. Never
   * throws. A failing listener is logged by slot, listener, ticket and run —
   * never with its message or the env — and reported in the returned result
   * the same way a failing shell command is, so the rest of the slot, the
   * shell hook and dispatch all continue.
   */
  private async runSlot(
    name: HookName,
    cwd: string,
    ticketRef: string,
    ctx: HookListenerContext | undefined,
    shellEnv: Record<string, string> | undefined,
  ): Promise<HookResult> {
    const failed: string[] = [];
    if (ctx) {
      const env = ctx.env;
      for (const [index, listener] of this.listeners.entries()) {
        const fn = listener[name];
        if (!fn) continue;
        const id = listener.id ?? `#${index}`;
        const before = { ...env };
        try {
          await fn(ctx);
        } catch (err) {
          failed.push(id);
          this.logger.error(
            {
              hook: name,
              listener: id,
              ticket: ticketRef,
              run: ctx.run?.uuid,
              err: errorKind(err),
            },
            'hook listener failed',
          );
        }
        ctx.env = env;
        this.guardEnv(env, before, {
          hook: name,
          listener: id,
          ticket: ticketRef,
        });
      }
    }
    const shell = await this.executor.runHook(
      name,
      cwd,
      { ticket: ticketRef },
      shellEnv,
    );
    if (failed.length === 0) return shell;
    const error = `hook listener failed: ${failed.join(', ')}`;
    return {
      hook: name,
      ran: true,
      ok: false,
      error: shell.ok ? error : `${shell.error}; ${error}`,
    };
  }

  /**
   * Undo a listener's env change the conductor does not accept: a reserved
   * key keeps the conductor's value, and an invalid name or a non-string value
   * never reaches a spawn. Key names only are logged.
   */
  private guardEnv(
    env: Record<string, string>,
    before: Record<string, string>,
    log: { hook: HookName; listener: string; ticket: string },
  ): void {
    const rejected: string[] = [];
    for (const key of Object.keys(env)) {
      const value: unknown = env[key];
      const ok = isReservedEnvKey(key)
        ? before[key] === value
        : ENV_KEY.test(key) && typeof value === 'string';
      if (ok) continue;
      rejected.push(key);
      if (key in before) env[key] = before[key] as string;
      else delete env[key];
    }
    for (const key of Object.keys(before)) {
      if (isReservedEnvKey(key) && !(key in env)) {
        env[key] = before[key] as string;
        rejected.push(key);
      }
    }
    if (rejected.length > 0) {
      this.logger.warn(
        { ...log, keys: rejected },
        'hook listener env change rejected',
      );
    }
  }

  /**
   * Run `on_freeze` once for each newly frozen ticket and `on_resume` once
   * for each that left the frozen list, in the ticket's worktree on this
   * machine. A ticket without a worktree here gets no hook. Never throws: an
   * unreadable list keeps the previous observation for the next poll.
   */
  private async observeFreezes(): Promise<void> {
    let frozen: FrozenTicket[];
    try {
      frozen = await this.remote.fetchFrozenTickets(this.id);
    } catch (err) {
      this.logger.warn(
        { conductorId: this.id, err: String(err) },
        'frozen tickets unreadable — freeze hooks deferred',
      );
      return;
    }
    const seen = this.loadFrozenSeen();
    const current = new Set(frozen.map((t) => t.ticketUuid));
    let changed = false;
    for (const [uuid, was] of [...seen]) {
      if (current.has(uuid)) continue;
      seen.delete(uuid);
      changed = true;
      this.queue.enqueue({
        key: `freeze:${uuid}:on_resume`,
        lane: uuid,
        run: () => this.runFreezeSlot('on_resume', uuid, was),
      });
    }
    for (const t of frozen) {
      if (seen.has(t.ticketUuid)) continue;
      seen.set(t.ticketUuid, {
        identifier: t.identifier,
        worktreePath: t.worktreePath,
      });
      changed = true;
      this.queue.enqueue({
        key: `freeze:${t.ticketUuid}:on_freeze`,
        lane: t.ticketUuid,
        run: () => this.runFreezeSlot('on_freeze', t.ticketUuid, t),
      });
    }
    if (changed) this.saveFrozenSeen(seen);
  }

  private loadFrozenSeen(): NonNullable<typeof this.frozenSeen> {
    if (this.frozenSeen) return this.frozenSeen;
    this.frozenSeen = new Map();
    const file = this.frozenStateFile;
    if (file && existsSync(file)) {
      try {
        this.frozenSeen = new Map(
          Object.entries(JSON.parse(readFileSync(file, 'utf8'))),
        );
      } catch (err) {
        this.logger.warn(
          { file, err: String(err) },
          'frozen ticket state unreadable — starting empty',
        );
      }
    }
    return this.frozenSeen;
  }

  private saveFrozenSeen(seen: NonNullable<typeof this.frozenSeen>): void {
    const file = this.frozenStateFile;
    if (!file) return;
    try {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, `${JSON.stringify(Object.fromEntries(seen))}\n`);
    } catch (err) {
      this.logger.warn(
        { file, err: String(err) },
        'frozen ticket state not saved',
      );
    }
  }

  private async runFreezeSlot(
    name: 'on_freeze' | 'on_resume',
    ticketUuid: string,
    t: { identifier: string; worktreePath: string },
  ): Promise<void> {
    if (!t.worktreePath || !existsSync(t.worktreePath)) return;
    const ctx = await this.listenerContext(ticketUuid, t.worktreePath, {
      hook: name,
    });
    await this.runSlot(name, t.worktreePath, t.identifier, ctx, ctx?.env);
  }

  /**
   * Reconcile closed tickets against their herdr worktrees and tear down any
   * whose workspace still lingers (BB-89). Driven by the durable `cleaned_up`
   * flag via {@link BbRemote.fetchUncleanedTickets}: every ticket the server
   * has already closed but not yet cleaned. The SAME reconciliation runs on
   * every tick AND standalone as `bakers oven clean`, and the query is
   * scoped to THIS conductor (BB-121) — so it catches the orphans a
   * live-tick-only path structurally cannot (the conductor was down when the
   * ticket closed, or crashed mid-cleanup) for its OWN tickets. A foreign
   * (non-bakers) worktree has no bakers ticket, so it is never on the work list; a
   * ticket assigned to another conductor is filtered out at the query — both are
   * left untouched with no host enumeration.
   *
   * The conductor is structurally UNABLE to close a ticket (BB-451): closing
   * is a server-side projection of terminality written by
   * `BbTicket::preSave()` on any save of a terminal, unclosed ticket, so it
   * holds for every write path and cannot be withheld by a teardown hiccup —
   * the reap reasons about `cleaned_up` alone. `cleaned_up` is withheld unless
   * the teardown is ACCOUNTED FOR (BB-141 RC-2), which `removeWorktree`
   * reports as one of three outcomes (BB-293):
   *   - `removed` — gone because this host tore it down → flag cleaned;
   *   - `already_absent` — nothing was there to tear down. A FINISHED teardown,
   *     not a failure: it is recorded in this log AND on the run record, then
   *     flagged cleaned. Recording it is the point — swallowing the absence and
   *     leaving `cleaned_up=0` is what made every later reap repeat the same
   *     failing teardown;
   *   - `unverified` — it could not be resolved and may still be on disk (e.g.
   *     its `worktree_path` was never persisted). Like a THROW, it logs loudly
   *     and leaves `cleaned_up=0` so the next reconciliation retries.
   * Flagging cleaned on an unverified teardown was the root cause of the ~28
   * never-touched leftovers, because the ticket then dropped off the
   * (cleaned_up=0) work list forever.
   * Re-running on an already-cleaned ticket is a no-op — it is off the list
   * (idempotent). Each ticket is isolated in a try/catch so one failure never
   * aborts the rest.
   *
   * The `after_done` hook runs through the executor (BB-84), which owns the
   * best-effort policy — it logs+swallows a hook failure and never throws, so
   * the core needs no per-call-site try/catch around it.
   */
  async reap(): Promise<void> {
    await this.enqueueReap();
    await this.queue.drain();
  }

  private async enqueueReap(): Promise<void> {
    const tickets = await this.remote.fetchUncleanedTickets(this.id);
    for (const t of tickets) {
      this.queue.enqueue({
        key: `reap:${t.ticketUuid}`,
        lane: t.ticketUuid,
        run: () => this.reapOne(t),
      });
    }
  }

  /**
   * Record the merge request's size on a done ticket while its worktree still
   * exists. The server keeps `metrics` writable until `cleaned_up`; a failure
   * is logged and never holds up the teardown. A teardown that keeps failing
   * re-measures on every reap; the rows are replaced, so they stay correct.
   */
  private async recordMrChanges(t: UncleanTicket): Promise<void> {
    if (t.state !== 'done' || !t.hasMr) return;
    try {
      if (!t.baseBranch) throw new Error('ticket has no base branch');
      // Under the git lock: workspace.ensure fetches the same ref into this repo.
      const values = await this.serialGit(() =>
        measureMrChanges(t.worktreePath, t.baseBranch),
      );
      await this.remote.replaceTicketMetrics(
        t.ticketUuid,
        'mr_changes.',
        mrChangesRows(values, Math.floor(Date.now() / 1000)),
      );
    } catch (err) {
      this.logger.warn(
        { ticket: t.ticketUuid, err: String(err) },
        'mr_changes not recorded',
      );
    }
  }

  /** Reaps one ticket; isolated, so one failure never aborts the rest. */
  private async reapOne(t: UncleanTicket): Promise<void> {
    try {
      // Infra teardown. The `after_done` hook runs in the worktree regardless
      // of executor kind (a non-persistent gitWorkspace still has an on-disk
      // worktree); only the workspace removal is gated on the persistent
      // capability (mirrors the executor-agnostic release path). Pass the
      // stable worktreePath so the executor resolves the worktree by path,
      // not by the mutable checked-out branch (the coding agent may rename
      // it). Teardown is idempotent: a worktree herdr no longer tracks is a
      // no-op / on-disk reclaim, not a failure.
      //
      // The hook needs the DIRECTORY, not just a recorded path (BB-293): a
      // hook is a shell spawned with the worktree as its `cwd`, so against an
      // absent one the spawn fails with ENOENT and the shared exec helper logs
      // `ERROR: exec failed` — for the very condition this ticket declares
      // normal. There is no useful work such a hook could do either: a command
      // that must run inside the worktree cannot run anywhere else.
      //
      // The absence is logged rather than passed over in silence, because an
      // `after_done` can reach beyond the directory it runs in — `ddev delete
      // -Oy` also drops a DDEV project registration and its database — and
      // that leftover is then an operator's to clear by hand.
      //
      // But the line states the CONDITION, not a decision about a hook: hook
      // commands are executor-owned config that the core cannot see, so it
      // does not know whether an `after_done` is configured at all. Saying a
      // hook was "skipped" would be false wherever none exists (the generated
      // playground config is exactly such a case). What the core does know is
      // that the directory is gone and that no `after_done` ran — both true in
      // either configuration.
      //
      // `existsSync` here is a plain filesystem question, not worktree
      // knowledge: the core stays executor-agnostic and asks nothing about
      // git. The check is deliberately reap-local — at dispatch a worktree the
      // workspace just created MUST exist, and silencing a hook there would
      // hide a real provisioning failure.
      if (t.worktreePath) {
        if (existsSync(t.worktreePath)) {
          await this.recordMrChanges(t);
          // BB-599: listeners get the ticket's current context; the shell
          // hook keeps its inherited env, exactly as before.
          const ctx =
            this.listeners.length === 0
              ? undefined
              : await this.listenerContext(t.ticketUuid, t.worktreePath, {
                  hook: 'after_done',
                  ...(t.runUuid ? { run: { uuid: t.runUuid } } : {}),
                });
          await this.runSlot(
            'after_done',
            t.worktreePath,
            t.ticketUuid,
            ctx,
            undefined,
          );
          // BB-663 review F2: a torn-down environment invalidates any
          // recorded `after_create` success — otherwise a worktree that
          // survives teardown (non-persistent executor, unverified reap)
          // looks bootstrapped forever and a reopened ticket dispatches
          // straight into a worktree with no provisioned environment.
          recordAfterCreateOutcome(
            bootstrapStateFileOf(this.config),
            t.worktreePath,
            false,
          );
        } else {
          this.logger.info(
            {
              ticket: t.ticketUuid,
              hook: 'after_done',
              worktreePath: t.worktreePath,
            },
            'worktree directory absent — after_done not run',
          );
        }
      }
      if (this.executor.capabilities().persistent) {
        let outcome: WorktreeTeardown;
        try {
          // removeWorktree reports what the teardown DID (BB-293):
          // `removed` = the worktree is gone because this host removed it;
          // `already_absent` = there was nothing to tear down; `unverified` =
          // it could NOT be resolved and may still be on disk (BB-141 RC-2
          // — e.g. worktree_path was never persisted and herdr lost track of
          // the branch). A THROW is a hard failure.
          outcome = await this.serialGit(() =>
            this.executor.removeWorktree(
              t.branchName,
              t.worktreePath || undefined,
            ),
          );
        } catch (err) {
          this.logger.warn(
            {
              ticket: t.ticketUuid,
              branch: t.branchName,
              worktreePath: t.worktreePath,
              err: String(err),
            },
            'worktree teardown failed',
          );
          return; // leave cleaned_up=0 → the next reconciliation retries.
        }
        if (outcome === 'unverified') {
          // BB-468 — an unverified teardown with NO run and NO recorded
          // path has nothing left for a later reap to resolve: no run will
          // appear on a terminal ticket, and no branch will appear for work
          // that never started (`reap()` passes `t.worktreePath ||
          // undefined`, so a never-ran ticket and a lost-path ticket reach
          // the executor byte-identically — only the reaper, which alone
          // knows `runUuid === ''`, can tell them apart). That retry is not
          // deferred, it is unreachable, so it is logged ONCE at info and
          // accounted for below rather than retried forever. BB-141 RC-2
          // is unchanged for every ticket that DOES carry a run or a
          // recorded path: those keep retrying below, unaffected.
          if (!t.runUuid && !t.worktreePath) {
            this.logger.info(
              { ticket: t.ticketUuid, branch: t.branchName },
              'no run and no recorded path — nothing to tear down',
            );
          } else {
            // Unverified teardown (BB-141 RC-2): do NOT flag cleaned_up, or
            // the ticket drops off fetchUncleanedTickets (which filters
            // cleaned_up=0) and the orphan is never retried. Leave it on the
            // work list so a later reap — with a persisted path, or once the
            // executor resolves it via the parent-repo git worktree list —
            // can finish the job.
            this.logger.warn(
              {
                ticket: t.ticketUuid,
                branch: t.branchName,
                worktreePath: t.worktreePath,
              },
              'worktree teardown unverified — retrying next reap',
            );
            return; // leave cleaned_up=0 → the next reconciliation retries.
          }
        }
        if (outcome === 'already_absent') {
          // BB-293: the worktree was gone before we got here. That is a
          // FINISHED teardown, so it is recorded rather than swallowed and
          // the ticket is flagged cleaned below — the next reap will not
          // retry it.
          this.logger.info(
            {
              ticket: t.ticketUuid,
              branch: t.branchName,
              worktreePath: t.worktreePath,
            },
            'worktree already absent — teardown complete',
          );
          // A ticket with no run has no record to write to — the conductor
          // log above is then the whole account.
          if (t.runUuid) {
            try {
              await this.remote.appendRunNote(
                t.runUuid,
                `worktree already absent at teardown: ${
                  t.worktreePath || '(path unknown)'
                }`,
              );
            } catch (err) {
              // Best-effort: an unreachable control plane must not keep a
              // finished teardown from being flagged.
              this.logger.warn(
                { ticket: t.ticketUuid, run: t.runUuid, err: String(err) },
                'run note write failed',
              );
            }
          }
        }
      }
      // Teardown verified locally, the worktree was already absent, or there
      // is nothing hosted to tear down: flag it cleaned so it drops off the
      // work list.
      await this.remote.markTicketCleanedUp(t.ticketUuid);
      this.logger.info({ ticket: t.ticketUuid }, 'ticket cleaned up');
    } catch (err) {
      this.logger.warn(
        { ticket: t.ticketUuid, err: String(err) },
        'ticket cleanup failed',
      );
    }
  }

  /**
   * The env a run executes in: the ticket's effective env_vars under the core
   * vars. Used at dispatch and, rebuilt from the current ticket, for the
   * `after_run` / `after_done` listener contexts (BB-599).
   */
  private async runEnv(
    t: Ticket,
    runUuid: string | undefined,
    state: string,
    agent?: BbAgent,
  ): Promise<Record<string, string>> {
    // BB-495: the agent names the workspace on its own calls now (the
    // dropsh transport stamps none), so it has to know which one it is
    // standing in and the full radius it may reach. Reserved core keys
    // always win over per-ticket env_vars (below), so no precedence code is
    // needed here. A key whose value could not be resolved is OMITTED, never
    // exported empty — an empty variable reads as "set but blank" to a skill,
    // which is worse than absent.
    let workspaceIds: string | undefined;
    try {
      const ids = await this.remote.getReachableWorkspaces();
      if (ids.length) workspaceIds = ids.join(',');
    } catch (err) {
      this.logger.warn(
        { ticket: t.identifier, err: String(err) },
        'could not resolve reachable workspaces for BB_WORKSPACE_IDS',
      );
    }
    const core: Record<string, string> = {
      BB_URL: this.config.site.base_url,
      BB_ID: t.uuid,
      // BB-569: lets a launch wrapper key off the ticket and the run's
      // start state without parsing the prompt (addon-claude `measure`).
      ...(t.identifier ? { BB_TICKET_IDENTIFIER: t.identifier } : {}),
      ...(state ? { BB_STATE: state } : {}),
      ...(runUuid ? { BB_RUN_UUID: runUuid } : {}),
      BB_TUNNEL: this.config.tunnel === true ? '1' : '0',
      WORKSPACE_ROOT: this.checkoutRoot,
      ...(t.issueUrl ? { TICKET_URL: t.issueUrl } : {}),
      ...(t.projectName ? { BB_PROJECT: t.projectName } : {}),
      ...(t.projectId ? { BB_PROJECT_ID: t.projectId } : {}),
      ...(t.workspaceName ? { BB_WORKSPACE: t.workspaceName } : {}),
      ...(t.workspaceId ? { BB_WORKSPACE_ID: t.workspaceId } : {}),
      ...(workspaceIds ? { BB_WORKSPACE_IDS: workspaceIds } : {}),
    };
    return resolveRunEnv(t.effectiveEnvVars, core, this.logger, {
      ticket: t.identifier,
      ...(agent?.runEnvPolicy ? { policy: agent.runEnvPolicy } : {}),
    });
  }

  /** Dispatches one claimed run; a failure terminalises it (BB-149). */
  private async dispatchOrFail(run: ClaimedRun): Promise<void> {
    try {
      await this.dispatch(run);
    } catch (err) {
      // BB-149: terminalise the run to `failed` with the error captured,
      // instead of leaving it `claimed` to expire after the ~300s lease (the
      // old silent stall). `failed` is a terminal sibling of `expired`
      // (dispatch/setup error vs lease lapse); it does NOT reopen the ticket
      // the way the BB-41-era fabricated `done` did, so there is no runaway.
      // Marking it now frees the ticket immediately and records *why* it
      // failed; a persistently-failing setup is then parked by the server-side
      // circuit breaker (TicketClaimService::assertNotCircuitBroken) after the
      // retry cap, not by a hot re-dispatch loop. Best-effort: a markFailed
      // that itself errors must not stop the claim loop, so it is swallowed
      // (the run then falls back to lease-expiry recovery).
      this.logger.error(
        { run: run.runUuid, err: String(err) },
        'dispatch failed',
      );
      try {
        await this.remote.markFailed(run.runUuid, String(err));
      } catch (markErr) {
        this.logger.warn(
          { run: run.runUuid, err: String(markErr) },
          'markFailed failed',
        );
      }
    }
  }

  private async dispatch(run: ClaimedRun) {
    const t = await this.remote.getTicket(run.ticketUuid);
    // Resolve the ticket alias and machine defaults, or the project selection hook.
    // Persist the package id below so finalize can choose its transcript parser.
    const chosen = resolveAgent(this.agents, t, {
      selectAgent: this.config.selectAgent,
      routes: this.config.routes,
      defaultAgent: this.config.default_agent,
      warn: (message) => this.logger.warn({ ticket: t.identifier }, message),
    });
    // The tick's gate may be stale by now; spawn nothing that cannot start.
    const [unavailable] = await sandboxFailures([chosen]);
    if (unavailable) throw new Error(unavailable);
    const baseRef = t.baseBranch ? `origin/${t.baseBranch}` : undefined;
    // Resolve the run env once (per-ticket env_vars + core BB_* vars) and
    // inject it into BOTH the executor-owned lifecycle hooks AND the agent run
    // env (BB-99). Reserved core keys always win; values may be sensitive so
    // only key names are ever logged.
    const env = await this.runEnv(
      t,
      run.runUuid,
      run.stateAtStart,
      chosen.agent,
    );
    const ws = await this.serialGit(() =>
      this.workspace.ensure(t.identifier, t.branchName, baseRef),
    );
    // A claimable state has no project policy without a WORKFLOW.md. Warn and
    // proceed so the missing project instructions are observable without
    // wedging the run. `ws.instructions` is the loaded file (null when absent).
    if (!ws.instructions) {
      this.logger.warn(
        { ticket: t.identifier, workspace: ws.path },
        'WORKFLOW.md missing — no project instructions dispatched',
      );
    }
    // BB-599: one listener context per dispatch. Its `env` IS the run env,
    // so what a listener adds reaches later listeners, the shell hooks and
    // `startRun`. From the first listener on, a sidecar may exist — so any
    // failure from here unwinds through `after_run` before it propagates.
    const ctx: HookListenerContext = {
      worktreePath: ws.path,
      ticket: t,
      state: run.stateAtStart,
      env,
      run: { uuid: run.runUuid, id: run.runId },
    };
    const launch = { started: false };
    try {
      await this.launch(run, t, chosen, ws, ctx, launch);
    } catch (err) {
      await this.unwindDispatch(ctx, launch.started);
      throw err;
    }
  }

  /**
   * The part of a dispatch that can leave a sidecar or a worker behind
   * (BB-599): its caller unwinds it through `after_run` on any failure.
   */
  private async launch(
    run: ClaimedRun,
    t: Ticket,
    chosen: ResolvedAgent,
    ws: EnsuredWorkspace,
    ctx: HookListenerContext,
    launch: { started: boolean },
  ): Promise<void> {
    const env = ctx.env;
    // Lifecycle hooks are executor-owned + best-effort (BB-84): runHook never
    // throws, so neither call can abort dispatch or wedge a run in `claimed`.
    // `runSlot` runs the addon listeners first under the same rule (BB-599).
    // Both get the resolved run env so a setup/pre hook sees the same vars (e.g.
    // a DB DSN) the agent does (BB-99).
    //
    // BB-237 / BB-663: `after_create` runs when the worktree was just
    // created OR this worktree has no record of a successful `after_create`.
    // `created` alone answers "was this worktree born just now?", which is
    // not the question dispatch needs answered — a worktree whose bootstrap
    // aborted, an interrupted earlier run, or a hand-made `git worktree add`
    // all exist WITHOUT being provisioned, and under a creation-only gate
    // they never got another chance (BB-237). But the inverse bug is just
    // as real: a worktree whose `after_create` already succeeded got the
    // hook re-run on EVERY later dispatch, because the conductor tracked no
    // outcome at all — every workflow step re-ran the project bootstrap
    // (BB-663). The record lives beside the conductor's own config file,
    // keyed by worktree path (not inside the worktree — review F1 — and not
    // in conductor memory, so it survives a conductor restart). `created`
    // always wins over a leftover record: `reapOne` clears it on `after_done`
    // (review F2), so a worktree torn down and reopened bootstraps again too.
    const bootstrapStateFile = bootstrapStateFileOf(this.config);
    const bootstrapped =
      !ws.created && hasSucceededAfterCreate(bootstrapStateFile, ws.path);
    const provisioning = bootstrapped
      ? { ok: true, ran: false, hook: 'after_create' as HookName }
      : await this.runSlot('after_create', ws.path, t.identifier, ctx, env);
    if (!bootstrapped) {
      recordAfterCreateOutcome(bootstrapStateFile, ws.path, provisioning.ok);
    }
    // AC-6: an agent is never dispatched into a worktree whose bootstrap failed
    // without that being visible. Dispatch is NOT withheld — runHook's
    // never-throw contract exists so a hook cannot wedge a run, and withholding
    // would re-introduce that wedge — so the failure is recorded against the run
    // instead (ticket + run + hook + workspace + err) and the run proceeds.
    // Boundedness stays with the existing circuit breaker.
    if (!provisioning.ok) {
      this.logger.error(
        {
          hook: provisioning.hook,
          ticket: t.identifier,
          run: run.runUuid,
          workspace: ws.path,
          err: provisioning.error,
        },
        'lifecycle hook failed',
      );
    }
    // BB-237: apply the workspace's open layout HERE — after `after_create`,
    // before the run starts. The layout's startup command names the bakers CLI
    // that `after_create` builds; applied inside `workspace.ensure()` (where it
    // used to live) it necessarily fired first, so a self-hosting checkout had
    // to paper over the ordering with a sentinel wait loop inside the pane
    // command. Ordering the two correctly removes the need for any handshake.
    //
    // Gated on `ws.created` — DELIBERATELY narrower than the `after_create` gate
    // right above it, which is convergent (a worktree can exist without ever
    // having been provisioned). Only a fresh create has an initial pane to lay
    // out; re-applying on reuse would start a duplicate editor on reattach.
    // Optional on the contract, so a workspace with no layout concept is a
    // no-op. Best-effort by contract: implementations swallow their own errors.
    if (ws.created) {
      await this.workspace.applyOpenLayout?.(ws.path, {
        identifier: t.identifier,
        branch: t.branchName,
        title: t.title,
      });
    }
    await this.runSlot('before_run', ws.path, t.identifier, ctx, env);
    // Clear a leftover tab for THIS run id in a reused workspace before
    // starting it (BB-183): run-scoped so a still-open sibling run's tab is
    // never killed. A fresh dispatch has no matching tab yet → a quiet no-op;
    // a re-dispatch of the same run drops its stale duplicate before startRun
    // re-creates it. Sibling prior-state run tabs are left to the worktree reap.
    await this.executor.cleanupRun(t.branchName, run.runId);
    const prompt = ws.instructions
      ? renderPrompt(this.config.prompt, {
          identifier: t.identifier,
          state: t.state || 'qualification',
          runUuid: run.runUuid,
          ticketUuid: t.uuid,
        })
      : '';
    // BB-473 review round 2 (Critical 1): pinning the run's own UUID
    // unconditionally makes a re-dispatch of the same run — an existing,
    // supported path (see the cleanupRun comment above) — fail to launch,
    // because `claude`/`grok --session-id` refuse a session id that already
    // exists.
    //
    // BB-473 review round 4 (Critical 2): a `startedAt` time window is not
    // an identity — it can still select a SIBLING run's transcript that
    // happens to be newer than the bound, in the very worktree-keyed
    // directory this ticket exists to stop scanning by recency. Walking this
    // run's deterministic attempt family (attempt 0 == the run's own UUID)
    // and pinning the first member whose transcript does not already exist
    // gives dispatch a collision-free id AND gives finalise something to
    // select by that nothing outside this run can collide with — no
    // `sessionExists?` on the agent means every candidate reads as "free", so
    // an agent without the capability keeps pinning attempt 0 exactly as
    // before.
    const family = attemptFamily(run.runUuid);
    let pinnedSessionId: string | undefined;
    for (const candidate of family) {
      const exists =
        (await chosen.agent.sessionExists?.(ws.path, candidate)) ?? false;
      if (!exists) {
        pinnedSessionId = candidate;
        break;
      }
    }
    const identity = pinnedSessionId
      ? { sessionId: pinnedSessionId }
      : undefined;
    // BB-473 round 4 (review round 3, Critical 1): captured BEFORE
    // `startRun` so it precedes any transcript the agent is about to write —
    // re-stamped into `bb_run.started_at` on every dispatch, including a
    // re-dispatch, as a tie-breaker for agents with no session mechanism at
    // all (codex, opencode). Sent as whole seconds, matching every other
    // timestamp this method writes (`heartbeat`, `closed_date`) — a
    // fractional-second ISO string is not one of the Drupal `timestamp`
    // field's accepted formats and the PATCH would be rejected (review round
    // 4, Critical 1).
    const dispatchedAt = Math.floor(Date.now() / 1000);
    const warnings = chosen.agent.launchWarnings;
    if (warnings?.length) {
      const alias = chosen.alias ?? chosen.id;
      for (const warning of warnings) {
        this.logger.info(
          {
            ticket: t.identifier,
            run: run.runUuid,
            harness: chosen.agent.id,
            alias,
          },
          `${chosen.agent.id}/${alias}: ${warning}`,
        );
      }
    }
    const command = chosen.agent.launchCommand(prompt, identity, ws.path);
    await this.executor.startRun({
      ticket: {
        uuid: t.uuid,
        identifier: t.identifier,
        title: t.title,
        branchName: t.branchName,
        state: t.state,
        ...(t.issueUrl ? { url: t.issueUrl } : {}),
      },
      run: { uuid: run.runUuid, id: run.runId, handler: run.handler },
      workspacePath: ws.path,
      instructions: ws.instructions,
      command,
      env,
    });
    launch.started = true;
    this.logger.info(
      {
        ticket: t.identifier,
        run: run.runUuid,
        state: t.state,
        workspace: ws.path,
        // Key names only — env values may be sensitive (BB-99).
        envKeys: Object.keys(env),
        harness: chosen.agent.id,
        alias: chosen.alias ?? chosen.id,
        // The launch with its options; the prompt is long and in the ticket.
        launch: command.replace(shellQuote(prompt), "'<prompt>'"),
      },
      'dispatched run',
    );
    // The conductor — not the agent — knows the per-run git worktree path, so
    // it persists `worktree_path` to bb_run here alongside the running state.
    // It also persists the chosen agent id (BB-144) for finalize footprint
    // routing.
    await this.remote.markRunning(run.runUuid, {
      worktree_path: ws.path,
      agent: chosen.id,
      startedAt: dispatchedAt,
    });
  }

  /**
   * Stop what a failed dispatch started (BB-599): the worker if it was
   * launched, then the `after_run` listeners and shell hook. Best-effort — it
   * never replaces the dispatch error the caller re-throws.
   */
  private async unwindDispatch(
    ctx: HookListenerContext,
    launched: boolean,
  ): Promise<void> {
    const runUuid = ctx.run?.uuid ?? '';
    try {
      if (launched && this.executor.capabilities().persistent) {
        try {
          await this.executor.stopRun(ctx.ticket.branchName);
        } catch (err) {
          this.logger.warn(
            { run: runUuid, err: String(err) },
            'agent stop failed',
          );
        }
        await this.closeRunTab(
          ctx.ticket.branchName,
          runUuid,
          ctx.run?.id ?? 0,
        );
      }
      await this.runSlot(
        'after_run',
        ctx.worktreePath,
        ctx.ticket.identifier,
        ctx,
        ctx.env,
      );
    } catch (err) {
      this.logger.warn(
        { run: runUuid, err: String(err) },
        'dispatch cleanup failed',
      );
    }
  }

  async serve(signal?: AbortSignal) {
    await this.pollLoop(signal);
  }

  /**
   * True once this conductor's own checkout has been removed from disk (its
   * worktree was reaped while the process kept running). Such a conductor is a
   * pure liability: it still heartbeats and still claims runs, but every
   * dispatch fails — no git command and no relative path can resolve from a
   * deleted directory — so each claim burns one attempt and three of them park
   * the ticket behind the circuit breaker. Observed as 30 orphans claiming and
   * failing tickets they could never dispatch.
   */
  private checkoutGone(): boolean {
    return !existsSync(this.checkoutRoot);
  }

  private async pollLoop(signal?: AbortSignal) {
    while (!signal?.aborted) {
      if (this.checkoutGone()) {
        // Stop claiming and let the loop end — the process exits and the cron
        // reaper flips status to offline on lease expiry, same as any crash.
        // Deliberately NOT an offline write from here: the loop never owns that
        // transition (see the note at the end of this method).
        this.logger.error(
          { conductorId: this.id, workspace: this.checkoutRoot },
          'checkout is gone — stopping conductor instead of claiming runs it cannot dispatch',
        );
        await this.queue.drain();
        return;
      }
      // Only produces: the loop never waits for the actions it enqueued.
      try {
        await this.produce();
      } catch (err) {
        this.logger.error(
          { conductorId: this.id, err: String(err) },
          'tick failed',
        );
      }
      await sleep(this.config.poll_interval_ms, signal);
    }
    await this.queue.drain();
    // NB: the poll loop never writes status=offline itself. A graceful stop
    // (`bakers oven stop`) writes offline directly server-side; a crash or
    // hard-kill leaves a stale lease that the Drupal cron reaper flips to
    // offline (bb_core cron → ConductorReaper). Liveness is thus always
    // derived from status + last_seen/lease_expires_at, never from the loop.
  }
}
