import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { inspectConfigSource } from '@bakers-build/core';
import { listConductorConfigFiles } from '../config.js';
import { ConfigSourceEditor } from './config-source-edit.js';

// BB-224 (Finding 8b, spec v3 decision 17): the `bakers config upgrade` RENAME pass.
//
// The addon packages were renamed `@bakers-build/plugin-<name>` → `@bakers-build/addon-<name>`
// (decision 14) and the core barrels `@bakers-build/core/{builtins,plugins}` were
// deleted (Finding 6). Both are npm-breaking for an existing install, whose
// `.bakers/` configs still name the old packages — so `bakers config upgrade` rewrites them
// in the user's PROJECT `./.bakers/` and HOME `~/.bakers/` configs.
//
// All THREE deleted/renamed specifiers are covered, and — BB-230 — so is the
// FOURTH: the `@bakers-build/bakers/plugins` host barrel.
//
// BB-224 excluded that barrel on the premise that it "still exists as a
// back-compat aggregator", so a config naming it keeps resolving. That premise is
// INSTALL-DEPENDENT and false for a dev-clone install: `@bakers-build/bakers` is the
// workspace's leaf SINK, so nothing depends on it and it is absent from
// `bakers-cli/node_modules/@bakers-build/`; it is also the only package exporting
// `./plugins` (`@bakers-build/core`'s export map has no such subpath). The `bakers` shim
// prefers a checkout's own build over the global install by design, so exactly
// there the barrel is unresolvable and that one config line dies while its
// sibling `addon-*` slots resolve fine.
//
// The barrel itself keeps existing — this is not repairing a dead reference, it is
// making configs stop NAMING a barrel the project docs already tell them not to
// name. Both barrels are therefore migrated the same closed-set way, over the same
// `CORE_PLUGINS_BARREL_EXPORTS` table. Two deliberate consequences:
//   - the table is a SUPERSET of what `@bakers-build/bakers/plugins` actually re-exports
//     (`host/src/plugins-barrel.ts` omits the fakes on purpose — they are
//     workspace-only and must not be a published package's dependency). Mapping
//     them anyway is right: such a descriptor is broken today, and retargeting it
//     at `@bakers-build/addon-fake` fixes it.
//   - `loadInstructions` IS a barrel export but is not a plugin factory and is
//     absent from the table, so it stays untouched — as does any other unmapped
//     `export:`.
//
// Covered per config dir:
//   - the connection config `bakers.config.js` (its `plugins[]` / `addons[]`);
//   - EVERY engine config the loader itself recognises — the default
//     `conductor.config.js` AND each `<variant>.conductor.config.js`
//     (BB-137 naming convention, enumerated via `listConductorConfigFiles` so
//     the pass and the loader can never disagree). A legacy `conductor.config.js`
//     still carrying `site`/`plugins` (the back-compat connection source) is
//     therefore covered too, and its `plugins[]` entries are mapped on the
//     CONNECTION surface — see `builtinsTargetFor`.
//
// Safety (decision 18 + the v3 risk register):
//   - Replacement is anchored on a CLOSED set of 14 known package names inside
//     a matched quote pair — never a broad `@bakers-build/plugin-.*` sweep. A
//     hand-written config's comments, formatting and unrelated code survive.
//     The `@bakers-build/core/plugins` rewrite is likewise closed-set: it is driven by
//     the barrel's OWN export list, and an export name outside that list is left
//     untouched rather than retargeted at a guess.
//   - `*Plugin` interface identifiers (`RemotePlugin`, `herdrExecutorPlugin`, …)
//     and the `plugins:`/`addons:` config KEYS are excluded BY CONSTRUCTION: a
//     replacement only ever fires on a full quoted specifier, and none of those
//     is one.
//   - Idempotent: a config already on `addon-*` produces zero matches and is
//     left BYTE-unchanged (no rewrite, no backup, no report line).
//   - `--dry-run` prints the line diff and writes nothing.
//   - A real rewrite backs the original up next to the file, like the
//     schema-migration path does.

/** Suffix of the pre-rewrite backup a real (non-dry) rewrite leaves behind. */
export const ADDON_RENAME_BAK_SUFFIX = '.pre-addon-rename.bak';

const AUTH_BASIC = '@bakers-build/addon-auth-basic';
const REMOTE_DRUPAL = '@bakers-build/addon-remote-drupal';
const WORKSPACE_GIT = '@bakers-build/addon-workspace-git';
const FAKE = '@bakers-build/addon-fake';

/**
 * The 14 addon packages renamed by BB-224 (spec v3 decision 14), including
 * the BB-220 `pi` agent addon merged in from develop. A CLOSED
 * set — the pass rewrites only these exact specifiers, so an unknown
 * `@bakers-build/plugin-something` is left alone rather than silently retargeted at a
 * package that does not exist.
 */
export const RENAMED_ADDONS = [
  'auth-basic',
  'claude',
  'codex',
  'deployment',
  'dropsh',
  'essentials',
  'fake',
  'bakers-ui',
  'herdr',
  'kimi',
  'opencode',
  'pi',
  'remote-drupal',
  'workspace-git',
] as const;

/**
 * `'@bakers-build/plugin-<known>'` (or `"…"` / `` `…` ``), with an optional subpath
 * (`/preset`), inside a MATCHED quote pair. The quote pair + the closing anchor
 * are what make this an exact-specifier match: `@bakers-build/plugin-herdr-x` cannot
 * match `herdr`, and a bare `RemotePlugin` identifier cannot match at all.
 * Longest name first so a longer name always wins the alternation.
 */
const QUOTED_LEGACY_ADDON = new RegExp(
  `(['"\`])@bakers-build/plugin-(${[...RENAMED_ADDONS]
    .sort((a, b) => b.length - a.length)
    .join('|')})((?:/[^'"\`]*)?)\\1`,
  'g',
);

/** `'@bakers-build/core/builtins'` inside a matched quote pair (the deleted preset). */
const QUOTED_LEGACY_BUILTINS = /(['"`])@bakers-build\/core\/builtins\1/g;

/**
 * Where each export of the host barrels lives now — the DELETED
 * `@bakers-build/core/plugins` and (BB-230) the meta package's
 * `@bakers-build/bakers/plugins`, which is unresolvable from a dev-clone install.
 *
 * The key set is the barrel's own export list — `core/src/plugins/registry-exports.ts`
 * as of the commit that deleted it — re-pointed at the addon that owns each
 * factory today. `defaultExport` records whether the target package
 * DEFAULT-exports exactly that factory; when it does, the descriptor's `export:`
 * becomes redundant and is dropped.
 *
 * Deliberately absent, so they are left untouched:
 *   - `selectRemote`/`selectWorkspace`/`selectExecutor`/`selectAgent(s)` — moved
 *     to `@bakers-build/conductor/contract`, but they are config-shape SELECTORS, not
 *     plugin factories, so no descriptor can legitimately name them;
 *   - any other/unknown export name — a config naming one is reported by the
 *     loader rather than silently retargeted at a package that may not have it.
 */
export const CORE_PLUGINS_BARREL_EXPORTS: Readonly<
  Record<string, { target: string; defaultExport: boolean }>
> = {
  DrupalBbRemote: { target: REMOTE_DRUPAL, defaultExport: false },
  FakeBbRemote: { target: FAKE, defaultExport: false },
  FakeWorkspace: { target: FAKE, defaultExport: false },
  GitWorkspace: { target: WORKSPACE_GIT, defaultExport: false },
  basicAuthProvider: { target: AUTH_BASIC, defaultExport: true },
  drupalRemote: { target: REMOTE_DRUPAL, defaultExport: true },
  // @bakers-build/addon-fake ships the whole deterministic triple as NAMED exports
  // (no default), so these keep their `export:`.
  fakeRemote: { target: FAKE, defaultExport: false },
  fakeWorkspace: { target: FAKE, defaultExport: false },
  gitWorkspace: { target: WORKSPACE_GIT, defaultExport: true },
};

/**
 * The host-barrel specifiers a descriptor may name. Both map through
 * `CORE_PLUGINS_BARREL_EXPORTS`: `@bakers-build/core/plugins` is DELETED, and
 * `@bakers-build/bakers/plugins` (BB-230) is unresolvable from a dev-clone install
 * because the meta package that exports it is the workspace's leaf sink.
 */
export const HOST_BARREL_PATHS = [
  '@bakers-build/core/plugins',
  '@bakers-build/bakers/plugins',
] as const;

/** Which surface a config file speaks — decides the ambiguous builtins mapping. */
export type ConfigSurface = 'connection' | 'engine';

/**
 * The object-literal entry that encloses `at`, e.g.
 * `{ use: '@bakers-build/core/builtins', with: { basic: token } }`. Empty string when
 * the occurrence is a BARE string entry (`addons: ['@bakers-build/core/builtins']`) —
 * the backward scan then hits the array/argument boundary first.
 */
function enclosingEntry(text: string, at: number): string {
  let depth = 0;
  let start = -1;
  for (let i = at; i >= 0; i--) {
    const c = text[i];
    if (c === '}') depth++;
    else if (c === '{') {
      if (depth === 0) {
        start = i;
        break;
      }
      depth--;
    } else if (depth === 0 && (c === '[' || c === '(' || c === ';')) {
      break;
    }
  }
  if (start < 0) return '';
  let d = 0;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (c === '{') d++;
    else if (c === '}') {
      d--;
      if (d === 0) return text.slice(start, i + 1);
    }
  }
  return text.slice(start);
}

/** The nearest `plugins:` / `addons:` array key BEFORE `at`, if any. */
function nearestArrayKey(text: string, at: number): string | undefined {
  const re = /\b(plugins|addons)\s*:/g;
  let last: string | undefined;
  for (let m = re.exec(text); m !== null && m.index < at; m = re.exec(text)) {
    last = m[1];
  }
  return last;
}

/**
 * `@bakers-build/core/builtins` was ONE preset contributing to BOTH surfaces, so its
 * replacement is per-occurrence (spec v3 decision 17, the Finding 6/8 interplay):
 *
 *   | signal (first that applies)                  | target                      |
 *   | the entry carries a `basic` token            | `@bakers-build/addon-auth-basic`  |
 *   | the nearest array key is `plugins:`          | `@bakers-build/addon-auth-basic`  |
 *   | the file is a connection config              | `@bakers-build/addon-auth-basic`  |
 *   | otherwise (engine `addons:` / a slot)        | `@bakers-build/addon-remote-drupal` |
 *
 * The `plugins:` rule is what makes a LEGACY `conductor.config.js` (engine file
 * name, but still carrying a connection `site`/`plugins`) come out right.
 */
function builtinsTargetFor(
  text: string,
  at: number,
  surface: ConfigSurface,
): string {
  if (/basic/i.test(enclosingEntry(text, at))) return AUTH_BASIC;
  if (nearestArrayKey(text, at) === 'plugins') return AUTH_BASIC;
  return surface === 'connection' ? AUTH_BASIC : REMOTE_DRUPAL;
}

/**
 * Rewrite the legacy specifiers in one config's SOURCE TEXT — all of them: the
 * renamed `@bakers-build/plugin-*` packages, the deleted `@bakers-build/core/builtins`
 * preset, and the host-barrel descriptors naming either `@bakers-build/core/plugins`
 * (deleted) or `@bakers-build/bakers/plugins` (BB-230). Pure; line
 * count is preserved (every replacement is line-local), which is what lets the
 * reported diff be a plain index-aligned line diff.
 */
export function migrateAddonNames(
  text: string,
  surface: ConfigSurface,
): { text: string; count: number } {
  const source = inspectConfigSource(text);
  if (source.syntax !== 'valid') return { text, count: 0 };
  const e = new ConfigSourceEditor(text);
  let count = 0;
  const keys = [...source.properties.keys()].filter((key) =>
    /(?:\.plugin|\.use|^plugins\[\d+\]$|^addons\[\d+\]$)$/.test(key),
  );
  for (const key of keys) {
    const p = e.property(key);
    if (!p?.staticallyDetermined || typeof p.value !== 'string') continue;
    let value = e.expression(key) as string;
    value = value.replace(
      QUOTED_LEGACY_ADDON,
      (_match, quote: string, name: string, subpath: string) =>
        `${quote}@bakers-build/addon-${name}${subpath}${quote}`,
    );
    value = value.replace(
      QUOTED_LEGACY_BUILTINS,
      (_match, quote: string) =>
        `${quote}${builtinsTargetFor(e.text, p.valueStart, surface)}${quote}`,
    );
    if (
      HOST_BARREL_PATHS.includes(p.value as (typeof HOST_BARREL_PATHS)[number])
    ) {
      const parent = key.replace(/\.(plugin|use)$/, '');
      const name = e.property(`${parent}.export`);
      const target =
        typeof name?.value === 'string'
          ? CORE_PLUGINS_BARREL_EXPORTS[name.value]
          : undefined;
      if (target) {
        value = `${value[0]}${target.target}${value[0]}`;
        if (target.defaultExport && !e.expression(parent)?.includes('\n'))
          e.remove(`${parent}.export`);
      }
    }
    if (value !== e.expression(key)) {
      e.set(key, value);
      count++;
    }
  }
  for (const span of [...e.source.moduleSpecifiers].reverse()) {
    const before = e.text.slice(span.start, span.end);
    const after = before.replace(
      QUOTED_LEGACY_ADDON,
      (_match, quote: string, name: string, subpath: string) =>
        `${quote}@bakers-build/addon-${name}${subpath}${quote}`,
    );
    if (before !== after) {
      e.replace(span.start, span.end, after);
      count++;
    }
  }
  return { text: e.text, count };
}

/** An index-aligned `- old` / `+ new` line diff (line count is preserved). */
function lineDiff(before: string, after: string): string[] {
  const a = before.split('\n');
  const b = after.split('\n');
  const out: string[] = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] === b[i]) continue;
    if (a[i] !== undefined) out.push(`  - ${a[i]}`);
    if (b[i] !== undefined) out.push(`  + ${b[i]}`);
  }
  return out;
}

/** The outcome of the rename pass over a single config file. */
export interface AddonRenameResult {
  /** Report line, in the shape of the other upgrade steps. */
  action: string;
  /** `- old` / `+ new` lines for the rewritten specifiers. */
  diff: string[];
  /** Number of rewritten specifiers. */
  count: number;
}

/**
 * Rename pass over ONE config file. Returns `undefined` when the file is absent
 * or already on the new names (idempotency: no write, no backup, no report
 * line — the file stays byte-identical).
 */
export function migrateAddonNamesInFile(
  path: string,
  surface: ConfigSurface,
  opts: { dryRun?: boolean } = {},
): AddonRenameResult | undefined {
  if (!existsSync(path)) return undefined;
  const before = readFileSync(path, 'utf8');
  const { text: after, count } = migrateAddonNames(before, surface);
  if (count === 0 || after === before) return undefined;

  const diff = lineDiff(before, after);
  const what = `${count} legacy addon reference(s) → @bakers-build/addon-*`;
  if (opts.dryRun ?? false) {
    return { action: `would rewrite ${path} (${what})`, diff, count };
  }
  const bak = `${path}${ADDON_RENAME_BAK_SUFFIX}`;
  writeFileSync(bak, before, 'utf8');
  writeFileSync(path, after, 'utf8');
  return {
    action: `rewrote ${path} (${what}; backup ${bak})`,
    diff,
    count,
  };
}

/**
 * Rename pass over every recognised config in the given `.bakers/` dirs (project
 * + home). Emits report lines ONLY for files it actually rewrites, so an install
 * already on `addon-*` adds no noise to the upgrade report.
 */
export function runAddonRenameMigration(
  opts: { bakersDirs: string[]; dryRun?: boolean } = { bakersDirs: [] },
): { actions: string[]; changed: boolean } {
  const actions: string[] = [];
  let changed = false;
  const seen = new Set<string>();
  for (const dir of opts.bakersDirs) {
    if (seen.has(dir) || !existsSync(dir)) continue;
    seen.add(dir);
    const files: [string, ConfigSurface][] = [
      [join(dir, 'bakers.config.js'), 'connection'],
      ...listConductorConfigFiles(dir).map(
        (f) => [join(dir, f), 'engine'] as [string, ConfigSurface],
      ),
    ];
    for (const [path, surface] of files) {
      const res = migrateAddonNamesInFile(path, surface, {
        dryRun: opts.dryRun ?? false,
      });
      if (res === undefined) continue;
      actions.push(res.action, ...res.diff);
      changed = true;
    }
  }
  return { actions, changed };
}
