import { execFile, spawnSync } from 'node:child_process';
import { basename, dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { promisify } from 'node:util';
import {
  type BbCommandHost,
  type BbCommandPlugin,
  CommandRunner,
  type ConductorLiveness,
  type ConductorLogger,
  checkForUpdate,
  configHomeOf,
  createBbConnectionClient,
  createLogger,
  declineUpdate,
  defaultProcProbe,
  deriveCheckoutRoot,
  deriveConductorLiveness,
  homeBbDir,
  loadReadyBbConnection,
  type ProcProbe,
  printVersionLine,
  resolveConfigPath,
  setDefaultCommandRunner,
  signalVerifiedProcess,
  stemForConfigFile,
  type UpdateCheckOptions,
  updateNotice,
  verifyConductorProcess,
} from '@bakers-build/core';
import { Command } from 'commander';
import { authStatus } from 'dropsh';
import { resolveBbProjectContext } from '../bakers-project-context.js';
import { composeConductorConfig, loadConductorConfig } from '../config.js';
import { Conductor, registrationOf } from '../core/conductor.js';
import { watchForRestart } from '../core/self-restart.js';
import type { BbExecutor } from '../plugins/executor.js';
import {
  type ResolvedAgent,
  selectAgents,
  selectExecutor,
  selectRemote,
  selectWorkspace,
} from '../plugins/plugins.js';
import type {
  BbRemote,
  ConductorRegistration,
  ConductorStatus,
  ConductorTakeoverRequired,
} from '../plugins/remote.js';
import { sandboxFailures } from '../plugins/sandbox-preflight.js';
import type { BbWorkspace } from '../plugins/workspace.js';
import {
  type DetachedChild,
  type DetachedSpawnRequest,
  spawnDetachedConductor,
} from '../process/detached-spawn.js';
import type { ConductorFileConfig } from '../types.js';
import { ovenTools } from './oven-tools.js';

// BB-201: the `conductor` command PLUGIN. `bakers` is now a thin host
// (`@bakers-build/bakers`) that dynamically mounts this package's command plugin under
// `bakers oven …`. This module owns the conductor lifecycle only; the UI
// (`@bakers-build/ui`), dropsh (`@bakers-build/addon-dropsh`) and — since BB-224
// (Finding 7) — deployment (`@bakers-build/addon-deployment`, `bakers deployment …`)
// are their own command packages. The connection
// (`site` + auth `plugins`) is composed in from `bakers.config.js`
// (`loadBbConfig`); this package's engine config (`conductor.config.js`) no
// longer carries it.

/** Test seam: inject any subset of dependencies. */
export interface BbCliDeps {
  remote?: BbRemote;
  executor?: BbExecutor;
  workspace?: BbWorkspace;
  agents?: ResolvedAgent[];
  config?: ConductorFileConfig;
  /** Injectable registry fetch for the start-time version check (tests). */
  fetch?: typeof fetch;
  /** Marker immediately before start hands control to conductor work. */
  onStartLoop?: () => void;
  /** Host contract (resolveBases); default: this install + cwd. */
  host?: BbCommandHost;
  /**
   * The detached spawn behind `start`. Defaults to `spawnDetachedConductor`;
   * a test MUST inject a fake, or the suite starts real conductor processes.
   */
  spawnConductor?: (req: DetachedSpawnRequest) => Promise<DetachedChild>;
  /**
   * BB-232: the pid probe behind `stop`. Defaults to the real /proc reader —
   * a test MUST inject a fake, or the suite signals real processes.
   */
  procProbe?: ProcProbe;
  /**
   * BB-450 D9: how long `start` waits between polls for a fresh heartbeat,
   * and how many it takes before giving up and reporting **failed**. Defaults
   * are a real wait budget (1s × 20 ≈ 20s); a test MUST inject both (with a
   * no-op `sleep`) or it waits for real time.
   */
  startPollIntervalMs?: number;
  startPollAttempts?: number;
  /**
   * BB-450 D10: `start --force`'s grace period — how long it waits between
   * polls for the stopped conductor to actually exit before escalating to
   * `SIGKILL`, and how many it takes before escalating. Defaults are a real
   * wait budget (500ms × 10 ≈ 5s).
   */
  forceGraceIntervalMs?: number;
  forceGraceAttempts?: number;
  /** Test seam: replaces the real timer `start` waits on between polls. */
  sleep?: (ms: number) => Promise<void>;
  /** Cache path, clock and fetch overrides for the start-time update check. */
  updateCheckOptions?: UpdateCheckOptions;
  /** stdin TTY override for the install prompt. */
  stdinIsTTY?: boolean;
  /** stdout TTY override for the install prompt. */
  stdoutIsTTY?: boolean;
  /** Environment for CI / selector detection. Defaults to process.env. */
  env?: NodeJS.ProcessEnv;
  /**
   * One prompt line (the update and the takeover question); empty string is
   * default yes. Reject to cancel.
   */
  askUpdate?: (question: string) => Promise<string>;
  /** Invoke `bakers` with an argv array (no binary name). */
  runBb?: (args: string[]) => Promise<void>;
  /** The self-restart file watcher behind `start --foreground`. */
  watchForRestart?: typeof watchForRestart;
  /** Checks the changed config; resolves an error message, or undefined when it loads. */
  checkConfig?: () => Promise<string | undefined>;
  /** Replaces this process (`process.execve`). A test MUST inject a fake. */
  execve?: Execve;
}

type Execve = (file: string, args: string[], env: NodeJS.ProcessEnv) => void;

/**
 * `oven start --dry-run` in a child with this process's own runtime and argv:
 * the changed files are imported fresh there, never into this process.
 */
async function defaultCheckConfig(): Promise<string | undefined> {
  const args = [
    ...process.execArgv,
    ...process.argv
      .slice(1)
      .map((a) => (a === '--foreground' ? '--dry-run' : a)),
  ];
  try {
    await promisify(execFile)(process.execPath, args, {
      cwd: process.cwd(),
      env: process.env,
      // A hung check would block every later restart; a timeout fails it.
      timeout: 60_000,
    });
    return undefined;
  } catch (err) {
    const { stderr, message } = err as { stderr?: string; message: string };
    return stderr?.trim().split('\n').slice(-20).join('\n') || message;
  }
}

/**
 * `oven start --dry-run`: load what a start would load — config with project
 * resolution, executor, workspace and agents — then stop before registering.
 */
async function cmdDryRun(deps: BbCliDeps): Promise<number> {
  try {
    const config = await resolveConfig(deps, undefined, true);
    const logger = loggerFor(await checkoutRootOf(config));
    if (!deps.executor) await selectExecutor(config, logger);
    if (!deps.workspace) await selectWorkspace(config, logger);
    if (!deps.agents) await selectAgents(config);
    console.log(`config ok: ${config.config_path}`);
    return 0;
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 1;
  }
}

/** Default host bases for connection/plugin resolution when none is injected. */
function defaultHost(): BbCommandHost {
  return { resolveBases: [import.meta.url, `${process.cwd()}/`] };
}

/**
 * Resolve + compose the full conductor config: the engine half
 * (`conductor.config.js` via `loadConductorConfig`) plus the connection half
 * (`bakers.config.js` via `loadBbConfig`, walk-up → home → shipped fallback).
 * `--config` / `$BB_CONDUCTOR_CONFIG` selects the engine file; the connection
 * is resolved from cwd.
 */
async function resolveConfig(
  deps: BbCliDeps,
  configPathOverride?: string,
  resolveProject = false,
): Promise<ConductorFileConfig> {
  if (deps.config) {
    return deps.config;
  }
  const host = deps.host ?? defaultHost();
  const engine = await loadConductorConfig(
    resolveConfigPath(configPathOverride),
  );
  if (!resolveProject) {
    const connection = await loadReadyBbConnection(host, {
      ...(engine.bakers.workspace
        ? { workspaceSelector: engine.bakers.workspace }
        : {}),
    });
    return composeConductorConfig(engine, connection);
  }
  const unscoped = await loadReadyBbConnection(host, {
    workspaceIdOverride: '',
  });
  const client = await createBbConnectionClient(unscoped);
  const context = await resolveBbProjectContext(client, engine.bakers);
  const connection = await loadReadyBbConnection(host, {
    workspaceIdOverride: '',
    workspaceSelector: context.workspaceId,
  });
  return {
    ...composeConductorConfig(engine, connection),
    resolved_bakers: context,
  };
}

async function resolveRemote(
  deps: BbCliDeps,
  config: ConductorFileConfig,
): Promise<BbRemote> {
  return deps.remote ?? (await selectRemote(config));
}

/**
 * The checkout root this conductor serves — the top of the working tree, not
 * its `.bakers` config directory (BB-450 D3). Resolved through the one shared
 * helper `deriveHerdrRoot()` already implemented, now `@bakers-build/core`'s
 * `deriveCheckoutRoot()`, so this call site cannot regress to a bare
 * `dirname(config_path)`.
 */
function checkoutRootOf(config: ConductorFileConfig): Promise<string> {
  return deriveCheckoutRoot(config.config_path);
}

/**
 * The conductor's identity (bb_conductor.conductor_id), derived by the
 * loader from the machine UUID, project and variant; lifecycle commands read
 * it here, never re-derive.
 */
function conductorIdOf(config: ConductorFileConfig): string {
  const id = config.conductor_id;
  if (id === undefined || id.trim() === '') {
    throw new Error('machine.config.js has no machine_id; run bakers init');
  }
  return id;
}

/**
 * Where a conductor keeps the frozen tickets it has observed, beside its
 * config file, so freeze hooks survive a restart and a one-shot poll.
 */
function frozenStateFileOf(config: ConductorFileConfig): string {
  const file = config.config_path;
  return join(dirname(file), `${basename(file, '.js')}.frozen.json`);
}

/** CLI-supplied logging overrides; beat env vars in createLogger. */
interface LogOpts {
  level?: string;
  sink?: string;
}

/** Read the `conductor`-level --log-level / --log-sink flags from a subcommand. */
function logOptsOf(cmd: Command): LogOpts {
  const opts = cmd.optsWithGlobals() as { logLevel?: string; logSink?: string };
  return {
    ...(opts.logLevel !== undefined ? { level: opts.logLevel } : {}),
    ...(opts.logSink !== undefined ? { sink: opts.logSink } : {}),
  };
}

/** Create the conductor logger (with CLI log overrides) and route all exec logging through it. */
function loggerFor(checkoutRoot: string, log: LogOpts = {}): ConductorLogger {
  const logger = createLogger({ checkoutRoot, ...log });
  setDefaultCommandRunner(new CommandRunner(logger));
  return logger;
}

// --- ls/status liveness -----------------------------------------------------

/**
 * The liveness words, owned by core.
 *
 * The per-config freshness threshold that used to live here is gone with the
 * registry: core applies the same stale window as the server-side deriver and
 * additionally honours the lease, which is the more accurate signal a
 * hand-tuned `lease_seconds * 2` was approximating.
 */
type StatusLabel = ConductorLiveness;

/**
 * The liveness words this CLI prints.
 *
 * Delegated to core so `bakers oven ls`, the cockpit and the server-side
 * deriver describe one conductor identically. The previous CLI-only vocabulary
 * (`wedged`, `stopped`, `host-missing`, `registry-only`) went with the registry
 * that made those distinctions expressible.
 *
 * BB-473: `deriveConductorLiveness` MUST NOT change — it also classifies
 * REMOTE conductors this machine cannot probe. This function additionally
 * probes the LOCAL pid, when both `thisHostKey` is given and it is this
 * conductor's own host (`hub.hostKey === thisHostKey`) with a positive
 * `lastPid` on record. `verifyConductorProcess` (the read-only half of the
 * pid-signal proof; BB-450 D1) either leaves the record's word alone
 * (host-mismatch / no-pid / an unverifiable platform, or a genuinely live,
 * verified pid) or, on `stale-pid` — the process is provably gone or was
 * recycled by something else — overrides it to `offline`: positive proof the
 * process is gone beats a lease-derived guess. The printed word always stays
 * one of `online | stale | offline` — no fourth word is invented.
 */
function classify(
  hub: ConductorStatus,
  thisHostKey?: string,
  probe?: ProcProbe,
): StatusLabel {
  const recordDerived = deriveConductorLiveness(
    hub,
    Math.floor(Date.now() / 1000),
  );
  if (
    !thisHostKey ||
    hub.hostKey !== thisHostKey ||
    !Number.isInteger(hub.lastPid) ||
    (hub.lastPid ?? 0) <= 0
  ) {
    return recordDerived;
  }
  const verified = verifyConductorProcess({
    pid: hub.lastPid,
    hostKey: hub.hostKey,
    thisHostKey,
    ...(probe ? { probe } : {}),
  });
  return !verified.ok && verified.reason === 'stale-pid'
    ? 'offline'
    : recordDerived;
}

interface LsRow {
  id: string;
  project: string;
  label: string;
  /** The `.bakers` dir it last registered from; '' when it never reported one. */
  workspaceRoot: string;
  status: StatusLabel;
}

async function buildLsRows(
  remote: BbRemote,
  config: ConductorFileConfig | undefined,
  onlyId?: string,
  probe?: ProcProbe,
): Promise<LsRow[]> {
  let hub: ConductorStatus[] = [];
  try {
    hub = await remote.listConductors('me');
  } catch {
    hub = [];
  }
  // BB-473: the local-pid probe in `classify` needs to know THIS machine's
  // host_key (to gate it to rows that are this machine's own conductor) —
  // `config` used to be ignored here, which is why `ls`/`status` never probed
  // the local pid at all and relied purely on the record.
  const thisHostKey = config ? (config.host_key?.trim() ?? '') : undefined;
  return hub
    .filter((c) => !onlyId || c.id === onlyId)
    .map((c) => ({
      id: c.id,
      project: c.project,
      label: c.label,
      workspaceRoot: c.workspaceRoot,
      status: classify(c, thisHostKey, probe),
    }));
}

function printRows(rows: LsRow[]): void {
  if (rows.length === 0) {
    console.log('no conductors on the control plane');
    return;
  }
  for (const r of rows) {
    console.log(
      `${r.label}\t${r.status}\t${r.project}\t${r.workspaceRoot}\t${r.id}`,
    );
  }
}

// --- command handlers -------------------------------------------------------

/**
 * Start-time auth gate. Returns true if authenticated (session or session-less
 * provider); otherwise logs a single clear line and returns false.
 */
export async function ensureAuthenticated(
  config: ConductorFileConfig,
  logger: ConductorLogger,
): Promise<boolean> {
  const st = await authStatus({
    baseUrl: config.site.base_url,
    plugins: config.plugins ?? [],
  });
  if (!st.loggedIn) {
    logger.error(
      { baseUrl: config.site.base_url },
      `not logged in against ${config.site.base_url} — run 'bakers auth login'`,
    );
    return false;
  }
  return true;
}

async function cmdPoll(deps: BbCliDeps, log: LogOpts = {}): Promise<void> {
  const config = await resolveConfig(deps, undefined, true);
  const checkoutRoot = await checkoutRootOf(config);
  const logger = loggerFor(checkoutRoot, log);
  if (!(await ensureAuthenticated(config, logger))) return;
  const remote = await resolveRemote(deps, config);
  const executor = deps.executor ?? (await selectExecutor(config, logger));
  const workspace = deps.workspace ?? (await selectWorkspace(config, logger));
  const agents = deps.agents ?? (await selectAgents(config));
  const conductor = new Conductor(
    config,
    remote,
    executor,
    workspace,
    agents,
    logger,
    checkoutRoot,
    frozenStateFileOf(config),
  );
  await conductor.start();
  await conductor.tick();
}

/** `bakers oven check`: whether each enabled agent can start its sandbox. */
async function cmdCheck(deps: BbCliDeps): Promise<void> {
  const config = await resolveConfig(deps);
  for (const agent of deps.agents ?? (await selectAgents(config))) {
    const [failure] = await sandboxFailures([agent]);
    console.log(failure ?? `${agent.alias ?? agent.id}: sandbox ok`);
    if (failure) process.exitCode = 1;
  }
}

async function cmdReap(deps: BbCliDeps, log: LogOpts = {}): Promise<void> {
  const config = await resolveConfig(deps, undefined, true);
  const checkoutRoot = await checkoutRootOf(config);
  const logger = loggerFor(checkoutRoot, log);
  if (!(await ensureAuthenticated(config, logger))) return;
  const remote = await resolveRemote(deps, config);
  const executor = deps.executor ?? (await selectExecutor(config, logger));
  const workspace = deps.workspace ?? (await selectWorkspace(config, logger));
  const agents = deps.agents ?? (await selectAgents(config));
  const conductor = new Conductor(
    config,
    remote,
    executor,
    workspace,
    agents,
    logger,
    checkoutRoot,
  );
  await conductor.reap();
}

/**
 * BB-474: `--foreground`'s one-per-project guard. Unlike `cmdStartBody`'s
 * entity-derived check (`classify(existing) === 'online'`), liveness here is
 * proven by an actual pid probe (`verifyConductorProcess`) of the recorded
 * `last_pid` — a stale record whose process is dead never blocks a fresh
 * start, and a record whose `host_key` differs from this host's never blocks
 * one either, since `verifyConductorProcess` refuses to confirm a pid it
 * cannot attribute to this host. Returns `true` when the caller must stop
 * (this process refused, or a `--force` restart failed) — never a signal:
 * `verifyConductorProcess` observes, it does not touch, the process it checks.
 */
async function refuseIfAlreadyRunning(
  remote: BbRemote,
  id: string,
  thisHostKey: string,
  force: boolean,
  deps: BbCliDeps,
): Promise<boolean> {
  const existing = (await remote.listConductors('me')).find((c) => c.id === id);
  if (!existing) return false;
  // A self-restart keeps the pid: the live record is this very process.
  if (existing.lastPid === process.pid && existing.hostKey === thisHostKey)
    return false;

  const probe = deps.procProbe ?? defaultProcProbe();
  const verified = verifyConductorProcess({
    pid: existing.lastPid,
    hostKey: existing.hostKey,
    thisHostKey,
    probe,
  });
  if (!verified.ok) return false;

  if (!force) {
    const age = heartbeatAgeSeconds(existing);
    console.log(
      `conductor ${id} already running (pid ${existing.lastPid ?? 'unknown'}, ` +
        `heartbeat ${age === undefined ? 'age unknown' : `${age}s old`})`,
    );
    return true;
  }

  const stopOutcome = signalVerifiedProcess({
    pid: existing.lastPid,
    hostKey: existing.hostKey,
    thisHostKey,
    signal: 'SIGTERM',
    probe,
  });
  if (!stopOutcome.ok) {
    console.log(
      `failed to restart conductor ${id}: could not stop the running conductor — ${stopOutcome.message}`,
    );
    process.exitCode = 1;
    return true;
  }

  if (!(await waitForNotRunning(probe, stopOutcome.pid, deps))) {
    const killOutcome = signalVerifiedProcess({
      pid: existing.lastPid,
      hostKey: existing.hostKey,
      thisHostKey,
      signal: 'SIGKILL',
      probe,
    });
    if (!killOutcome.ok) {
      console.log(
        `failed to restart conductor ${id}: still running after the grace period, and could not force-stop it — ${killOutcome.message}`,
      );
      process.exitCode = 1;
      return true;
    }
    if (!(await waitForNotRunning(probe, killOutcome.pid, deps))) {
      console.log(
        `failed to restart conductor ${id}: sent SIGKILL but it is still reported running — refusing a second spawn`,
      );
      process.exitCode = 1;
      return true;
    }
  }
  console.log(`stopped conductor ${id} for restart (--force)`);
  return false;
}

async function cmdStartForeground(
  deps: BbCliDeps,
  log: LogOpts = {},
  force = false,
  choice: TakeoverChoice = {},
): Promise<void> {
  const config = await resolveConfig(deps, undefined, true);
  const checkoutRoot = await checkoutRootOf(config);
  const logger = loggerFor(checkoutRoot, log);
  if (!(await ensureAuthenticated(config, logger))) return;
  const remote = await resolveRemote(deps, config);
  const id = conductorIdOf(config);
  const thisHostKey = config.host_key?.trim() ?? '';
  if (await refuseIfAlreadyRunning(remote, id, thisHostKey, force, deps))
    return;
  // This process is the conductor: its takeover registration carries its pid.
  const serve = {
    ...registrationOf(config, checkoutRoot),
    last_pid: process.pid,
  };
  if (!(await settleTakeover(deps, remote, serve, choice))) return;
  const executor = deps.executor ?? (await selectExecutor(config, logger));
  const workspace = deps.workspace ?? (await selectWorkspace(config, logger));
  const agents = deps.agents ?? (await selectAgents(config));
  const conductor = new Conductor(
    config,
    remote,
    executor,
    workspace,
    agents,
    logger,
    checkoutRoot,
    frozenStateFileOf(config),
  );
  // This process IS the conductor, so it may report its own pid and config
  // name — the two values a cockpit needs to stop it later. poll/reap build a
  // Conductor too but never claim, so they cannot overwrite this pid.
  conductor.claimServeProcess();
  await conductor.start();
  // The endpoint file is how `bakers ports` and other CLI calls reach the tools.
  await conductor.startTools(
    join(homeBbDir(), 'conductors', `${conductor.id}.json`),
  );
  const controller = new AbortController();
  const onSignal = () => controller.abort();
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  let restart = false;
  const execve =
    deps.execve ?? (process as { execve?: Execve }).execve?.bind(process);
  let watcher: { close(): void } | undefined;
  if (config.restart_on_change !== false && config.watch_paths) {
    if (!execve) {
      logger.warn(
        { node: process.version },
        'restart_on_change needs process.execve (Node >= 22.15); the conductor does not restart itself on config changes',
      );
    } else {
      const check = deps.checkConfig ?? defaultCheckConfig;
      watcher = (deps.watchForRestart ?? watchForRestart)(
        config.watch_paths,
        async (path) => {
          if (controller.signal.aborted) return;
          logger.info(
            { path },
            `restart_on_change: ${path} changed; checking config`,
          );
          const error = await check();
          // A stop requested while the check ran stays a stop.
          if (controller.signal.aborted) return;
          if (error !== undefined) {
            logger.error(
              { path, err: error },
              `config check failed; keeping the running conductor: ${error}`,
            );
            return;
          }
          logger.info({ path }, 'config check passed; restarting conductor');
          restart = true;
          watcher?.close();
          controller.abort();
        },
      );
    }
  }
  try {
    await conductor.serve(controller.signal);
  } finally {
    watcher?.close();
    process.removeListener('SIGINT', onSignal);
    process.removeListener('SIGTERM', onSignal);
    await conductor.stopTools();
    // The exiting process writes its own `offline`. It has to be this process:
    // a heartbeat sets `online` unconditionally (ConductorRegistrar), so an
    // offline written by anyone else is erased by the next tick — the status
    // is only trustworthy when written after the heartbeats have stopped.
    // Best-effort: a conductor that cannot reach the control plane on the way
    // out must still exit, and the reaper flips it on lease expiry anyway.
    // A self-restart skips it: the same conductor id comes straight back.
    if (!restart) {
      try {
        await remote.setConductorStatus(conductor.id, 'offline');
      } catch (err) {
        logger.warn(
          { conductorId: conductor.id, err: String(err) },
          'could not write offline status on shutdown; the lease reaper will',
        );
      }
    }
  }
  // Same pid, pane and log.
  if (restart && execve)
    execve(
      process.execPath,
      [process.execPath, ...process.execArgv, ...process.argv.slice(1)],
      process.env,
    );
}

async function defaultAskUpdate(question: string): Promise<string> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });
  let settled = false;
  try {
    return await new Promise<string>((resolveAnswer, reject) => {
      const cancel = () => {
        if (settled) return;
        settled = true;
        reject(new Error('cancelled'));
      };
      rl.once('SIGINT', cancel);
      rl.once('close', cancel);
      rl.question(`${question} `, (answer) => {
        if (settled) return;
        settled = true;
        resolveAnswer(answer);
      });
    });
  } finally {
    rl.close();
  }
}

/** Whether a human can answer a question on this terminal. */
function isInteractive(deps: BbCliDeps): boolean {
  return (
    (deps.stdinIsTTY ?? Boolean(process.stdin.isTTY)) &&
    (deps.stdoutIsTTY ?? Boolean(process.stdout.isTTY)) &&
    !(deps.env ?? process.env).CI
  );
}

/** `oven start --adopt <uuid>` / `--new`: the takeover decision, given up front. */
export interface TakeoverChoice {
  adopt?: string;
  createNew?: boolean;
}

/**
 * Settles, once, a conductor whose derived id the control plane does not know
 * yet: registering it either succeeds, or the control plane offers the
 * conductor this machine, project and variant already have under an older id.
 * A terminal asks whether to take it over (or which, when there are several);
 * any other answer than a choice or no cancels. Without one the start stops with
 * the control plane's own `--adopt`/`--new` hint. After this the id is known,
 * so no later start (nor the detached child, which has no terminal) asks again.
 * Returns false when the start must stop.
 */
async function settleTakeover(
  deps: BbCliDeps,
  remote: BbRemote,
  registration: ConductorRegistration,
  choice: TakeoverChoice,
): Promise<boolean> {
  const id = registration.id;
  if ((await remote.listConductors('me')).some((c) => c.id === id)) return true;
  const reg = {
    ...registration,
    ...(choice.adopt ? { adopt: choice.adopt } : {}),
    ...(choice.createNew ? { create_new: true } : {}),
  };
  try {
    await remote.registerConductor(reg);
    return true;
  } catch (caught) {
    // By name: the remote addon may load its own copy of the contract class.
    if ((caught as Error)?.name !== 'ConductorTakeoverRequired') throw caught;
    const err = caught as ConductorTakeoverRequired;
    const { adoptable } = err;
    if (!isInteractive(deps) || adoptable.length === 0) {
      console.error(err.message);
      process.exitCode = 1;
      return false;
    }
    const one = adoptable.length === 1;
    const question = one
      ? `${err.message}\nTake it over? [Y/n]`
      : `${err.message}\n${adoptable.map((uuid, i) => `${i + 1}) ${uuid}`).join('\n')}\nTake over which? [1-${adoptable.length}, n for a new one]`;
    let answer: string;
    try {
      answer = (await (deps.askUpdate ?? defaultAskUpdate)(question))
        .trim()
        .toLowerCase();
    } catch {
      answer = 'cancel';
    }
    const adopt =
      one && ['', 'y', 'yes'].includes(answer)
        ? adoptable[0]
        : adoptable[Number(answer) - 1];
    if (!adopt && answer !== 'n' && answer !== 'no') {
      console.error('Start cancelled.');
      process.exitCode = 1;
      return false;
    }
    await remote.registerConductor(
      adopt ? { ...reg, adopt } : { ...reg, create_new: true },
    );
    return true;
  }
}

async function cmdStart(
  deps: BbCliDeps,
  log: LogOpts = {},
  updateCheck = true,
  body: (
    deps: BbCliDeps,
    log: LogOpts,
    force: boolean,
  ) => Promise<void> = cmdStartBody,
  force = false,
  foreground = false,
): Promise<void> {
  const current = printVersionLine();
  if (updateCheck) {
    const options: UpdateCheckOptions = {
      fetchImpl: deps.fetch ?? globalThis.fetch,
      ...deps.updateCheckOptions,
    };
    if (deps.fetch && options.cachePath === undefined) {
      options.cachePath = `/tmp/bakers-update-check-${process.pid}-${Math.random()}.json`;
    }
    const result = await checkForUpdate(options);
    const notice = result.latestVersion
      ? updateNotice(current, result.latestVersion)
      : null;
    const env = deps.env ?? process.env;
    const interactive = !foreground && isInteractive(deps);
    if (notice && interactive && result.declined !== true) {
      console.log(
        'Installing accepts the newer release and runs configuration migration.',
      );
      console.log(
        'After a successful install this start exits; rerun the start command to use the new release.',
      );
      const question = `A new bakers version is available (${current} → ${result.latestVersion}). Install it now? [Y/n]`;
      const ask = deps.askUpdate ?? defaultAskUpdate;
      let accepted: boolean;
      try {
        for (;;) {
          const answer = (await ask(question)).trim().toLowerCase();
          if (answer === '' || answer === 'y' || answer === 'yes') {
            accepted = true;
            break;
          }
          if (answer === 'n' || answer === 'no') {
            accepted = false;
            break;
          }
        }
      } catch {
        console.error('Start cancelled.');
        process.exitCode = 1;
        return;
      }
      const runBb =
        deps.runBb ??
        (async (args: string[]) => {
          const { error, status, signal } = spawnSync('bakers', args, {
            stdio: 'inherit',
            cwd: process.cwd(),
            env,
            shell: false,
          });
          if (error) throw error;
          if (signal)
            throw new Error(`bakers ${args[0]} terminated by ${signal}`);
          if (status) throw new Error(`bakers ${args[0]} exited ${status}`);
        });
      const prefix = env.BB_CONDUCTOR
        ? `bakers --conductor ${env.BB_CONDUCTOR}`
        : 'bakers';
      const rerun = `${prefix} oven start${force ? ' --force' : ''}`;
      if (accepted) {
        try {
          await runBb(['update']);
        } catch (err) {
          console.error(`bakers update failed: ${String(err)}`);
          console.error('Retry with: bakers update');
          process.exitCode = 1;
          return;
        }
        try {
          await runBb(['config', 'upgrade', '--scope', 'all', '--yes']);
        } catch (err) {
          console.error(`bakers config upgrade failed: ${String(err)}`);
          console.error(
            `Retry with: ${prefix} config upgrade --scope all --yes`,
          );
          console.error(`Then rerun \`${rerun}\`.`);
          process.exitCode = 1;
          return;
        }
        console.log('bakers update and configuration migration completed.');
        console.log(
          `This process still has the previous modules loaded; rerun \`${rerun}\` in a new process.`,
        );
        console.log(
          'A source checkout or PATH shim may still run the source tree after a global install; use the bakers executable you expect after bakers update.',
        );
        return;
      }
      if (!(await declineUpdate(result, options))) {
        console.error(
          'Could not remember the decline; you may be asked again on the next start.',
        );
      }
    } else if (notice) {
      console.log(notice);
    }
  }
  deps.onStartLoop?.();
  await body(deps, log, force);
}

/** Default budget: 1s between polls, 20 attempts ≈ 20s total. */
const START_POLL_INTERVAL_MS = 1000;
const START_POLL_MAX_ATTEMPTS = 20;

function realSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Seconds since the row's last heartbeat, or undefined when it never reported one. */
function heartbeatAgeSeconds(row: ConductorStatus): number | undefined {
  if (!row.lastSeen) return undefined;
  return Math.max(0, Math.floor(Date.now() / 1000) - row.lastSeen);
}

/**
 * Polls the control plane until this conductor's DERIVED liveness reads
 * `online`, the record carries a pid different from `priorPid`, AND its
 * `last_seen` has advanced past `priorLastSeen` — a fresh heartbeat has
 * arrived from a NEW process, not merely a record that was already fresh —
 * or the attempt budget runs out.
 *
 * BB-450 D9: "started" must mean registered and claiming, not merely that a
 * spawn call returned. The plain `start` path's premise — refusing to spawn
 * when a row is already `online` means an `online` row afterwards is this
 * start's own doing — is false on the `--force` path (BB-450 review B8):
 * `--force` enters precisely because the existing row WAS `online`, a
 * `SIGKILL`ed conductor writes no `offline` (nothing survives to write it),
 * so the record can still read `online` with the OLD pid on attempt 0, before
 * the new process has registered anything. `priorPid` is the pid on record
 * before this call (the killed conductor's, under `--force`; a stale or
 * absent one on a plain start), and a match on it is rejected rather than
 * accepted as this start's proof.
 *
 * BB-450 review B15: the pid check alone is not enough. `last_seen` is
 * written ONLY by the heartbeat resource, never by `registerConductor()`'s
 * upsert (`ConductorDeriver.php:47`'s comment records this as deliberate —
 * D12 does not make registration stamp it, because that would hide the
 * failed-registration case D9/AC-13 exist to surface). So the instant the new
 * process registers its OWN pid at boot (D8), the record already satisfies
 * "online, new pid" while still carrying the KILLED conductor's in-window
 * `last_seen` — `started` would print for a conductor that has only
 * registered, never heartbeated. `priorLastSeen` is the value on record
 * before this call, captured alongside `priorPid`; requiring `last_seen` to
 * have moved past it, rather than merely being within the freshness window,
 * is what tells "a heartbeat happened during this call" apart from "a
 * heartbeat happened at some point before it, possibly by the process this
 * call just killed".
 */
async function waitForFreshHeartbeat(
  remote: BbRemote,
  id: string,
  priorPid: number | undefined,
  priorLastSeen: number | undefined,
  deps: BbCliDeps,
  stopped: () => boolean = () => false,
): Promise<ConductorStatus | undefined> {
  const intervalMs = deps.startPollIntervalMs ?? START_POLL_INTERVAL_MS;
  const attempts = deps.startPollAttempts ?? START_POLL_MAX_ATTEMPTS;
  const sleep = deps.sleep ?? realSleep;
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (stopped()) return undefined;
    const row = (await remote.listConductors('me')).find((c) => c.id === id);
    if (
      row &&
      classify(row) === 'online' &&
      row.lastPid !== undefined &&
      row.lastPid !== priorPid &&
      (priorLastSeen === undefined || row.lastSeen > priorLastSeen)
    )
      return row;
    await sleep(intervalMs);
  }
  return undefined;
}

/** Default grace period: 500ms between polls, 10 attempts ≈ 5s total. */
const FORCE_GRACE_INTERVAL_MS = 500;
const FORCE_GRACE_MAX_ATTEMPTS = 10;

/**
 * Polls the LOCAL process — never the control plane — until the pid this
 * `--force` just signalled is actually gone, or the grace-period budget runs
 * out.
 *
 * BB-450 review (B4): this used to ask `remote.listConductors('me')` whether
 * the conductor's DERIVED liveness had left `online`, which is the same
 * category error D1 removed downstairs — proving a PROCESS fact (did the pid
 * exit) from a CONTROL-PLANE value (has a heartbeat lapsed). A `SIGKILL`ed
 * conductor writes no `offline` (nothing survives to write it), so its record
 * keeps deriving `online` until the stale window or the lease lapses — both
 * minutes away — while the grace budget is seconds. That mismatch made
 * `--force` kill the wedged conductor and then refuse to restart it, on the
 * one case `--force` exists for. `signalVerifiedProcess` already trusts
 * `probe.cmdlineOf(pid) === undefined` as "gone" (`stale-pid`); this reuses
 * exactly that authoritative local signal instead of a second, slower, and
 * sometimes-wrong one.
 */
async function waitForNotRunning(
  probe: ProcProbe,
  pid: number,
  deps: BbCliDeps,
): Promise<boolean> {
  const intervalMs = deps.forceGraceIntervalMs ?? FORCE_GRACE_INTERVAL_MS;
  const attempts = deps.forceGraceAttempts ?? FORCE_GRACE_MAX_ATTEMPTS;
  const sleep = deps.sleep ?? realSleep;
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (probe.cmdlineOf(pid) === undefined) return true;
    await sleep(intervalMs);
  }
  return false;
}

/**
 * `bakers oven start` reports exactly one of three outcomes (BB-450
 * AC-12): **started**, naming the pid and `host_key`; **already running**,
 * naming the live pid and its heartbeat age; **failed**, naming the reason.
 * `failed` sets a non-zero exit status so a script can tell the three apart.
 *
 * `--force` (D10) turns "already running" into a restart: a verified
 * `SIGTERM`, a bounded grace period, an escalation to `SIGKILL`, then the
 * normal spawn+verify below. Any failure in that sequence — including the
 * `no-pid` refusal `signalVerifiedProcess` already gives — is **failed** and
 * never falls through to a second spawn (AC-14/AC-20's two-conductors risk).
 */
async function cmdStartBody(
  deps: BbCliDeps,
  log: LogOpts,
  force = false,
  choice: TakeoverChoice = {},
): Promise<void> {
  const config = await resolveConfig(deps, undefined, true);
  const checkoutRoot = await checkoutRootOf(config);
  const logger = loggerFor(checkoutRoot, log);
  if (!(await ensureAuthenticated(config, logger))) return;
  // The loop withholds claims while this fails; say so before it starts.
  // Best-effort: an agent config the loop cannot load fails there, as before.
  try {
    for (const line of await sandboxFailures(
      deps.agents ?? (await selectAgents(config)),
    )) {
      console.warn(`warning: ${line}`);
    }
  } catch {}
  const remote = await resolveRemote(deps, config);
  const id = conductorIdOf(config);
  const thisHostKey = config.host_key?.trim() ?? '';

  // Block on the DERIVED status, not the raw one. A crashed conductor keeps
  // `status: online` on its record until the cron reaper notices the lapsed
  // lease, and those are precisely the minutes in which someone wants to
  // restart it. Only a conductor that is actually alive refuses a second start.
  const existing = (await remote.listConductors('me')).find((c) => c.id === id);
  // Captured before any stop/kill below: the pid this start must NOT report
  // as its own (BB-450 review B8) — the killed conductor's under `--force`,
  // a stale or absent one on a plain start.
  const priorPid = existing?.lastPid;
  // BB-450 review B15: the heartbeat this start must NOT accept as its own
  // — a registration writes a new pid without touching `last_seen`, so this
  // is what tells a genuine new heartbeat apart from the killed conductor's
  // stale-but-still-in-window one.
  const priorLastSeen = existing?.lastSeen;
  if (existing && classify(existing) === 'online') {
    if (!force) {
      const age = heartbeatAgeSeconds(existing);
      console.log(
        `conductor ${id} already running (pid ${existing.lastPid ?? 'unknown'}, ` +
          `heartbeat ${age === undefined ? 'age unknown' : `${age}s old`})`,
      );
      return;
    }

    const probe = deps.procProbe ?? defaultProcProbe();
    const stopOutcome = signalVerifiedProcess({
      pid: existing.lastPid,
      hostKey: existing.hostKey,
      thisHostKey,
      signal: 'SIGTERM',
      probe,
    });
    if (!stopOutcome.ok) {
      console.log(
        `failed to restart conductor ${id}: could not stop the running conductor — ${stopOutcome.message}`,
      );
      process.exitCode = 1;
      return;
    }

    if (!(await waitForNotRunning(probe, stopOutcome.pid, deps))) {
      const killOutcome = signalVerifiedProcess({
        pid: existing.lastPid,
        hostKey: existing.hostKey,
        thisHostKey,
        signal: 'SIGKILL',
        probe,
      });
      if (!killOutcome.ok) {
        console.log(
          `failed to restart conductor ${id}: still running after the grace period, and could not force-stop it — ${killOutcome.message}`,
        );
        process.exitCode = 1;
        return;
      }
      if (!(await waitForNotRunning(probe, killOutcome.pid, deps))) {
        console.log(
          `failed to restart conductor ${id}: sent SIGKILL but it is still reported running — refusing a second spawn`,
        );
        process.exitCode = 1;
        return;
      }
    }
    console.log(`stopped conductor ${id} for restart (--force)`);
  }

  // The detached child has no terminal, so a takeover is settled here first.
  if (
    !existing &&
    !(await settleTakeover(
      deps,
      remote,
      registrationOf(config, checkoutRoot),
      choice,
    ))
  )
    return;

  // BB-477: carry the selector on the child's own argv, derived the same way
  // the conductor reports its `conductor_name`, so it cannot re-resolve to a
  // different config.
  const stem = stemForConfigFile(basename(config.config_path));
  const argv = [
    process.execPath,
    process.argv[1] as string, // the running bakers entry script
    ...(stem && stem !== 'conductor' ? ['--conductor', stem] : []),
    'oven',
    ...(log.level ? ['--log-level', log.level] : []),
    // No --log-sink: the child's stdout is the log file, pinned by BB_CONDUCTOR_LOG=file.
    'start',
    '--foreground',
    '--no-update-check',
  ];
  const logPath = join(configHomeOf(checkoutRoot), 'log.txt');
  let child: DetachedChild;
  try {
    child = await (deps.spawnConductor ?? spawnDetachedConductor)({
      argv,
      cwd: checkoutRoot,
      env: { ...process.env, BB_CONDUCTOR_LOG: 'file' },
      logPath,
    });
    logger.info({ id, pid: child.pid }, 'started conductor detached');
  } catch (err) {
    console.log(
      `failed to start conductor ${id}: could not spawn — ${(err as Error).message} — see ${logPath}`,
    );
    process.exitCode = 1;
    return;
  }

  let exited = false;
  const outcome = await Promise.race([
    child.exited.then((code) => {
      exited = true; // ends the losing heartbeat poll, so the CLI exits now
      return { code };
    }),
    waitForFreshHeartbeat(
      remote,
      id,
      priorPid,
      priorLastSeen,
      deps,
      () => exited,
    ).then((row) => ({ row })),
  ]);
  if ('code' in outcome) {
    console.log(
      `failed to start conductor ${id}: exited with code ${outcome.code} before its first heartbeat — see ${logPath}`,
    );
    process.exitCode = 1;
    return;
  }
  const started = outcome.row;
  if (!started) {
    console.log(
      `failed to start conductor ${id}: spawned, but no fresh heartbeat arrived — see ${logPath}`,
    );
    process.exitCode = 1;
    return;
  }
  console.log(
    `started conductor ${id} (pid ${started.lastPid ?? 'unknown'}, host ${started.hostKey ?? thisHostKey})`,
  );
}

/**
 * Other conductor records that name the SAME checkout as `own` (BB-450 D6,
 * AC-19) — the exact ambiguity BB-281 recorded in the field: one checkout,
 * two `bb_conductor` rows under different ids. Reported so the operator can
 * see the stray; never signalled and never cleaned up here.
 */
export function strayConductorsOf(
  rows: ConductorStatus[],
  own: ConductorStatus,
): ConductorStatus[] {
  if (!own.workspaceRoot) return [];
  const target = resolve(own.workspaceRoot);
  return rows.filter(
    (c) =>
      c.id !== own.id &&
      c.workspaceRoot !== '' &&
      resolve(c.workspaceRoot) === target,
  );
}

/**
 * Stops this checkout's conductor with a verified signal.
 *
 * Two things this deliberately no longer does. It does not kill a herdr tab:
 * that killed the pane the conductor happened to be shown in, which is neither
 * necessary (a signal reaches the process wherever it lives) nor sufficient (a
 * conductor started by systemd or a bare --foreground has no tab). And it does
 * not write `offline` — a heartbeat sets `online` unconditionally, so a status
 * written from here is erased by the next tick unless it happens to land after
 * the process died. The exiting process writes its own, which is correct by
 * construction rather than by ordering luck.
 *
 * `--now` differs only in the signal. It runs through the same verification
 * gate, because a hard kill aimed at a recycled pid is the most damaging
 * version of the same mistake.
 */
async function cmdStop(deps: BbCliDeps, now: boolean): Promise<void> {
  const config = await resolveConfig(deps);
  const remote = await resolveRemote(deps, config);
  const id = conductorIdOf(config);
  const thisHostKey = config.host_key?.trim() ?? '';

  const rows = await remote.listConductors('me');
  const row = rows.find((c) => c.id === id);
  if (!row) {
    console.log(
      `no conductor ${id} on the control plane — nothing to stop (it may never have started)`,
    );
    return;
  }

  // BB-450 D6: report a stray record naming this checkout, never touch it.
  for (const stray of strayConductorsOf(rows, row)) {
    console.log(
      `note: conductor ${stray.id} also names this checkout (${stray.workspaceRoot}) — left untouched`,
    );
  }

  const signal: NodeJS.Signals = now ? 'SIGKILL' : 'SIGTERM';
  const outcome = signalVerifiedProcess({
    pid: row.lastPid,
    hostKey: row.hostKey,
    thisHostKey,
    signal,
    ...(deps.procProbe ? { probe: deps.procProbe } : {}),
  });

  if (!outcome.ok) {
    console.log(`could not stop conductor ${id}: ${outcome.message}`);
    return;
  }

  console.log(
    now
      ? `hard-stopped conductor ${id} (SIGKILL to pid ${outcome.pid}); a killed process writes no offline, so the status follows on lease expiry`
      : `stopped conductor ${id} (SIGTERM to pid ${outcome.pid}); it writes its own offline as it exits`,
  );
}

async function cmdLs(deps: BbCliDeps): Promise<void> {
  const config = deps.config ?? (await tryConfig(deps));
  const remote = await resolveRemote(
    deps,
    config ?? (await resolveConfig(deps)),
  );
  const rows = await buildLsRows(remote, config, undefined, deps.procProbe);
  printRows(rows);
}

async function cmdStatus(deps: BbCliDeps): Promise<void> {
  const config = await resolveConfig(deps);
  const remote = await resolveRemote(deps, config);
  const id = conductorIdOf(config);
  const rows = await buildLsRows(remote, config, id, deps.procProbe);
  printRows(rows);
}

/** ls may run without a config file; best-effort load. */
async function tryConfig(
  deps: BbCliDeps,
): Promise<ConductorFileConfig | undefined> {
  if (deps.config) {
    return deps.config;
  }
  try {
    return await resolveConfig(deps);
  } catch {
    return undefined;
  }
}

/** Prompt for the developer Kürzel / user id on an interactive terminal. */
// --- the conductor command tree --------------------------------------------

/** Build the `oven` subcommand tree (lifecycle + registry). */
export function createConductorCommand(deps: BbCliDeps): Command {
  const conductor = new Command('oven')
    .description('node-agent lifecycle + local registry')
    .option(
      '--log-level <level>',
      'log verbosity: debug | info | warn | error (overrides BB_LOG_LEVEL)',
    )
    .option(
      '--log-sink <sink>',
      'log sink: stdout | file | both (overrides BB_CONDUCTOR_LOG)',
    )
    .addHelpText(
      'after',
      `
Logging (precedence: CLI flag > env var > default):
  --log-level <level>  debug | info (default) | warn | error.
                       Set debug to see per-poll ticks, claims, and idle cycles.
  --log-sink <sink>    stdout | file | both (file/both write <checkoutRoot>/.bakers/log.txt).
                       Default: both on a TTY, file otherwise (BB-237 — a run in a
                       herdr pane is on a TTY, and its diagnostics must outlive the pane).
  BB_LOG_LEVEL       env fallback for --log-level.
  BB_CONDUCTOR_LOG   env fallback for --log-sink.

Examples:
  bakers oven --log-level debug start --foreground
  bakers oven --log-level debug once
  BB_LOG_LEVEL=debug bakers oven once`,
    );

  conductor
    .command('start')
    .description(
      'start the conductor loop (a detached background process by default)',
    )
    .option('--foreground', 'run the loop in this process', false)
    .option('--no-update-check', 'skip the daily CLI update check')
    .option(
      '--force',
      'restart: verify-stop the already-running conductor (SIGTERM, a grace ' +
        'period, then SIGKILL) and start a new one. Fails rather than starting ' +
        'a second conductor if the running one cannot be verified or stopped.',
      false,
    )
    .option(
      '--adopt <uuid>',
      'take over the conductor this machine, project and variant already have',
    )
    .option('--new', 'register a new conductor instead of taking one over')
    .option(
      '--dry-run',
      'load the config, executor, workspace and agents, then exit (0 when they load, 1 with the error)',
      false,
    )
    .action(async function (
      this: Command,
      opts: {
        foreground: boolean;
        updateCheck: boolean;
        force: boolean;
        adopt?: string;
        new?: boolean;
        dryRun: boolean;
      },
    ) {
      if (opts.dryRun) {
        process.exitCode = await cmdDryRun(deps);
        return;
      }
      if (opts.adopt && opts.new) {
        console.error('Choose either --adopt <uuid> or --new, not both.');
        process.exitCode = 1;
        return;
      }
      const choice: TakeoverChoice = {
        ...(opts.adopt ? { adopt: opts.adopt } : {}),
        ...(opts.new ? { createNew: true } : {}),
      };
      const body = opts.foreground ? cmdStartForeground : cmdStartBody;
      await cmdStart(
        deps,
        logOptsOf(this),
        opts.updateCheck,
        (d, l, f) => body(d, l, f, choice),
        opts.force,
        opts.foreground,
      );
    });

  conductor
    .command('once')
    .description('run one conductor cycle then exit')
    .action(async function (this: Command) {
      await cmdPoll(deps, logOptsOf(this));
    });

  conductor
    .command('check')
    .description(
      'check that every enabled agent can start its sandbox on this machine (exit 1 if one cannot)',
    )
    .action(async () => {
      await cmdCheck(deps);
    });

  conductor
    .command('clean')
    .description(
      'tear down herdr worktrees of finished-but-uncleaned tickets (recovers orphans a live tick missed: conductor was down at done, restarted, or reassigned)',
    )
    .action(async function (this: Command) {
      await cmdReap(deps, logOptsOf(this));
    });

  conductor
    .command('stop')
    .description(
      'stop the conductor: graceful offline (default) or hard kill (--now)',
    )
    .option(
      '--now',
      'hard-kill via host and let the cron reaper mark it offline',
      false,
    )
    .action(async (opts: { now: boolean }) => {
      await cmdStop(deps, opts.now);
    });

  conductor
    .command('ls')
    .description('list conductors on this machine + status')
    .action(async () => {
      await cmdLs(deps);
    });

  conductor
    .command('status')
    .description('status of the conductor for this checkout')
    .action(async () => {
      await cmdStatus(deps);
    });

  conductor
    .command('tools')
    .description(
      "list or call the conductor's addon tools from inside a run (exit 4 outside one)",
    )
    .argument('[name]', 'the tool to call; omitted, list the tools')
    .option('--data <json>', 'arguments as a JSON object, or @<file>')
    .option('--schema', "print the tool's input schema instead of calling it")
    .action(
      async (
        name: string | undefined,
        opts: { data?: string; schema?: boolean },
      ) => {
        process.exitCode = await ovenTools(name, opts);
      },
    );

  // `bakers conductor rm` is gone (BB-232). Its only job was deleting the local
  // registry entry; with no registry there is nothing to remove, and deleting
  // the control-plane record is explicitly not the model — a conductor that
  // stops is offline, not absent.

  return conductor;
}

/** The `oven` command plugin the host mounts (BB-201). BB-224
 *  (Finding 7): the `bakers deployment` batch helper is no longer registered here —
 *  it is its own command addon, `@bakers-build/addon-deployment`. */
const conductorCommandPlugin: BbCommandPlugin = {
  kind: 'command',
  name: 'oven',
  describe: 'node-agent lifecycle + local registry',
  register(program: Command, host: BbCommandHost): void {
    program.addCommand(createConductorCommand({ host }));
  },
};

export default conductorCommandPlugin;

/**
 * Build a standalone program with the conductor command mounted — the test entry
 * (mirrors what the host does for `bakers oven …`). `deps` inject fakes.
 */
export function buildConductorProgram(deps: BbCliDeps = {}): Command {
  const program = new Command();
  program.name('bakers').description('bakers.build conductor + client CLI');
  program.addCommand(createConductorCommand(deps));
  return program;
}

/** Parse argv against the conductor program (test entry). */
export async function runConductorCli(
  argv: string[],
  deps: BbCliDeps = {},
): Promise<void> {
  const program = buildConductorProgram(deps);
  await program.parseAsync(argv, { from: 'user' });
}
