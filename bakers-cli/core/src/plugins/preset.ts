// BB-215: the preset contract — the Storybook-style self-declaration every
// bakers.build addon exposes through its `./preset` export subpath. A preset declares an
// addon's contributions through named, per-surface ACCUMULATOR functions
// `(acc, opts) => acc` (Storybook's `managerEntries`/`previewAnnotations` model),
// plus an `addons` array for meta-addon composition. Each extension point is
// list-valued; the core discovers presets and threads these accumulators, so a
// conforming addon needs no per-slot `export:`/kind wiring in config.
//
// The three bakers.build surfaces (each named for its config home):
//   - command    → the `@bakers-build/bakers` host registry (CommandDescriptor[]).
//   - conductor  → the run engine (remote / executor / workspace / agent /
//                  lifecycle hook listeners).
//   - connection → dropsh (auth + renderer plugins).
//
// Settings (machine_id / project / states / shell `hooks` / scheduler) are NEVER
// preset-contributed — identity must not be composable — so this interface has
// no such members and an unknown preset export is rejected loudly at discovery.
//
// BB-224 (Finding 6, decision 7): this module is surface-AGNOSTIC. It knows
// the accumulator NAMES of every surface (`SURFACE_KEYS`) and the shape of the
// pure-data command surface (`CommandDescriptor`), but the element types of the
// CONDUCTOR surface (`RemotePlugin` / `ExecutorPlugin` / `WorkspacePlugin` /
// `AgentCandidate`, and the `Ticket` an agent priority scores) live in
// `@bakers-build/conductor`. Importing them here would give the kernel an
// `@bakers-build/*` edge, which the acyclic guard forbids — so those
// accumulators are OPAQUE (see `OpaqueAccumulator`) and the concrete view is
// declared by the surface owner (`@bakers-build/conductor`'s `Preset`).

import type { DropSHPlugin } from 'dropsh/plugin';
import type { ConfigScope } from '../cli/config-report.js';

/** The config files an addon may be listed in: `~/.bakers/machine.config.js`
 *  (`machine`) and the project's `.bakers/conductor.config.js` (`project`). */
export type AddonScope = Extract<ConfigScope, 'machine' | 'project'>;

/**
 * A lazy command pointer (moved here from the host, BB-201, + `describe`). The
 * command surface accumulates DESCRIPTORS — never constructed command plugins —
 * so the host runs every addon's `commands` at boot without importing their
 * runtime (preserves the BB-201 lazy-mount + "bakers --help imports none").
 */
export interface CommandDescriptor {
  /** The subcommand name mounted as `bakers <name> …`. */
  name: string;
  /** Module specifier that default- (or `export`-) exports the `BbCommandPlugin`. */
  plugin: string;
  /** Shown in `bakers --help` even when the plugin is NOT loaded (describe-only stub). */
  describe: string;
  /** Named export to pick instead of the module default. */
  export?: string;
  /** Keep dispatch available while omitting the command from help. */
  hidden?: boolean;
  /** `bakers help <name>` runs `bakers <name> --help`, for plugins that render their own help. */
  forwardHelp?: boolean;
}

/** The three surfaces, each named for its config home (surface = file = plugins). */
export type BbSurface = 'command' | 'conductor' | 'connection';

/**
 * One entry in an `addons[]` array — a bare package name, or a descriptor naming
 * the package (`use`, or SB's `name`) plus its `with` options and, for agents, a
 * static `priority` over the ticket. Never carries a `kind`/`export`: the surface
 * is decided by which preset function the addon exports; the kind by the
 * contribution's own `.kind`.
 */
export type AddonEntry =
  | string
  | {
      /** The addon package (bakers.build term). */
      use?: string;
      /** Storybook's term for the same field; accepted as an alias. */
      name?: string;
      /** Options handed to the addon's accumulators as `opts`. */
      with?: unknown;
      /** Select a named agent variant, or name a single custom contribution. */
      alias?: string;
      /** Alias for `with`. */
      options?: unknown;
      /**
       * Agent-surface only: the static per-ticket priority (see the conductor
       * surface's `selectAgent`). The ticket type belongs to the conductor
       * surface, so the kernel types the parameter as `never` — that makes ANY
       * concretely-typed `(ticket: Ticket) => number` assignable here (a `never`
       * parameter is contravariantly assignable to every parameter type) while
       * keeping this module free of a conductor import.
       */
      priority?: (ticket: never) => number;
    };

/**
 * The accumulated contributions across an `addons[]` list, one array per
 * extension point. `discoverAddons` populates only the arrays belonging to the
 * requested surface (the others stay empty) — so a connection load never runs
 * the conductor accumulators.
 */
export interface DiscoveredContributions {
  commands: CommandDescriptor[];
  /** Opaque: `RemotePlugin[]` on the conductor surface. */
  remotes: unknown[];
  /** Opaque: `ExecutorPlugin[]` on the conductor surface. */
  executors: unknown[];
  /** Opaque: `WorkspacePlugin[]` on the conductor surface. */
  workspaces: unknown[];
  /** Opaque: `AgentCandidate[]` on the conductor surface. */
  agents: unknown[];
  /** Opaque: `HookListener[]` on the conductor surface (BB-599). */
  hooks: unknown[];
  /** Opaque: `HerdrHost[]` on the conductor surface. */
  processHosts: unknown[];
  connectionPlugins: DropSHPlugin[];
  /**
   * BB-373: UI extension entry MODULES — specifiers, never constructed
   * contributions.
   *
   * Storybook's `managerEntries` model, and load-bearing for a measured reason:
   * `discoverAddons` runs on every connection load (`bakers dropsh` included), and
   * `@opentui/core` is megabytes of native code that a preset returning objects
   * would pull onto that path — the very import BB-326 had to make dynamic.
   * Concretely typed rather than opaque: a specifier is a string, so the kernel
   * needs no foreign type for it and stays surface-agnostic all the same.
   */
  uiEntries: string[];
  /**
   * Addon inbox messages (conductor surface, contract 2, BB-661): each
   * addon's `inbox` export with the name and version read from its
   * package.json, plus the entry's `with` options for its lazy `handlers`.
   * Opaque here; the conductor types `inbox` as its `InboxMessages`.
   */
  addonInbox: Array<{
    name: string;
    version: string;
    inbox: unknown;
    options?: unknown;
  }>;
}

/**
 * An OPAQUE per-surface accumulator. The kernel threads it without knowing its
 * element type; the surface owner declares the concrete signature (see
 * `@bakers-build/conductor`'s `Preset`). `never[]` on the input side is deliberate:
 * it keeps a concretely-typed accumulator such as
 * `(acc: RemotePlugin[], opts) => RemotePlugin[]` structurally assignable to
 * this opaque form, so a conductor-surface `Preset` still satisfies `BbPreset`.
 */
export type OpaqueAccumulator<O> = (
  acc: never[],
  opts: O,
) => unknown[] | Promise<unknown[]>;

/** The extension points each surface runs (the preset function names to call). */
export const SURFACE_KEYS: Record<
  BbSurface,
  Array<keyof DiscoveredContributions>
> = {
  command: ['commands'],
  conductor: [
    'remotes',
    'executors',
    'workspaces',
    'agents',
    'hooks',
    'processHosts',
  ],
  connection: ['connectionPlugins', 'uiEntries'],
};

/**
 * A preset: named per-surface accumulator functions + a meta-addon `addons`
 * array. Every accumulator is `(acc, opts) => acc` (sync or async); returning a
 * new array lets an addon append, replace, or even FILTER a prior contribution
 * (override semantics — the user config participates as the final preset).
 */
export interface BbPreset<O = unknown> {
  /** Meta-addon composition: children apply depth-first BEFORE this preset. */
  addons?: AddonEntry[];

  /** The config scopes this addon may be listed in; absent means both. */
  scopes?: AddonScope[];
  /**
   * Merge the entry's `with` when the addon is listed in both scopes (each
   * argument `undefined` when that entry has none). Absent: the machine
   * `with`, when given, replaces the project `with` whole.
   */
  mergeWith?: (project: unknown, machine: unknown) => unknown;
  /**
   * Check one entry's own `with` (`undefined` when it has none); each problem
   * names its key relative to `with`. `bakers config check --online` reports
   * them as `addon_with_invalid`.
   */
  checkWith?: (value: unknown) => { key: string; message: string }[];

  // ── command surface (host) — descriptors only, never constructed plugins ──
  commands?: (
    acc: CommandDescriptor[],
    opts: O,
  ) => CommandDescriptor[] | Promise<CommandDescriptor[]>;

  // ── conductor surface (engine) — OPAQUE here; concretely typed by
  //    `@bakers-build/conductor`'s `Preset`, which an addon should use instead. ──
  remotes?: OpaqueAccumulator<O>;
  executors?: OpaqueAccumulator<O>;
  workspaces?: OpaqueAccumulator<O>;
  agents?: OpaqueAccumulator<O>;
  hooks?: OpaqueAccumulator<O>;
  processHosts?: OpaqueAccumulator<O>;

  // ── connection surface (dropsh) ──
  connectionPlugins?: (
    acc: DropSHPlugin[],
    opts: O,
  ) => DropSHPlugin[] | Promise<DropSHPlugin[]>;

  // ── connection surface (the TUI's contribution registry) ──
  // BB-373: module SPECIFIERS the renderer imports at boot, never objects —
  // see `DiscoveredContributions.uiEntries` for why that distinction is the
  // whole point.
  uiEntries?: (acc: string[], opts: O) => string[] | Promise<string[]>;

  // ── conductor surface: inbox messages (contract 2, BB-661) — a value,
  //    not an accumulator; discovery records it with the addon's package
  //    name, version and `with` options. ──
  inbox?: unknown;
}

/** The preset function keys, for shape-detection during discovery. */
export const PRESET_FUNCTION_KEYS: Array<keyof DiscoveredContributions> = [
  'commands',
  'remotes',
  'executors',
  'workspaces',
  'agents',
  'hooks',
  'processHosts',
  'connectionPlugins',
  'uiEntries',
];

/** An empty contributions accumulator. */
export function emptyContributions(): DiscoveredContributions {
  return {
    commands: [],
    remotes: [],
    executors: [],
    workspaces: [],
    agents: [],
    hooks: [],
    processHosts: [],
    connectionPlugins: [],
    uiEntries: [],
    addonInbox: [],
  };
}
