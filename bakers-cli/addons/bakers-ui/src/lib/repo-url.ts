// BB-223 (spec Decision 3) — a git remote URL reduced to a comparable
// `host/path` identity.
//
// DELIBERATE MIRROR of `@bakers-build/ui`'s `normalizeRepoUrl` (`ui/src/route.ts`),
// for the same reason `UiInitialRoute` and `HomeConnection` are mirrored: the
// command package resolves this renderer DYNAMICALLY and must never import it
// (`ui/tests/no-bakers-ui-import.test.ts`), and the layering forbids an addon from
// edging `@bakers-build/ui`. Both sides need the SAME reduction — the CLI normalises
// the cwd's remote, this side normalises `bb_project.repository.url` — so
// the function exists twice and is fixture-tested on both sides against the same
// measured pair.

/**
 * `host/path`, with scheme, userinfo, port, a trailing `.git` and trailing
 * slashes dropped, lowercased. `undefined` when the input carries no host+path.
 *
 * | raw                                     | normalised          |
 * |-----------------------------------------|---------------------|
 * | `git@host:bakers-build/bakers-build.git`              | `host/bakers-build/bakers-build`  |
 * | `ssh://git@host/bakers-build/bakers-build.git`        | `host/bakers-build/bakers-build`  |
 * | `ssh://git@host:2222/bakers-build/bakers-build.git`   | `host/bakers-build/bakers-build`  |
 * | `https://host/bakers-build/bakers-build.git`          | `host/bakers-build/bakers-build`  |
 */
export function normalizeRepoUrl(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
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
    // The scp-like form `[user@]host:path` — what `git remote get-url` emits for
    // an ssh clone. A bare local path has no colon and falls out here.
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
