// The forge entry's `with`: `merge` rules per base branch and exactly one
// `backend` (`use` names the package, `with` is that package's settings).

import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import type { AddonScope } from '@bakers-build/core';
import { resolveModuleEslintStyle } from '@bakers-build/core';
import {
  assertForgeBackend,
  type ForgeBackend,
  type ForgeBackendFactory,
} from './backend.js';

export const FORGE_SPEC = '@bakers-build/addon-forge';

export const FORGE_NEEDS_BACKEND = `addons[${FORGE_SPEC}].with.backend.use must name a forge backend ('@bakers-build/addon-forge-github' or '@bakers-build/addon-forge-gitlab') in ~/.bakers/machine.config.js or .bakers/conductor.config.js; see docs/addons/forge`;

export interface MergeRule {
  readonly method: 'squash' | 'merge';
  readonly delete_source: boolean;
}

const DEFAULT_RULE: MergeRule = { method: 'squash', delete_source: true };

/** Backend keys that hold a credential; never literal in a committed file. */
const SECRET_KEYS = ['token', 'private_key'];

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export function checkWith(
  value: unknown,
  scope: AddonScope = 'machine',
): { key: string; message: string }[] {
  if (!isObject(value)) return [{ key: 'backend.use', message: 'must name a forge backend package' }];
  const out: { key: string; message: string }[] = [];
  for (const k of Object.keys(value))
    if (k !== 'merge' && k !== 'backend')
      out.push({ key: k, message: 'is not a forge setting (merge, backend)' });
  const { merge, backend } = value;
  if (merge !== undefined) {
    if (!isObject(merge)) out.push({ key: 'merge', message: 'must be an object of base branch → rule' });
    else
      for (const [base, rule] of Object.entries(merge))
        if (
          !isObject(rule) ||
          (rule.method !== 'squash' && rule.method !== 'merge') ||
          typeof rule.delete_source !== 'boolean'
        )
          out.push({
            key: `merge.${base}`,
            message: "must be { method: 'squash' | 'merge', delete_source: true | false }",
          });
  }
  if (!isObject(backend) || typeof backend.use !== 'string' || backend.use === '')
    out.push({ key: 'backend.use', message: 'must name a forge backend package' });
  else if (scope === 'project' && isObject(backend.with))
    for (const k of SECRET_KEYS)
      if (backend.with[k] !== undefined)
        out.push({
          key: `backend.with.${k}`,
          message: `is a credential in a committed file: use ${k}_env, or set it in ~/.bakers/machine.config.js`,
        });
  return out;
}

/** The machine wins key by key (a machine `backend` replaces the project's). */
export function mergeWith(project: unknown, machine: unknown): unknown {
  if (!isObject(machine)) return machine === undefined ? project : machine;
  if (!isObject(project)) return machine;
  return { ...project, ...machine };
}

/** The rule for merging into `base`: `merge[base]`, else `merge['*']`, else squash and delete. */
export function mergeRule(settings: unknown, base: string): MergeRule {
  const merge = isObject(settings) && isObject(settings.merge) ? settings.merge : {};
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
  if (!isObject(backend) || typeof backend.use !== 'string' || backend.use === '')
    throw new Error(FORGE_NEEDS_BACKEND);
  const spec = backend.use;
  const resolved = resolveModuleEslintStyle(spec, [
    pathToFileURL(`${home}/`).href,
    ...hostInstallBases(),
    pathToFileURL(`${process.cwd()}/`).href,
  ]);
  if (resolved === undefined)
    throw new Error(`forge cannot resolve backend package '${spec}'`);
  const factory = ((await import(pathToFileURL(resolved).href)) as { default?: unknown }).default;
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
