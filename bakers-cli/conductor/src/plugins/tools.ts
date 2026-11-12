// The agent-tool contract on the conductor surface: an addon's preset may
// export `tools` — tool definitions plus LAZY handlers, shaped like the
// inbox contract. The conductor serves them to agent runs through its MCP
// server, and addons call each other's tools through the same registry.
// Every call is bound to one worktree by the caller, never by an argument.

import { spawn } from 'node:child_process';
import type { ConductorLogger } from '@bakers-build/core';
import {
  type MessageInput,
  payloadSchema,
  validateArgs,
} from '@bakers-build/message';
import type { Ticket } from './remote.js';

export interface ToolDefinition {
  description: string;
  /** Absent means a parameterless tool. Unknown arguments are refused. */
  input?: MessageInput;
}

export interface ToolResult {
  text: string;
}

/** The worktree a call acts on — fixed by the session, never by the tool. */
export interface ToolBinding {
  worktreePath: string;
  /** Set by the conductor's run grant, never accepted as a tool argument. */
  runUuid?: string;
  /** The run's ticket; an operator call may know only its identifier. */
  ticket?: Partial<Ticket> & { identifier: string };
}

export interface ToolRequest extends ToolBinding {
  args: Record<string, unknown>;
  signal: AbortSignal;
  logger: ConductorLogger;
  /** Call another registered tool on the same worktree. */
  callTool(name: string, args?: Record<string, unknown>): Promise<ToolResult>;
}

/** Throw to report a tool error; the message reaches the caller. */
export type ToolHandler = (request: ToolRequest) => Promise<ToolResult>;

/** An addon preset's `tools` export. */
export interface AddonTools {
  contract: 1;
  tools: Record<string, ToolDefinition>;
  /** Lazy: imported only when the conductor loads the addon. */
  handlers: (options?: unknown) => Promise<Record<string, ToolHandler>>;
}

/** One `tools` export as discovery found it. */
export interface DiscoveredTools {
  name: string;
  version: string;
  tools: AddonTools;
  /** The addon entry's `with` options, handed to `tools.handlers`. */
  options?: unknown;
}

export interface ListedTool {
  name: string;
  addon: string;
  description: string;
  /** JSON schema of the arguments. */
  inputSchema: object;
}

export interface ToolRegistry {
  list(): ListedTool[];
  call(
    name: string,
    args: Record<string, unknown> | undefined,
    binding: ToolBinding,
    options?: { signal?: AbortSignal; logger?: ConductorLogger },
  ): Promise<ToolResult>;
}

/** `hooks.provision_up`: one command, or a command per profile. */
export type ProvisionHook = string | Record<string, string>;

export const PROVISION_TIMEOUT_MS = 30 * 60_000;
const OUTPUT_CAP = 64 * 1024;

type ShellResult = { exitCode: number; output: string };

/** Provisioning runs the conductor owns, one per worktree and command. */
export interface ProvisionRuns {
  /** Joins the running command of this worktree, or starts it. */
  run(worktreePath: string, command: string): Promise<ShellResult>;
  /** Kills the runs of one worktree, or all; resolves once they closed. */
  stop(worktreePath?: string): Promise<void>;
}

export function provisionRuns(timeoutMs = PROVISION_TIMEOUT_MS): ProvisionRuns {
  const running = new Map<
    string,
    { worktreePath: string; abort: AbortController; done: Promise<ShellResult> }
  >();
  return {
    run(worktreePath, command) {
      const key = JSON.stringify([worktreePath, command]);
      const current = running.get(key);
      if (current) return current.done;
      const abort = new AbortController();
      const done = shell(command, worktreePath, abort.signal, timeoutMs);
      running.set(key, { worktreePath, abort, done });
      const forget = () => running.delete(key);
      done.then(forget, forget);
      return done;
    },
    async stop(worktreePath) {
      const ending = [...running.values()].filter(
        (r) => worktreePath === undefined || r.worktreePath === worktreePath,
      );
      for (const r of ending) r.abort.abort();
      await Promise.allSettled(ending.map((r) => r.done));
    },
  };
}

/**
 * The core `provision_up(profile?)` tool, offered only when the hook is set.
 * The agent picks when and which configured profile, never the command. The
 * command outlives its caller: the call's signal is ignored on purpose.
 */
export function provisionTools(
  hook: ProvisionHook | undefined,
  runs: ProvisionRuns = provisionRuns(),
): DiscoveredTools[] {
  if (hook === undefined) return [];
  const profiles = typeof hook === 'string' ? undefined : hook;
  if (
    typeof hook !== 'string' &&
    (typeof hook !== 'object' ||
      hook === null ||
      Object.values(hook).some((cmd) => typeof cmd !== 'string'))
  )
    throw new Error(
      'hooks.provision_up must be a command or a { profile: command } map',
    );
  const keys = profiles ? Object.keys(profiles).join(', ') : '';
  const commandFor = (profile: unknown): string => {
    if (!profiles) return hook as string;
    if (profile === undefined)
      throw new Error(`provision_up: profile required, one of ${keys}`);
    // The input schema's enum has already refused an unknown profile.
    return profiles[String(profile)] as string;
  };
  return [
    {
      name: 'conductor',
      version: '1',
      tools: {
        contract: 1,
        tools: {
          provision_up: {
            description: `Bring this worktree's environment up${profiles ? ` with a configured profile (${keys})` : ''}; the project's command reuses a ready environment. Returns the command's output, including the base URL. The first call on a new worktree can take minutes; the call waits until the command ends, for up to 30 minutes. On a client timeout the command keeps running: call again with the same profile to join it and receive its result, without starting a second one.`,
            input: {
              type: 'object',
              properties: {
                profile: profiles
                  ? { type: 'string', enum: Object.keys(profiles) }
                  : { type: 'string' },
              },
            },
          },
        },
        handlers: async () => ({
          provision_up: async (req) => {
            const command = commandFor(req.args.profile);
            // shortcut: inherits the conductor's env, not the run's BAKERS_* env; pass it through the binding once a hook needs it.
            const { exitCode, output } = await runs.run(
              req.worktreePath,
              command,
            );
            const text = `exit ${exitCode}\n${output}`;
            if (exitCode !== 0) throw new Error(text);
            return { text };
          },
        }),
      },
    },
  ];
}

/**
 * `sh -c` with stdout and stderr interleaved, the tail kept. Its own process
 * group, killed whole at the timeout or abort, so no child outlives it.
 */
function shell(
  command: string,
  cwd: string,
  signal: AbortSignal,
  timeoutMs: number,
): Promise<ShellResult> {
  return new Promise((done, fail) => {
    const child = spawn('sh', ['-c', command], {
      cwd,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let killed = false;
    const kill = () => {
      try {
        if (child.pid) process.kill(-child.pid, 'SIGTERM');
        killed = true;
      } catch {
        // The group is already gone.
      }
    };
    // Armed until 'close', not 'exit': a child of sh can hold the output open after sh exits.
    const timer = setTimeout(kill, timeoutMs);
    signal.addEventListener('abort', kill, { once: true });
    let output = '';
    const collect = (chunk: Buffer) => {
      output = (output + chunk.toString('utf8')).slice(-OUTPUT_CAP);
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    child.on('error', (err) => {
      clearTimeout(timer);
      fail(err);
    });
    child.on('close', (code, sig) => {
      clearTimeout(timer);
      const by = sig ?? (killed ? 'SIGTERM' : null);
      done({
        exitCode: by ? 124 : (code ?? 124),
        output: by ? `${output}\n(killed: ${by})` : output,
      });
    });
  });
}

const silent: ConductorLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

/**
 * Resolves every addon's handlers and checks that handlers and declared tools
 * match one to one. A tool name declared by two addons is an error, so the
 * conductor never starts with an ambiguous tool.
 */
export async function loadTools(
  found: readonly DiscoveredTools[],
): Promise<ToolRegistry> {
  const entries = new Map<
    string,
    { addon: string; def: ToolDefinition; handler: ToolHandler }
  >();
  for (const addon of found) {
    const fail = (msg: string) => new Error(`addon ${addon.name}: ${msg}`);
    if (addon.tools.contract !== 1)
      throw fail(`unsupported tools contract ${addon.tools.contract}`);
    const handlers = await addon.tools.handlers(addon.options);
    for (const [name, def] of Object.entries(addon.tools.tools)) {
      const handler = handlers[name];
      if (typeof handler !== 'function')
        throw fail(`no handler for tool ${name}`);
      const taken = entries.get(name);
      if (taken)
        throw new Error(
          `tool ${name} is declared by both ${taken.addon} and ${addon.name}`,
        );
      entries.set(name, { addon: addon.name, def, handler });
    }
    for (const name of Object.keys(handlers))
      if (!(name in addon.tools.tools))
        throw fail(`handler ${name} is not declared`);
  }

  const registry: ToolRegistry = {
    list: () =>
      [...entries].map(([name, { addon, def }]) => ({
        name,
        addon,
        description: def.description,
        inputSchema: payloadSchema(def.input),
      })),
    call: async (name, args, binding, options = {}) => {
      const entry = entries.get(name);
      if (!entry) throw new Error(`unknown tool ${name}`);
      const valid = validateArgs(entry.def.input, args);
      if (!valid.ok)
        throw new Error(
          `${name}: invalid arguments: ${valid.errors.join('; ')}`,
        );
      const signal = options.signal ?? new AbortController().signal;
      return entry.handler({
        ...binding,
        args: args ?? {},
        signal,
        logger: options.logger ?? silent,
        callTool: (next, nextArgs) =>
          registry.call(next, nextArgs, binding, { ...options, signal }),
      });
    },
  };
  return registry;
}
