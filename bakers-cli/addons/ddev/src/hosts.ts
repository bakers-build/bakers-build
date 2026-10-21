// BB-681 Task 1 — the project's effective DDEV hosts, read once from
// `ddev utility configyaml` (DDEV's own merged/expanded config, not the raw
// `.ddev/config.yaml` file, which can omit defaults DDEV fills in at
// runtime). DDEV alone owns calling/parsing this — no other addon reads
// `.ddev/config.yaml` for hostnames.

import { parse as parseYaml } from 'yaml';

export interface DdevHosts {
  readonly primary: string;
  readonly additional: readonly string[];
}

/** Thrown by `parseDdevHosts` on any config shape it cannot safely derive
 *  hosts from — a caller converts this to an `unknown` discovery result
 *  rather than ever inventing a concrete host. */
export class DdevHostsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DdevHostsError';
  }
}

/** Lowercase/trailing-dot normalization, shared with anything that compares
 *  an observed `VIRTUAL_HOST` entry against a configured host (`claims.ts`'s
 *  alias-eligibility check). */
export function normalizeHost(host: string): string {
  return host.trim().toLowerCase().replace(/\.$/, '');
}

/** A bare `*` or a `*.`-prefixed entry is a wildcard — DDEV accepts these in
 *  `additional_hostnames`/`additional_fqdns`, but a wildcard is unsupported
 *  for individual host sharing: there is no single concrete hostname to
 *  derive from it, and inventing one would be a guess this module must never
 *  make. */
function isWildcard(host: string): boolean {
  return host.includes('*');
}

/**
 * Derive `{ primary, additional }` from DDEV's effective config (the parsed
 * `ddev utility configyaml` object, or a pre-parsed equivalent). Throws
 * `DdevHostsError` on missing/invalid required fields, a wildcard host, or a
 * collision between two inputs that normalize to the same host — never
 * silently drops or invents one.
 */
export function parseDdevHosts(config: unknown): DdevHosts {
  if (typeof config !== 'object' || config === null) {
    throw new DdevHostsError('ddev config is not an object');
  }
  const c = config as Record<string, unknown>;
  const name = c.name;
  const projectTld = c.project_tld;
  if (typeof name !== 'string' || !name) {
    throw new DdevHostsError('ddev config is missing `name`');
  }
  if (typeof projectTld !== 'string' || !projectTld) {
    throw new DdevHostsError('ddev config is missing `project_tld`');
  }

  const additionalHostnames = Array.isArray(c.additional_hostnames)
    ? (c.additional_hostnames as unknown[]).filter(
        (h): h is string => typeof h === 'string' && h.length > 0,
      )
    : [];
  const additionalFqdns = Array.isArray(c.additional_fqdns)
    ? (c.additional_fqdns as unknown[]).filter(
        (h): h is string => typeof h === 'string' && h.length > 0,
      )
    : [];

  const primaryRaw = `${name}.${projectTld}`;
  if (isWildcard(primaryRaw)) {
    throw new DdevHostsError(
      'the primary host resolves to a wildcard — unsupported for individual host sharing',
    );
  }
  const primary = normalizeHost(primaryRaw);

  // Order of derivation: additional_hostnames first (expanded with
  // project_tld), then additional_fqdns (literal) — a stable, input-order-
  // independent derivation (reordering either source list must not change
  // the resulting set), checked below by normalized-key collision, not by
  // list position.
  const rawAdditional: string[] = [
    ...additionalHostnames.map((h) => `${h}.${projectTld}`),
    ...additionalFqdns,
  ];

  for (const host of rawAdditional) {
    if (isWildcard(host)) {
      throw new DdevHostsError(
        `additional host '${host}' is a wildcard — unsupported for individual host sharing`,
      );
    }
  }

  const seen = new Map<string, string>();
  const additional: string[] = [];
  for (const raw of rawAdditional) {
    const normalized = normalizeHost(raw);
    if (normalized === primary) continue; // already covered by the primary claim
    const prior = seen.get(normalized);
    if (prior !== undefined && prior !== raw) {
      throw new DdevHostsError(
        `two hosts normalize to the same value '${normalized}': '${prior}' and '${raw}'`,
      );
    }
    if (prior === undefined) {
      seen.set(normalized, raw);
      additional.push(normalized);
    }
  }

  return { primary, additional };
}

/** The injected exec seam — the same bounded-exec pattern
 *  `@bakers-build/addon-docker-compose`'s `discoverCompose` uses (a `run(cmd,
 *  args, cwd?)` returning `{ stdout, ok, exitCode? }`), reused rather than
 *  inventing a second one. */
export interface DdevHostsDeps {
  run(
    cmd: string,
    args: string[],
    cwd?: string,
  ): Promise<{ readonly stdout: string; readonly ok: boolean }>;
}

export type DdevHostsResult =
  | { readonly ok: true; readonly hosts: DdevHosts }
  | { readonly ok: false; readonly reason: string };

/**
 * Discover this worktree's effective DDEV hosts via `ddev utility configyaml`
 * (DDEV's own merged config, YAML on stdout) — parsed with the project's
 * existing `yaml` dependency, never a hand-written parser. A failed command,
 * unparseable YAML, or any `parseDdevHosts` rejection all become `{ ok:
 * false }` — never a thrown exception, so a caller converts this directly to
 * an `unknown` claim instead of crashing discovery.
 */
export async function discoverDdevHosts(
  worktree: string,
  deps: DdevHostsDeps,
): Promise<DdevHostsResult> {
  let result: { readonly stdout: string; readonly ok: boolean };
  try {
    result = await deps.run('ddev', ['utility', 'configyaml'], worktree);
  } catch (err) {
    return {
      ok: false,
      reason: `ddev utility configyaml failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  if (!result.ok) {
    return { ok: false, reason: 'ddev utility configyaml failed' };
  }
  let parsed: unknown;
  try {
    parsed = parseYaml(result.stdout);
  } catch (err) {
    return {
      ok: false,
      reason: `ddev utility configyaml output is not valid YAML: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  try {
    return { ok: true, hosts: parseDdevHosts(parsed) };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}
