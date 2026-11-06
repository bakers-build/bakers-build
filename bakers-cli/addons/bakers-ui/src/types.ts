import type { ConductorProcessHost } from './Entity/conductor/Data/process.js';
// Shared shapes for the dropsh renderer inputs + the JSON:API documents the TUI
// reads. These model the *contract* the plugin consumes at runtime (the dropsh
// client, its `toResource(...)` wrappers, and the ticket-detail document) so the
// modules stay strictly typed without leaking `any`.

/** A dropsh `toResource(...)` wrapper — see tests/test-support.ts. */
export interface Resource {
  id: string;
  type: string;
  attr(key: string): unknown;
  rel(key: string): string | null;
  rels(key: string): string[];
}

/** A dropsh collection query builder (fluent). */
export interface Collection {
  where(path: string, op: string, value: unknown): Collection;
  whereIn(path: string, values: unknown[]): Collection;
  sort(field: string, direction: string): Collection;
  page(size: number): Collection;
  first(): Promise<Resource | null>;
  list(): Promise<Resource[]>;
}

/**
 * The attributes/relationships payload a write accepts. A STRUCTURAL MIRROR of
 * dropsh's own `ResourceWriteBody` (`dropsh/dist/src/core/jsonapi/client.d.ts`),
 * mirrored rather than imported for the same reason `UiInitialRoute` and
 * `HomeConnection` are: this renderer must stay dropsh-decoupled (BB-194 AC-5
 * — its `package.json` deliberately has no `dropsh` dependency).
 */
export interface ResourceWriteBody {
  attributes?: Record<string, unknown>;
  relationships?: Record<string, unknown>;
}

/**
 * The dropsh JSON:API client exposed as `services.client`.
 *
 * BB-233: this is a hand-written NARROWING of dropsh's `JsonApiClient`, which
 * really exposes `get/post/patch/delete/upload/collection/resource/create/
 * update/upsert/me`. The read-only shape was the type, never the object — so
 * adding `update` costs no HTTP plumbing. Only the one method the TUI calls is
 * declared; the rest stays narrowed on purpose.
 */
export interface DropshClient {
  collection(type: string): Collection;
  // `params` (a drupal-jsonapi-params `DrupalJsonApiParams`) is serialized by the
  // client via `params.getQueryString()`; typed `unknown` to avoid leaking the
  // dep into the shared contract. Matches dropsh 0.5.7's `get(path, params?)`.
  get(path: string, params?: unknown): Promise<unknown>;
  /** PATCH `{ data: { type, id, ...body } }` — dropsh 0.5.8's `update`. */
  update(type: string, id: string, body: ResourceWriteBody): Promise<unknown>;
  /**
   * POST a raw document to a path — dropsh's `post`, for the custom resources
   * that are not an entity create (the addon inbox send).
   */
  post(path: string, body: unknown): Promise<unknown>;
}

/** A JSON:API relationship linkage. */
export interface JsonApiRelationship {
  data?: { id: string } | Array<{ id: string }> | null;
}

/** A JSON:API resource object (the ticket entity + its sideloaded includes). */
export interface JsonApiResource {
  type?: string;
  id?: string;
  attributes?: Record<string, unknown>;
  relationships?: Record<string, JsonApiRelationship | undefined>;
}

/** A ticket-detail document: primary resource + sideloaded includes. */
export interface TicketDetailDocument {
  data?: JsonApiResource;
  included?: JsonApiResource[];
}

/** The dropsh renderer `services` bag the TUI consumes. */
export interface RendererServices {
  client: DropshClient;
  baseUrl?: string;
  project?: string;
  /** The connection's current user (uuid or name) — My work's "me". */
  currentUser?: string;
  /** Fail-closed workspace-lead capability resolved from the active membership. */
  isWorkspaceAdmin?: boolean;
  /**
   * Injectable millisecond clock (defaults to `Date.now`). The footer notice
   * animates dot → check by wall-clock age, so a test that asserts the
   * transient `·` phase must control time deterministically rather than race a
   * real `setTimeout` — under load the real gap overruns NOTICE_ANIM_MS and the
   * toast is already `✓`, which made the Conductors "settles the action toast"
   * test flaky.
   */
  now?: () => number;
  /**
   * A WRITE-scoped JSON:API client, when the host resolved a separate one.
   *
   * BB-233 introduced this as "the `pm` profile", with the read client staying
   * `session` because `pm` could not read `bb_run`. BB-391 RETIRES that
   * reasoning: there is ONE identity now and no profile concept at all, so there
   * is no second scope for a caller to pick and no read this client is barred
   * from. The member survives as the seam it always was — a client the host may
   * hand in for writes — and the two are the same connection in practice.
   *
   * Absent ⇒ the write falls back to `client`, and the server's own 403 is what
   * the operator sees (spec Decisions 1 + 5: one failure path for "wrong scope"
   * and "no scope" alike, never a silent degradation).
   */
  writeClient?: DropshClient;
  // BB-391: there is no companion auth-profile member here, and there is no
  // profile left to name. The popup used to say which profile `writeClient` had
  // resolved under, because there were two of them and it could be on the wrong
  // one; one identity makes that a sentence with no referent. See `launcher.ts`'s
  // `HomeConnection`.
  /** Optional process seam used by the routed Conductors screen. */
  conductorProcess?: ConductorProcessHost;
  /**
   * BB-472 — re-execute this process, injected from `ui/src/bun-runtime.ts`'s
   * `reExecUnderBun` by the conductor entry. The workspace-picker screen calls
   * it AFTER writing a new selection to the owning config, so a conductor
   * reading the same file picks up the write on its next read; absent ⇒ the
   * picker can write but not restart (e.g. under an injected test renderer).
   */
  restartProcess?: () => void;
  /** Persist a product-workspace name through the command owner's config contract. */
  selectWorkspace?: (name: string) => Promise<void>;
  /** BB-472 — the active workspace's uuid, unresolved name form. See
   *  `TuiOptions.workspaceId`. */
  workspaceId?: string;
  /** BB-472 — the active workspace's resolved name. See `TuiOptions.workspace`. */
  workspace?: string;
  /** Absolute path of the loaded connection config, retained for diagnostics. */
  configPath?: string;
  /** Project .bakers directory owning the committed workspace selection. */
  bakersDir?: string;
}

// ---- BB-223: deep links ------------------------------------------------
//
// `UiViewMode` + `UiInitialRoute` are declared HERE and in `@bakers-build/ui`'s
// `src/route.ts`, structurally identical and deliberately NOT shared: the
// command package must never statically import this renderer (it resolves it
// dynamically — enforced by `ui/tests/no-bakers-ui-import.test.ts`), and this
// renderer must not depend on the command package. Mirroring is the established
// pattern across that boundary — `HomeConnection` does exactly the same.

/** How a ticket target is rendered. Mirrors the Drupal `bb_ticket` view modes. */
export type UiViewMode = 'full' | 'teaser' | 'board_card';

/**
 * A deep-link target as the CLI parsed it — UNRESOLVED. It says what to look up
 * and how, never what screen results. Mirror of `@bakers-build/ui`'s `UiInitialRoute`.
 */
export interface UiInitialRoute {
  kind: 'ticket' | 'project' | 'run';
  /**
   * How `value` must be looked up. `'repo'` is the `--here` project rung: the
   * value is a NORMALISED remote URL (`host/path`), matched client-side against
   * `bb_project.repository.url` (spec Decision 3).
   */
  /**
   * `'origin'` (BB-544) is a ticket looked up by its origin issue — `#19`,
   * `bakers#19` or the issue URL — which the server's `filter[search]` resolves.
   */
  by: 'uuid' | 'identifier' | 'name' | 'repo' | 'origin';
  value: string;
  /** Drupal view mode for a ticket target; default 'full'. */
  view?: UiViewMode | undefined;
  /** Set when the target came from `--here`; error messages only. */
  fromBranch?: string | undefined;
}

/**
 * A route AFTER resolution against the control plane — renderer-internal, never
 * crossing a package boundary, so it may speak screen vocabulary.
 *
 * `view` and `tab` are orthogonal and both needed: `view` says HOW the ticket is
 * rendered (the sectioned detail vs. a compact block), `tab` says which ticket
 * SECTION is open WHEN `view` is 'full'. A `run:` target sets `tab: 'runs'`. The
 * project variant carries both id and name — the kernel queries by id and
 * headlines by name, and resolving `project:<uuid>` already fetched both.
 */
export type ResolvedRoute =
  | {
      screen: 'ticket';
      ticketId: string;
      view: UiViewMode;
      tab?: 'runs' | undefined;
      /** Carried even though nothing renders it yet, so a future dedicated run
       *  screen needs no change to the CLI grammar or the launcher contract. */
      runId?: string | undefined;
    }
  | { screen: 'project'; projectId: string; projectName: string }
  /**
   * Spec Decision 14 (AC-8): several bakers projects claim the same repo — a
   * DESIGNED-FOR topology (BB-126/137 map each site of a Drupal multisite repo
   * to its own project), so `--here` shows the ambiguity and lets the user pick
   * instead of failing permanently. This is the one route outcome that is a
   * screen rather than a lookup result, which is why Decision 5's "abort before
   * the TUI" invariant is scoped to FAILURES.
   */
  | {
      screen: 'project-picker';
      /** The normalised `host/path` every candidate claims. */
      repo: string;
      candidates: { id: string; name: string }[];
    };

/**
 * How a delayed callback is scheduled (BB-257 R2).
 *
 * The parent picker re-queries the control plane on a debounce, and a test that
 * waits out a real 150ms timer is a test that fails on a busy machine. Injecting
 * the scheduler lets the suite run it in immediate mode instead of sleeping.
 * Returns the CANCEL for the pending call — a new keystroke supersedes the one
 * before it, which is what makes it a debounce rather than a queue.
 */
export type Debounce = (fn: () => void, ms: number) => () => void;

/**
 * BB-376 — a directory watch, reduced to the two things the refresh signal
 * needs: the events for one directory, and a way to stop.
 *
 * Declared HERE rather than in `lib/refresh-signal.ts` for the same reason
 * `Debounce` is: `TuiOptions` names it as a test seam, and a `types.ts` that
 * imported `lib/` would put a cycle between the two modules every other file
 * already depends on.
 */
export type WatchDirectory = (
  dir: string,
  onEvent: (filename: string | null) => void,
) => { close(): void };

/**
 * BB-326 — what happened to a request to copy something.
 *
 * Four values because the terminal answers in three states and the write can
 * still fail:
 *
 *  - `copied`       the terminal confirmed OSC 52 and the escape went out;
 *  - `unconfirmed`  the escape went out, but the terminal never answered the
 *                   capability probe (`osc52_support: 'unknown'`), so nobody
 *                   can say whether it landed;
 *  - `unsupported`  the terminal answered that it does not accept OSC 52 —
 *                   nothing was sent;
 *  - `failed`       supported, but the write did not happen.
 *
 * The wording for each is in `lib/clipboard.ts`; the seam that produces them is
 * `Kernel/clipboard.ts`.
 */
export type ClipboardOutcome =
  | 'copied'
  | 'unconfirmed'
  | 'unsupported'
  | 'failed';

/**
 * Put one string in the operator's system clipboard.
 *
 * Declared HERE, in the shared types, because three layers that may not import
 * each other all speak it. `Kernel/` implements it
 * over the renderer, `Screen/` carries it on the context, and a slice's own
 * `Screen/` calls it — and the boundary guards (`tests/boundary.test.ts` G5)
 * forbid a screen from importing the kernel.
 */
export type ClipboardWriter = (text: string) => ClipboardOutcome;

/** Options passed by the factory into the kernel. */
export interface TuiOptions {
  project?: string;
  cwd?: string;
  /**
   * BB-232 (D9): the `.bakers` dir the entry is standing in, UNRESOLVED. The
   * plugin's `run()` matches it against each conductor's `workspace_root` and
   * fills `project` from the record it finds — the value the deleted
   * `~/.bakers/conductors.json` used to supply. Absent outside
   * any project, and never read by the kernel itself.
   */
  bakersDir?: string | undefined;
  /**
   * BB-472 — the connection's ambient workspace uuid, UNRESOLVED (the name is
   * what the chrome shows). The plugin's `run()` resolves it into `workspace`
   * below, the same way it resolves `bakersDir` into `project` — read once, at
   * boot, beside `readOwnConductor()`.
   */
  workspaceId?: string | undefined;
  /** BB-472 — the RESOLVED workspace name the plugin's `run()` produced,
   *  passed to the chrome verbatim. Absent ⇒ no workspace suffix. */
  workspace?: string | undefined;
  selectWorkspace?: ((name: string) => Promise<void>) | undefined;
  /** BB-472 — see `RendererServices.configPath`. */
  configPath?: string | undefined;
  currentUser?: string;
  /** Workspace-lead capability resolved by the plugin before routing starts. */
  isWorkspaceAdmin?: boolean;
  /** BB-223: the unresolved deep-link target, as it arrived from the CLI. */
  initialRoute?: UiInitialRoute | undefined;
  /** BB-223: the RESOLVED route the plugin's `run()` produced. The kernel
   *  boots this screen instead of the default one; absent ⇒ My work. */
  route?: ResolvedRoute | undefined;
  /** The write-scoped client — see `RendererServices.writeClient`, and BB-391
   *  for why it no longer names a profile. Optional at every hop, resolved
   *  `services?.x ?? options?.x`. */
  writeClient?: DropshClient | undefined;
  /**
   * BB-232: the seam the Conductors screen starts and stops through.
   *
   * Injectable so the kernel tests drive the real key handling without
   * spawning a process or signalling a pid. Absent ⇒ the real host.
   */
  conductorProcess?: ConductorProcessHost | undefined;
  /**
   * BB-472 — the re-exec seam the workspace-picker screen calls after
   * writing a new selection. See `RendererServices.restartProcess`.
   */
  restartProcess?: (() => void) | undefined;
  /** BB-257 R2: the parent picker's debounce, injectable for the tests.
   *  Absent ⇒ a real `setTimeout`. */
  debounce?: Debounce | undefined;
  /** BB-376: the auto-refresh directory watch, injectable for the kernel
   *  tests so a signal is a function call rather than an inotify event.
   *  Absent ⇒ the real `node:fs` watch. */
  watchDirectory?: WatchDirectory | undefined;
  /**
   * BB-326: a test supplies its own `CliRenderer`; production creates one.
   *
   * The same shape the kernel already takes `writeClient`,
   * `conductorProcess` and `debounce` in — and the only production-code
   * concession the OpenTUI swap makes to the tests. Present ALSO means
   * interactive: `@opentui/core/testing`'s renderer has no TTY behind it, so
   * `process.stdout.isTTY` would otherwise send a test down the plain-lines
   * branch that has no renderer at all.
   */
  renderer?: import('@opentui/core').CliRenderer | undefined;
  /**
   * BB-373: UI extension entry modules, resolved from `addons[]` by core.
   *
   * Specifiers, not contributions — the kernel imports them ONCE at boot
   * (`Extension/load.ts`). Absent ⇒ no contributions, which is the shape every
   * pre-existing caller already has.
   */
  uiEntries?: readonly string[] | undefined;
  /**
   * BB-375: skip the timed boot splash. Defaults to true when `renderer` is
   * injected (harness speed); production TTY leaves this unset and shows splash.
   * Set `false` with an injected renderer to exercise splash in a dedicated test.
   */
  skipSplash?: boolean | undefined;
  /** BB-375: injectable splash clock (defaults to real `setTimeout`). */
  wait?: ((ms: number) => Promise<void>) | undefined;
}
