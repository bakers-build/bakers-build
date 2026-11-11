// The forge entry's `with`: `merge` rules per base branch and exactly one
// `backend` (`use` names the package, `with` is that package's settings);
// options.schema.json describes them.

import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolveModuleEslintStyle } from '@bakers-build/core';
import {
  assertForgeBackend,
  type ForgeBackend,
  type ForgeBackendFactory,
} from './backend.js';

export const FORGE_SPEC = '@bakers-build/addon-forge';

export const FORGE_NEEDS_BACKEND = `addons[${FORGE_SPEC}].with.backend.use must name a forge backend ('@bakers-build/addon-forge-github' or '@bakers-build/addon-forge-gitlab') in ~/.bakers/machine.config.js or .bakers/project.config.js; see docs/addons/forge`;

export interface MergeRule {
  readonly method: 'squash' | 'merge';
  readonly delete_source: boolean;
}

const DEFAULT_RULE: MergeRule = { method: 'squash', delete_source: true };

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** The machine wins key by key (a machine `backend` replaces the project's). */
export function mergeWith(project: unknown, machine: unknown): unknown {
  if (!isObject(machine)) return machine === undefined ? project : machine;
  if (!isObject(project)) return machine;
  return { ...project, ...machine };
}

/** The rule for merging into `base`: `merge[base]`, else `merge['*']`, else squash and delete. */
export function mergeRule(settings: unknown, base: string): MergeRule {
  const merge =
    isObject(settings) && isObject(settings.merge) ? settings.merge : {};
  return (merge[base] ?? merge['*'] ?? DEFAULT_RULE) as MergeRule;
}

/** Resolution bases rooted at the running `bakers` host install (see addon-ports' config). */
function hostInstallBases(): string[] {
  const entry = process.argv[1];
  if (!entry) return [import.meta.url];
  let real: string;
  try {
    real = realpathSync(entry);
  } catch {
    real = entry;
  }
  const entryUrl = pathToFileURL(real);
  return [entryUrl.href, new URL('../host/dist/src/host.js', entryUrl).href];
}

/** Resolve, load and construct the configured backend. */
export async function loadForgeBackend(
  settings: unknown,
  home: string,
): Promise<ForgeBackend> {
  const backend = isObject(settings) ? settings.backend : undefined;
  if (
    !isObject(backend) ||
    typeof backend.use !== 'string' ||
    backend.use === ''
  )
    throw new Error(FORGE_NEEDS_BACKEND);
  const spec = backend.use;
  const resolved = resolveModuleEslintStyle(spec, [
    pathToFileURL(`${home}/`).href,
    ...hostInstallBases(),
    pathToFileURL(`${process.cwd()}/`).href,
  ]);
  if (resolved === undefined)
    throw new Error(`forge cannot resolve backend package '${spec}'`);
  const factory = (
    (await import(pathToFileURL(resolved).href)) as { default?: unknown }
  ).default;
  if (typeof factory !== 'function')
    throw new Error(`forge backend '${spec}' has no default export factory`);
  let made: unknown;
  try {
    made = await (factory as ForgeBackendFactory)(backend.with, { home });
  } catch (err) {
    throw new Error(
      `forge backend '${spec}' rejected its settings: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  assertForgeBackend(made, spec);
  return made;
}
