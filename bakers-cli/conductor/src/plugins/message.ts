// The InboxMessageHandler contract on the conductor surface: an addon's
// preset may export `inbox` — a map of message types plus LAZY handlers, so
// a command-only load never imports them. Contract 2 replaces the retired
// `actions`/views/rows contract (BB-661): this is the only live inbox
// contract.

import type { ConductorLogger } from '@bakers-build/core';
import {
  MESSAGE_CONTRACT_VERSION,
  type MessageDefinition,
  type MessageResult,
  validateArgs,
  validateMessageDefinition,
} from '@bakers-build/message';
import type { Ticket } from './remote.js';
import type { ToolResult } from './tools.js';

/** What a handler gets: its own request identity plus the ticket's worktree. */
export interface InboxMessageRequest {
  /** The bb_inbox_message entity UUID; the request's own identity, never the message type. */
  id: string;
  /** The namespaced message type, e.g. `ports.tunnel`. */
  messageType: string;
  addonVersion: string;
  requestedBy: string;
  ticket: Ticket;
  payload?: Record<string, unknown>;
  worktreePath: string;
  env: Record<string, string>;
  logger: ConductorLogger;
  /** Aborts when the handler runs past its timeout. */
  signal: AbortSignal;
  /** Call an addon tool on this worktree; absent when no addon declares tools. */
  callTool?: (
    name: string,
    args?: Record<string, unknown>,
  ) => Promise<ToolResult>;
}

export type InboxMessageHandler = (
  request: InboxMessageRequest,
) => Promise<MessageResult>;

/**
 * Answers a message by calling a conductor tool on the ticket's worktree.
 * Without `args` the message's payload is passed through; never merged.
 */
export interface InboxBinding {
  tool: string;
  args?: Record<string, unknown>;
}

/** An addon preset's `inbox` export. Each message has a handler or a binding. */
export interface InboxMessages {
  contract: 2;
  label?: string;
  /** Inline SVG markup, at most 8192 characters; shown as an image only. */
  icon?: string;
  messages: Record<string, MessageDefinition>;
  /** Lazy: imported only when the conductor loads the addon. */
  handlers?: (
    options?: unknown,
  ) => Promise<Record<string, InboxMessageHandler>>;
  bindings?: Record<string, InboxBinding>;
}

/** One `inbox` export as discovery found it. */
export interface DiscoveredInbox {
  name: string;
  version: string;
  inbox: InboxMessages;
  /** The addon entry's `with` options, handed to `inbox.handlers`. */
  options?: unknown;
}

/** A validated inbox addon with its handlers resolved. */
export interface LoadedInbox {
  name: string;
  version: string;
  label: string | undefined;
  icon?: string;
  messages: Record<string, MessageDefinition>;
  handlers: Record<string, InboxMessageHandler>;
  bindings: Record<string, InboxBinding>;
}

/**
 * Validates every declared message definition, checks that each declared
 * message has exactly one handler or binding (and nothing undeclared), that a
 * binding names one of `toolNames`, and rejects a contract other than 2.
 * `handlers` gets `options` (the addon entry's `with`). Throws an Error naming
 * the addon on any violation.
 */
export async function loadInbox(
  found: DiscoveredInbox,
  options?: unknown,
  toolNames: ReadonlySet<string> = new Set(),
): Promise<LoadedInbox> {
  const fail = (msg: string) => new Error(`addon ${found.name}: ${msg}`);
  if (found.inbox.contract !== MESSAGE_CONTRACT_VERSION)
    throw fail(`unsupported inbox contract ${found.inbox.contract}`);
  for (const [key, def] of Object.entries(found.inbox.messages)) {
    const valid = validateMessageDefinition(def);
    if (!valid.ok) throw fail(`messages.${key}: ${valid.errors.join('; ')}`);
  }
  const handlers = (await found.inbox.handlers?.(options)) ?? {};
  const bindings = found.inbox.bindings ?? {};
  const declared = Object.keys(found.inbox.messages);
  for (const key of Object.keys(handlers)) {
    if (!declared.includes(key)) throw fail(`handler ${key} is not declared`);
  }
  for (const key of Object.keys(bindings)) {
    if (!declared.includes(key)) throw fail(`binding ${key} is not declared`);
  }
  for (const key of declared) {
    const handled = typeof handlers[key] === 'function';
    const binding = bindings[key];
    if (handled && binding)
      throw fail(`message ${key}: both a handler and a binding`);
    if (!handled && !binding) throw fail(`no handler for message ${key}`);
    if (!binding) continue;
    if (!toolNames.has(binding.tool))
      throw fail(`message ${key}: unknown tool ${binding.tool}`);
    if (binding.args && found.inbox.messages[key]?.input)
      throw fail(`message ${key}: fixed args with a declared input`);
  }
  return {
    name: found.name,
    version: found.version,
    label: found.inbox.label,
    ...(found.inbox.icon !== undefined ? { icon: found.inbox.icon } : {}),
    messages: found.inbox.messages,
    handlers,
    bindings,
  };
}

/** Validates a request's payload against its message's input schema. */
export function validateRequestPayload(
  messages: Record<string, MessageDefinition>,
  messageType: string,
  payload: unknown,
): { ok: true } | { ok: false; errors: string[] } {
  const def = messages[messageType];
  if (!def)
    return { ok: false, errors: [`unknown message type ${messageType}`] };
  return validateArgs(def.input, payload);
}
