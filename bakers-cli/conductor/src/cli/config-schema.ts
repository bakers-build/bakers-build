import { readFileSync } from 'node:fs';
import { ConfigSourceEditor } from './config-source-edit.js';

// BB-216: schema versioning for the generated CONNECTION config
// (`bakers.config.js`, project + home). Decoupled from the npm package semver —
// the schema version bumps only when the config SHAPE changes, not every
// release. Every generated connection config carries a machine-readable header
// comment `// @bakers-schema-version <N>` (the source of truth for the upgrade
// decision, read by regex so `bakers config upgrade` NEVER executes a possibly
// side-effecting config module) and a `schema_version: <N>` field for
// programmatic reads.

/** The header marker prepended to every generated connection config. */
const MARKER_RE = /@bakers-schema-version\s+(\d+)/;
const HEADER_LINE_RE = /^\/\/ @bakers-schema-version \d+\n/;

/**
 * A single, discrete, testable upgrade method `vN → vN+1`, registered in order —
 * exactly like a Drupal `hook_update_N` chain. `bakers config upgrade` resolves a config's
 * current version and applies each method in sequence up to CURRENT (it does not
 * blindly overwrite), so a method can PRESERVE operator-set fields across a bump.
 */
export interface ConnectionConfigMigration {
  /** The schema version this method upgrades FROM. */
  from: number;
  /** The schema version this method upgrades TO (=== from + 1). */
  to: number;
  /** What shape change this method performs (human-readable). */
  description: string;
  /**
   * Upgrade the config text from `from` to `to`, returning the new file text
   * WITHOUT the version header — the runner re-stamps `@bakers-schema-version to`.
   */
  apply(currentText: string): string;
}

/**
 * BB-226: the package name whose `plugins[]` entry contributes the `md`
 * renderer (plus the authoritative JSON:API schema) to a connection config. The
 * AGGREGATOR is named, not `@dropsh/plugin-markdown` directly: a direct
 * `@dropsh/*` descriptor is unresolvable from `loadBbConfig`'s bases
 * (config dir / host module / cwd), whereas `@bakers-build/addon-essentials` is a
 * real dependency of both the host and the engine and therefore resolves in the
 * monorepo AND from a global `@bakers-build/bakers` install. No `export:` is needed —
 * the package default-exports its factory.
 */
export const RENDERER_PLUGIN_PACKAGE = '@bakers-build/addon-essentials';

/** The exact `plugins[]` element text the v1→v2 migration and the scaffold emit. */
export const RENDERER_PLUGIN_ENTRY = `{ plugin: '${RENDERER_PLUGIN_PACKAGE}' },`;

/**
 * BB-226 (v1 → v2): insert the renderer aggregator as the FIRST `plugins[]`
 * element, so `bakers dropsh --format md` works instead of failing with
 * `E_CONFIG: Unknown format 'md'. Available: json`.
 *
 * A pure TEXT transform — the upgrade runner must never execute a possibly
 * side-effecting config module. Idempotent: text that already names the package
 * in CODE is returned unchanged (whole-line `//` comments are stripped for that
 * probe, so the template's own explanatory header does not read as a hit), and a
 * config with no `plugins: [` array literal (an `addons: []`-shaped or
 * hand-reshaped file) is left alone rather than guessed at.
 */
export function addRendererPluginEntry(text: string): string {
  const e = new ConfigSourceEditor(text);
  const array = e.property('plugins');
  if (array?.nodeType !== 'ArrayExpression') return text;
  if (
    [...e.source.properties].some(
      ([key, p]) =>
        /^plugins\[\d+\]\.plugin$/.test(key) &&
        p.value === RENDERER_PLUGIN_PACKAGE,
    )
  )
    return text;
  e.replace(
    array.valueStart + 1,
    array.valueStart + 1,
    `\n    ${RENDERER_PLUGIN_ENTRY}`,
  );
  return e.text;
}

/** The dropsh plugin package whose entries carry a connection's OAuth identity. */
export const OAUTH2_PLUGIN_PACKAGE = '@dropsh/plugin-oauth2';

/**
 * The id of the ONE oauth2 provider a bakers.build connection declares (BB-391 D1).
 *
 * `bakers`, not `session`: the entry names the CONNECTION, not a capability. Until
 * v3 a config declared two providers that differed only by scope — `session`
 * (`bb:session`) and `pm` (`bakers:project_manager`) — and every write had to
 * pick one. What that choice cost is what BB-391 removes; the id therefore
 * names the connection, and the surviving scope carries the capability.
 */
export const OAUTH2_PROVIDER_ID = 'bakers';

/**
 * The ONE OAuth2 scope a bakers.build connection requests (BB-391 D1, as revised).
 *
 * There is exactly one, and there is not zero. `bb:session`'s role carries
 * the ceiling of what a machine identity may do.
 *
 * Zero was the original design, and a live control plane refuted it:
 * `simple_oauth`'s Oauth2AccessPolicy rewrites a token account's permissions
 * with `overwrite: TRUE`, and for a `client_credentials` token — every bakers.build
 * machine identity — the set becomes EXACTLY the scope's permissions, with
 * neither user_role nor OG-rank permissions surviving. A request naming no scope
 * against a consumer holding no default scopes does not even mint a token.
 */
export const OAUTH2_SCOPE = 'bb:session';

/**
 * BB-391 (v2 → v3): collapse a connection's oauth2 entries into ONE `bakers`
 * provider on ONE scope — the whole of the one-identity change, as a pure text
 * transform.
 *
 * A MIGRATION rather than a cutover (spec D3): operators have hand-edited these
 * files — a pinned literal `baseUrl`, a per-install `workspace_id`, an extra
 * `addons[]` entry — so every value outside the two elements being merged is
 * carried over verbatim, and the runner never EXECUTES a possibly
 * side-effecting config module.
 *
 * The FIRST oauth2 element survives (it is the one v2 marked `default: true`);
 * the rest are removed line-and-all. A config with no oauth2 element is left
 * exactly as it is — that is the one silent no-op, and it is silent because
 * there is nothing to collapse. An element that IS there but cannot be given the
 * `bakers` identity throws (see {@link ensureProviderId}) rather than passing
 * through unchanged.
 */
export function collapseOauth2Providers(text: string): string {
  const e = new ConfigSourceEditor(text);
  const entries = [...e.source.properties]
    .filter(
      ([key, p]) =>
        /^plugins\[\d+\]\.plugin$/.test(key) &&
        p.value === OAUTH2_PLUGIN_PACKAGE,
    )
    .map(([key]) => key.replace(/\.plugin$/, ''));
  const first = entries[0];
  if (!first) return text;
  if (e.property(`${first}.with`)?.nodeType !== 'ObjectExpression')
    throw new Error('Cannot migrate oauth2 without a with object.');
  for (const duplicate of entries.slice(1).reverse()) {
    for (const key of ['client_id', 'client_secret', 'token_url', 'type']) {
      if (
        e.expression(`${first}.with.${key}`) !==
        e.expression(`${duplicate}.with.${key}`)
      )
        throw new Error('OAuth providers have conflicting connection inputs.');
    }
    e.remove(duplicate);
  }
  for (const [key, value] of [
    ['id', "'bakers'"],
    ['scope', "'bb:session'"],
    ['default', 'true'],
  ] as const) {
    if (e.expression(`${first}.with.${key}`) !== value)
      e.set(`${first}.with.${key}`, value);
  }
  return e.text;
}

/**
 * The ordered, contiguous migration chain. v1 was the pre-BB-226 shape (auth
 * plugins only); v2 adds the markdown renderer entry; v3 collapses the two
 * differently-scoped oauth2 providers into ONE identity on ONE scope (BB-391)
 * — one, not zero: see {@link OAUTH2_SCOPE} for why the scope survives.
 * Nothing below v1 is a versioned config (v0 = seed / hand-authored / untouched).
 * `BB_CONFIG_SCHEMA_VERSION` derives from the chain's last `to` — never
 * hardcode it.
 */
export const CONNECTION_MIGRATIONS: ConnectionConfigMigration[] = [
  {
    from: 1,
    to: 2,
    description: `add the ${RENDERER_PLUGIN_PACKAGE} renderer entry to plugins[]`,
    apply: addRendererPluginEntry,
  },
  {
    from: 2,
    to: 3,
    description:
      `collapse the two ${OAUTH2_PLUGIN_PACKAGE} entries into one ` +
      `'${OAUTH2_PROVIDER_ID}' provider on scope '${OAUTH2_SCOPE}'`,
    apply: collapseOauth2Providers,
  },
  {
    from: 3,
    to: 4,
    description:
      'connection owns credentials and workspace independently of machine context',
    apply: (text) => {
      const source = new ConfigSourceEditor(text);
      if (
        /const (baseUrl|clientId|clientSecret|workspaceId) = [^;]*machine\.(base_url|client_id|client_secret|workspace_id)/.test(
          text,
        ) ||
        [...source.source.properties.keys()].some((key) =>
          /\bmachine\.(base_url|client_id|client_secret|workspace_id)\b/.test(
            source.expression(key) ?? '',
          ),
        )
      )
        throw new Error(
          'Connection ownership requires scoped cross-file planning.',
        );
      return text;
    },
  },
];

/** The current connection-config schema version — single source of truth. */
export const BB_CONFIG_SCHEMA_VERSION = CONNECTION_MIGRATIONS.at(-1)?.to ?? 1;

/** Parse the `@bakers-schema-version` marker from config text; `0` when absent. */
export function schemaVersionOf(text: string): number {
  const m = MARKER_RE.exec(text);
  return m ? Number.parseInt(m[1] as string, 10) : 0;
}

/**
 * Read the schema version from a connection config FILE by regex (sync, never
 * executes the module). `0` when the file is absent, unreadable, or carries no
 * marker (legacy / hand-authored).
 */
export function readConfigSchemaVersion(path: string): number {
  try {
    return schemaVersionOf(readFileSync(path, 'utf8'));
  } catch {
    return 0;
  }
}

/** Strip a leading `// @bakers-schema-version <N>` header line, if present. */
export function stripVersionHeader(text: string): string {
  return text.replace(HEADER_LINE_RE, '');
}

/** Prepend (replacing any existing) a `// @bakers-schema-version <N>` header. */
export function stampVersion(text: string, version: number): string {
  return `// @bakers-schema-version ${version}\n${stripVersionHeader(text)}`;
}

/**
 * Re-stamp the in-body `schema_version: <N>` field, which the generated config
 * carries alongside the header marker for programmatic reads. The header is the
 * upgrade decision's source of truth and is stamped by the runner; this keeps the
 * FIELD from going stale when a migration bumps the version (BB-226 — the first
 * migration is where the two could first disagree). No-op when the field is
 * absent (a hand-authored config need not carry it).
 */
export function stampSchemaVersionField(text: string, version: number): string {
  return text.replace(
    /^([ \t]*)schema_version:\s*\d+\s*,/m,
    `$1schema_version: ${version},`,
  );
}

/**
 * Validate a migration chain is contiguous: each `to === from + 1`, the first
 * migrates from v1, no gaps, and the chain ends at `current` (default CURRENT).
 * An empty chain is valid iff `current === 1`. Throws with an actionable message.
 */
export function assertContiguous(
  chain: ConnectionConfigMigration[],
  current: number = BB_CONFIG_SCHEMA_VERSION,
): void {
  let prev = 1;
  chain.forEach((m, i) => {
    if (m.to !== m.from + 1) {
      throw new Error(
        `migration[${i}]: to (${m.to}) must equal from+1 (${m.from + 1})`,
      );
    }
    const expectedFrom = i === 0 ? 1 : prev;
    if (m.from !== expectedFrom) {
      throw new Error(
        `migration[${i}]: from (${m.from}) must equal ${expectedFrom} (no gaps; chain starts at v1)`,
      );
    }
    prev = m.to;
  });
  const end = chain.at(-1)?.to ?? 1;
  if (end !== current) {
    throw new Error(
      `migration chain ends at v${end}, expected CURRENT v${current}`,
    );
  }
}

/**
 * Walk the migration chain from `from` up to `to`, applying each method's
 * `apply` in sequence. Input/output text is WITHOUT the version header — the
 * caller stamps CURRENT after. After each step the in-body `schema_version:`
 * field is re-stamped to that step's `to`, so no individual method has to know
 * (or hardcode) its own number twice. `chain` is injectable for tests.
 */
export function applyMigrations(
  text: string,
  from: number,
  to: number,
  chain: ConnectionConfigMigration[] = CONNECTION_MIGRATIONS,
): string {
  let cur = from;
  let out = text;
  while (cur < to) {
    const step = chain.find((m) => m.from === cur);
    if (step === undefined) {
      throw new Error(`no migration from v${cur} (chain incomplete)`);
    }
    out = stampSchemaVersionField(step.apply(out), step.to);
    cur = step.to;
  }
  return out;
}
