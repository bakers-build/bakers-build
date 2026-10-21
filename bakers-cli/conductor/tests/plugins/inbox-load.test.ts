import { describe, expect, it } from 'vitest';
import {
  type DiscoveredInbox,
  type InboxMessageHandler,
  loadInbox,
  validateRequestPayload,
} from '../../src/plugins/message.js';

const ok: InboxMessageHandler = async (request) => ({
  markdown: `Request ${request.id} completed.`,
});

function demo(handlers: Record<string, InboxMessageHandler>): DiscoveredInbox {
  return {
    name: 'demo',
    version: '0.3.0',
    inbox: {
      contract: 2,
      label: 'Demo',
      messages: { ping: { label: 'Ping', access: 'view' } },
      handlers: async () => handlers,
    },
  };
}

describe('loadInbox', () => {
  it('merges name/version/label and resolves handlers', async () => {
    const loaded = await loadInbox(demo({ ping: ok }));
    expect(loaded).toMatchObject({
      name: 'demo',
      version: '0.3.0',
      label: 'Demo',
      messages: { ping: { label: 'Ping', access: 'view' } },
    });
    expect(typeof loaded.handlers.ping).toBe('function');
  });

  it('rejects an unsupported contract version', async () => {
    const found = demo({ ping: ok });
    found.inbox = { ...found.inbox, contract: 1 as 2 };
    await expect(loadInbox(found)).rejects.toThrow(
      /unsupported inbox contract/,
    );
  });

  it('rejects a message with no matching handler', async () => {
    await expect(loadInbox(demo({}))).rejects.toThrow(
      /no handler for message ping/,
    );
  });

  it('rejects an undeclared handler', async () => {
    await expect(loadInbox(demo({ ping: ok, extra: ok }))).rejects.toThrow(
      /handler extra is not declared/,
    );
  });

  it('rejects an invalid message definition', async () => {
    const found = demo({ ping: ok });
    (found.inbox.messages.ping as Record<string, unknown>).confirm = 'Sure?';
    await expect(loadInbox(found)).rejects.toThrow(/messages\.ping/);
  });

  it('calls the loaded handler and returns the request id', async () => {
    const loaded = await loadInbox(demo({ ping: ok }));
    const result = await loaded.handlers.ping({
      id: 'req-1',
      messageType: 'demo.ping',
      addonVersion: '0.3.0',
      requestedBy: 'user-1',
      ticket: {} as never,
      worktreePath: '/tmp/demo',
      env: {},
      logger: { warn: () => {} } as never,
      signal: new AbortController().signal,
    });
    expect(result.markdown).toBe('Request req-1 completed.');
  });
});

describe('validateRequestPayload', () => {
  const messages = {
    ping: { label: 'Ping', access: 'view' as const },
    stop: {
      label: 'Stop',
      access: 'update' as const,
      input: {
        type: 'object' as const,
        required: ['port'],
        properties: { port: { type: 'integer' as const } },
      },
    },
  };

  it('accepts no payload for a parameterless message', () => {
    expect(validateRequestPayload(messages, 'ping', undefined).ok).toBe(true);
  });

  it('rejects an unknown message type', () => {
    expect(validateRequestPayload(messages, 'missing', undefined).ok).toBe(
      false,
    );
  });

  it('rejects a missing required payload field', () => {
    expect(validateRequestPayload(messages, 'stop', {}).ok).toBe(false);
  });

  it('accepts a valid payload', () => {
    expect(validateRequestPayload(messages, 'stop', { port: 443 }).ok).toBe(
      true,
    );
  });
});
