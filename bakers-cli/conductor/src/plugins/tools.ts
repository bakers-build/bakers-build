// The agent-tool contract on the conductor surface: an addon's preset may
// export `tools` — tool definitions plus LAZY handlers, shaped like the
// inbox contract. The conductor serves them to agent runs through its MCP
// server, and addons call each other's tools through the same registry.
// Every call is bound to one worktree by the caller, never by an argument.

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
  ticket?: Ticket;
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
        throw new Error(`${name}: invalid arguments: ${valid.errors.join('; ')}`);
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
