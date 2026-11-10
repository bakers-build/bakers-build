import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

/** A repo's config files live in this dir, one conductor config per conductor. */
const BB_DIR = '.bakers';

/** The project file; its conductor variant is `conductor`, the conductor id's default. */
const DEFAULT_CONFIG = 'project.config.js';
/** Variant files are `project.<variant>.config.js`. */
const VARIANT = /^project\.(.+)\.config\.js$/;
/** A project's own connection file. */
const PROJECT_CONNECTION = 'connection.config.js';
/** The home default connection, beside the named ones. */
const DEFAULT_CONNECTION = join('connections', 'default.js');

/**
 * List the conductor variants in a `.bakers/` dir: `project.config.js` is the
 * default variant `conductor`, `project.<name>.config.js` is variant `<name>`.
 * Every other file (`vite.config.js`, `connection.config.js`) is ignored.
 */
function configStems(bakersDir: string): string[] {
  return readdirSync(bakersDir)
    .map(stemForConfigFile)
    .filter((s): s is string => s !== undefined)
    .sort();
}

/**
 * The conductor stem a config file name denotes, or `undefined` when the file
 * is not a conductor config at all.
 *
 * The inverse of {@link fileForStem}, exported because the naming rule has to
 * stay in one place: a conductor reporting which config it was started from
 * would otherwise slice the filename itself and quietly disagree with the
 * loader about the near-miss cases this rule exists to exclude
 * (`myconductor.config.js`, `vite.config.js`, `bakers.config.js`).
 *
 * Takes a bare file name, not a path — callers pass `basename(config_path)`.
 */
export function stemForConfigFile(fileName: string): string | undefined {
  if (fileName === DEFAULT_CONFIG) return 'conductor';
  const variant = VARIANT.exec(fileName)?.[1];
  return variant === 'conductor' ? undefined : variant;
}

/** Map a conductor stem back to its file name. */
function fileForStem(stem: string): string {
  return stem === 'conductor' ? DEFAULT_CONFIG : `project.${stem}.config.js`;
}

/**
 * The user-global `.bakers` dir. Core owns where the split-config files live,
 * so a consumer that must recognise the home dir (e.g. to exclude it from a
 * project walk-up, BB-219 AC-9) asks for it rather than joining it itself.
 *
 * This is the ONE place that decides where `.bakers` lives. `BAKERS_HOME` names
 * that directory itself — not a home containing one — so an isolated test, a
 * second identity on one machine, or a container can relocate it without
 * redirecting HOME. A relative value is resolved against the cwd, because the
 * value travels into generated config text where an ambiguous path is a bug.
 * An explicit `home` argument still wins: callers that already know whose home
 * they mean (a fixture, another user's layer) are not overridden by the
 * environment.
 */
export function homeBbDir(home?: string): string {
  if (home !== undefined) return join(home, BB_DIR);
  const override = process.env.BAKERS_HOME;
  return override ? resolve(override) : join(homedir(), BB_DIR);
}

/**
 * Walk from `cwd` root-ward (git/eslint style) to the nearest ancestor whose
 * `.bakers/` dir holds at least one conductor config; return that `.bakers/` dir, or
 * `undefined` if none is found up to the filesystem root.
 */
export function findBbDir(cwd: string): string | undefined {
  let dir = resolve(cwd);
  for (;;) {
    const bakersDir = join(dir, BB_DIR);
    if (existsSync(bakersDir) && configStems(bakersDir).length > 0) {
      return bakersDir;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      return undefined;
    }
    dir = parent;
  }
}

/**
 * Resolve the project config (`project.config.js`) path from `cwd`.
 *
 * 1. An explicit `--config` / `$BAKERS_CONDUCTOR_CONFIG` wins verbatim (no walk).
 * 2. Otherwise walk root-ward to the nearest `.bakers/` dir holding a conductor
 *    config — so any subdirectory of a project/worktree resolves the same dir.
 *    - A `--conductor <name>` / `$BAKERS_CONDUCTOR` selector resolves the stem's
 *      file (`conductor` → `project.config.js`, else `project.<name>.config.js`).
 *    - No selector: `project.config.js` present → the default; else exactly
 *      one config → use it (back-compat); else → error naming the stems.
 * 3. No `.bakers/` config anywhere up the tree → an `ENOENT` error naming
 *    `bakers config init --scope project`.
 */
export function resolveConfigPath(
  override?: string,
  cwd: string = process.cwd(),
  conductorName?: string,
): string {
  const explicit = override ?? process.env.BAKERS_CONDUCTOR_CONFIG;
  if (explicit) {
    return explicit;
  }
  const bakersDir = findBbDir(cwd);
  if (bakersDir === undefined) {
    // `ENOENT`, because that is what this is: the file the caller asked for
    // does not exist. A caller for whom the project layer is optional then
    // treats a failed walk and an absent file the same way, instead of
    // discriminating one Error's message from another's.
    //
    // The remedy names `config init --scope project`, never `bakers init`: the
    // latter writes machine and connection and deliberately leaves the project
    // layer alone, so recommending it sends the reader back to the command
    // they have already run.
    throw Object.assign(
      new Error(
        `no .bakers/project.config.js found from ${cwd} upward; ` +
          'run `bakers config init --scope project` in a project checkout',
      ),
      { code: 'ENOENT' },
    );
  }
  const stems = configStems(bakersDir);
  const name = conductorName ?? process.env.BAKERS_CONDUCTOR;
  if (name !== undefined && name !== '') {
    const candidate = join(bakersDir, fileForStem(name));
    if (!existsSync(candidate)) {
      throw new Error(
        `no conductor '${name}' in ${bakersDir}; available: ${stems.join(', ')}`,
      );
    }
    return candidate;
  }
  if (stems.includes('conductor')) {
    return join(bakersDir, DEFAULT_CONFIG);
  }
  if (stems.length === 1) {
    return join(bakersDir, fileForStem(stems[0] as string));
  }
  throw new Error(
    `${stems.length} conductors in ${bakersDir} (${stems.join(', ')}); ` +
      'select one with --conductor <name> or $BAKERS_CONDUCTOR',
  );
}

/**
 * Which leg of the connection precedence produced the resolved path. Purely
 * diagnostic (BB-219 D4): it lets a consumer report project-vs-home without
 * re-deriving the rule, which would be a second precedence implementation.
 */
export type BbConfigSource = 'explicit' | 'project' | 'home';

/** A current resolved connection with diagnostic source metadata. */
export interface BbConfigResolution {
  path: string;
  /** Current connections never use a credential fallback. */
  fallback: boolean;
  /** Current resolution never selects a historical engine connection. */
  legacy: boolean;
  /** Which leg produced `path` (BB-219 D4). */
  source: BbConfigSource;
}

/** Walk upward for current project connection files only. Legacy engine files
 * are migration input, never runtime connection sources. */
export function findBbConfig(
  cwd: string,
): { path: string; legacy: boolean } | undefined {
  let dir = resolve(cwd);
  for (;;) {
    const bakersDir = join(dir, BB_DIR);
    if (existsSync(bakersDir)) {
      const bakersCfg = join(bakersDir, PROJECT_CONNECTION);
      if (existsSync(bakersCfg)) return { path: bakersCfg, legacy: false };
    }
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/**
 * Walk root-ward for the nearest `.bakers/` dir that marks a **project** — one
 * holding any bakers config at all, a `connection.config.js` or at least one
 * project config. Returns that `.bakers/` dir, or `undefined` up to the filesystem root.
 *
 * Deliberately a different question from `findBbConfig` (BB-219 AC-9):
 * "which project am I standing in" is not "where does my connection come from".
 * Since BB-230 the connection walk-up skips an engine-only
 * `conductor.config.js`, and BB-218 makes exactly that the canonical repo
 * shape — so keying project detection on the connection would stop recognising
 * the most common project as a project. It is content-agnostic for the same
 * reason `findBbDir` is: a `.bakers/` dir is the marker.
 *
 * It is a superset of `findBbDir`, which requires a *conductor* config
 * because it resolves the engine config; a repo carrying only a project
 * connection override is a project here and not there.
 */
export function findProjectBbDir(cwd: string): string | undefined {
  let dir = resolve(cwd);
  for (;;) {
    const bakersDir = join(dir, BB_DIR);
    if (
      existsSync(bakersDir) &&
      (existsSync(join(bakersDir, PROJECT_CONNECTION)) ||
        configStems(bakersDir).length > 0)
    ) {
      return bakersDir;
    }
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/** Configuration management also recognizes an empty/partial .bakers directory.
 * Keep runtime engine and connection root resolution unchanged.
 */
export function findConfigProjectBbDir(
  cwd: string,
  home?: string,
): string | undefined {
  let dir = resolve(cwd);
  const globalDir = resolve(homeBbDir(home));
  for (;;) {
    const bakersDir = join(dir, BB_DIR);
    if (bakersDir !== globalDir && existsSync(bakersDir)) return bakersDir;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/** Resolve explicit → project → global connection. An absent global still
 * names its canonical owner so callers can provide a precise init remedy. */
export function resolveBbConfigPath(
  opts: { cwd?: string; explicit?: string | undefined; home?: string } = {},
): BbConfigResolution {
  const homeCfg = join(homeBbDir(opts.home), DEFAULT_CONNECTION);

  const explicit = opts.explicit;
  if (explicit !== undefined && explicit.trim() !== '') {
    return {
      path: explicit,
      fallback: false,
      legacy: false,
      source: 'explicit',
    };
  }
  const cwd = opts.cwd ?? process.cwd();
  const project = findBbConfig(cwd);
  if (project !== undefined) {
    return {
      path: project.path,
      fallback: false,
      legacy: project.legacy,
      source: project.path === homeCfg ? 'home' : 'project',
    };
  }
  return { path: homeCfg, fallback: false, legacy: false, source: 'home' };
}
