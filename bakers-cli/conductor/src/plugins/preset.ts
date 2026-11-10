// BB-224 (Finding 6, decision 7): the CONDUCTOR-SURFACE view of the preset
// contract. `@bakers-build/core` owns the surface-AGNOSTIC machinery — it knows the
// accumulator NAMES (`SURFACE_KEYS`) and threads them (`discoverAddons`), but its
// per-surface accumulators are OPAQUE (`OpaqueAccumulator`), because the element
// types of the conductor surface (`RemotePlugin`, `ExecutorPlugin`,
// `WorkspacePlugin`, `AgentCandidate`) live HERE, in the package that owns the
// surface. Without that split, `core/src/plugins/preset.ts` would have to import
// the conductor contract and core would edge `@bakers-build/conductor` — breaking the
// "core has zero @bakers-build/* edges" rule.
//
// A conductor-surface addon therefore types its `./preset` accumulators against
// THIS `Preset` (e.g. `export const agents: Preset['agents'] = …`) instead of
// core's `BbPreset`, and stays structurally assignable to it.

import type {
  AddonEntry,
  BbPreset,
  DiscoveredContributions,
} from '@bakers-build/core';
import type { HookListener } from './executor.js';
import type { DiscoveredInbox, InboxMessages } from './message.js';
import type {
  AgentCandidate,
  ExecutorPlugin,
  RemotePlugin,
  WorkspacePlugin,
} from './plugins.js';
import type { Ticket } from './remote.js';
import type { AddonTools, DiscoveredTools } from './tools.js';

/**
 * The conductor surface's concrete contributions — the strongly-typed view of
 * the conductor accumulators `discoverAddons(entries, 'conductor', …)`
 * fills. Core returns them as opaque `unknown[]`; the engine narrows once, at
 * the discovery call site (see {@link narrowConductorContributions}).
 */
export interface ConductorContributions {
  servers: RemotePlugin[];
  executors: ExecutorPlugin[];
  worktrees: WorkspacePlugin[];
  agents: AgentCandidate[];
  /** Lifecycle hook listeners, in accumulator order (BB-599). */
  hooks: HookListener[];
  /** Addon `inbox` exports with their package name and version (contract 2, BB-661). */
  addonInbox: DiscoveredInbox[];
  /** Addon `tools` exports with their package name and version. */
  addonTools: DiscoveredTools[];
}

/**
 * One `addons[]` entry on the conductor surface: core's surface-agnostic
 * `AddonEntry` with the agent `priority` narrowed to the real `Ticket`.
 */
export type ConductorAddonEntry =
  | string
  | (Exclude<AddonEntry, string> & {
      priority?: (ticket: Ticket) => number;
    });

/**
 * A preset as a CONDUCTOR-surface addon writes it: core's `BbPreset` with the
 * conductor accumulators concretely typed.
 *
 * It literally `extends BbPreset`, so the compiler — not a comment — enforces
 * that this view stays a faithful narrowing of the kernel contract. That only
 * type-checks because core's `OpaqueAccumulator` takes `never[]` on the input
 * side: `never[]` is assignable to `RemotePlugin[]`, so the concrete member below
 * satisfies the opaque one contravariantly. If core ever widened that parameter
 * to `unknown[]`, this `extends` would fail loudly here instead of the two views
 * silently drifting apart.
 */
export interface Preset<O = unknown> extends BbPreset<O> {
  // ── conductor surface (engine) — concretely typed here ──
  servers?: (
    acc: RemotePlugin[],
    opts: O,
  ) => RemotePlugin[] | Promise<RemotePlugin[]>;
  executors?: (
    acc: ExecutorPlugin[],
    opts: O,
  ) => ExecutorPlugin[] | Promise<ExecutorPlugin[]>;
  worktrees?: (
    acc: WorkspacePlugin[],
    opts: O,
  ) => WorkspacePlugin[] | Promise<WorkspacePlugin[]>;
  agents?: (
    acc: AgentCandidate[],
    opts: O,
  ) => AgentCandidate[] | Promise<AgentCandidate[]>;
  hooks?: (
    acc: HookListener[],
    opts: O,
  ) => HookListener[] | Promise<HookListener[]>;
  /** Addon inbox messages: contract 2, BB-661. */
  inbox?: InboxMessages;
  /** Agent tools served through the conductor's MCP server. */
  tools?: AddonTools;
}

/**
 * The single, reviewed narrowing at the engine's discovery seam: reinterpret
 * core's opaque conductor accumulators as this surface's concrete contribution
 * lists. Safe because every conductor-surface preset is typed against
 * {@link Preset}, and `resolveConductorSlots` still runs the runtime `.kind`
 * guard on whatever actually landed in a singleton slot.
 */
export function narrowConductorContributions(
  discovered: Pick<
    DiscoveredContributions,
    | 'servers'
    | 'executors'
    | 'worktrees'
    | 'agents'
    | 'hooks'
    | 'addonInbox'
    | 'addonTools'
  >,
): ConductorContributions {
  return discovered as unknown as ConductorContributions;
}
