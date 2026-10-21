import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  type ConfigSourceKind,
  type DropSHPlugin,
  resolveConfigSource,
  resolveConnectionsDir,
} from 'dropsh/plugin';
import { shellQuote } from '../core/shell.js';
import { discoverAddons } from '../plugins/discover-addons.js';
import type { AddonEntry } from '../plugins/preset.js';
import type { BbCommandHost } from './commands.js';
import { inspectConfigSource } from './config-source.js';
import {
  findConfigProjectBbDir,
  type BbConfigSource,
  homeBbDir,
  resolveBbConfigPath,
} from './bakers-dir.js';
import { importConfig } from './import-config.js';
import {
  machineUiConfigPath,
  projectConductorConfigPath,
  readUiEntryLayers,
} from './layered-ui-entries.js';
import { resolveModuleEslintStyle } from './resolve-module.js';

/**
 * A connection config that was RESOLVED but is not usable — a missing
 * `site.base_url`, or a `plugins` export that is not a list.
 *
 * It exists so a caller can tell "there is no config" from "the config is right
 * there and says something wrong". `bakers dropsh` otherwise reports every load
 * failure as `no connection config could be loaded`, which sends the reader
 * hunting for a file that was found and read. Matched by `name` rather than
 * `instanceof`, so a duplicated `@bakers-build/core` in a pnpm tree cannot break the
 * check.
 */
export class BbConnectionConfigError extends Error {
  override readonly name = 'BbConnectionConfigError';
}

/** The resolved control-plane connection: site + constructed auth plugins. */
export interface BbConnectionConfig {
  site: { base_url: string; jsonapi_prefix: string };
  plugins: DropSHPlugin[];
  /**
   * BB-351: the uuid of the `bb_workspace` this connection is focused on.
   * BB-495: optional. `bakers dropsh` needs none — the caller names the
   * workspace on each call; `bakers ui` still uses this value to focus its
   * picker and attach its own read-scoping plugin.
   */
  workspace_id: string | undefined;
  /** Absolute path of the loaded connection config. */
  config_path: string;
  /** Current connections never reconstruct credentials from machine context. */
  fallback: boolean;
  /** Which leg of the precedence produced `config_path` (BB-219 D4). */
  source: BbConfigSource;
  /** The selected named connection, or `default` for the global connection. */
  connection_id: string | undefined;
  /** Which user-facing selector chose the connection. */
  selection_source:
    | ConfigSourceKind
    | 'project-file'
    | 'default'
    | 'legacy-project';
  /** Current resolution never chooses a historical engine connection. */
  legacy: boolean;
  /**
   * BB-373: UI extension entry modules discovered from `addons[]`, as
   * RESOLVED `file://` URLs (see `resolveUiEntries` for why resolution happens
   * here rather than at the import).
   *
   * Nothing is imported — `bakers dropsh` loads this same connection and never
   * renders a TUI, so the cost of a UI contribution must not be paid until
   * `bakers ui`'s kernel actually boots (spec F2/D3).
   */
  ui_entries: string[];
}

export interface EffectiveConnectionField {
  key: string;
  value: string | number | boolean | null | unknown[] | Record<string, unknown>;
  source: string;
}

/** Report values from the evaluated config with static source locations where provable. */
export async function reportLoadedBbConfigFields(
  path: string,
): Promise<EffectiveConnectionField[]> {
  const raw = (await importConfig(path)).default;
  if (!isRecord(raw))
    throw new BbConnectionConfigError(
      `Connection ${path} must export an object.`,
    );
  const site = isRecord(raw.site) ? raw.site : {};
  const jsonapiPrefix =
    typeof site.jsonapi_prefix === 'string' && site.jsonapi_prefix.trim()
      ? site.jsonapi_prefix
      : '/jsonapi';
  const effective = {
    ...raw,
    site: { ...site, jsonapi_prefix: jsonapiPrefix },
  };
  const inspected = inspectConfigSource(readFileSync(path, 'utf8'));
  const fields: EffectiveConnectionField[] = [];
  const seen = new WeakSet<object>();
  const visit = (key: string, value: unknown, depth: number): void => {
    const secret =
      /secret|client_id|token|password|credential|authorization/i.test(key);
    const literal = inspected.properties.get(key);
    const source =
      key === 'site.jsonapi_prefix' &&
      jsonapiPrefix === '/jsonapi' &&
      (!literal || site.jsonapi_prefix === '' || site.jsonapi_prefix === null)
        ? 'built-in default'
        : literal?.staticallyDetermined &&
            (Object.is(literal.value, value) ||
              (Array.isArray(value) &&
                value.length === 0 &&
                literal.nodeType === 'ArrayExpression') ||
              (isRecord(value) &&
                Object.keys(value).length === 0 &&
                literal.nodeType === 'ObjectExpression'))
          ? path
          : 'dynamic/not statically determined';
    if (
      secret ||
      value === null ||
      typeof value !== 'object' ||
      depth >= 16 ||
      seen.has(value)
    ) {
      fields.push({
        key,
        value: secret
          ? '[REDACTED]'
          : typeof value === 'function' ||
              typeof value === 'symbol' ||
              typeof value === 'undefined'
            ? null
            : (value as EffectiveConnectionField['value']),
        source,
      });
      return;
    }
    seen.add(value);
    const entries = Object.entries(value);
    if (entries.length === 0) {
      fields.push({ key, value: Array.isArray(value) ? [] : {}, source });
      return;
    }
    for (const [name, child] of entries)
      visit(
        Array.isArray(value)
          ? `${key}[${name}]`
          : key
            ? `${key}.${name}`
            : name,
        child,
        depth + 1,
      );
  };
  for (const [key, value] of Object.entries(effective)) visit(key, value, 0);
  return fields;
}

export interface BbConnectionLoadOptions {
  cwd?: string;
  explicit?: string | undefined;
  connection?: string | undefined;
  env?: NodeJS.ProcessEnv;
  home?: string;
  /**
   * BB-472: `bakers ui --workspace <name|uuid>` — a one-shot override of the
   * configured `workspace_id` for THIS process only, never persisted. It
   * re-runs the SAME plugin construction (`resolvePlugins`/`withGlobals`) with
   * a different `globals.workspace_id`, so every plugin that reads the ambient
   * workspace from context (not just the returned field) sees the override.
   */
  workspaceIdOverride?: string;
}

export interface BbConnectionSelection {
  path: string;
  connectionId: string | undefined;
  selectionSource:
    | ConfigSourceKind
    | 'project-file'
    | 'default'
    | 'legacy-project';
  source: BbConfigSource;
  fallback: boolean;
  legacy: boolean;
}

function projectConnectionSelection(
  cwd: string,
  home: string | undefined,
): string | undefined {
  const bakersDir = findConfigProjectBbDir(cwd, home);
  if (!bakersDir) return undefined;
  const path = join(bakersDir, 'connection.config.local.js');
  if (!existsSync(path)) return undefined;
  const inspected = inspectConfigSource(readFileSync(path, 'utf8'));
  const topLevel = inspected.propertyOccurrences.filter(
    (property) => !property.key.includes('.') && !property.key.includes('['),
  );
  const unknown = topLevel.find((property) => property.key !== 'connection');
  if (unknown)
    throw new BbConnectionConfigError(
      `Unknown key '${unknown.key}' in ${path}; only 'connection' is allowed.`,
    );
  const connection = inspected.properties.get('connection');
  if (
    inspected.syntax !== 'valid' ||
    inspected.shape !== 'object' ||
    inspected.unknownKeys ||
    !connection?.staticallyDetermined ||
    typeof connection.value !== 'string' ||
    connection.value.trim() === ''
  )
    throw new BbConnectionConfigError(
      `${path} must default-export one literal string key: connection.`,
    );
  return connection.value.trim();
}

/** Resolve the connection source without importing or executing it. */
export async function resolveBbConnectionSelection(
  opts: BbConnectionLoadOptions = {},
): Promise<BbConnectionSelection> {
  const env = opts.env ?? process.env;
  const connectionsDir = resolveConnectionsDir({
    flag: join(homeBbDir(opts.home), 'connections'),
  });
  let projectConnection: string | undefined;
  let projectConnectionRead = false;
  const dropshEnv = {
    ...env,
    ...(env.BB_CONFIG ? { DROPSH_CONFIG: env.BB_CONFIG } : {}),
  };
  Object.defineProperty(dropshEnv, 'DROPSH_CONNECTION', {
    enumerable: true,
    get() {
      const environmentConnection =
        env.BB_CONNECTION || env.DROPSH_CONNECTION;
      if (environmentConnection) return environmentConnection;
      projectConnectionRead = true;
      projectConnection = projectConnectionSelection(
        opts.cwd ?? process.cwd(),
        opts.home,
      );
      return projectConnection;
    },
  });
  const defaultResolution = resolveBbConfigPath({
    ...(opts.cwd !== undefined ? { cwd: opts.cwd } : {}),
    explicit: undefined,
    ...(opts.home ? { home: opts.home } : {}),
  });
  const selected = resolveConfigSource({
    config: opts.explicit,
    connection: opts.connection,
    defaultConfig: defaultResolution.path,
    connectionsDir,
    env: dropshEnv,
    ...(opts.cwd !== undefined ? { cwd: opts.cwd } : {}),
  });
  let selectionSource: BbConnectionSelection['selectionSource'] =
    selected.source === 'env-connection' &&
    projectConnectionRead &&
    projectConnection !== undefined
      ? 'project-file'
      : selected.source;
  const usesDefaultConfig =
    selected.source === 'cwd' || selected.source === 'default-config';
  const resolution = usesDefaultConfig
    ? defaultResolution
    : {
        ...selected,
        fallback: false,
        legacy: false,
        source: 'explicit' as const,
      };
  if (usesDefaultConfig)
    selectionSource =
      resolution.source === 'home' ? 'default' : 'legacy-project';
  return {
    path: resolve(resolution.path),
    connectionId:
      usesDefaultConfig && resolution.source === 'home'
        ? 'default'
        : selected.id,
    selectionSource,
    source: resolution.source,
    fallback: resolution.fallback,
    legacy: resolution.legacy,
  };
}
/**
 * BB-495: `workspace_id` is no longer required, so loading a connection has
 * one shape now — this is kept as the public entry point, and
 * `loadBbConnectionBootstrap` is its (identical) implementation, still
 * exported for callers (`bakers ui`'s picker, `discoverBbWorkspaces`) that
 * want the same load ahead of a workspace being known.
 */
export async function loadBbConfig(
  host: BbCommandHost,
  opts: BbConnectionLoadOptions = {},
): Promise<BbConnectionConfig> {
  return loadBbConnectionBootstrap(host, opts);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPluginDescriptor(
  entry: unknown,
): entry is Record<string, unknown> & { plugin: string } {
  return isRecord(entry) && typeof entry.plugin === 'string';
}

/**
 * The connection config's top-level values, handed to every contribution as its
 * base options (BB-351). An addon entry's own `with`/`options` is merged over
 * them, so an explicit per-entry value always wins.
 *
 * This exists because the ambient workspace is NOT configured per addon: the
 * filler is a child of `@bakers-build/addon-essentials`, which no config passes
 * options to, so the uuid has to travel as a global rather than as a `with`.
 */
export interface BbConnectionGlobals {
  workspace_id: string;
}

/** Merge the config globals under an entry's own options; the entry wins. */
function withGlobals(
  globals: BbConnectionGlobals,
  own: unknown,
): Record<string, unknown> {
  return isRecord(own) ? { ...globals, ...own } : { ...globals };
}

/**
 * Construct a `{ plugin, export?, with?/options? }` descriptor. Resolution base
 * order: the config's own dir first (so a project config can name a locally
 * installed plugin), then the host's `resolveBases` (host install → cwd) for
 * pnpm-safe resolution of installed `@dropsh/plugin-*`.
 */
async function loadDescriptor(
  entry: Record<string, unknown> & { plugin: string },
  bases: string[],
  globals: BbConnectionGlobals,
): Promise<unknown> {
  const resolved = resolveModuleEslintStyle(entry.plugin, bases);
  if (resolved === undefined) {
    throw new Error(`bakers.config.js cannot resolve plugin '${entry.plugin}'`);
  }
  const mod = (await import(pathToFileURL(resolved).href)) as Record<
    string,
    unknown
  >;
  let factory: unknown;
  if (typeof entry.export === 'string') {
    factory = mod[entry.export];
    if (typeof factory !== 'function') {
      throw new Error(
        `plugin '${entry.plugin}' has no callable export '${entry.export}'`,
      );
    }
  } else if (typeof mod.default === 'function') {
    factory = mod.default;
  } else {
    const fns = Object.keys(mod).filter((k) => typeof mod[k] === 'function');
    if (fns.length === 1) {
      factory = mod[fns[0] as string];
    } else {
      throw new Error(
        `plugin '${entry.plugin}' has no default export and ${fns.length} function exports (${fns.join(', ')}); specify "export"`,
      );
    }
  }
  return (factory as (options?: unknown) => unknown)(
    withGlobals(globals, entry.with ?? entry.options),
  );
}

/** Resolve the `plugins[]` array: descriptors constructed, constructed entries
 *  passed through; a factory returning an array is flattened one level (dropsh
 *  `composePlugins` semantics), mirroring the engine loader. */
async function resolvePlugins(
  raw: unknown,
  bases: string[],
  globals: BbConnectionGlobals,
): Promise<DropSHPlugin[]> {
  if (!Array.isArray(raw)) return [];
  const resolved = await Promise.all(
    raw.map((entry) =>
      isPluginDescriptor(entry) ? loadDescriptor(entry, bases, globals) : entry,
    ),
  );
  return resolved.flat() as DropSHPlugin[];
}

/** Load site and plugins without requiring the workspace needed by normal dispatch. */
export async function loadBbConnectionBootstrap(
  host: BbCommandHost,
  opts: BbConnectionLoadOptions = {},
): Promise<BbConnectionConfig> {
  const resolution = await resolveBbConnectionSelection(opts);
  const configPath = resolution.path;

  if (!existsSync(configPath))
    throw new BbConnectionConfigError(
      `No connection config at ${configPath}; run bakers config init --scope connection --config ${shellQuote(configPath)}.`,
    );
  let module: { default?: unknown };
  try {
    module = await importConfig(configPath);
  } catch (error) {
    const cause = error instanceof Error ? error.message : String(error);
    throw new BbConnectionConfigError(
      `Could not import connection ${configPath}; check its syntax and imported files with bakers config check --scope connection --config ${shellQuote(configPath)}. Cause: ${cause}`,
      { cause: error },
    );
  }
  const raw = module.default;
  if (!isRecord(raw)) {
    throw new Error(
      `bakers connection config default export must be an object (${configPath})`,
    );
  }

  const site = isRecord(raw.site) ? raw.site : {};
  const baseUrl = typeof site.base_url === 'string' ? site.base_url : '';
  if (baseUrl.trim() === '') {
    // BB-218 (AC-9): a legible failure that names the resolved connection path
    // and the file that was expected to supply `site.base_url`, so a mis-resolved
    // or empty connection is diagnosable — never a downstream plugin error (auth
    // no longer lives in the engine config, so no plugin resolution runs here).
    const expected =
      'set site.base_url in the selected connection; run bakers config check --scope connection';
    throw new BbConnectionConfigError(
      `bakers connection config requires site.base_url — resolved ${configPath}; ${expected}`,
    );
  }
  const jsonapiPrefix =
    typeof site.jsonapi_prefix === 'string' && site.jsonapi_prefix.trim() !== ''
      ? site.jsonapi_prefix
      : '/jsonapi';

  const fileWorkspaceId =
    typeof raw.workspace_id === 'string' ? raw.workspace_id.trim() : '';
  const workspaceId =
    opts.workspaceIdOverride === undefined
      ? fileWorkspaceId
      : opts.workspaceIdOverride.trim();
  const globals: BbConnectionGlobals = { workspace_id: workspaceId };

  // Config dir first, then the host installation bases.
  const bases = [
    pathToFileURL(`${dirname(configPath)}/`).href,
    ...host.resolveBases,
  ];
  // BB-215: the connection surface has TWO input forms that both still load —
  // the legacy `plugins:[]` descriptor array AND the Storybook-style `addons:[]`
  // discovered via the shared engine (connection surface = the auth/renderer
  // plugins). Concatenate legacy first, then discovered.
  const legacy = await resolvePlugins(raw.plugins, bases, globals);
  const discovered = Array.isArray(raw.addons)
    ? await discoverAddons(raw.addons as AddonEntry[], 'connection', bases, {
        globals,
      })
    : undefined;
  const plugins = discovered
    ? [...legacy, ...discovered.connectionPlugins]
    : legacy;

  // BB-562: `ui_entries` is layered — machine, then connection, then project.
  // Broadest scope first, so a machine-wide tab keeps a stable leftmost position
  // and project-specific tabs append to its right; a reader predicts the tab
  // order from the file layout without running anything.
  const warn = (message: string) => {
    console.warn(message);
  };
  // The `.bakers` root is core's decision (BB_HOME), not this function's: an
  // absent `opts.home` must reach `homeBbDir()`'s resolver rather than
  // collapsing to the OS home here first, or BB_HOME never relocates
  // `machine.config.js` for this layer.
  const machineBbDir = homeBbDir(opts.home);
  // The project root is the SELECTED connection config's own directory only
  // when that config actually sits in A PROJECT's `.bakers/` dir — `configPath`
  // is `<project root>/.bakers/<file>` — whether resolved by walk-up or given
  // explicitly. The home connection (`<home>/.bakers/bakers.config.js`, BB-218's
  // canonical engine-only shape) and a named connection
  // (`<home>/.bakers/connections/<id>.js`) both fail that test — the first
  // because its `.bakers/` dir IS the home one, the second because its parent
  // dir is `connections`, not `.bakers` — so both fall back to the caller's
  // working directory, same as before this layer existed.
  const cwd = opts.cwd ?? process.cwd();
  const configBbDir = resolve(dirname(configPath));
  const cameFromProject =
    basename(configBbDir) === '.bakers' && configBbDir !== machineBbDir;
  const projectRootHint = cameFromProject ? dirname(configBbDir) : cwd;
  const projectPath = projectConductorConfigPath(projectRootHint, opts.home);
  // One effective list over both files: an addon in a scope it does not
  // declare renders nowhere, and one listed in both renders from the machine.
  const { machine: machineLayer, project: projectLayer } =
    await readUiEntryLayers({
      machine: {
        path: machineUiConfigPath(opts.home),
        bases: [pathToFileURL(`${machineBbDir}/`).href, ...host.resolveBases],
      },
      ...(projectPath
        ? {
            project: {
              path: projectPath,
              bases: [
                pathToFileURL(`${dirname(projectPath)}/`).href,
                pathToFileURL(`${cwd}/`).href,
                ...host.resolveBases,
              ],
            },
          }
        : {}),
    });

  // Dedup on the RESOLVED module, not the specifier: the same package named in
  // two layers is one tab, while two different installs of one package name are
  // honestly two. First occurrence wins and keeps its position.
  const seen = new Set<string>();
  const uiEntries = [
    ...resolveUiEntries(machineLayer.entries, machineLayer.bases, {
      strict: false,
      source: machineLayer.path,
      warn,
    }),
    ...(discovered
      ? resolveUiEntries(discovered.uiEntries, bases, {
          strict: true,
          source: configPath,
          warn,
        })
      : []),
    ...(projectLayer
      ? resolveUiEntries(projectLayer.entries, projectLayer.bases, {
          strict: false,
          source: projectLayer.path,
          warn,
        })
      : []),
  ].filter((url) => {
    if (seen.has(url)) return false;
    seen.add(url);
    return true;
  });

  return {
    site: { base_url: baseUrl, jsonapi_prefix: jsonapiPrefix },
    plugins,
    workspace_id: workspaceId || undefined,
    config_path: configPath,
    fallback: resolution.fallback,
    source: resolution.source,
    connection_id: resolution.connectionId,
    selection_source: resolution.selectionSource,
    legacy: resolution.legacy,
    ui_entries: uiEntries,
  };
}

/**
 * Resolve one layer's UI entry specifiers to importable file URLs — BB-373,
 * layered in BB-562.
 *
 * Resolution belongs HERE, against the very bases that found the addon's
 * `./preset`, and not in the renderer that eventually imports them. A preset
 * names a package specifier (`@bakers-build/addon-x/ui`) because that is what its
 * author can honestly write; but the module that imports it is the TUI kernel,
 * inside `@bakers-build/addon-bakers-ui`, and a bare specifier there resolves against
 * THAT package's dependencies. A contribution addon is its SIBLING, never its
 * dependency — the layered DAG forbids the backwards edge — so the bare import
 * fails, and it fails at cockpit boot rather than at config load.
 *
 * Still NOTHING IS IMPORTED here (F2): a resolve is a path lookup, and the
 * megabytes behind the specifier stay unloaded until a TUI actually boots.
 *
 * `strict` decides what an unresolvable entry costs. The CONNECTION layer keeps
 * throwing: dropsh auth plugins hang off the same `addons[]`, and a silently
 * missing auth plugin becomes a 401 several frames later instead of a named
 * failure. The machine and project layers warn and skip — they are an optional
 * extra, and a host that lacks one addon must still be able to run `bakers dropsh`.
 */
function resolveUiEntries(
  entries: string[],
  bases: string[],
  opts: { strict: boolean; source: string; warn: (m: string) => void },
): string[] {
  const out: string[] = [];
  for (const entry of entries) {
    const resolved = resolveModuleEslintStyle(entry, bases);
    if (resolved === undefined) {
      const message =
        `addons[] in ${opts.source}: UI entry '${entry}' does not resolve — ` +
        'the addon that contributes it must be installed where that config can see it';
      if (opts.strict) throw new Error(message);
      opts.warn(`${message}; the entry is skipped.`);
      continue;
    }
    out.push(pathToFileURL(resolved).href);
  }
  return out;
}
