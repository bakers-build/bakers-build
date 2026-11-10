// BB-215: addon discovery. One shared `discoverAddons(entries, surface, bases)`
// called by the conductor loader, the connection loader, and the host — each
// runs ONLY its surface's accumulators. Resolution reuses the ESLint-style
// resolver (`resolveModuleEslintStyle`) so an addon named in a config resolves
// the same way a slot plugin did before (config dir → cwd → install).
//
// Ordering / override semantics (Storybook never wrote these down; spec'd here):
//   1. addons apply in `addons[]` ARRAY ORDER;
//   2. a preset's `addons` children apply DEPTH-FIRST BEFORE the declaring preset
//      (a parent overrides its children — essentials-style composition);
//   3. the user config file is the final preset (its own `addons[]` are the
//      top-level entries, processed last → it always wins);
//   4. an EXACT duplicate addon (same resolved path AND same options) is
//      processed once (visited-set keyed by path + serialized options) and
//      warned — this also prevents meta-addon cycles and fixes the old one-level
//      `composePlugins` flatten. The same package with DIFFERENT options is a
//      legitimate multi-instance (e.g. two oauth2 profiles) and both load.
// Per entry: resolve → import `<pkg>/preset` (fallback: the package's default
// export adapted as a single contribution, logged) → run the surface's
// accumulators with the entry's `with` → for `agents`, attach the entry's
// `priority`. The runtime `.kind` guard is retained at singleton resolution.

//
// BB-224 (Finding 6, decision 7): surface-AGNOSTIC. The per-surface
// accumulators are opaque `unknown[]` here (their element types belong to the
// surface owner — `@bakers-build/conductor` for the conductor surface), so this module
// keeps zero `@bakers-build/*` edges. Everything it needs from a contribution is
// structural: the `.kind` tag for the singleton guard, `.id` for the warn line,
// and `.priority` for the agent-candidate attach.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveModuleEslintStyle } from '../cli/resolve-module.js';
import type { ConductorLogger } from '../core/logger.js';
import {
  type AddonEntry,
  type BbPreset,
  type BbSurface,
  type DiscoveredContributions,
  emptyContributions,
  PRESET_FUNCTION_KEYS,
  SURFACE_KEYS,
} from './preset.js';

/** The opaque per-ticket priority a config entry may carry (see `AddonEntry`). */
type AddonPriority = (ticket: never) => number;

/** The only structure the kernel reads off an opaque contribution. */
interface KindedContribution {
  kind?: unknown;
  id?: unknown;
}

/** The only structure the kernel reads off an opaque agent candidate. */
interface PrioritizedCandidate {
  alias?: string;
  priority?: AddonPriority;
}

/** A minimal warn sink — the in-scope conductor logger, else `console.warn`. */
type Warn = (msg: string) => void;
function warnFrom(logger?: ConductorLogger): Warn {
  if (logger) return (msg) => logger.warn({}, msg);
  return (msg) => {
    console.warn(msg);
  };
}

/** Normalize an `AddonEntry` to `{ spec, opts, priority }`. */
export function normalizeEntry(entry: AddonEntry): {
  spec: string;
  opts: unknown;
  priority?: AddonPriority;
  alias?: string;
} {
  if (typeof entry === 'string') return { spec: entry, opts: undefined };
  const spec = entry.use;
  if (typeof spec !== 'string' || spec.trim() === '') {
    throw new Error(
      `addons[] entry must name a package via a string or { use }; got ${JSON.stringify(entry)}`,
    );
  }
  return {
    spec,
    opts: entry.with,
    ...(entry.alias !== undefined ? { alias: entry.alias } : {}),
    ...(entry.priority ? { priority: entry.priority } : {}),
  };
}

/** Does an imported module look like a preset (any accumulator fn or `addons`)? */
function isPresetShaped(mod: Record<string, unknown>): boolean {
  if (Array.isArray(mod.addons)) return true;
  if (typeof mod.inbox === 'object' && mod.inbox !== null) return true;
  if (typeof mod.tools === 'object' && mod.tools !== null) return true;
  if (Array.isArray(mod.scopes) || typeof mod.mergeWith === 'function')
    return true;
  return PRESET_FUNCTION_KEYS.some((k) => typeof mod[k] === 'function');
}

/** Pick a module's single factory: the default export, else a sole function. */
function pickFactory(
  mod: Record<string, unknown>,
): ((o?: unknown) => unknown) | undefined {
  if (typeof mod.default === 'function') {
    return mod.default as (o?: unknown) => unknown;
  }
  const fns = Object.keys(mod).filter((k) => typeof mod[k] === 'function');
  if (fns.length === 1)
    return mod[fns[0] as string] as (o?: unknown) => unknown;
  return undefined;
}

/**
 * Adapt a not-yet-migrated package (no `./preset`, module not preset-shaped) by
 * constructing its default/sole factory and routing the built plugin into the
 * surface accumulator matching its `.kind`. Incremental-migration path; logged.
 * A factory returning an array (dropsh `composePlugins` aggregator) is flattened.
 */
function adaptDefaultExport(
  mod: Record<string, unknown>,
  spec: string,
  warn: Warn,
): BbPreset {
  const factory = pickFactory(mod);
  if (!factory) {
    throw new Error(
      `addon '${spec}' has no ./preset, is not preset-shaped, and has no default/sole factory to adapt`,
    );
  }
  warn(
    `addon '${spec}' has no ./preset export — adapting its default export (legacy; migrate it to a ./preset, BB-215 AC-3)`,
  );
  return {
    connectionPlugins: (acc, opts) => {
      const built = factory(opts);
      const list = Array.isArray(built) ? built : [built];
      // Route by kind: only plugins WITHOUT a bakers.build engine kind are dropsh
      // connection plugins; engine kinds are routed by the branches below.
      const conn = list.filter(
        (p) => !isEngineKind((p as { kind?: unknown }).kind),
      );
      return [
        ...acc,
        ...(conn as DiscoveredContributions['connectionPlugins']),
      ];
    },
    servers: (acc, opts) => routeByKind(factory, opts, 'server', acc),
    executors: (acc, opts) => routeByKind(factory, opts, 'executor', acc),
    worktrees: (acc, opts) => routeByKind(factory, opts, 'worktree', acc),
    agents: (acc, opts) => {
      const built = factory(opts);
      const list = Array.isArray(built) ? built : [built];
      const agents = list.filter(
        (p) => (p as { kind?: unknown }).kind === 'agent',
      );
      return [...acc, ...agents.map((agent) => ({ agent }))];
    },
  };
}

function isEngineKind(kind: unknown): boolean {
  return (
    kind === 'server' ||
    kind === 'executor' ||
    kind === 'worktree' ||
    kind === 'agent'
  );
}

function routeByKind<T>(
  factory: (o?: unknown) => unknown,
  opts: unknown,
  kind: string,
  acc: T[],
): T[] {
  const built = factory(opts);
  const list = Array.isArray(built) ? built : [built];
  const matching = list.filter((p) => (p as { kind?: unknown }).kind === kind);
  return [...acc, ...(matching as T[])];
}

/**
 * Addons that no longer exist, with what replaced them. An entry naming one is
 * skipped with a warning instead of failing the whole config, so a config
 * written for an older release keeps loading after an update.
 */
const RETIRED_ADDONS: Record<string, string> = {
  '@bakers-build/addon-ports-ui':
    'the Ports panel now comes from @bakers-build/addon-ports in the conductor config (the ticket Addons tab); remove the entry',
};

/** Is `spec` a retired addon (skipped with a warning by `discoverAddons`)? */
export function isRetiredAddon(spec: string): boolean {
  return RETIRED_ADDONS[spec] !== undefined;
}

/** Thrown when an addon package cannot be RESOLVED (never when it throws on import). */
export class AddonUnresolvedError extends Error {
  constructor(readonly spec: string) {
    super(`addons[] cannot resolve addon '${spec}'`);
    this.name = 'AddonUnresolvedError';
  }
}

/** Resolve + import the preset for one addon spec. Returns the preset + a stable
 *  visited key (the resolved module path). Throws `AddonUnresolvedError` when
 *  the package does not resolve. */
export async function loadAddonPreset(
  spec: string,
  bases: string[],
  warn: Warn = warnFrom(),
): Promise<{ preset: BbPreset; key: string }> {
  // 1. the conventional `<pkg>/preset` subpath.
  const presetPath = resolveModuleEslintStyle(`${spec}/preset`, bases);
  if (presetPath !== undefined) {
    const mod = (await import(pathToFileURL(presetPath).href)) as Record<
      string,
      unknown
    >;
    if (!isPresetShaped(mod)) {
      throw new Error(
        `addon '${spec}' exposes a ./preset that declares no contributions`,
      );
    }
    return { preset: mod as BbPreset, key: presetPath };
  }

  // 2. the package's main export — either preset-shaped, or a legacy default.
  const mainPath = resolveModuleEslintStyle(spec, bases);
  if (mainPath === undefined) {
    throw new AddonUnresolvedError(spec);
  }
  const mod = (await import(pathToFileURL(mainPath).href)) as Record<
    string,
    unknown
  >;
  if (isPresetShaped(mod)) return { preset: mod as BbPreset, key: mainPath };
  return { preset: adaptDefaultExport(mod, spec, warn), key: mainPath };
}

/**
 * Merge the caller's global options under an entry's own `with` (BB-351).
 *
 * A preset normally reads only what its own config entry passed it. That breaks
 * down for a value carried by a meta-addon's CHILD: a child is listed as a bare
 * package name, so it has no `with` at all, and the config has no place to write
 * one. `globals` is the config-level fallback — every preset sees it, an entry's
 * own `with` overrides it key by key, and an entry that ignores the extra keys
 * (all of them but one, today) is unaffected.
 */
function mergeGlobals(globals: unknown, own: unknown): unknown {
  if (globals === undefined) return own;
  const g = globals as Record<string, unknown>;
  if (own === undefined) return { ...g };
  if (typeof own !== 'object' || own === null || Array.isArray(own)) return own;
  return { ...g, ...(own as Record<string, unknown>) };
}

/** Run one preset's surface accumulators into `acc`, attaching `priority` to any
 *  newly appended agent candidates. */
async function applyPreset(
  preset: BbPreset,
  opts: unknown,
  priority: AddonPriority | undefined,
  alias: string | undefined,
  surface: BbSurface,
  acc: DiscoveredContributions,
  only?: Array<keyof DiscoveredContributions>,
  agentOpts: unknown = opts,
): Promise<void> {
  // `only` NARROWS, never widens: a key the surface does not run stays unrun.
  const keys = only
    ? SURFACE_KEYS[surface].filter((k) => only.includes(k))
    : SURFACE_KEYS[surface];
  for (const key of keys) {
    const fn = preset[key as keyof BbPreset] as
      | ((a: unknown[], o: unknown) => unknown[] | Promise<unknown[]>)
      | undefined;
    if (typeof fn !== 'function') continue;
    const before = key === 'agents' ? acc.agents.length : 0;
    const keyOpts = key === 'agents' ? agentOpts : opts;
    // biome-ignore lint/suspicious/noExplicitAny: heterogeneous per-key arrays
    (acc as any)[key] = await fn((acc as any)[key], keyOpts);
    if (key === 'agents' && alias !== undefined) {
      const added = acc.agents.slice(before) as PrioritizedCandidate[];
      const selected = added.filter((c) => c.alias === alias);
      if (selected.length > 0) {
        acc.agents.splice(before, added.length, ...selected);
      } else if (added.length === 1) {
        acc.agents[before] = { ...added[0], alias };
      } else {
        throw new Error(
          `agent alias '${alias}' does not select a single variant; supply with options for a custom agent`,
        );
      }
    }
    if (key === 'agents' && priority) {
      for (let i = before; i < acc.agents.length; i++) {
        const c = acc.agents[i] as PrioritizedCandidate;
        const candidate = { ...c, priority: c.priority ?? priority };
        // A priority-only entry predates catalog routing. An addon's new
        // default alias must not collapse its variants or bypass its callback.
        if (alias === undefined) delete candidate.alias;
        acc.agents[i] = candidate;
      }
    }
  }
}

/**
 * Discover + accumulate the `entries` for one `surface`. `bases` is the
 * ESLint-style resolution order (config dir → cwd → install). Depth-first over
 * meta-addon `addons` (children before parent), visited-set keyed by resolved
 * path + serialized options (dedup + cycle-safe). Returns the accumulated
 * per-extension-point arrays; singleton resolution is `resolveConductorSlots`.
 */
export async function discoverAddons(
  entries: AddonEntry[] | undefined,
  surface: BbSurface,
  bases: string[],
  opts: {
    logger?: ConductorLogger;
    globals?: unknown;
    /** Like `globals`, but seen only by the `agents` accumulators (the
     *  conductor's shared run security). */
    agentGlobals?: unknown;
    /** Narrow the surface's accumulators to this subset (intersection only). */
    only?: Array<keyof DiscoveredContributions>;
    /** `skip` warns and drops an addon that does not RESOLVE; import errors still throw. */
    unresolved?: 'throw' | 'skip';
    /** The config file the entries came from, named in the skip warning. */
    source?: string;
    /** Resolution bases per top-level entry (index-aligned); a missing index
     *  uses `bases`. A meta-addon's children inherit their parent's bases. */
    entryBases?: Array<string[] | undefined>;
  } = {},
): Promise<DiscoveredContributions> {
  const acc = emptyContributions();
  if (!Array.isArray(entries) || entries.length === 0) return acc;
  const warn = warnFrom(opts.logger);
  const visited = new Set<string>();

  const walk = async (
    list: AddonEntry[],
    parentBases?: string[],
  ): Promise<void> => {
    for (const [index, entry] of list.entries()) {
      const listBases = parentBases ?? opts.entryBases?.[index] ?? bases;
      const { spec, opts: withOpts, priority, alias } = normalizeEntry(entry);
      const retired = RETIRED_ADDONS[spec];
      if (retired !== undefined) {
        warn(`addon '${spec}' is retired: ${retired}.`);
        continue;
      }
      let loaded: { preset: BbPreset; key: string };
      try {
        loaded = await loadAddonPreset(spec, listBases, warn);
      } catch (error) {
        if (
          opts.unresolved === 'skip' &&
          error instanceof AddonUnresolvedError
        ) {
          warn(
            `addons[] in ${opts.source ?? '<config>'}: cannot resolve addon ` +
              `'${spec}' — its contributions are skipped; install it where that ` +
              'config can resolve it.',
          );
          continue;
        }
        throw error;
      }
      const { preset, key } = loaded;
      // Dedup on (resolved path + serialized options): an EXACT repeat is a
      // mistake (skip + warn), but the SAME package with DIFFERENT `with` is a
      // legitimate multi-instance (e.g. two @dropsh/plugin-oauth2 profiles —
      // session + pm), so both must load. Cycle-safe: a meta-addon that re-lists
      // itself with the same options hits the visited key and stops.
      const dedupKey = `${key} ${optionsKey(withOpts)}\0${alias ?? ''}`;
      if (visited.has(dedupKey)) {
        warn(
          `addon '${spec}' already registered — skipping the exact duplicate`,
        );
        continue;
      }
      visited.add(dedupKey);
      // Depth-first: meta-addon children apply BEFORE the declaring preset.
      if (Array.isArray(preset.addons) && preset.addons.length > 0) {
        await walk(preset.addons, listBases);
      }
      const presetOpts = mergeGlobals(opts.globals, withOpts);
      await applyPreset(
        preset,
        presetOpts,
        priority,
        alias,
        surface,
        acc,
        opts.only,
        mergeGlobals(opts.agentGlobals, presetOpts),
      );
      if (
        surface === 'conductor' &&
        preset.inbox !== undefined &&
        (!opts.only || opts.only.includes('addonInbox'))
      ) {
        acc.addonInbox.push({
          ...addonPackage(key),
          inbox: preset.inbox,
          ...(presetOpts !== undefined ? { options: presetOpts } : {}),
        });
      }
      if (
        surface === 'conductor' &&
        preset.tools !== undefined &&
        (!opts.only || opts.only.includes('addonTools'))
      ) {
        acc.addonTools.push({
          ...addonPackage(key),
          tools: preset.tools,
          ...(presetOpts !== undefined ? { options: presetOpts } : {}),
        });
      }
    }
  };

  await walk(entries);
  return acc;
}

/**
 * The addon name and version from the nearest package.json above its preset:
 * `@bakers-build/addon-ports` → `ports`. Addons do not author them (contract D6).
 */
function addonPackage(modulePath: string): { name: string; version: string } {
  let dir = dirname(modulePath);
  for (let i = 0; i < 8; i++) {
    try {
      const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
      if (typeof pkg.name === 'string') {
        return {
          name: pkg.name.replace(/^@[^/]+\//, '').replace(/^addon-/, ''),
          version: typeof pkg.version === 'string' ? pkg.version : '0.0.0',
        };
      }
    } catch {}
    dir = dirname(dir);
  }
  throw new Error(`addon at ${modulePath} has no package.json with a name`);
}

/** Stable-ish serialization of an addon entry's `with` options for dedup keying.
 *  Functions collapse to a marker; unserializable values fall back to String(). */
function optionsKey(opts: unknown): string {
  if (opts === undefined) return '';
  try {
    return (
      JSON.stringify(opts, (_k, v) => (typeof v === 'function' ? '[fn]' : v)) ??
      ''
    );
  } catch {
    return String(opts);
  }
}

/**
 * The resolved conductor slots (last-wins singletons + agent candidate list).
 * Generic over the four element types so the kernel stays surface-agnostic while
 * the caller keeps full type-safety: the engine passes its narrowed
 * `ConductorContributions` (see `@bakers-build/conductor`'s
 * `narrowConductorContributions`) and gets `RemotePlugin`/`ExecutorPlugin`/
 * `WorkspacePlugin`/`AgentCandidate` back.
 */
export interface ResolvedConductorSlots<
  R = unknown,
  E = unknown,
  W = unknown,
  A = unknown,
> {
  remote?: R;
  executor?: E;
  workspace?: W;
  agents: A[];
}

/** Take the LAST contributor for a singleton slot; warn when >1 competed; run
 *  the runtime `.kind` guard so a mis-declared contribution still fails loudly. */
function resolveSingleton<T>(
  list: T[],
  kind: string,
  logger?: ConductorLogger,
): T | undefined {
  if (list.length === 0) return undefined;
  const warn = warnFrom(logger);
  if (list.length > 1) {
    const ids = list
      .map((p) => (p as KindedContribution).id ?? '<?>')
      .join(', ');
    warn(
      `${kind}: ${list.length} addons contributed a ${kind} ([${ids}]); using the last (override wins)`,
    );
  }
  const picked = list[list.length - 1] as T;
  const pickedKind = (picked as KindedContribution).kind;
  if (pickedKind !== kind) {
    throw new Error(
      `addon contributed a '${String(pickedKind)}' into the ${kind} slot`,
    );
  }
  return picked;
}

/** Resolve discovered conductor contributions into the four engine slots. */
export function resolveConductorSlots<R, E, W, A>(
  contributions: {
    servers: R[];
    executors: E[];
    worktrees: W[];
    agents: A[];
  },
  logger?: ConductorLogger,
): ResolvedConductorSlots<R, E, W, A> {
  const remote = resolveSingleton(contributions.servers, 'server', logger);
  const executor = resolveSingleton(
    contributions.executors,
    'executor',
    logger,
  );
  const workspace = resolveSingleton(
    contributions.worktrees,
    'worktree',
    logger,
  );
  return {
    ...(remote ? { remote } : {}),
    ...(executor ? { executor } : {}),
    ...(workspace ? { workspace } : {}),
    agents: contributions.agents,
  };
}
