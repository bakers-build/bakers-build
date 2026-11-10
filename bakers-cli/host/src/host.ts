import { pathToFileURL } from 'node:url';
import { commands as agentsCommands } from '@bakers-build/addon-agents/preset';
import { commands as deploymentCommands } from '@bakers-build/addon-deployment/preset';
import { commands as dropshCommands } from '@bakers-build/addon-dropsh/preset';
import { commands as infoCommands } from '@bakers-build/addon-info/preset';
import { commands as portsCommands } from '@bakers-build/addon-ports/preset';
import { commands as trackCommands } from '@bakers-build/addon-track/preset';
import { commands as conductorCommands } from '@bakers-build/conductor/preset';
import {
  type BbCommandHost,
  type BbCommandPlugin,
  type CommandDescriptor,
  resolveCliVersion,
  resolveConfigPath,
  resolveModuleEslintStyle,
  retiredEnvErrors,
} from '@bakers-build/core';
import { commands as uiCommands } from '@bakers-build/ui/preset';
import { Command } from 'commander';
import { registerConfig } from './config.js';
import { registerUpdate } from './update.js';

// BB-201: the `bakers` plugin HOST. The meta package `@bakers-build/bakers` owns the
// CLI entrypoint (AC-1); ui / conductor / dropsh / deployment are declared,
// ESLint-style resolved, LAZILY mounted command plugins (AC-2). The host
// discovers + mounts; it hard-wires nothing. Only the invoked subcommand's module
// is imported — `bakers --help` lists all four via describe-only stubs and imports
// none; `bakers conductor …` imports only the conductor module.
//
// BB-215: the registry is DERIVED from the command surface — the command
// addons' preset `commands` accumulators — rather than a hand-written list.
// Those presets are LIGHT (they import no runtime, only return descriptors), so
// composing them at boot keeps `bakers --help` import-light. `$BAKERS_COMMANDS`
// still overrides the whole registry. BB-224 (Finding 7) added the fourth
// command surface, `@bakers-build/addon-deployment` (`bakers deployment …`), which the
// `conductor` command plugin used to register as a side effect.

/** Compose the built-in command registry from the command addons' presets. The
 *  accumulators are synchronous descriptor builders (light presets), threaded in
 *  the conductor → ui → dropsh → deployment order. */
function composeCommandSurface(): CommandDescriptor[] {
  const accumulators = [
    conductorCommands,
    uiCommands,
    dropshCommands,
    deploymentCommands,
    agentsCommands,
    infoCommands,
    portsCommands,
    trackCommands,
  ];
  let acc: CommandDescriptor[] = [];
  for (const fn of accumulators) {
    if (typeof fn === 'function')
      acc = fn(acc, undefined) as CommandDescriptor[];
  }
  return acc;
}

/** The built-in command registry. `$BAKERS_COMMANDS` (JSON array of descriptors)
 *  overrides it wholesale. */
export const DEFAULT_COMMANDS: CommandDescriptor[] = composeCommandSurface();

/** Resolve the registry: `$BAKERS_COMMANDS` override else the built-in set. */
export function resolveCommands(): CommandDescriptor[] {
  const override = process.env.BAKERS_COMMANDS;
  if (override && override.trim() !== '') {
    const parsed = JSON.parse(override) as CommandDescriptor[];
    if (!Array.isArray(parsed)) {
      throw new Error(
        '$BAKERS_COMMANDS must be a JSON array of command descriptors',
      );
    }
    return parsed;
  }
  return DEFAULT_COMMANDS;
}

export { resolveCliVersion } from '@bakers-build/core';

/** Host bases for ESLint-style sibling resolution: the meta install → cwd. */
export function hostBases(): string[] {
  return [import.meta.url, pathToFileURL(`${process.cwd()}/`).href];
}

/** Load a command descriptor's `BbCommandPlugin` (default export, or the named
 *  `export`), resolving the module over the host bases. */
async function loadCommandPlugin(
  entry: CommandDescriptor,
  bases: string[],
): Promise<BbCommandPlugin> {
  const resolved = resolveModuleEslintStyle(entry.plugin, bases);
  if (resolved === undefined) {
    throw new Error(
      `bakers: cannot resolve command plugin '${entry.plugin}' (command '${entry.name}')`,
    );
  }
  const mod = (await import(pathToFileURL(resolved).href)) as Record<
    string,
    unknown
  >;
  const factory = entry.export ? mod[entry.export] : mod.default;
  if (factory === undefined || factory === null) {
    throw new Error(
      `bakers: command plugin '${entry.plugin}' has no ${entry.export ?? 'default'} export`,
    );
  }
  return factory as BbCommandPlugin;
}

/**
 * Value-aware argv pre-scan: find the first positional token that names a
 * registered command. Skips the host's value-taking global (`--conductor <v>`)
 * and maps `help <name>` → `<name>`. Returns undefined for `--help`, an unknown
 * first positional, or a bare invocation.
 */
export function scanTarget(
  argv: string[],
  names: string[],
): string | undefined {
  const index = firstPositionalIndex(argv);
  const name = argv[index] === 'help' ? argv[index + 1] : argv[index];
  return name !== undefined && names.includes(name) ? name : undefined;
}

function firstPositionalIndex(argv: string[]): number {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string;
    if (a === '--conductor') {
      i++; // skip its value
      continue;
    }
    if (a.startsWith('-')) continue; // any other flag
    return i;
  }
  return -1;
}

/** Add a describe-only stub for a not-loaded command so `--help` stays complete.
 *  If it is ever dispatched (a mis-scan), its action self-loads the real plugin
 *  and re-runs the host forcing that target. */
function addStub(
  program: Command,
  entry: CommandDescriptor,
  bases: string[],
  argv: string[],
): void {
  program
    .command(entry.name, { hidden: entry.hidden ?? false })
    .description(pluginDescribe(entry))
    .allowUnknownOption(true)
    .allowExcessArguments(true)
    .helpOption(false)
    .action(async () => {
      await runHost(argv, { forceTarget: entry.name, bases });
    });
}

/** Best-effort describe text for a stub without importing the plugin. BB-215:
 *  the descriptor now carries its own `describe` (from the addon's preset); this
 *  falls back only for a `$BAKERS_COMMANDS` entry that omits it. */
function pluginDescribe(entry: CommandDescriptor): string {
  if (typeof entry.describe === 'string' && entry.describe.trim() !== '') {
    return entry.describe;
  }
  switch (entry.name) {
    case 'conductor':
      return 'conductor lifecycle + local registry';
    case 'ui':
      return 'interactive terminal UI: dashboard, projects, tickets';
    case 'dropsh':
      return 'JSON:API shell (dropsh) bound to the bakers.build connection config';
    case 'deployment':
      return 'release / deployment helpers';
    default:
      return `${entry.name} command`;
  }
}

/** Build the top-level host program, mounting only the target command (the rest
 *  are describe-only stubs). */
export async function buildHostProgram(
  argv: string[],
  opts: { forceTarget?: string; bases?: string[] } = {},
): Promise<Command> {
  const bases = opts.bases ?? hostBases();
  const commands = resolveCommands();
  const names = commands.map((c) => c.name);
  const target = opts.forceTarget ?? scanTarget(argv, names);
  const projectContext =
    target === 'ui'
      ? await import('@bakers-build/conductor/project-context')
      : undefined;
  const host: BbCommandHost = {
    resolveBases: bases,
    workspacePlugin: async (workspaceId) => {
      const { workspacePlugin } = await import('@bakers-build/addon-workspace');
      return workspacePlugin({ workspace_id: workspaceId });
    },
    ...(projectContext
      ? {
          projectContext: {
            resolveConfigPath: (cwd: string) =>
              resolveConfigPath(undefined, cwd),
            readWorkspace: (configPath: string) =>
              projectContext.readBbProjectSelection(configPath).workspace,
            resolveContext: async (
              configPath: string,
              connection: import('@bakers-build/core').BbConnectionConfig,
            ) => {
              const { createBbConnectionClient } = await import(
                '@bakers-build/core'
              );
              const { resolveBbProjectContext } = await import(
                '@bakers-build/conductor/contract'
              );
              const selection =
                projectContext.readBbProjectSelection(configPath);
              return resolveBbProjectContext(
                await createBbConnectionClient(connection),
                selection,
              );
            },
            writeWorkspace: async (configPath: string, name: string) => {
              await projectContext.writeBbWorkspaceSelection(
                projectContext.bakersProjectOwner(configPath),
                name,
                `Set project.workspace in ${configPath} to switch manually.`,
              );
            },
          },
        }
      : {}),
  };

  const program = new Command();
  // exitOverride so commander surfaces help/version/unknown-command as thrown
  // CommanderErrors (mapped in runHost) instead of calling process.exit —
  // otherwise an unknown command would kill the host process directly.
  program.exitOverride();
  program
    .name('bakers')
    .description('bakers.build conductor + client CLI')
    .option(
      '--conductor <name>',
      'select a conductor variant (default → project.config.js, else project.<name>.config.js; env $BAKERS_CONDUCTOR)',
    );

  // The global --conductor flag threads into $BAKERS_CONDUCTOR (flag wins over env)
  // so every command selects the named engine config without per-command wiring.
  program.hook('preAction', () => {
    const name = program.opts().conductor as string | undefined;
    if (typeof name === 'string' && name !== '') {
      process.env.BAKERS_CONDUCTOR = name;
    }
  });

  const cliVersion = resolveCliVersion();
  program.version(cliVersion); // -V, --version
  program
    .command('version')
    .description('output the bakers CLI version')
    .action(() => {
      console.log(cliVersion);
    });

  registerConfig(program, { host });
  registerUpdate(program);

  for (const entry of commands) {
    if (entry.name === target) {
      const plugin = await loadCommandPlugin(entry, bases);
      await plugin.register(program, host);
    } else {
      addStub(program, entry, bases, argv);
    }
  }

  return program;
}

/** Parse argv against the host program, mapping commander's clean exits. */
export async function runHost(
  argv: string[],
  opts: { forceTarget?: string; bases?: string[] } = {},
): Promise<void> {
  // A hidden alias (`oven` for `conductor`) runs as its command: the argv
  // names the command, so help, dispatch and the plugin see one name.
  const index = firstPositionalIndex(argv);
  const at = argv[index] === 'help' ? index + 1 : index;
  const canonical = resolveCommands().find((c) =>
    c.aliases?.includes(argv[at] as string),
  );
  if (canonical)
    argv = [...argv.slice(0, at), canonical.name, ...argv.slice(at + 1)];
  // Forward help to plugins that render their own complete option list.
  if (
    argv[index] === 'help' &&
    resolveCommands().some((c) => c.forwardHelp && c.name === argv[index + 1])
  ) {
    argv = [...argv.slice(0, index), ...argv.slice(index + 1), '--help'];
  }
  const program = await buildHostProgram(argv, opts);
  try {
    await program.parseAsync(argv, { from: 'user' });
  } catch (err) {
    const e = err as { code?: string; message?: string };
    if (
      e.code === 'commander.helpDisplayed' ||
      e.code === 'commander.version'
    ) {
      return;
    }
    if (typeof e.code === 'string' && e.code.startsWith('commander.')) {
      if (!process.exitCode) process.exitCode = 1;
      return;
    }
    process.stderr.write(`${e.message ?? String(err)}\n`);
    if (!process.exitCode) process.exitCode = 1;
  }
}

/** The `bakers` entrypoint: drop node + script path, run the host. */
export async function main(argv: string[]): Promise<void> {
  const retired = retiredEnvErrors(process.env);
  if (retired.length > 0) {
    process.stderr.write(`${retired.join('\n')}\n`);
    process.exitCode = 1;
    return;
  }
  await runHost(argv.slice(2));
}
