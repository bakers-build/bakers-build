// The effective addon list: `~/.bakers/machine.config.js` and the project's
// `.bakers/project.config.js` each carry one `addons[]`, read the same way.
// The addon decides where it may be listed (its preset's `scopes`, default
// both); an entry in a scope it does not declare is reported and not loaded.
// The same addon (resolved module + alias) in both scopes becomes one entry
// at the machine position, and the machine `with` wins — whole, unless the
// addon exports its own `mergeWith`. Machine entries come first, so the
// broadest scope keeps its position (the `bakers ui` tab order).

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { findConfigProjectBbDir, homeBbDir } from '../cli/bakers-dir.js';
import type { ConductorLogger } from '../core/logger.js';
import {
  AddonUnresolvedError,
  discoverAddons,
  isRetiredAddon,
  loadAddonPreset,
  normalizeEntry,
} from './discover-addons.js';
import type {
  AddonEntry,
  AddonScope,
  BbPreset,
  BbSurface,
  DiscoveredContributions,
} from './preset.js';

/** One scope's `addons[]` with the bases its entries resolve against. */
export interface AddonScopeInput {
  scope: AddonScope;
  /** The config file the entries came from. */
  path: string;
  entries: AddonEntry[];
  bases: string[];
}

/** One entry of the effective list. A merged entry keeps the machine side. */
export interface EffectiveAddon {
  entry: AddonEntry;
  scope: AddonScope;
  path: string;
  bases: string[];
  /** The resolved preset module path. */
  key: string;
}

/** An entry listed in a scope its addon does not declare. */
export type AddonScopeFinding = {
  code: 'addon_scope_not_allowed';
  spec: string;
  path: string;
  scope: AddonScope;
  allowed: AddonScope[];
};

const ALL_SCOPES: AddonScope[] = ['machine', 'project'];
const SCOPE_FILE: Record<AddonScope, string> = {
  machine: '~/.bakers/machine.config.js',
  project: '.bakers/project.config.js',
};

/** The `with` an entry carries. */
function entryWith(entry: AddonEntry): unknown {
  return normalizeEntry(entry).opts;
}

/** `entry` as a descriptor carrying `with` (or none when undefined). */
function withReplaced(entry: AddonEntry, value: unknown): AddonEntry {
  const { with: _with, ...rest } =
    typeof entry === 'string' ? { use: entry } : entry;
  return value === undefined ? rest : { ...rest, with: value };
}

/**
 * Build the effective addon list from the machine and project scopes. An
 * unresolvable machine entry is skipped with a warning; an unresolvable
 * project entry throws, unless `unresolved: 'skip'` makes every scope soft
 * (an optional reader such as `bakers ui`).
 */
export async function scopeAddons(
  inputs: AddonScopeInput[],
  opts: { logger?: ConductorLogger; unresolved?: 'skip' } = {},
): Promise<{ addons: EffectiveAddon[]; findings: AddonScopeFinding[] }> {
  const warn = (msg: string) => {
    if (opts.logger) opts.logger.warn({}, msg);
    else console.warn(msg);
  };
  const addons: EffectiveAddon[] = [];
  const findings: AddonScopeFinding[] = [];
  const machineAt = new Map<string, number>();
  const ordered = [
    ...inputs.filter((i) => i.scope === 'machine'),
    ...inputs.filter((i) => i.scope !== 'machine'),
  ];
  for (const input of ordered) {
    for (const entry of input.entries) {
      const { spec, alias } = normalizeEntry(entry);
      if (isRetiredAddon(spec)) {
        // discoverAddons warns once and skips it.
        addons.push({
          entry,
          scope: input.scope,
          path: input.path,
          bases: input.bases,
          key: spec,
        });
        continue;
      }
      let loaded: { preset: BbPreset; key: string };
      try {
        loaded = await loadAddonPreset(spec, input.bases, warn);
      } catch (error) {
        const soft = input.scope === 'machine' || opts.unresolved === 'skip';
        if (soft && error instanceof AddonUnresolvedError) {
          warn(
            `addons[] in ${input.path}: cannot resolve addon '${spec}' — it is ` +
              'skipped; install it where that config can resolve it.',
          );
          continue;
        }
        throw error;
      }
      const allowed = loaded.preset.scopes ?? ALL_SCOPES;
      if (!allowed.includes(input.scope)) {
        findings.push({
          code: 'addon_scope_not_allowed',
          spec,
          path: input.path,
          scope: input.scope,
          allowed,
        });
        warn(
          `addons[] in ${input.path}: addon '${spec}' is not loaded — it may ` +
            `be configured only in ${allowed.map((s) => SCOPE_FILE[s]).join(' or ')}.`,
        );
        continue;
      }
      const match = `${loaded.key}\0${alias ?? ''}`;
      const at = input.scope === 'project' ? machineAt.get(match) : undefined;
      if (at !== undefined) {
        const winner = addons[at] as EffectiveAddon;
        const project = entryWith(entry);
        const machine = entryWith(winner.entry);
        const merged = loaded.preset.mergeWith
          ? loaded.preset.mergeWith(project, machine)
          : machine !== undefined
            ? machine
            : project;
        addons[at] = { ...winner, entry: withReplaced(winner.entry, merged) };
        continue;
      }
      if (input.scope === 'machine' && !machineAt.has(match))
        machineAt.set(match, addons.length);
      addons.push({
        entry,
        scope: input.scope,
        path: input.path,
        bases: input.bases,
        key: loaded.key,
      });
    }
  }
  return { addons, findings };
}

/** Run `surface` over the effective list, each entry against its own bases. */
export function discoverScoped(
  addons: EffectiveAddon[],
  surface: BbSurface,
  opts: Omit<
    NonNullable<Parameters<typeof discoverAddons>[3]>,
    'entryBases'
  > = {},
): Promise<DiscoveredContributions> {
  return discoverAddons(
    addons.map((a) => a.entry),
    surface,
    addons[0]?.bases ?? [],
    { ...opts, entryBases: addons.map((a) => a.bases) },
  );
}

/**
 * `<BAKERS_HOME or ~/.bakers>/machine.config.js`. `home` stays optional and, when
 * given, still wins (a fixture that pins an explicit home) — but an absent one
 * must reach `homeBbDir()`'s resolver rather than collapsing to the OS home
 * first, or `BAKERS_HOME` never relocates this file.
 */
export function machineUiConfigPath(home?: string): string {
  return join(homeBbDir(home), 'machine.config.js');
}

/** The nearest project `.bakers/project.config.js` above `cwd`, or undefined. */
export function projectConductorConfigPath(
  cwd: string,
  home?: string,
): string | undefined {
  const bakersDir = findConfigProjectBbDir(cwd, home);
  if (bakersDir === undefined) return undefined;
  const path = join(dirname(bakersDir), '.bakers', 'project.config.js');
  return existsSync(path) ? path : undefined;
}

/** A config file's `addons[]`, or `[]` when the file is absent or broken. */
export async function readConfigAddons(path: string): Promise<AddonEntry[]> {
  if (!existsSync(path)) return [];
  try {
    // Cache-bust so a re-read within one process sees an edited file.
    const mod = await import(`${pathToFileURL(path).href}?t=${Date.now()}`);
    const addons = (mod.default as { addons?: unknown } | undefined)?.addons;
    return Array.isArray(addons) ? (addons as AddonEntry[]) : [];
  } catch {
    return [];
  }
}

/**
 * The effective entry for one addon package from `machine.config.js` and the
 * nearest project `.bakers/project.config.js` above `cwd` (or `projectPath`).
 * `bases` are appended to each scope's own (e.g. the caller's install).
 */
export async function readEffectiveAddon(
  spec: string,
  opts: { cwd: string; home?: string; projectPath?: string; bases?: string[] },
): Promise<EffectiveAddon | undefined> {
  const extra = opts.bases ?? [];
  const machinePath = machineUiConfigPath(opts.home);
  const projectPath =
    opts.projectPath ?? projectConductorConfigPath(opts.cwd, opts.home);
  const inputs: AddonScopeInput[] = [
    {
      scope: 'machine',
      path: machinePath,
      entries: await readConfigAddons(machinePath),
      bases: [pathToFileURL(`${dirname(machinePath)}/`).href, ...extra],
    },
  ];
  if (projectPath !== undefined)
    inputs.push({
      scope: 'project',
      path: projectPath,
      entries: await readConfigAddons(projectPath),
      bases: [
        pathToFileURL(`${dirname(projectPath)}/`).href,
        pathToFileURL(`${opts.cwd}/`).href,
        ...extra,
      ],
    });
  // Only this addon's entries: an unrelated broken entry must not block it.
  for (const input of inputs)
    input.entries = input.entries.filter(
      (e) => (typeof e === 'string' ? e : e?.use) === spec,
    );
  const { addons } = await scopeAddons(inputs, { unresolved: 'skip' });
  return addons[0];
}
