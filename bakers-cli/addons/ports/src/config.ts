// BB-681 Task 2 — resolve the machine's configured ports transport package
// by name, reusing the engine's own ESLint-style module resolver
// (`resolveModuleEslintStyle`, hoisted from the conductor's plugin loader)
// rather than inventing a second one.

import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import {
  machineUiConfigPath,
  projectConductorConfigPath,
  readConfigAddons,
  readEffectiveAddon,
  readMachineContext,
  resolveModuleEslintStyle,
} from '@bakers-build/core';
import type { Claimer } from './claims.js';
import { duplicateServiceKey } from './service-config.js';
import {
  assertPortsTransport,
  InvalidTransportModuleError,
  type PortsTransport,
  type PortsTransportFactory,
} from './transport.js';

/**
 * Resolution bases rooted at the running `bakers` HOST install, usable from
 * both the CLI (which gets a `BbCommandHost`) and the conductor tools (which
 * does not: `oven start`/`once` dispatches tool calls from inside
 * the SAME long-running `bakers` process, never a subprocess). The three
 * built-in transport packages are declared only on `bakers-cli/host/package.json`
 * (never on `@bakers-build/addon-ports`, which would cycle back through
 * `addon-ports/transport` — see the spec's "no core dependency on provider
 * implementations"), so they resolve from the host's own `node_modules`, not
 * from wherever this file happens to be installed. `process.argv[1]` is the
 * entry script for every invocation shape (`bakers ports …` and the conductor
 * process alike); a test harness with no such argv falls back to this
 * module's own URL. The global install is a symlink
 * (`~/.nvm/.../bin/bakers` → `lib/node_modules/@bakers-build/bakers/bin/bakers`):
 * `createRequire`'s `node_modules` walk follows the real path, not the
 * symlink's directory, so the base must be realpath'd first (BB-681 review
 * C1). The repo's own dev/test-workspace launcher (`bakers-cli/bin/bakers`) is a
 * SEPARATE package from the host and imports `../host/dist/src/host.js`
 * directly, so `entry`'s own realpath'd directory has no `node_modules` with
 * the transport packages either — mirror that launcher's own relative import
 * as a second candidate (BB-681 review N6).
 */
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

/** The ports addon entry's `with`, transport-agnostic: `transport.use`
 *  names the package to load; `transport.with` is whatever settings that
 *  package's own factory understands. This loader validates only this
 *  generic shape — never a specific transport's own field names. */
export interface PortsMachineConfig {
  readonly transport: {
    readonly use: string;
    readonly with?: unknown;
  };
}

/** No ports addon entry (or one without a transport) in either scope. */
export const PORTS_NEEDS_ENTRY =
  "bakers ports needs '@bakers-build/addon-ports' in addons[] of ~/.bakers/machine.config.js or .bakers/project.config.js, with with.transport.use naming a transport package; see docs/addons/ports";

/** The retired top-level machine `ports` key. */
export const PORTS_RETIRED =
  "machine ports is retired: move it to addons: [{ use: '@bakers-build/addon-ports', with: { transport: … } }]";

/** Throw the remediation when the machine config still carries `ports`. */
export async function assertNoMachinePorts(): Promise<void> {
  const machine = await readMachineContext();
  if ((machine as { ports?: unknown }).ports !== undefined)
    throw new Error(PORTS_RETIRED);
}

const PORTS_SPEC = '@bakers-build/addon-ports';

/** `addons[@bakers-build/addon-ports].with.<key> <message>` for the rule the
 *  options schema cannot express (a duplicate service key). */
export function withProblems(value: unknown): string[] {
  const problem = duplicateServiceKey(value);
  return problem ? [`addons[${PORTS_SPEC}].with.${problem}`] : [];
}

/** Throw the first malformed ports `with` in the machine or project config,
 *  naming the file and key — a bad setting is never silently ignored. */
async function assertValidScopes(worktree: string): Promise<void> {
  const project = projectConductorConfigPath(worktree);
  for (const path of [machineUiConfigPath(), project]) {
    if (path === undefined) continue;
    for (const entry of await readConfigAddons(path)) {
      if (typeof entry === 'string' || entry?.use !== PORTS_SPEC) continue;
      const [problem] = withProblems(entry.with);
      if (problem) throw new Error(`${path}: ${problem}`);
    }
  }
}

/** `portsSettings` plus the retired machine `ports` check — the transport
 *  path; discovery (`list`) reads settings without it. */
export async function portsSettings(worktree: string): Promise<unknown> {
  await assertNoMachinePorts();
  return readPortsSettings(worktree);
}

/**
 * The effective `@bakers-build/addon-ports` entry's `with` for `worktree`, merged
 * by the preset's `mergeWith` (the machine wins). Undefined when neither
 * scope lists the addon. Throws for a malformed `with` in either scope.
 */
export async function readPortsSettings(worktree: string): Promise<unknown> {
  await assertValidScopes(worktree);
  const found = await readEffectiveAddon('@bakers-build/addon-ports', {
    cwd: worktree,
    bases: [...hostInstallBases(), import.meta.url],
  });
  if (found === undefined || typeof found.entry === 'string') return undefined;
  return found.entry.with;
}

/** `home`, the running `bakers` host install, then `process.cwd()` — see
 *  `loadPortsTransport`. */
function loadBases(home: string): string[] {
  return [
    pathToFileURL(`${home}/`).href,
    ...hostInstallBases(),
    pathToFileURL(`${process.cwd()}/`).href,
  ];
}

/**
 * Load the claimer packages the ports entry's `with.claimers` names, in
 * order, from the same bases as the transport. Each module exports its
 * `Claimer` as the named export `claimer`; an unresolvable package or a
 * module without one throws a safe diagnostic.
 */
export async function loadClaimers(
  settings: unknown,
  home: string,
): Promise<Claimer[]> {
  const names = (settings as { claimers?: unknown } | undefined)?.claimers;
  if (!Array.isArray(names)) return [];
  return Promise.all(
    names.map(async (spec: string) => {
      const resolved = resolveModuleEslintStyle(spec, loadBases(home));
      if (resolved === undefined)
        throw new Error(
          `bakers ports cannot resolve claimer package '${spec}'`,
        );
      const { claimer } = (await import(pathToFileURL(resolved).href)) as {
        claimer?: Partial<Claimer>;
      };
      if (
        typeof claimer?.discover !== 'function' ||
        typeof claimer.claim !== 'function'
      )
        throw new Error(
          `ports claimer '${spec}' has no \`claimer\` export with discover and claim`,
        );
      return claimer as Claimer;
    }),
  );
}

/**
 * Resolve, load and construct the configured ports transport from the ports
 * addon entry's `with` (`settings`).
 * Resolution bases, in order: `home` (a project-local transport package),
 * the running `bakers` host's own install (realpath'd, so the three built-in
 * provider packages resolve through a symlinked global install), then
 * `process.cwd()`.
 * Every failure — missing config, unresolvable package, no default export,
 * a factory that rejects its settings, or a malformed `PortsTransport`
 * result — throws a safe diagnostic, never a raw crash.
 */
export async function loadPortsTransport(
  settings: unknown,
  home: string,
): Promise<PortsTransport> {
  const ports = settings as PortsMachineConfig | undefined;
  if (
    !ports ||
    typeof ports !== 'object' ||
    typeof ports.transport !== 'object' ||
    ports.transport === null ||
    typeof ports.transport.use !== 'string' ||
    ports.transport.use === ''
  ) {
    throw new Error(PORTS_NEEDS_ENTRY);
  }
  const spec = ports.transport.use;
  // `resolveModuleEslintStyle`'s bases are node module PARENTS — a bare
  // directory path (no trailing slash) is otherwise treated by
  // `createRequire` as a FILE, which starts `node_modules` lookup one level
  // too high. Same `pathToFileURL(dir + '/')` shape `load-bakers-config.ts`
  // already uses for its own bases.
  const resolved = resolveModuleEslintStyle(spec, loadBases(home));
  if (resolved === undefined) {
    throw new Error(`bakers ports cannot resolve transport package '${spec}'`);
  }
  let mod: Record<string, unknown>;
  try {
    mod = (await import(pathToFileURL(resolved).href)) as Record<
      string,
      unknown
    >;
  } catch (err) {
    throw new InvalidTransportModuleError(
      spec,
      `failed to load: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const factory = mod.default;
  if (typeof factory !== 'function') {
    throw new InvalidTransportModuleError(
      spec,
      'module has no default export factory',
    );
  }
  let transport: unknown;
  try {
    transport = await (factory as PortsTransportFactory)(ports.transport.with, {
      home,
    });
  } catch (err) {
    if (err instanceof InvalidTransportModuleError) throw err;
    throw new Error(
      `ports transport '${spec}' rejected its settings: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  assertPortsTransport(transport, spec);
  return transport;
}
