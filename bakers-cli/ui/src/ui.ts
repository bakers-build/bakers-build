import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { type AgentLaunchHost, herdrAgentHost } from '@bakers-build/addon-herdr';
import { workspacePlugin } from '@bakers-build/addon-workspace';
import {
  CommandRunner,
  type ConductorLogger,
  createBbConnectionClient,
  createBbConnectionContext,
  createLogger,
  exec,
  fetchUpdateNotice,
  type BbCommandHost,
  type BbCommandPlugin,
  type BbConnectionConfig,
  loadReadyBbConnection,
  type MachineContext,
  machineContextPath,
  readMachineContext,
  resolveCliVersion,
  setDefaultCommandRunner,
  type WorkspaceRecoveryOptions,
} from '@bakers-build/core';
import type { Command } from 'commander';
import { buildProgram as buildDropshProgram } from 'dropsh';
import {
  applyOpentuiLibc,
  reExecUnderBun,
  resolveBunBinary,
  shouldReExecUnderBun,
} from './bun-runtime.js';
import {
  parseTarget,
  resolveHere,
  UI_VIEW_MODES,
  type UiInitialRoute,
} from './route.js';
import {
  type HomeConnection,
  resolveAgentCommand,
  resolveProjectRooting,
} from './ui-home.js';

// BB-201 / BB-219: the `bakers ui` command plugin. The cockpit resolves its
// connection through core: explicit → project → global. Workspace recovery
// completes before the terminal renderer starts, using the same policy as dropsh.
// This package deliberately keeps no precedence rule of its own (AC-6), so
// running `bakers ui` inside a project reaches that project's control plane.
// The TUI renderer `@bakers-build/addon-bakers-ui` is resolved DYNAMICALLY at runtime
// (never statically imported), so this package stays independent of the
// renderer and of the conductor.

/** Prompt-level agent service the renderer consumes (mirror of bakers-ui's `TuiAgentService`). */
interface TuiAgentService {
  launch(o: {
    group: string;
    cwd: string;
    prompt: string;
    env: Record<string, string | undefined>;
    isNew?: boolean | undefined;
    label?: string | undefined;
  }): Promise<{ id: string; group: string; label: string }>;
  list(group: string): Promise<{ id: string; group: string; label: string }[]>;
  focus(id: string): Promise<void>;
  hide(group: string): Promise<void>;
  kill(id: string): Promise<void>;
}

/** A dropsh program (only the `parseAsync` the launcher drives). */
interface DropshProgram {
  parseAsync(argv: string[], opts: { from: 'user' }): Promise<unknown>;
}

/** Options for bakers-ui's `runBbUi` (mirror of its `BbUiLauncherOptions`). */
export interface RunBbUiOptions {
  connection: HomeConnection;
  cwd: string;
  project?: string | undefined;
  agents?: TuiAgentService | undefined;
  currentUser?: string | undefined;
  /**
   * The `.bakers` dir of the project the ui was started in, when there is one.
   *
   * Replaces the `ownConductorMachineId` the local registry used to supply
   * (BB-232): the renderer matches this against each conductor's
   * `workspace_root` to find which record is this machine's own — it holds the
   * JSON:API client, and this entry does not.
   */
  bakersDir?: string | undefined;
  /** BB-472 — the connection's ambient workspace uuid; the renderer resolves
   *  its name and shows it in the chrome. Absent ⇒ no workspace suffix. */
  workspaceId?: string | undefined;
  /** BB-472 — the loaded connection config's absolute path, so the
   *  workspace-picker screen can find `workspace_id`'s owning file. */
  configPath?: string | undefined;
  /** BB-472 — re-executes this process; the picker calls it after writing a
   *  new workspace selection. */
  restartProcess?: (() => void) | undefined;
  /** Persist a product-workspace name through the conductor-owned contract. */
  selectWorkspace?: ((name: string) => Promise<void>) | undefined;
  createPrompt?: string | undefined;
  buildProgram: (opts: { plugins: unknown[] }) => DropshProgram;
  renderer?: ((opts: unknown) => unknown) | undefined;
  /** BB-223: the deep-link target, still UNRESOLVED (the entry has no JSON:API
   *  client — Finding 1). Absent ⇒ the renderer boots its dashboard (AC-4). */
  initialRoute?: UiInitialRoute | undefined;
  /** BB-233: the write-scoped JSON:API client. Absent ⇒ the renderer writes
   *  through the read client and the server decides (spec Decision 1). */
  writeClient?: unknown;
  /** BB-373: UI extension entry MODULES core discovered from `addons[]`.
   *  Specifiers only — this package imports none of them (spec F2). */
  uiEntries?: readonly string[] | undefined;
}

/** What a write-client builder needs — everything a connection already carries. */
export interface BuildWriteClientOptions {
  baseUrl: string;
  jsonapiPrefix: string;
  stateDir?: string;
  plugins: BbConnectionConfig['plugins'];
}

/**
 * Build the write-side JSON:API client from the plugins core already
 * constructed, resolving the connection's DEFAULT auth provider.
 *
 * BB-391: no profile is named any more. This used to resolve a second,
 * differently-SCOPED provider (`pm`) beside the reads' `session`, because at
 * granularity `role` the requested scope alone decided which role a token
 * carried. BB-359 moved capability onto OG ranks, so both scopes resolved to
 * the same role and the split was ceremony.
 *
 * It is still a second CLIENT, and that is not an oversight (spec D6): the READ
 * client lives inside dropsh — the TUI renders within the dropsh program, which
 * resolves auth itself — and is unreachable from here. Two client objects, ONE
 * identity.
 *
 * Throws when the connection declares no usable provider — the caller catches
 * it and runs the cockpit read-only rather than aborting, because a connection
 * with no resolvable provider still reads.
 */
async function buildWriteClientDefault(
  o: BuildWriteClientOptions,
): Promise<unknown> {
  return createBbConnectionClient(
    {
      site: { base_url: o.baseUrl, jsonapi_prefix: o.jsonapiPrefix },
      plugins: o.plugins,
    },
    o.stateDir ? { stateDir: o.stateDir } : {},
  );
}

/** The dynamically-imported `@bakers-build/addon-bakers-ui` module shape. */
interface BbUiModule {
  runBbUi(opts: RunBbUiOptions): Promise<void>;
}

/** Test/composition seams for `bakers ui`. */
export interface UiDeps {
  /** Local operator identity; default: read the host context from disk. */
  machine?: Partial<MachineContext>;
  workspaceRecovery?: WorkspaceRecoveryOptions;
  /** herdr-backed agent host; default: `herdrAgentHost(exec herdr)`. */
  agentHost?: AgentLaunchHost;
  /** The renderer launcher; default: the dynamically-resolved `runBbUi`. */
  runUi?: (opts: RunBbUiOptions) => Promise<void>;
  /** Host contract (resolveBases) for renderer resolution; default: cwd + this install. */
  host?: BbCommandHost;
  /** Explicit connection config (`--config`); beats project + home (AC-4). */
  explicitConfig?: string;
  /** Named connection selected by `--connection`. */
  connection?: string;
  /**
   * `--workspace <name|uuid>` (BB-472): a ONE-SHOT override of the
   * configured workspace for THIS process only — never written to the
   * connection config. Resolved against the identity's reachable workspaces
   * (`discoverBbWorkspaces`) before the ready connection loads, so an
   * unknown or ambiguous name fails before the renderer starts.
   */
  workspace?: string;
  /** Where the resolution + the rooting start; default: `process.cwd()`. */
  cwd?: string;
  /** Connection loader; default: core's `loadBbConfig` (the ONE rule). */
  loadConnection?: (
    host: BbCommandHost,
    opts: {
      cwd?: string;
      explicit?: string | undefined;
      connection?: string | undefined;
      workspaceSelector?: string | undefined;
    },
  ) => Promise<BbConnectionConfig>;
  /** Print the resolved connection and exit without launching the TUI (AC-7). */
  printConfig?: boolean;
  /** Sink for `--print-config`; default: `process.stdout.write`. */
  stdout?: (s: string) => void;
  /** Daily update lookup; injectable for startup ordering tests. */
  updateCheck?: () => Promise<string | null>;

  // ---- BB-223: the deep-link grammar ------------------------------------
  /** Positional `[target]` (`BB-221`, `#19`, `ticket:…`, `project:…`, `run:…`). */
  target?: string | undefined;
  /** `--ticket <id>`. */
  ticket?: string | undefined;
  /** `--project <id>`. */
  project?: string | undefined;
  /** `--run <uuid>`. */
  run?: string | undefined;
  /** `--here` — derive the target from the cwd (Decision 3). */
  here?: boolean | undefined;
  /** `--view <mode>` — how a ticket target renders (Decision 13). */
  view?: string | undefined;
  /** Current git branch of a dir; default `git branch --show-current`. */
  readBranch?: (cwd: string) => Promise<string>;
  /** The dir's `origin` remote URL; default `git remote get-url origin`. */
  readRemoteUrl?: (cwd: string) => Promise<string>;
  /** Where user-facing grammar errors go; default `process.stderr`. */
  stderr?: (line: string) => void;

  /** Builds the write client with the same configured identity as reads.
   *  Injected so the write seam is testable without a live token endpoint. */
  buildWriteClient?: (o: BuildWriteClientOptions) => Promise<unknown>;
}

/**
 * The current branch of `cwd`. Git resolves this PER WORKTREE, so
 * worktree-awareness for `--here` costs nothing (Decision 3). Never throws:
 * outside a repo, or on a detached HEAD, it yields '' and the ladder falls
 * through to its project rung.
 */
async function readCurrentBranch(cwd: string): Promise<string> {
  try {
    const out = await exec('git', ['branch', '--show-current'], { cwd });
    return typeof out === 'string' ? out.trim() : String(out ?? '').trim();
  } catch {
    return '';
  }
}

/**
 * The cwd's `origin` remote URL, raw. Git resolves it per worktree, and a
 * worktree shares its main clone's remote — exactly the right answer for
 * "which repo am I standing in" (Decision 3). Never throws: outside a repo, or
 * with no `origin`, it yields '' and the ladder produces its named error.
 *
 * Revision 4 replaced the previous rung (an `import()` of the repo's engine
 * `conductor.config.js` plus a longest-prefix fallback over the then-still-alive
 * local conductor registry) with this one read: neither could answer inside a
 * worktree (both keyed on `.bakers` DIRS, and a worktree has its own), the config
 * read needed a dynamic import of a possibly secret-bearing module, and the
 * remote works in a fresh clone that has no `.bakers/` at all. Revision 5 then
 * deleted that registry outright, which only removes an alternative this rung
 * had already rejected.
 */
async function readOriginRemoteUrl(cwd: string): Promise<string> {
  try {
    const out = await exec('git', ['remote', 'get-url', 'origin'], { cwd });
    return typeof out === 'string' ? out.trim() : String(out ?? '').trim();
  } catch {
    return '';
  }
}

/**
 * The explicit connection leg (AC-4, D2): `--config` → `$BB_CONFIG` →
 * `$DROPSH_CONFIG`, first non-empty wins. The two env vars are read because
 * core's resolver already names all three as the explicit leg and the renderer's
 * launcher already honours a pre-set `$DROPSH_CONFIG` — so the path `bakers ui`
 * reports and the file dropsh loads can never disagree.
 */
function resolveExplicitConfig(flag?: string): string | undefined {
  for (const candidate of [
    flag,
    process.env.BB_CONFIG,
    process.env.DROPSH_CONFIG,
  ]) {
    if (candidate !== undefined && candidate.trim() !== '') return candidate;
  }
  return undefined;
}

/**
 * The `--print-config` block (AC-7): which file won, and what it points at.
 *
 * `project` reports the `--project` flag, and `bb_dir` the project dir the
 * rooting resolved. BB-232 split the two on purpose: the DEFAULT project is no
 * longer knowable here. It used to be read out of `~/.bakers/conductors.json`,
 * which this ticket deleted, and its replacement is the conductor record whose
 * `workspace_root` equals `bb_dir` — a control-plane read, and this command
 * holds no JSON:API client (BB-223 spec Finding 1). Printing `bb_dir` is
 * therefore the honest form: it names the exact input the renderer resolves the
 * project from, instead of a `project:` line that could only ever say `(none)`.
 */
function formatConnectionReport(
  connection: BbConnectionConfig,
  rooting: { cwd: string; bakersDir?: string | undefined },
  project?: string | undefined,
): string {
  const yesNo = (b: boolean) => (b ? 'yes' : 'no');
  const lines = [
    ['connection', connection.config_path],
    ['connection_id', connection.connection_id ?? 'default'],
    ['selection', connection.selection_source],
    ['source', connection.source],
    ['fallback', yesNo(connection.fallback)],
    ['legacy', yesNo(connection.legacy)],
    ['base_url', connection.site.base_url],
    ['cwd', rooting.cwd],
    ['bb_dir', rooting.bakersDir ?? '(none)'],
    [
      'project',
      project ?? (rooting.bakersDir ? '(resolved from bb_dir)' : '(none)'),
    ],
  ];
  return `${lines.map(([k, v]) => `${`${k}:`.padEnd(12)}${v}`).join('\n')}\n`;
}

function loggerFor(checkoutRoot: string): ConductorLogger {
  const logger = createLogger({ checkoutRoot });
  setDefaultCommandRunner(new CommandRunner(logger));
  return logger;
}

/**
 * Resolve + dynamically import `@bakers-build/addon-bakers-ui` (the renderer launcher),
 * ESLint-style over the host bases. This package never statically imports the
 * renderer — it is a swappable plugin. Returns undefined (and logs) when the
 * package is not installed.
 */
async function loadBbUiModule(
  logger: ConductorLogger,
  bases: string[],
): Promise<BbUiModule | undefined> {
  let resolved: string | undefined;
  for (const base of bases) {
    try {
      resolved = createRequire(base).resolve('@bakers-build/addon-bakers-ui');
      break;
    } catch {
      // try the next base
    }
  }
  if (resolved === undefined) {
    logger.error(
      {},
      'bakers ui: could not resolve @bakers-build/addon-bakers-ui. ' +
        'Install it, or set $BB_UI_PLUGIN to a renderer plugin path.',
    );
    return undefined;
  }
  return (await import(pathToFileURL(resolved).href)) as BbUiModule;
}

/**
 * `bakers ui` — launch the interactive terminal UI. Resolves the connection
 * through core's shared ready loader (explicit → project → global), roots the agents in the project it was started in, reads the
 * machine context for identity + the agent binary, adapts a herdr-backed agent
 * host to the renderer's prompt-level service, and delegates to
 * `@bakers-build/addon-bakers-ui`'s `runBbUi`. `--print-config` reports the
 * resolution and exits without launching. `$BB_UI_PLUGIN` overrides the
 * renderer module (dev).
 */
export async function cmdUi(deps: UiDeps = {}): Promise<void> {
  const logger = loggerFor(homedir());
  const host = deps.host ?? {
    resolveBases: [`${process.cwd()}/`, import.meta.url],
  };
  const cwd = deps.cwd ?? process.cwd();
  // User-facing CLI errors go to stderr, not the log sink: `createLogger` writes
  // to `$HOME/log.txt` whenever stdout is not a TTY, and `bakers ui BB-1 | cat`
  // must still SAY why it failed. Spec Decision 5: "a stderr line and exit 1".
  const fail = (message: string): void => {
    (deps.stderr ?? ((line: string) => process.stderr.write(line)))(
      `${message}\n`,
    );
    process.exitCode = 1;
  };

  // BB-326 (A1) — teach OpenTUI which libc this host runs BEFORE anything
  // else. It is set on THIS process rather than only on the re-exec's `env`
  // argument, and that placement is the whole point: `reExecUnderBun` passes
  // `env: process.env`, so the Bun child inherits it for free, while the three
  // paths that never re-exec (already under Bun, `$BB_UI_NO_BUN` on Node 26 +
  // --experimental-ffi, an injected `runUi`) load `@opentui/core` in THIS
  // process and would otherwise get the glibc default on Alpine. `@opentui/core`
  // reads the variable when it resolves its native asset — strictly later than
  // here, since the renderer is a dynamic import — so one assignment covers
  // every path. On glibc it is a no-op.
  applyOpentuiLibc(process.env);

  // BB-326 — the renderer needs Bun's FFI. Re-exec here rather than in a bin
  // shim: there are three shims, the host already owns the value-aware argv
  // pre-scan that says `ui` was invoked, and `--print-config` must keep working
  // without Bun. This sits after `fail` is declared (the only ordering the
  // named-error path allows) and still before every config load and the whole
  // deep-link ladder, so nothing is resolved twice across the two processes.
  if (
    shouldReExecUnderBun({
      bunVersion: process.versions.bun,
      noBun: process.env.BB_UI_NO_BUN,
      printConfig: Boolean(deps.printConfig),
      injectedRenderer: deps.runUi !== undefined,
    })
  ) {
    const bin = resolveBunBinary(host.resolveBases);
    if (bin === undefined) {
      fail(
        'bakers ui: could not resolve the bun runtime. `@bakers-build/addon-bakers-ui` ' +
          'depends on it; reinstall, or set $BB_UI_NO_BUN=1 to run on Node ' +
          '26+ with --experimental-ffi.',
      );
      return;
    }
    reExecUnderBun(bin, process.argv);
  }

  // BB-223: build the deep-link route FIRST — argv parsing, the conflict rule
  // and the whole `--here` ladder are offline, so every one of their failures
  // costs no config load and no network round-trip, and never reaches the
  // launcher (AC-1/AC-2).
  let initialRoute: UiInitialRoute | undefined;
  try {
    const parsed = parseTarget({
      target: deps.target,
      ticket: deps.ticket,
      project: deps.project,
      run: deps.run,
      here: deps.here,
      view: deps.view,
    });
    if (parsed?.kind === 'route') {
      initialRoute = parsed.route;
    } else if (parsed?.kind === 'here') {
      initialRoute = await resolveHere({
        cwd,
        ...(parsed.view !== undefined ? { view: parsed.view } : {}),
        readBranch: deps.readBranch ?? readCurrentBranch,
        readRemoteUrl: deps.readRemoteUrl ?? readOriginRemoteUrl,
      });
    }
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
    return;
  }

  const mcPath = machineContextPath();
  // The machine context still supplies identity (`user_id`) + the agent binary;
  // it is NOT the connection any more — core resolves that.
  const machine: Partial<MachineContext> =
    deps.machine ?? (await readMachineContext(mcPath).catch(() => ({})));

  const rooting = resolveProjectRooting(cwd, homedir());
  const conductorPath = rooting.bakersDir
    ? (host.projectContext?.resolveConfigPath(cwd) ??
      join(rooting.bakersDir, 'conductor.config.js'))
    : undefined;
  const workspaceSelector =
    deps.workspace ??
    (conductorPath
      ? host.projectContext?.readWorkspace(conductorPath)
      : undefined);

  // Core resolves the selected connection; the host delegates project context
  // to conductor so this command package stays independent of both packages.
  const load = deps.loadConnection ?? loadReadyBbConnection;
  let resolved: BbConnectionConfig;
  try {
    const projectContext = host.projectContext;
    const resolveProject = Boolean(
      conductorPath &&
        projectContext?.resolveContext &&
        !deps.workspace &&
        !deps.printConfig,
    );
    resolved = await load(host, {
      ...deps.workspaceRecovery,
      cwd,
      explicit: resolveExplicitConfig(deps.explicitConfig),
      ...(deps.connection ? { connection: deps.connection } : {}),
      ...(resolveProject
        ? { workspaceIdOverride: '' }
        : workspaceSelector
          ? { workspaceSelector }
          : {}),
    });
    if (resolveProject && conductorPath && projectContext?.resolveContext) {
      const context = await projectContext.resolveContext(
        conductorPath,
        resolved,
      );
      resolved = await load(host, {
        ...deps.workspaceRecovery,
        cwd,
        explicit: resolveExplicitConfig(deps.explicitConfig),
        ...(deps.connection ? { connection: deps.connection } : {}),
        workspaceIdOverride: '',
        workspaceSelector: context.workspaceId,
      });
    }
    // BB-495 D1: the dropsh request path no longer carries an ambient
    // workspace — the caller names it on the call. `bakers ui` scopes its own
    // reads because a focused workspace is what makes its lists readable, so
    // it attaches the plugin itself, right here, with the workspace it
    // already resolved.
    if (
      resolved.workspace_id &&
      !resolved.plugins.some((plugin) => plugin.id === 'bakers-workspace')
    ) {
      resolved = {
        ...resolved,
        plugins: [
          ...resolved.plugins,
          workspacePlugin({ workspace_id: resolved.workspace_id }),
        ],
      };
    }
  } catch (err) {
    // `fail`, not `logger.error`: a connection config that will not resolve is
    // the most user-facing error this command has, and the logger writes to
    // `$HOME/log.txt` whenever stdout is not a TTY. Sent to the log sink it
    // came out as `exit 1` and NOT ONE LINE of output — which is exactly how
    // CI reported it, with the actual cause (a missing `site.base_url`)
    // sitting in a file nobody on that runner would think to read. The log
    // keeps its copy; stderr gets the one a human reads.
    const message = err instanceof Error ? err.message : String(err);
    logger.error({}, message);
    fail(`bakers ui: ${message}`);
    return;
  }

  const notice = deps.updateCheck
    ? await deps.updateCheck()
    : deps.runUi
      ? null
      : await fetchUpdateNotice(resolveCliVersion());
  if (notice !== null) {
    (deps.stdout ?? ((line: string) => process.stdout.write(line)))(
      `${notice}\n`,
    );
  }

  const connection: HomeConnection = {
    baseUrl: resolved.site.base_url,
    jsonapiPrefix: resolved.site.jsonapi_prefix,
    authPlugins: resolved.plugins,
    configPath: resolved.config_path,
  };

  // BB-233: the write client, built here because this package already holds
  // the constructed plugins and imports dropsh — the renderer stays
  // dropsh-decoupled and receives a finished object.
  //
  // BB-391 emptied this fallback of the PROFILE concept but kept the fallback
  // itself, and the difference is the point. It used to point the write profile
  // at the read one, because a connection declaring the reads' provider and not
  // the writes' was an ordinary configuration; that rename is gone along with
  // both fields, and there is no profile left to name.
  //
  // What remains is why it was a `catch` and not a `fail`: a connection with NO
  // resolvable auth provider still READS. `resolveAuth` throws
  // `Multiple auth profiles configured (); none active` for a plugins[] that
  // yields none, and a `@bakers-build/addon-auth-basic` connection reaches this line
  // the same way. Aborting there would take the whole cockpit down over a write
  // seam it may never use. So no write client is injected, the renderer falls
  // back to the read client, and the server's own 403 is the operator's answer —
  // Decision 1's single failure path, minus the profile it used to name.
  let writeClient: unknown;
  try {
    writeClient = await (deps.buildWriteClient ?? buildWriteClientDefault)({
      baseUrl: resolved.site.base_url,
      jsonapiPrefix: resolved.site.jsonapi_prefix ?? '/jsonapi',
      plugins: resolved.plugins,
      ...(deps.workspaceRecovery?.stateDir
        ? { stateDir: deps.workspaceRecovery.stateDir }
        : {}),
    });
  } catch (err) {
    logger.warn(
      {},
      'bakers ui: no write client could be built ' +
        `(${err instanceof Error ? err.message : String(err)}); ` +
        'edits will be attempted through the read client.',
    );
  }

  const project = deps.project;

  // AC-7, always on: the resolution lands in the log even when the TUI takes
  // over the screen a moment later.
  logger.info(
    {
      config_path: resolved.config_path,
      source: resolved.source,
      fallback: resolved.fallback,
      legacy: resolved.legacy,
      base_url: resolved.site.base_url,
      cwd: rooting.cwd,
      // The `.bakers` dir, not a project name: since BB-232 the default project
      // is resolved in the renderer from the conductor record whose
      // `workspace_root` is this dir. `project` here is the flag alone.
      bb_dir: rooting.bakersDir,
      project,
    },
    'bakers ui: resolved connection',
  );

  // AC-7, the human surface: print and exit 0 WITHOUT booting the TUI, so a
  // wrong-control-plane situation is diagnosable at a prompt.
  if (deps.printConfig) {
    const write = deps.stdout ?? ((s: string) => process.stdout.write(s));
    write(formatConnectionReport(resolved, rooting, project));
    return;
  }

  const agentCommand = resolveAgentCommand(machine);
  const agentHost =
    deps.agentHost ?? herdrAgentHost((args) => exec('herdr', args));
  const agents: TuiAgentService = {
    launch: (o) =>
      agentHost.launch({
        group: o.group,
        cwd: o.cwd,
        command: agentCommand(o.prompt),
        env: o.env,
        ...(o.label !== undefined ? { label: o.label } : {}),
      }),
    list: (group) => agentHost.list(group),
    focus: (id) => agentHost.focus(id),
    hide: (group) => agentHost.hide(group),
    kill: (id) => agentHost.kill(id),
  };

  let renderer: ((opts: unknown) => unknown) | undefined;
  const override = process.env.BB_UI_PLUGIN;
  if (override) {
    try {
      const mod = (await import(pathToFileURL(override).href)) as {
        default?: (opts: unknown) => unknown;
        ticketRendererPlugin?: (opts: unknown) => unknown;
      };
      const factory = mod.default ?? mod.ticketRendererPlugin;
      if (typeof factory !== 'function') {
        throw new Error('module exports no renderer-plugin factory');
      }
      renderer = factory;
    } catch (err) {
      logger.error(
        { override },
        `bakers ui: could not load $BB_UI_PLUGIN at ${override} ` +
          `(${err instanceof Error ? err.message : String(err)}).`,
      );
      process.exitCode = 1;
      return;
    }
  }

  let run = deps.runUi;
  if (!run) {
    const uiMod = await loadBbUiModule(logger, host.resolveBases);
    if (uiMod === undefined) {
      process.exitCode = 1;
      return;
    }
    run = uiMod.runBbUi;
  }

  // The launcher (and, through it, the renderer's route resolution — Decision 5)
  // may reject BEFORE the TUI takes the terminal; `await run(...)` was unguarded,
  // so that surfaced as an unhandled rejection. Catch it into exit 1 + a line.
  try {
    await run({
      connection,
      cwd: rooting.cwd,
      ...(project !== undefined ? { project } : {}),
      agents,
      ...(machine.user_id ? { currentUser: machine.user_id } : {}),
      ...(rooting.bakersDir ? { bakersDir: rooting.bakersDir } : {}),
      ...(resolved.workspace_id ? { workspaceId: resolved.workspace_id } : {}),
      configPath: resolved.config_path,
      // BB-472: the workspace-picker screen's restart seam — the same
      // reExecUnderBun step this process took to reach OpenTUI at all
      // (`shouldReExecUnderBun`, above). Absent only when the bun binary could
      // not be resolved, which already failed startup before this point.
      restartProcess: () => {
        const bin = resolveBunBinary(host.resolveBases);
        if (bin) reExecUnderBun(bin, process.argv);
      },
      ...(conductorPath && host.projectContext
        ? {
            selectWorkspace: async (name: string) => {
              await host.projectContext?.writeWorkspace(conductorPath, name);
            },
          }
        : {}),
      // The plugins are real constructed `DropSHPlugin[]` now (core built them),
      // matching dropsh's declared contract — F3's substance, a descriptor handed
      // to an API expecting instances, is gone. The two casts that remain are
      // structural, not unsound: `RunBbUiOptions` is a local MIRROR of the
      // dynamically-resolved renderer's type (this package must not compile
      // against it), so its `plugins` is `unknown[]` and its program type is the
      // narrow `DropshProgram` above. Both casts only re-tell TypeScript what the
      // mirror deliberately forgot.
      // Bind command context to the freshly loaded connection, including its
      // request hooks. The renderer cannot reload an earlier environment config.
      buildProgram: (o) =>
        buildDropshProgram({
          plugins: o.plugins as BbConnectionConfig['plugins'],
          contextFactory: () =>
            createBbConnectionContext(
              {
                ...resolved,
                plugins: o.plugins as BbConnectionConfig['plugins'],
              },
              { ...deps.workspaceRecovery, cwd },
            ),
        }) as unknown as DropshProgram,
      ...(renderer ? { renderer } : {}),
      ...(initialRoute ? { initialRoute } : {}),
      ...(writeClient !== undefined ? { writeClient } : {}),
      // BB-373 — the UI contributions core discovered from `addons[]`, still
      // as module specifiers. Omitted when there are none, so a config without
      // `addons[]` hands the renderer exactly what it got before.
      //
      // `?? []` because `loadConnection` is an INJECTED seam (`deps`), so the
      // resolved object is only as complete as whoever supplied the loader:
      // core's own always carries this key, a caller's substitute need not.
      ...(resolved.ui_entries?.length
        ? { uiEntries: resolved.ui_entries }
        : {}),
    });
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }
}

/** The `ui` command plugin the host mounts (`bakers ui`). */
const uiCommandPlugin: BbCommandPlugin = {
  kind: 'command',
  name: 'ui',
  describe: 'interactive terminal UI: dashboard, projects, tickets',
  register(program: Command, host: BbCommandHost): void {
    program
      .command('ui')
      .description('interactive terminal UI: dashboard, projects, tickets')
      .argument(
        '[target]',
        'deep-link target: BB-221 · #19 · bakers#19 · <issue url> · ticket:<id|uuid> · project:<name|uuid> · run:<uuid>',
      )
      .option('--ticket <id>', 'open a ticket by identifier or uuid')
      .option('--project <id>', 'open a project by name or uuid')
      .option('--run <uuid>', "open a run's owning ticket, on its Runs tab")
      .option(
        '--here',
        "derive the target from the cwd: the branch's ticket, else this repo's project",
      )
      .option(
        '--view <mode>',
        `how a ticket renders: ${UI_VIEW_MODES.join(' | ')}`,
      )
      .option(
        '--config <path>',
        'connection config path; wins over the project and home configs',
      )
      .option('--connection <id>', 'named connection from ~/.bakers/connections')
      .option(
        '--workspace <name|uuid>',
        'select a workspace for THIS run only — never written to the connection config',
      )
      .option('--yes', 'never prompt for workspace selection')
      .option(
        '--print-config',
        'print the resolved connection config and exit, without launching the UI',
      )
      .addHelpText(
        'after',
        `
Targets (at most ONE of the positional, --ticket, --project, --run, --here):
  bakers ui                                the dashboard
  bakers ui BB-221                       a ticket by identifier (case-insensitive)
  bakers ui ticket:BB-221                the same, said explicitly
  bakers ui ticket:<uuid>                  a ticket by uuid
  bakers ui '#19'                          a ticket by its origin issue (quote the #);
  bakers ui bakers#19                        also <repo>#<n> or the issue URL
  bakers ui project:bakers                   a project by name (case-sensitive label)
  bakers ui run:<uuid>                     that run's owning ticket, Runs tab active
  bakers ui --ticket BB-221              the script-friendly flag form
  bakers ui --here                         this branch's ticket (feat/bb-223-… → BB-223),
                                         else this repo's project

Modifier (orthogonal — never conflicts with a target):
  bakers ui BB-221 --view teaser         a compact block instead of the tabbed detail
  bakers ui BB-221 --view board_card     the board-card field set

Two target sources at once exit non-zero naming both. A bare uuid is ambiguous
(prefix it); a bare number is not an identifier. --view applies to ticket
targets only. Full reference: bakers-cli/ui/README.md
`,
      )
      .action(
        async (
          target: string | undefined,
          o: {
            ticket?: string;
            project?: string;
            run?: string;
            here?: boolean;
            view?: string;
            config?: string;
            connection?: string;
            workspace?: string;
            printConfig?: boolean;
            yes?: boolean;
          },
        ) => {
          await cmdUi({
            host,
            ...(target !== undefined ? { target } : {}),
            ...(o.ticket !== undefined ? { ticket: o.ticket } : {}),
            ...(o.project !== undefined ? { project: o.project } : {}),
            ...(o.run !== undefined ? { run: o.run } : {}),
            ...(o.here !== undefined ? { here: o.here } : {}),
            ...(o.view !== undefined ? { view: o.view } : {}),
            ...(o.config !== undefined ? { explicitConfig: o.config } : {}),
            ...(o.connection !== undefined ? { connection: o.connection } : {}),
            ...(o.workspace !== undefined ? { workspace: o.workspace } : {}),
            ...(o.yes ? { workspaceRecovery: { yes: true } } : {}),
            ...(o.printConfig ? { printConfig: true } : {}),
          });
        },
      );
  },
};

export default uiCommandPlugin;
