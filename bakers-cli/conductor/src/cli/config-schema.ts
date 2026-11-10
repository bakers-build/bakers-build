import { readFileSync } from 'node:fs';

// BB-216: schema versioning for the generated CONNECTION config
// (connection file, project + home). Decoupled from the npm package semver —
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
 * The ordered, contiguous migration chain. Every config file is at schema v1,
 * so the chain is empty; a later shape change adds its `v1 → v2` step here.
 * `BB_CONFIG_SCHEMA_VERSION` derives from the chain's last `to` — never
 * hardcode it.
 */
export const CONNECTION_MIGRATIONS: ConnectionConfigMigration[] = [];

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
