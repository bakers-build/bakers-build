// BB-223: the pure CLI seam of `bakers ui` deep links.
//
// This module owns the *grammar* — argv in, an unresolved `UiInitialRoute` out —
// and the `--here` ladder. It performs no I/O of its own: git, the filesystem
// and the conductor registry all enter through injected seams, so the whole
// grammar is testable offline and a conflict/parse failure costs no network
// round-trip (spec Decisions 1, 3, 4, 6, 13).
//
// Resolving a route against the control plane is deliberately NOT here: the
// entry has no JSON:API client (spec Finding 1). That happens in the renderer,
// in `@bakers-build/addon-bakers-ui`'s `resolveRoute`, still before the TUI takes the
// terminal (spec Decision 5).

/** How a ticket target is rendered. Mirrors the Drupal `bb_ticket` view modes. */
export type UiViewMode = 'full' | 'teaser' | 'board_card';

/** The known `--view` modes, in the order error messages list them. */
export const UI_VIEW_MODES: readonly UiViewMode[] = [
  'full',
  'teaser',
  'board_card',
];

/**
 * A deep-link target as the CLI understands it — *unresolved*: it says what to
 * look up and how, never what screen results. Crosses both package boundaries
 * (`RunBbUiOptions` → `BbUiLauncherOptions` → `TuiOptions`) and is mirrored
 * structurally in the renderer, per the `HomeConnection` precedent (Finding 6).
 */
export interface UiInitialRoute {
  kind: 'ticket' | 'project' | 'run';
  /**
   * How `value` must be looked up. `'repo'` is the `--here` project rung: the
   * value is a NORMALISED remote URL (`host/path`), matched client-side against
   * the `bb_project.repository.url` of every project (spec Decision 3).
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

/** The raw argv inputs `parseTarget` reads (commander's parsed options). */
export interface TargetInputs {
  target?: string | undefined;
  ticket?: string | undefined;
  project?: string | undefined;
  run?: string | undefined;
  here?: boolean | undefined;
  view?: string | undefined;
}

/**
 * What the grammar made of the argv: nothing (the dashboard), a `--here`
 * request that still needs the ladder walked, or a finished route.
 */
export type ParsedTarget =
  | { kind: 'here'; view?: UiViewMode | undefined }
  | { kind: 'route'; route: UiInitialRoute };

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `<project-key>-<number>`, case-insensitive (Decision 4). One dash only, so a
 *  UUID can never match it. */
const IDENTIFIER_RE = /^[A-Za-z][A-Za-z0-9]*-\d+$/;

/**
 * The ticket identifier carried by a branch name, first match wins. Every
 * convention places the identifier before the title slug and `capBranchName()`
 * never truncates it (Finding 3), so the first match is the right one.
 */
const BRANCH_IDENTIFIER_RE = /(?:^|[/_-])([A-Za-z][A-Za-z0-9]*-\d+)(?=$|[/_-])/;

/** An origin issue reference: `#19`, `bakers#19`, or an http(s) URL. Only shape
 *  is checked here; the server resolves the alias and the URL. */
const ORIGIN_RE = /^(?:[A-Za-z0-9._-]*#\d+|https?:\/\/\S+)$/;

const ACCEPTED_FORMS =
  "accepted forms: BB-221 (a ticket identifier), '#19' or 'bakers#19' or an " +
  "issue URL (an origin issue), 'ticket:<id|uuid>', 'project:<name|uuid>', " +
  "'run:<uuid>'";

/** True for an `8-4-4-4-12` hex UUID (case-insensitive). */
export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

/** True for a `KEY-123` ticket identifier (case-insensitive). */
export function isTicketIdentifier(value: string): boolean {
  return IDENTIFIER_RE.test(value);
}

/**
 * The ticket identifier a branch name carries, uppercased, or `null`.
 * Pure and offline — the `--here` ticket rung never needs the network.
 */
export function parseTicketIdentifierFromBranch(branch: string): string | null {
  const match = BRANCH_IDENTIFIER_RE.exec(branch);
  return match?.[1] ? match[1].toUpperCase() : null;
}

/** Validate a raw `--view` value against the known modes. */
function parseViewMode(raw: string | undefined): UiViewMode | undefined {
  if (raw === undefined) return undefined;
  if ((UI_VIEW_MODES as readonly string[]).includes(raw)) {
    return raw as UiViewMode;
  }
  throw new Error(
    `bakers ui: unknown --view mode '${raw}'. Known modes: ${UI_VIEW_MODES.join(', ')}.`,
  );
}

/** A ticket target from a raw value: a UUID by id, else an identifier by name. */
function ticketTarget(
  value: string,
): Pick<UiInitialRoute, 'kind' | 'by' | 'value'> {
  if (isUuid(value)) return { kind: 'ticket', by: 'uuid', value };
  if (isTicketIdentifier(value)) {
    return { kind: 'ticket', by: 'identifier', value: value.toUpperCase() };
  }
  throw new Error(
    `bakers ui: '${value}' is not a ticket identifier or UUID — ${ACCEPTED_FORMS}.`,
  );
}

/** A project target: a UUID by id, else the label verbatim (labels are
 *  case-sensitive Drupal entity labels — Decision 4). */
function projectTarget(
  value: string,
): Pick<UiInitialRoute, 'kind' | 'by' | 'value'> {
  return isUuid(value)
    ? { kind: 'project', by: 'uuid', value }
    : { kind: 'project', by: 'name', value };
}

/** A run target — UUIDs only; there is no human-readable run handle. */
function runTarget(
  value: string,
): Pick<UiInitialRoute, 'kind' | 'by' | 'value'> {
  if (!isUuid(value)) {
    throw new Error(`bakers ui: a run target must be a UUID, got '${value}'.`);
  }
  return { kind: 'run', by: 'uuid', value };
}

/** Parse the positional form: an optional `kind:` prefix, else a bare identifier. */
function parsePositional(
  raw: string,
): Pick<UiInitialRoute, 'kind' | 'by' | 'value'> {
  // Before the `kind:` split: an issue URL carries a colon of its own.
  if (ORIGIN_RE.test(raw)) return { kind: 'ticket', by: 'origin', value: raw };
  const colon = raw.indexOf(':');
  if (colon >= 0) {
    const prefix = raw.slice(0, colon);
    const value = raw.slice(colon + 1);
    if (prefix !== 'ticket' && prefix !== 'project' && prefix !== 'run') {
      throw new Error(
        `bakers ui: unknown target kind '${prefix}'. ` +
          "Known kinds: 'ticket:', 'project:', 'run:'.",
      );
    }
    if (value === '') {
      throw new Error(
        `bakers ui: '${raw}' has an empty value — ${ACCEPTED_FORMS}.`,
      );
    }
    if (prefix === 'ticket') return ticketTarget(value);
    if (prefix === 'project') return projectTarget(value);
    return runTarget(value);
  }
  // Bare: strictly a ticket identifier. A UUID is ambiguous by construction —
  // it does not say which kind — and never guessed (Decision 1).
  if (isUuid(raw)) {
    throw new Error(
      `bakers ui: '${raw}' is ambiguous — a bare UUID does not say which kind. ` +
        "Use 'ticket:<uuid>', 'project:<uuid>' or 'run:<uuid>'.",
    );
  }
  return ticketTarget(raw);
}

/**
 * The grammar: at most ONE target source (the positional, `--ticket`,
 * `--project`, `--run`, `--here`) plus the orthogonal `--view` modifier.
 *
 * Returns `undefined` for no target at all (the dashboard, AC-4), `{kind:'here'}`
 * when the ladder still has to be walked, else the finished route. Throws — with
 * a message naming exactly what went wrong — on a conflict or an unparseable
 * form; the caller turns that into a stderr line and exit 1 before any network
 * work happens.
 */
export function parseTarget(inputs: TargetInputs): ParsedTarget | undefined {
  const supplied: string[] = [];
  if (inputs.target !== undefined && inputs.target !== '') {
    supplied.push(`the positional target '${inputs.target}'`);
  }
  if (inputs.ticket !== undefined) supplied.push('--ticket');
  if (inputs.project !== undefined) supplied.push('--project');
  if (inputs.run !== undefined) supplied.push('--run');
  if (inputs.here === true) supplied.push('--here');

  if (supplied.length > 1) {
    throw new Error(
      `bakers ui: conflicting targets — ${supplied.join(', ')} were all supplied. ` +
        'Give at most one of: a positional target, --ticket, --project, --run, --here.',
    );
  }

  const view = parseViewMode(inputs.view);

  if (supplied.length === 0) return undefined;
  if (inputs.here === true) {
    return { kind: 'here', view: view ?? 'full' };
  }

  const target =
    inputs.target !== undefined && inputs.target !== ''
      ? parsePositional(inputs.target)
      : inputs.ticket !== undefined
        ? ticketTarget(inputs.ticket)
        : inputs.project !== undefined
          ? projectTarget(inputs.project)
          : runTarget(inputs.run as string);

  // `--view` describes how a TICKET renders. A project screen has no view mode,
  // and `run:` already means "the ticket's Runs tab", so pairing it with a
  // compact block is contradictory rather than resolvable (Decision 13).
  if (view !== undefined && target.kind === 'project') {
    throw new Error(
      'bakers ui: --view applies to ticket targets only, but the target is a project. ' +
        'Drop --view, or name a ticket.',
    );
  }
  if (view !== undefined && target.kind === 'run') {
    throw new Error(
      "bakers ui: --view cannot be combined with a 'run:' target — 'run:' already " +
        "means the owning ticket's Runs tab. Use 'ticket:<id> --view <mode>' instead.",
    );
  }

  return {
    kind: 'route',
    route:
      target.kind === 'project' ? target : { ...target, view: view ?? 'full' },
  };
}

/**
 * A git remote URL reduced to a comparable `host/path` identity: scheme,
 * userinfo, port and a trailing `.git` (and trailing slashes) dropped, the whole
 * thing lowercased. Returns `undefined` for anything that carries no host+path.
 *
 * This is REQUIRED, not cosmetic (spec Decision 3): git and the control plane
 * disagree on form. Measured in this repo — `git remote get-url origin` yields
 * `git@git.key-tec.de:bakers-build/bakers-build.git` while `bb_project.repository.url` holds
 * `ssh://git@git.key-tec.de/bakers-build/bakers-build.git`. Both must reduce to
 * `git.key-tec.de/bakers-build/bakers-build` or the `--here` project rung never matches.
 *
 * | raw                                     | normalised          |
 * |-----------------------------------------|---------------------|
 * | `git@host:bakers-build/bakers-build.git`              | `host/bakers-build/bakers-build`  |
 * | `ssh://git@host/bakers-build/bakers-build.git`        | `host/bakers-build/bakers-build`  |
 * | `ssh://git@host:2222/bakers-build/bakers-build.git`   | `host/bakers-build/bakers-build`  |
 * | `https://host/bakers-build/bakers-build.git`          | `host/bakers-build/bakers-build`  |
 */
export function normalizeRepoUrl(raw: string | undefined): string | undefined {
  const trimmed = (raw ?? '').trim();
  if (trimmed === '') return undefined;

  let host: string;
  let path: string;

  // `scheme://[user@]host[:port]/path` — checked FIRST, so an `ssh://…:2222/…`
  // port is never mistaken for the scp form's `host:path` colon.
  const withScheme = /^[A-Za-z][A-Za-z0-9+.-]*:\/\/(.+)$/.exec(trimmed);
  if (withScheme?.[1] !== undefined) {
    const rest = withScheme[1];
    const slash = rest.indexOf('/');
    if (slash < 0) return undefined;
    host = rest.slice(0, slash);
    path = rest.slice(slash + 1);
  } else {
    // The scp-like form `[user@]host:path` — what `git remote get-url` emits
    // for an ssh clone. A bare local path has no colon and falls out here.
    const scp = /^(?:[^/@]+@)?([^/:]+):(.+)$/.exec(trimmed);
    if (scp?.[1] === undefined || scp[2] === undefined) return undefined;
    host = scp[1];
    path = scp[2];
  }

  host = host
    .replace(/^[^@]*@/, '')
    .replace(/:\d+$/, '')
    .toLowerCase();
  path = path
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .replace(/\.git$/i, '')
    .replace(/\/+$/, '')
    .toLowerCase();

  if (host === '' || path === '') return undefined;
  return `${host}/${path}`;
}

/** Everything `resolveHere` needs, all injected — two git reads, nothing else. */
export interface HereContext {
  cwd: string;
  view?: UiViewMode | undefined;
  /** The current branch of `cwd` (git resolves it per worktree). May reject. */
  readBranch: (cwd: string) => Promise<string>;
  /**
   * The cwd's `origin` remote URL, raw. Git resolves it per worktree too, and a
   * worktree shares its main clone's remote — which is exactly the right answer
   * (spec Decision 3). May reject (not a repo, no `origin`).
   */
  readRemoteUrl: (cwd: string) => Promise<string>;
}

/**
 * `--here`: derive the target from the cwd (spec Decision 3).
 *
 * ```
 * branch carries a ticket identifier?  → that TICKET   (feat/bb-223-… → BB-223)
 * else: the cwd's git remote           → the PROJECT(s) whose repository claims it
 * else                                 → a named error
 * ```
 *
 * The BRANCH decides the first rung, not git mechanics: a worktree on a
 * non-ticket branch and the main clone on a ticket branch both come out right.
 *
 * The project rung stops HERE at a normalised repo identity — matching it
 * against `bb_project.repository` needs a JSON:API client, which the entry does
 * not have (Finding 1), so `by: 'repo'` travels to the renderer's `resolveRoute`
 * and the ambiguity ruling (one match / a picker / an error) is made there
 * (Decisions 5 + 14).
 */
export async function resolveHere(ctx: HereContext): Promise<UiInitialRoute> {
  const branch = await ctx.readBranch(ctx.cwd).then(
    (b) => b.trim(),
    () => '',
  );

  const identifier =
    branch === '' ? null : parseTicketIdentifierFromBranch(branch);
  if (identifier !== null) {
    return {
      kind: 'ticket',
      by: 'identifier',
      value: identifier,
      view: ctx.view ?? 'full',
      fromBranch: branch,
    };
  }

  const remote = await ctx.readRemoteUrl(ctx.cwd).then(
    (r) => r.trim(),
    () => '',
  );
  const repo = normalizeRepoUrl(remote);
  if (repo === undefined) {
    const got = remote === '' ? '' : `, got '${remote}'`;
    throw new Error(
      `bakers ui --here: could not derive a project from '${ctx.cwd}' — ` +
        `no usable git remote (looked at 'origin'${got}).\n` +
        "  Run 'bakers ui' and press Tab for the project list, or 'bakers ui project:<name>' to open one directly.",
    );
  }

  return {
    kind: 'project',
    by: 'repo',
    value: repo,
    ...(branch !== '' ? { fromBranch: branch } : {}),
  };
}
