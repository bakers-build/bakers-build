import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FakeBbRemote } from '@bakers-build/addon-fake';
import type { ConductorLogger } from '@bakers-build/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ActionQueue } from '../../src/core/action-queue.js';
import {
  answerV2,
  HANDLER_TIMEOUT_MS,
  InboxRuntime,
  runInbox,
} from '../../src/core/inbox-runtime.js';
import { type LoadedInbox, loadInbox } from '../../src/plugins/message.js';
import type { InboxMessage } from '../../src/plugins/remote.js';
import { loadTools, type ToolRequest } from '../../src/plugins/tools.js';

function spyLogger(): { log: ConductorLogger; calls: object[] } {
  const calls: object[] = [];
  const mk = (level: string) => (obj: object, msg?: string) => {
    calls.push({ level, obj, msg });
  };
  return {
    calls,
    log: {
      debug: mk('debug'),
      info: mk('info'),
      warn: mk('warn'),
      error: mk('error'),
    } as unknown as ConductorLogger,
  };
}

let worktree: string;
let remote: FakeBbRemote;

function message(
  id: string,
  messageId: string,
  extra: Partial<InboxMessage> = {},
): InboxMessage {
  return {
    id,
    messageId,
    version: '0.3.0',
    ticketUuid: 't-1',
    payload: {},
    worktreePath: worktree,
    requestedBy: 'user-1',
    ...extra,
  };
}

async function demoInbox(
  handlers: Record<string, (req: unknown) => Promise<{ markdown: string }>>,
): Promise<LoadedInbox> {
  return loadInbox({
    name: 'demo',
    version: '0.3.0',
    inbox: {
      contract: 2,
      label: 'Demo',
      messages: { ping: { label: 'Ping', access: 'view' } },
      handlers: async () => handlers as any,
    },
  });
}

beforeEach(() => {
  worktree = mkdtempSync(join(tmpdir(), 'bakers-inbox-v2-'));
  remote = new FakeBbRemote({
    tickets: { 't-1': { identifier: 'BB-1', title: 'T', state: 'working' } },
  });
});

describe('InboxRuntime', () => {
  it('registers the contract-2 definition with name and version', async () => {
    const demo = await demoInbox({ ping: async () => ({ markdown: 'ok' }) });
    const rt = new InboxRuntime(
      [demo],
      remote,
      spyLogger().log,
      async () => ({}),
    );
    await rt.register('node-1');
    expect(rt.registered).toBe(true);
  });

  it('registers the addon icon when the preset declares one', async () => {
    const icon = '<svg xmlns="http://www.w3.org/2000/svg"/>';
    const demo = await loadInbox({
      name: 'demo',
      version: '0.3.0',
      inbox: {
        contract: 2,
        icon,
        messages: { ping: { label: 'Ping' } },
        handlers: async () => ({ ping: async () => ({ markdown: '' }) }),
      },
    });
    const rt = new InboxRuntime(
      [demo],
      remote,
      spyLogger().log,
      async () => ({}),
    );
    await rt.register('node-1');
    expect(remote.registeredAddons[0]).toMatchObject({ name: 'demo', icon });
  });

  it('runs the handler and returns its markdown', async () => {
    const demo = await demoInbox({
      ping: async (req) => ({ markdown: `hi ${(req as { id: string }).id}` }),
    });
    const rt = new InboxRuntime(
      [demo],
      remote,
      spyLogger().log,
      async () => ({}),
    );
    const outcome = await rt.handle(message('m-1', 'demo.ping'));
    expect(outcome).toEqual({ status: 'done', result: { markdown: 'hi m-1' } });
  });

  it('fails a message for an unknown message type', async () => {
    const demo = await demoInbox({ ping: async () => ({ markdown: 'ok' }) });
    const rt = new InboxRuntime(
      [demo],
      remote,
      spyLogger().log,
      async () => ({}),
    );
    const outcome = await rt.handle(message('m-1', 'demo.missing'));
    expect(outcome.status).toBe('failed');
    expect(outcome.result.markdown).toContain(
      'no handler for message demo.missing',
    );
  });

  it('fails a message without a worktree on this machine', async () => {
    const demo = await demoInbox({ ping: async () => ({ markdown: 'ok' }) });
    const rt = new InboxRuntime(
      [demo],
      remote,
      spyLogger().log,
      async () => ({}),
    );
    const outcome = await rt.handle(
      message('m-1', 'demo.ping', { worktreePath: null }),
    );
    expect(outcome.status).toBe('failed');
    expect(outcome.result.markdown).toContain('no worktree');
  });

  it('fails an invalid handler result with the validation message', async () => {
    const demo = await demoInbox({
      ping: async () => ({ rows: [] }) as any,
    });
    const rt = new InboxRuntime(
      [demo],
      remote,
      spyLogger().log,
      async () => ({}),
    );
    const outcome = await rt.handle(message('m-1', 'demo.ping'));
    expect(outcome.status).toBe('failed');
    expect(outcome.result.markdown).toContain('invalid result');
  });

  it('answerV2 writes running then the terminal result', async () => {
    const demo = await demoInbox({ ping: async () => ({ markdown: 'ok' }) });
    const rt = new InboxRuntime(
      [demo],
      remote,
      spyLogger().log,
      async () => ({}),
    );
    const statuses: string[] = [];
    const write = remote.writeInboxResult.bind(remote);
    remote.writeInboxResult = async (id, status, result) => {
      statuses.push(status);
      await write(id, status, result);
    };
    await answerV2(remote, rt, message('m-1', 'demo.ping'), spyLogger().log);
    expect(statuses).toEqual(['running', 'done']);
  });
});

describe('InboxRuntime bindings', () => {
  const calls: { args: unknown; worktreePath: string }[] = [];
  let behavior: 'ok' | 'throw' | 'hang' = 'ok';

  async function boundRuntime(): Promise<InboxRuntime> {
    calls.length = 0;
    const registry = await loadTools([
      {
        name: 'demo-tools',
        version: '1.0.0',
        tools: {
          contract: 1,
          tools: {
            up: { description: 'Up' },
            echo: {
              description: 'Echo',
              input: {
                type: 'object',
                required: ['port'],
                properties: { port: { type: 'integer' } },
              },
            },
          },
          handlers: async () => {
            const run = async (req: ToolRequest) => {
              calls.push({ args: req.args, worktreePath: req.worktreePath });
              if (behavior === 'throw') throw new Error('tunnel broke');
              if (behavior === 'hang')
                await new Promise((_r, reject) =>
                  req.signal.addEventListener('abort', () =>
                    reject(new Error('aborted')),
                  ),
                );
              return { text: `ran ${JSON.stringify(req.args)}` };
            };
            return { up: run, echo: run };
          },
        },
      },
    ]);
    const demo = await loadInbox(
      {
        name: 'demo',
        version: '0.3.0',
        inbox: {
          contract: 2,
          messages: {
            up: { label: 'Up', access: 'view' },
            echo: {
              label: 'Echo',
              access: 'update',
              input: {
                type: 'object',
                properties: { port: { type: 'integer' } },
              },
            },
          },
          bindings: {
            up: { tool: 'up', args: {} },
            echo: { tool: 'echo' },
          },
        },
      },
      undefined,
      new Set(registry.list().map((t) => t.name)),
    );
    return new InboxRuntime(
      [demo],
      remote,
      spyLogger().log,
      async () => ({}),
      registry,
    );
  }

  beforeEach(() => {
    behavior = 'ok';
  });

  it('calls the bound tool with fixed args on the worktree', async () => {
    const rt = await boundRuntime();
    const outcome = await rt.handle(
      message('m-1', 'demo.up', { payload: { ignored: true } }),
    );
    expect(outcome).toEqual({ status: 'done', result: { markdown: 'ran {}' } });
    expect(calls).toEqual([{ args: {}, worktreePath: worktree }]);
  });

  it('passes the payload through when the binding has no args', async () => {
    const rt = await boundRuntime();
    const outcome = await rt.handle(
      message('m-1', 'demo.echo', { payload: { port: 443 } }),
    );
    expect(outcome).toEqual({
      status: 'done',
      result: { markdown: 'ran {"port":443}' },
    });
  });

  it('fails with the tool error', async () => {
    behavior = 'throw';
    const rt = await boundRuntime();
    const outcome = await rt.handle(message('m-1', 'demo.up'));
    expect(outcome).toEqual({
      status: 'failed',
      result: { markdown: 'tunnel broke' },
    });
  });

  it('fails when the tool refuses the arguments', async () => {
    const rt = await boundRuntime();
    const outcome = await rt.handle(message('m-1', 'demo.echo'));
    expect(outcome.status).toBe('failed');
    expect(outcome.result.markdown).toContain('echo: invalid arguments');
  });

  it('fails a tool that runs past the timeout', async () => {
    vi.useFakeTimers();
    try {
      behavior = 'hang';
      const rt = await boundRuntime();
      const pending = rt.handle(message('m-1', 'demo.up'));
      await vi.advanceTimersByTimeAsync(HANDLER_TIMEOUT_MS);
      const outcome = await pending;
      expect(outcome.status).toBe('failed');
      expect(outcome.result.markdown).toContain('timed out after 60s');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('runInbox', () => {
  it('registers and answers a pending message through the queue', async () => {
    const demo = await demoInbox({
      ping: async (req) => ({ markdown: `done ${(req as { id: string }).id}` }),
    });
    const rt = new InboxRuntime(
      [demo],
      remote,
      spyLogger().log,
      async () => ({}),
    );
    remote.enqueue(message('m-1', 'demo.ping'));
    const q = new ActionQueue(spyLogger().log);
    await runInbox(remote, rt, 'node-1', spyLogger().log, q);
    await q.drain();
    expect(remote.results.map((r) => r.status)).toEqual(['running', 'done']);
    expect(remote.results.at(-1)?.result).toEqual({ markdown: 'done m-1' });
  });
});
