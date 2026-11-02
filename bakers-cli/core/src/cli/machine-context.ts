import { existsSync } from 'node:fs';
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

/** Local host identity, operator short name and shared capacity. */
export interface MachineContext {
  machine_id: string;
  user_id: string;
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

/** Import an existing context module's default export, or `{}` if absent/broken. */
export async function readMachineContext(
  path?: string,
): Promise<Partial<MachineContext>> {
  const resolved = resolveMachineContextPath(path);
  if (!existsSync(resolved)) return {};
  try {
    // Cache-bust so a re-render within one process re-reads fresh.
    const mod = await import(`${pathToFileURL(resolved).href}?t=${Date.now()}`);
    const raw = mod.default;
    return raw && typeof raw === 'object'
      ? (raw as Partial<MachineContext>)
      : {};
  } catch {
    return {};
  }
}
