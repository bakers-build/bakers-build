import {
  type BbCommandHost,
  type BbCommandPlugin,
  createBbConnectionContext,
  discoverBbWorkspaces,
  loadBbConnectionBootstrap,
  loadReadyBbConnection,
  type WorkspaceRecoveryOptions,
} from '@bakers-build/core';
import { toolPlugin } from '@dropsh/plugin-tool';
import { type Command, Help } from 'commander';
import { buildProgram as buildDropshProgram } from 'dropsh';
import { registerTemplateCommand } from './template.js';
import { hideUnpublishedComments } from './unpublished-comments.js';

export function dropshConfigHint(resolvedPath?: string): string {
  return `bakers dropsh: no connection config at ${resolvedPath ?? '~/.bakers/connections/default.js'}. Use --config <path> or run bakers config init --scope connection.`;
}
export interface DropshDispatchOptions extends WorkspaceRecoveryOptions {
  publicCommand?: 'tools' | 'auth';
  stdout?: (text: string) => void;
  stderr?: (text: string) => void;
}
/** Consume only wrapper flags; forward all actual dropsh arguments unchanged. */
function invocation(argv: string[]) {
  const forwarded: string[] = [];
  let explicit: string | undefined;
  let connection: string | undefined;
  let format: string | undefined;
  let yes = false;
  let profile: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i] as string;
    if (token === '--yes') {
      yes = true;
      continue;
    }
    if (
      token === '--config' ||
      token === '--connection' ||
      token === '--format' ||
      token === '--auth-profile'
    ) {
      const value = argv[i + 1];
      if (value !== undefined) {
        if (token === '--config') explicit = value;
        else if (token === '--connection') connection = value;
        else if (token === '--format') format = value;
        else profile = value;
        forwarded.push(token, value);
        i++;
        continue;
      }
    }
    if (token.startsWith('--config=')) explicit = token.slice(9);
    if (token.startsWith('--connection=')) connection = token.slice(13);
    if (token.startsWith('--format=')) format = token.slice(9);
    if (token.startsWith('--auth-profile=')) profile = token.slice(15);
    forwarded.push(token);
  }
  // Global options can appear late, after the command's positional arguments.
  const positional = forwarded.filter(
    (token, i) =>
      ![
        '--config',
        '--connection',
        '--format',
        '--auth-profile',
        '--view-mode',
      ].includes(token) &&
      !/^--(?:config|connection|format|auth-profile|view-mode)=/.test(token) &&
      ![
        '--config',
        '--connection',
        '--format',
        '--auth-profile',
        '--view-mode',
      ].includes(forwarded[i - 1] ?? ''),
  );
  return { forwarded, explicit, connection, format, yes, profile, positional };
}

const SITE_TOOL = 'tool_api__';

/** A site tool's name for the route: plain on the run's conductor, `tool_api__` on the site. */
export function toolNameFor(name: string, inRun: boolean): string {
  if (inRun)
    return name.startsWith(SITE_TOOL) ? name.slice(SITE_TOOL.length) : name;
  return name.startsWith('bakers_') ? `${SITE_TOOL}${name}` : name;
}

/** Build the actual plugin registrations after the final connection is ready. */
export async function dispatchBbDropsh(
  host: BbCommandHost,
  argv: string[],
  options: DropshDispatchOptions = {},
): Promise<void> {
  const args = invocation(argv);
  // Inside a conductor run, tools go to the run's own `bakers` server with the
  // run token, never to the site with the operator's credentials.
  const runUrl = process.env.BAKERS_CONDUCTOR_URL;
  const runToken = process.env.BAKERS_CONDUCTOR_TOKEN;
  const run =
    args.positional[0] === 'tool' && runUrl && runToken
      ? { url: runUrl, token: runToken }
      : undefined;
  const name = args.positional[0] === 'tool' ? args.positional[1] : undefined;
  if (name !== undefined) {
    const at = args.forwarded.indexOf(name);
    args.forwarded[at] = toolNameFor(name, run !== undefined);
  }
  const opts = {
    ...options,
    ...(args.explicit ? { explicit: args.explicit } : {}),
    ...(args.connection ? { connection: args.connection } : {}),
    ...(args.format ? { format: args.format } : {}),
    yes: options.yes || args.yes,
  };
  const help =
    argv.includes('--help') || argv.includes('-h') || argv.length === 0;
  const auth = args.positional[0] === 'auth';
  const search =
    args.positional[0] === 'search' &&
    args.positional[1] === 'bb_workspace' &&
    args.positional.length === 2 &&
    (!args.format || ['md', 'json'].includes(args.format));
  if (search) {
    const connection = await loadBbConnectionBootstrap(host, opts);
    const rows = await discoverBbWorkspaces(connection, opts);
    const stdout = options.stdout ?? ((s: string) => process.stdout.write(s));
    if (args.format === 'md')
      stdout(
        `| Workspace | UUID |\n| --- | --- |\n${rows.map((r) => `| ${r.name.replace(/[|\r\n]/g, ' ')} | ${r.id} |`).join('\n')}\n`,
      );
    else stdout(`${JSON.stringify(rows, null, 2)}\n`);
    return;
  }
  const connection =
    help || run
      ? undefined
      : auth
        ? await loadBbConnectionBootstrap(host, opts)
        : await loadReadyBbConnection(host, opts);
  const plugins = connection?.plugins ?? [];
  const program = buildDropshProgram({
    // `dropsh tool` (MCP, default endpoint /mcp) rides the same connection and auth profile.
    plugins: run
      ? [toolPlugin({ endpoint: '/' })]
      : plugins.some((plugin) => plugin.id === 'tool')
        ? plugins
        : [...plugins, toolPlugin()],
    ...(options.stdout ? { stdout: options.stdout } : {}),
    ...(options.stderr ? { stderr: options.stderr } : {}),
    ...(run
      ? {
          // The tool command reads only `auth` and `baseUrl` from its context.
          contextFactory: async () =>
            ({
              baseUrl: run.url,
              auth: {
                apply: async (request: {
                  headers?: Record<string, string>;
                }) => ({
                  ...request,
                  headers: {
                    ...request.headers,
                    authorization: `Bearer ${run.token}`,
                  },
                }),
              },
            }) as unknown as Awaited<
              ReturnType<typeof createBbConnectionContext>
            >,
        }
      : {}),
    ...(connection
      ? {
          contextFactory: () =>
            createBbConnectionContext(connection, {
              ...opts,
              ...(args.profile ? { profile: args.profile } : {}),
              wrapHttp: hideUnpublishedComments,
            }),
        }
      : {}),
  });
  if (options.publicCommand) {
    program.name('bakers');
    const command = program.commands.find(
      (entry) =>
        entry.name() === (options.publicCommand === 'tools' ? 'tool' : 'auth'),
    );
    for (const entry of command ? [command, ...command.commands] : []) {
      entry.exitOverride();
      entry.configureHelp({
        showGlobalOptions: true,
        commandUsage: (entry) =>
          new Help()
            .commandUsage(entry)
            .replace(/^bakers tool\b/, 'bakers tools'),
      });
    }
  }
  if (connection) {
    registerTemplateCommand(program, {
      contextFactory: () =>
        createBbConnectionContext(connection, {
          ...opts,
          ...(args.profile ? { profile: args.profile } : {}),
          wrapHttp: hideUnpublishedComments,
        }),
      stdout: options.stdout ?? ((s: string) => process.stdout.write(s)),
      stderr: options.stderr ?? ((s: string) => process.stderr.write(s)),
      setExitCode: (code) => {
        process.exitCode = code;
      },
    });
  }
  // Auth commands perform their own reload; bind it explicitly to the same path.
  const forwarded = connection
    ? ['--config', connection.config_path, ...args.forwarded]
    : args.forwarded;
  await program.parseAsync(forwarded, { from: 'user' });
}
const dropshCommandPlugin: BbCommandPlugin = {
  kind: 'command',
  name: 'dropsh',
  describe:
    'JSON:API shell (dropsh) bound to the bakers.build connection config',
  register(program: Command, host: BbCommandHost): void {
    program
      .command('dropsh', { hidden: true })
      .description('JSON:API shell bound to the bakers.build connection')
      .helpOption(false)
      .allowUnknownOption()
      .argument('[args...]')
      .action(async (args: string[]) => {
        await dispatchBbDropsh(host, args);
      });
  },
};
export default dropshCommandPlugin;

function publicAlias(
  name: 'tools' | 'auth',
  verb: 'tool' | 'auth',
): BbCommandPlugin {
  return {
    kind: 'command',
    name,
    describe:
      name === 'tools'
        ? 'discover, inspect and execute named tools'
        : 'manage connection authentication and profiles',
    register(program, host) {
      program
        .command(name)
        .description(this.describe)
        .helpOption(false)
        .allowUnknownOption()
        .argument('[args...]')
        .action(async (args: string[]) => {
          try {
            await dispatchBbDropsh(host, [verb, ...args], {
              publicCommand: name,
            });
          } catch (error) {
            if ((error as { code?: string }).code !== 'commander.helpDisplayed')
              throw error;
          }
        });
    },
  };
}

export const toolsCommandPlugin = publicAlias('tools', 'tool');
export const authCommandPlugin = publicAlias('auth', 'auth');
