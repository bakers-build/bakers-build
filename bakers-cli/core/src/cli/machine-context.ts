import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { homeBbDir } from './bakers-dir.js';
import { assertValidConfig } from './config-validate.js';

/** One machine-local agent variant constructed by an installed addon preset. */
export interface MachineAgentEntry {
  harness: string;
  alias?: string;
  with?: unknown;
}

/** Named state-to-agent routes. `default` is the automatic route; `'*'` matches any state. */
export type AgentRoutes = Record<string, Record<string, string>>;

/** Optional host-local overlays and selection policy for addon-derived agents. */
export interface MachineAgentPolicy {
  catalog?: MachineAgentEntry[];
  enabled?: string[];
  disabled?: string[];
  routes?: AgentRoutes;
}

/** Local host identity, display label and shared capacity. */
export interface MachineContext {
  /** Host key: a UUID from `bakers init` for a new machine (lowercased); an existing id stays. */
  machine_id: string;
  /** Display name for people; never a key. */
  label: string;
  /** Optional selection policy for the agents the machine `addons[]` contribute. */
  agents?: MachineAgentPolicy;
  /**
   * This host's addons, the same entry shape as a project conductor config's
   * `addons[]`. Each addon declares whether it may be listed here (its preset
   * `scopes`); agent harnesses belong here, and an addon listed in both files
   * takes the machine entry's `with`.
   */
  addons?: (string | Record<string, unknown>)[];
  /**
   * When true, agents share local HTTP(S) preview links through `bakers ports`.
   * Omitted or false keeps the original local URL.
   */
  tunnel?: boolean;
  /** Shared run permissions for every agent; the conductor validates it. */
  permissions?: unknown;
  /** Renamed to `permissions`; the conductor rejects it on load. */
  security?: unknown;
  /**
   * This machine's executor, an `executor` slot value as in a conductor
   * config. It overrides every project's executor on this machine; the
   * workspace and remote stay project-owned.
   */
  executor?: unknown;
}

/** Canonical machine-context path: `<BAKERS_HOME or ~/.bakers>/machine.config.js`. */
export function machineContextPath(): string {
  return join(homeBbDir(), 'machine.config.js');
}

/** Resolve explicit or canonical current host context. */
export function resolveMachineContextPath(path?: string): string {
  if (path !== undefined && path !== '') return path;
  return machineContextPath();
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Whether a value is a UUID, in any case. */
function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

/** The configuration schema version every file kind is at. */
export const CONFIG_SCHEMA_VERSION = 1;

/**
 * Every config file (machine, connection, project) is at schema version 1.
 * Any other version, in the `schema_version` field or the
 * `@bakers-schema-version` header, is refused.
 */
export function assertSchemaVersion(
  path: string,
  raw: Record<string, unknown>,
): void {
  let text = '';
  try {
    text = readFileSync(path, 'utf8');
  } catch {}
  const versions = [
    ...(raw.schema_version !== undefined ? [raw.schema_version] : []),
    ...[...text.matchAll(/@bakers-schema-version\s+(\d+)/g)].map((m) =>
      Number(m[1]),
    ),
  ];
  const other = versions.find((version) => version !== CONFIG_SCHEMA_VERSION);
  if (other !== undefined)
    throw new Error(
      `${path}: schema version ${String(other)} is not supported; remove the file and run bakers init`,
    );
}

/**
 * Import an existing context module's default export, or `{}` if absent/broken.
 * A file at another schema version, or one the machine schema rejects,
 * throws naming the file and every problem. An existing machine keeps its
 * `machine_id` as it is; only a UUID is normalised to lowercase.
 */
export async function readMachineContext(
  path?: string,
): Promise<Partial<MachineContext>> {
  const resolved = resolveMachineContextPath(path);
  if (!existsSync(resolved)) return {};
  let raw: unknown;
  try {
    // Cache-bust so a re-render within one process re-reads fresh.
    raw = (await import(`${pathToFileURL(resolved).href}?t=${Date.now()}`))
      .default;
  } catch {
    return {};
  }
  if (!raw || typeof raw !== 'object') return {};
  const ctx = raw as Record<string, unknown>;
  assertSchemaVersion(resolved, ctx);
  assertValidConfig('machine', ctx, resolved);
  return {
    ...(ctx as Partial<MachineContext>),
    ...(isUuid(ctx.machine_id)
      ? { machine_id: ctx.machine_id.toLowerCase() }
      : {}),
  };
}
