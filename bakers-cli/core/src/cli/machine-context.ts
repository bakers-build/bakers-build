import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { homeBbDir } from './bakers-dir.js';

/** One machine-local agent variant constructed by an installed addon preset. */
export interface MachineAgentEntry {
  harness: string;
  alias?: string;
  with?: unknown;
}

/** Normalized named state-to-agent routes. `default` is the automatic route. */
export type AgentRoutes = Record<string, Record<string, string>>;

/** Optional host-local overlays and selection policy for addon-derived agents. */
export interface MachineAgentPolicy {
  catalog?: MachineAgentEntry[];
  enabled?: string[];
  disabled?: string[];
  default_agent?: string;
  routes?: AgentRoutes;
}

/** Local host identity, display label and shared capacity. */
export interface MachineContext {
  /** UUID generated once by `bakers init`, normalised to lowercase. */
  machine_id: string;
  /** Display name for people; never a key. */
  label: string;
  /**
   * Host concurrent-run budget (BB-353). Optional; consumers default to 1.
   * Source of truth for capacity — not the engine conductor.config.js.
   */
  max_parallel?: number;
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
}

/** Canonical machine-context path: `<BB_HOME or ~/.bakers>/machine.config.js`. */
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
export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

/**
 * Every config file (machine, connection, project) is at schema version 1.
 * Any other version, in the `schema_version` field or the
 * `@bakers-schema-version` header, predates the fresh start and is refused.
 */
export function assertSchemaVersion1(
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
  const other = versions.find((version) => version !== 1);
  if (other !== undefined)
    throw new Error(
      `${path}: schema version ${String(other)} is not supported; remove the file and run bakers init`,
    );
}

/**
 * Import an existing context module's default export, or `{}` if absent/broken.
 * A stale identity (`user_id`, a non-UUID `machine_id`, a schema version other
 * than 1) throws, naming `bakers init`.
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
  assertSchemaVersion1(resolved, ctx);
  if ('user_id' in ctx)
    throw new Error(
      `${resolved}: user_id is retired (the server takes the owner from sign-in); remove the file and run bakers init`,
    );
  if (ctx.machine_id !== undefined && !isUuid(ctx.machine_id))
    throw new Error(
      `${resolved}: machine_id must be a UUID; remove the file and run bakers init`,
    );
  return {
    ...(ctx as Partial<MachineContext>),
    ...(typeof ctx.machine_id === 'string'
      ? { machine_id: ctx.machine_id.toLowerCase() }
      : {}),
  };
}
