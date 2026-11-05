// Contract-2 inbox dispatch (BB-661): one message, one handler, one
// `{ markdown }` answer. `runInbox` is the tick step: it registers the
// addon's messages and enqueues every pending inbox message this conductor
// handles.

import { existsSync } from 'node:fs';
import type { ConductorLogger } from '@bakers-build/core';
import { type MessageResult, validateResult } from '@bakers-build/message';
import type { LoadedInbox } from '../plugins/message.js';
import type { BbRemote, InboxMessage, Ticket } from '../plugins/remote.js';
import type { ToolRegistry } from '../plugins/tools.js';
import type { ActionQueue } from './action-queue.js';

/** Per-handler timeout; the request's `signal` aborts after it. */
export const HANDLER_TIMEOUT_MS = 60_000;

type Outcome =
  | { status: 'done'; result: MessageResult }
  | { status: 'failed'; result: MessageResult };

const failed = (text: string): Outcome => ({
  status: 'failed',
  result: { markdown: text },
});

export class InboxRuntime {
  private readonly ids = new Map<string, string>();
  private registeredOk = false;

  constructor(
    private readonly addons: LoadedInbox[],
    private readonly remote: BbRemote,
    private readonly logger: ConductorLogger,
    private readonly env: (ticket: Ticket) => Promise<Record<string, string>>,
    private readonly tools?: ToolRegistry,
  ) {}

  /** Whether this conductor runs no contract-2 addon. */
  get empty(): boolean {
    return this.addons.length === 0;
  }

  /** Whether the last registration reached the server. */
  get registered(): boolean {
    return this.registeredOk;
  }

  /**
   * Registers every loaded addon's contract-2 definition. An empty list is
   * sent too, so a conductor that dropped its addons leaves every version it
   * was listed on.
   */
  async register(conductorId: string): Promise<void> {
    const reg = await this.remote.registerAddons(
      conductorId,
      this.addons.map((a) => ({
        name: a.name,
        version: a.version,
        contract: 2 as const,
        messages: a.messages,
        ...(a.label !== undefined ? { label: a.label } : {}),
        ...(a.icon !== undefined ? { icon: a.icon } : {}),
      })),
    );
    this.registeredOk = true;
    for (const a of reg.accepted) this.ids.set(a.name, a.id);
    for (const r of reg.rejected) {
      this.logger.error(
        { addon: r.name, version: r.version, reason: r.error },
        `addon ${r.name}@${r.version} rejected by the server: ${r.error}`,
      );
    }
  }

  /** The addon and message key a message names, if this conductor runs it. */
  private target(msg: InboxMessage): [LoadedInbox, string] | undefined {
    const dot = msg.messageId.indexOf('.');
    const addon = this.addons.find(
      (a) => a.name === msg.messageId.slice(0, dot),
    );
    const key = msg.messageId.slice(dot + 1);
    return dot > 0 &&
      addon?.messages[key] &&
      (addon.handlers[key] || addon.bindings[key])
      ? [addon, key]
      : undefined;
  }

  /** Runs the handler a message names. Never throws. */
  async handle(msg: InboxMessage): Promise<Outcome> {
    const target = this.target(msg);
    if (!target) return failed(`no handler for message ${msg.messageId}`);
    const [addon, key] = target;
    try {
      const ticket = await this.remote.getTicket(msg.ticketUuid);
      if (!msg.worktreePath || !existsSync(msg.worktreePath)) {
        return failed(`no worktree for ${ticket.identifier} on this machine`);
      }
      const result = await this.run(addon, key, ticket, msg);
      return { status: 'done', result };
    } catch (err) {
      return failed(err instanceof Error ? err.message : String(err));
    }
  }

  /** Runs one handler or bound tool with the timeout and validates its result. */
  private async run(
    addon: LoadedInbox,
    key: string,
    ticket: Ticket,
    msg: InboxMessage,
  ): Promise<MessageResult> {
    const worktreePath = msg.worktreePath ?? '';
    const controller = new AbortController();
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`timed out after ${HANDLER_TIMEOUT_MS / 1000}s`));
        controller.abort();
      }, HANDLER_TIMEOUT_MS);
    });
    try {
      const binding = addon.bindings[key];
      if (binding) {
        if (!this.tools) throw new Error(`no tools for ${key}`);
        const { text } = await Promise.race([
          this.tools.call(
            binding.tool,
            binding.args ?? msg.payload,
            { worktreePath, ticket },
            { signal: controller.signal, logger: this.logger },
          ),
          timeout,
        ]);
        return { markdown: text };
      }
      const handler = addon.handlers[key];
      if (!handler) throw new Error(`no handler for ${key}`);
      const result = await Promise.race([
        handler({
          id: msg.id,
          messageType: msg.messageId,
          addonVersion: addon.version,
          requestedBy: msg.requestedBy ?? '',
          ticket,
          ...(Object.keys(msg.payload).length > 0
            ? { payload: msg.payload }
            : {}),
          worktreePath,
          env: await this.env(ticket),
          logger: this.logger,
          signal: controller.signal,
          ...(this.tools
            ? {
                callTool: (name: string, args?: Record<string, unknown>) =>
                  (this.tools as ToolRegistry).call(
                    name,
                    args,
                    { worktreePath, ticket },
                    { signal: controller.signal, logger: this.logger },
                  ),
              }
            : {}),
        }),
        timeout,
      ]);
      const valid = validateResult(result);
      if (!valid.ok)
        throw new Error(`invalid result: ${valid.errors.join('; ')}`);
      return result;
    } finally {
      clearTimeout(timer);
    }
  }
}

/** One line per answer: status and a bounded prefix of the markdown. */
function logAnswer(
  logger: ConductorLogger,
  msg: InboxMessage,
  outcome: Outcome,
): void {
  const line = `inbox message ${msg.messageId} ${outcome.status}`;
  const meta = { id: msg.id, ticket: msg.ticketUuid };
  if (outcome.status === 'failed') logger.warn(meta, line);
  else logger.info(meta, line);
}

/** Answers one inbox message through the contract-2 runtime. Catches its own errors. */
export async function answerV2(
  remote: BbRemote,
  runtime: InboxRuntime,
  msg: InboxMessage,
  logger: ConductorLogger,
): Promise<void> {
  try {
    await remote.writeInboxResult(msg.id, 'running');
    const outcome = await runtime.handle(msg);
    try {
      await remote.writeInboxResult(msg.id, outcome.status, outcome.result);
    } catch (err) {
      await remote.writeInboxResult(msg.id, 'failed', {
        markdown: `Could not store the result: ${err instanceof Error ? err.message : String(err)}`,
      });
      throw err;
    }
    logAnswer(logger, msg, outcome);
  } catch (err) {
    logger.error(
      { message: msg.messageId, id: msg.id, err: String(err) },
      'inbox message failed',
    );
  }
}

/**
 * The tick step: enqueue every pending message this conductor handles on the
 * action queue; the queue answers them. Catches its own errors so the tick
 * continues.
 */
export async function runInbox(
  remote: BbRemote,
  runtime: InboxRuntime,
  conductorId: string,
  logger: ConductorLogger,
  queue: ActionQueue,
): Promise<void> {
  if (runtime.empty) return;
  try {
    if (!runtime.registered) await runtime.register(conductorId);
    const snapshot = await remote.fetchInbox(conductorId);
    for (const msg of snapshot.messages) {
      const run = () => answerV2(remote, runtime, msg, logger);
      const queued = queue.enqueue({
        key: `message:${msg.id}`,
        lane: msg.ticketUuid,
        run,
      });
      if (queued) {
        logger.info(
          { id: msg.id, ticket: msg.ticketUuid, payload: msg.payload },
          `inbox message ${msg.messageId} received`,
        );
      }
    }
  } catch (err) {
    logger.error({ conductorId, err: String(err) }, 'inbox step failed');
  }
}
