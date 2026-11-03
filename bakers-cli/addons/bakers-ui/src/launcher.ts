import bakersUiPlugin, { type BbUiOptions } from './plugin.js';
import type {
  DropshClient,
  TuiAgentService,
  UiInitialRoute,
  UiViewMode,
} from './types.js';

// BB-194 AC-4: the dropsh-tui invocation (`buildProgram` + the `--format tui`
// seed run) lives HERE, in the renderer package, not in the conductor `bakers ui`
// command. The conductor entry stays a thin composition point: it resolves the
// home connection + a herdr-backed agent host and delegates to `runBbUi`. The
// launcher stays herdr-agnostic (the agent impl is INJECTED, never imported) and
// dropsh-decoupled (dropsh's `buildProgram` is INJECTED, so this package needs
// no `dropsh` dependency — AC-5).

/** A dropsh program: only the `parseAsync` we drive is modelled. */
export interface DropshProgram {
  parseAsync(argv: string[], opts: { from: 'user' }): Promise<unknown>;
}

/** The subset of dropsh's `buildProgram` the launcher uses (injected). */
export type DropshBuildProgram = (opts: {
  plugins: unknown[];
}) => DropshProgram;

/**
 * The resolved home control-plane connection. `authPlugins` are the dropsh auth
 * plugin descriptors/instances (ONE oauth2 client-credentials entry on ONE
 * scope, marked `default: true` — BB-391); `configPath` points dropsh's own
 * in-process context factory at a home dropsh config (base_url + the same auth)
 * so it can build its client WITHOUT a project `conductor.config.js` — the
 * conductor entry synthesizes it.
 *
 * BB-391 removed the two read/write auth-profile members this interface used
 * to carry. They existed because a connection declared two profiles differing
 * only by OAuth scope, and which one a caller was on decided what it could see
 * and write: `bb_run` came back EMPTY under one while the other held no
 * `update bb_ticket` at all. What went away is the CHOICE, not the scope: the
 * surviving entry still requests `bb:session`, because for a
 * `client_credentials` token `simple_oauth` overwrites the account's permissions
 * with exactly the scope's. The OG rank the identity holds in its workspace
 * (BB-359) bounds which ROWS the cockpit reaches; the one scope bounds which
 * operations exist at all — and since there is only one of each, there is nothing
 * left for a caller to pin. AC2's grep over every package's `src` is the guard,
 * which is why the retired member names are not spelled here.
 */
export interface HomeConnection {
  baseUrl: string;
  jsonapiPrefix?: string | undefined;
  authPlugins: unknown[];
  configPath?: string | undefined;
}

export interface BbUiLauncherOptions {
  /** Resolved home connection (base_url + auth + dropsh config path). */
  connection: HomeConnection;
  /** Repo/home root the launched agents run in. */
  cwd: string;
  /** Default project (opaque group) — `bakers ui --project`, when given. */
  project?: string | undefined;
  /**
   * BB-232 (D9): the `.bakers` dir the entry is standing in. The renderer's
   * `run()` resolves it against the control plane into the default `project`
   * and `ownConductorId`; the entry cannot, holding no JSON:API client.
   * An explicit `project` above still wins.
   */
  bakersDir?: string | undefined;
  /** BB-472 — the connection's ambient workspace uuid; the renderer resolves
   *  its name and shows it in the chrome. Absent ⇒ no workspace suffix. */
  workspaceId?: string | undefined;
  /** BB-472 — the loaded connection config's absolute path, so the
   *  workspace-picker screen can find `workspace_id`'s owning file. */
  configPath?: string | undefined;
  /** BB-472 — re-executes this process; the picker calls it after writing a
   *  new workspace selection. Injected from `ui/src/bun-runtime.ts`. */
  restartProcess?: (() => void) | undefined;
  selectWorkspace?: ((name: string) => Promise<void>) | undefined;
  /** Herdr-backed agent host, already adapted prompt→command (injected). */
  agents?: TuiAgentService | undefined;
  /** Preselected new-ticket assignee (this machine's user id). */
  currentUser?: string | undefined;
  /** This checkout's conductor UUID — preselected in the new-ticket form. */
  ownConductorId?: string | undefined;
  /** Config override for the ticket-create agent's base prompt. */
  createPrompt?: string | undefined;
  /** Injected dropsh `buildProgram` (the entry passes dropsh's real one). */
  buildProgram: DropshBuildProgram;
  /** Injected renderer factory; defaults to this package's own plugin. The
   *  `$BB_UI_PLUGIN` dev override resolves a different module in the entry. */
  renderer?: ((opts: BbUiOptions) => unknown) | undefined;
  /** BB-223: the deep-link target the entry parsed, still UNRESOLVED — the
   *  entry has no JSON:API client (spec Finding 1), so the renderer resolves it
   *  in `run()` before the kernel takes the terminal. Absent ⇒ My work
   *  (BB-256 moved the routeless default there). */
  initialRoute?: UiInitialRoute | undefined;
  /**
   * BB-233: the write-scoped JSON:API client, BUILT by the caller (the ui
   * package owns connection + auth composition; this package stays
   * dropsh-decoupled and only forwards the finished object). Absent ⇒ the
   * kernel writes through the read client and the server decides.
   */
  writeClient?: DropshClient | undefined;
  /**
   * BB-373: the UI extension entry modules core discovered from `addons[]`.
   *
   * Forwarded verbatim into the renderer factory; nothing here imports them.
   */
  uiEntries?: readonly string[] | undefined;
}

// BB-223: re-exported so a consumer of the launcher contract can name the
// route type without reaching into `types.js`. See `types.ts` for why the shape
// is MIRRORED rather than imported from `@bakers-build/ui`.
export type { UiInitialRoute, UiViewMode };

/**
 * Build + run the dropsh `--format tui` program with the TUI renderer and the
 * injected agent host. A trivial `search bb_project` seeds the renderer's
 * `run()`; the renderer discards the seed document and boots its own projects
 * screen from the `bb_conductor` records it reads through this connection.
 */
export async function runBbUi(opts: BbUiLauncherOptions): Promise<void> {
  // Point dropsh's own in-process context factory at the home dropsh config so
  // it resolves base_url + auth without a project config. An explicit
  // $DROPSH_CONFIG (or a prior set) still wins.
  if (opts.connection.configPath && !process.env.DROPSH_CONFIG) {
    process.env.DROPSH_CONFIG = opts.connection.configPath;
  }
  // BB-391: nothing sets `$DROPSH_AUTH_PROFILE` any more. This used to pin the
  // read profile so dropsh could not fall through to a previously-active one
  // whose provider the home config omitted. A v3 connection declares exactly one
  // provider, marked `default: true`, so there is no other profile to fall
  // through to — and naming one would assert a capability the token no longer
  // carries.

  const makeRenderer = opts.renderer ?? bakersUiPlugin;
  const renderer = makeRenderer({
    cwd: opts.cwd,
    ...(opts.project !== undefined ? { project: opts.project } : {}),
    ...(opts.bakersDir !== undefined ? { bakersDir: opts.bakersDir } : {}),
    ...(opts.workspaceId !== undefined
      ? { workspaceId: opts.workspaceId }
      : {}),
    ...(opts.configPath !== undefined ? { configPath: opts.configPath } : {}),
    ...(opts.restartProcess !== undefined
      ? { restartProcess: opts.restartProcess }
      : {}),
    ...(opts.selectWorkspace !== undefined
      ? { selectWorkspace: opts.selectWorkspace }
      : {}),
    ...(opts.agents ? { agents: opts.agents } : {}),
    ...(opts.currentUser !== undefined
      ? { currentUser: opts.currentUser }
      : {}),
    ...(opts.ownConductorId !== undefined
      ? { ownConductorId: opts.ownConductorId }
      : {}),
    ...(opts.createPrompt !== undefined
      ? { createPrompt: opts.createPrompt }
      : {}),
    // Optional at every hop — omitting the key is the My work path.
    ...(opts.initialRoute !== undefined
      ? { initialRoute: opts.initialRoute }
      : {}),
    // BB-233: the write seam — the client is built by the caller. BB-391
    // dropped the profile that used to ride along beside it: there is one
    // identity, so there is nothing for the popup to name.
    ...(opts.writeClient !== undefined
      ? { writeClient: opts.writeClient }
      : {}),
    // BB-373 — optional at every hop, exactly like `initialRoute` above.
    ...(opts.uiEntries !== undefined ? { uiEntries: opts.uiEntries } : {}),
  });

  const program = opts.buildProgram({
    plugins: [...opts.connection.authPlugins, renderer],
  });

  // Any JSON:API document with `--format tui` drives the renderer; it discards
  // the seed and loads My work itself.
  await program.parseAsync(
    [
      '--format',
      'tui',
      'search',
      'bb_project',
      '--bundle',
      'bb_project',
      '--limit',
      '1',
    ],
    { from: 'user' },
  );
}
