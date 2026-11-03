import {
  type BbCommandHost,
  type BbCommandPlugin,
  createBbConnectionContext,
  discoverBbWorkspaces,
  loadBbConnectionBootstrap,
  loadReadyBbConnection,
  type WorkspaceRecoveryOptions,
} from '@bakers-build/core';
import { createToolClient, toolPlugin } from '@dropsh/plugin-tool';
import { type Command, Help } from 'commander';
import { buildProgram as buildDropshProgram } from 'dropsh';
import { askUserQuestionDecision } from './ask-user-question-hook.js';
import { registerTemplateCommand } from './template.js';
import { hideUnpublishedComments } from './unpublished-comments.js';

export function dropshConfigHint(resolvedPath?: string): string {
  return `bakers dropsh: no connection config at ${resolvedPath ?? '~/.bakers/bakers.config.js'}. Use --config <path> or run bakers config init --scope connection.`;
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

/** Build the actual plugin registrations after the final connection is ready. */
export async function dispatchBbDropsh(
  host: BbCommandHost,
  argv: string[],
  options: DropshDispatchOptions = {},
): Promise<void> {
  const args = invocation(argv);
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
  const connection = help
    ? undefined
    : auth
      ? await loadBbConnectionBootstrap(host, opts)
      : await loadReadyBbConnection(host, opts);
  const plugins = connection?.plugins ?? [];
  const program = buildDropshProgram({
    // `dropsh tool` (MCP, default endpoint /mcp) rides the same connection and auth profile.
    plugins: plugins.some((plugin) => plugin.id === 'tool')
      ? plugins
      : [...plugins, toolPlugin()],
    ...(options.stdout ? { stdout: options.stdout } : {}),
    ...(options.stderr ? { stderr: options.stderr } : {}),
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

/** A connection context for the bakers.build commands beside dropsh. */
async function siteContext(
  host: BbCommandHost,
  options: { config?: string; connection?: string },
) {
  const opts = {
    ...(options.config ? { explicit: options.config } : {}),
    ...(options.connection ? { connection: options.connection } : {}),
  };
  const connection = await loadReadyBbConnection(host, opts);
  return createBbConnectionContext(connection, {
    ...opts,
    wrapHttp: hideUnpublishedComments,
  });
}

/** Read a ticket through the site's `bakers_ticket_read` tool. */
async function readSiteTicket(
  ctx: Awaited<ReturnType<typeof siteContext>>,
  ticket: string,
): Promise<Record<string, unknown>> {
  const tools = createToolClient({ auth: ctx.auth, baseUrl: ctx.baseUrl });
  try {
    const result = await tools.call('tool_api__bakers_ticket_read', { ticket });
    if (result.isError) {
      const text = (result.content as { type: string; text?: string }[])
        .map((c) => c.text ?? '')
        .join(' ');
      throw new Error(`bakers_ticket_read refused: ${text}`);
    }
    return (result.structuredContent ?? {}) as Record<string, unknown>;
  } finally {
    await tools.close();
  }
}

async function drain(stream: NodeJS.ReadableStream): Promise<void> {
  if ((stream as { isTTY?: boolean }).isTTY) return;
  for await (const _ of stream);
}

/** `bakers hook ask-user-question`: Claude's PreToolUse hook on `AskUserQuestion`. */
export const hookCommandPlugin: BbCommandPlugin = {
  kind: 'command',
  name: 'hook',
  describe: 'agent hooks for conductor runs',
  register(program: Command, host: BbCommandHost): void {
    program
      .command('hook')
      .description('Agent hooks for conductor runs')
      .command('ask-user-question')
      .description(
        'Deny the terminal dialog in autopilot runs and point to `bakers ticket ask`',
      )
      .option('--connection <name>', 'bakers.build connection to use')
      .option('--config <path>', 'connection config file')
      .action(async (flags: { connection?: string; config?: string }) => {
        await drain(process.stdin);
        const output = await askUserQuestionDecision(
          process.env,
          async (ticket) =>
            readSiteTicket(await siteContext(host, flags), ticket),
        );
        if (output) process.stdout.write(`${JSON.stringify(output)}\n`);
      });
  },
};
