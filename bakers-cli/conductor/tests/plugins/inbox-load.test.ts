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

describe('loadInbox bindings', () => {
  function bound(inbox: Partial<DiscoveredInbox['inbox']>): DiscoveredInbox {
    return {
      name: 'demo',
      version: '0.3.0',
      inbox: {
        contract: 2,
        messages: {
          up: { label: 'Up', access: 'view' },
          stop: {
            label: 'Stop',
            access: 'update',
            input: {
              type: 'object',
              properties: { port: { type: 'integer' } },
            },
          },
        },
        ...inbox,
      },
    };
  }
  const tools = new Set(['ports_up', 'ports_down']);

  it('loads bound messages without handlers', async () => {
    const loaded = await loadInbox(
      bound({
        bindings: {
          up: { tool: 'ports_up', args: {} },
          stop: { tool: 'ports_down' },
        },
      }),
      undefined,
      tools,
    );
    expect(loaded.bindings).toEqual({
      up: { tool: 'ports_up', args: {} },
      stop: { tool: 'ports_down' },
    });
    expect(loaded.handlers).toEqual({});
  });

  it('mixes handlers and bindings', async () => {
    const loaded = await loadInbox(
      bound({
        handlers: async () => ({ stop: ok }),
        bindings: { up: { tool: 'ports_up' } },
      }),
      undefined,
      tools,
    );
    expect(Object.keys(loaded.handlers)).toEqual(['stop']);
    expect(Object.keys(loaded.bindings)).toEqual(['up']);
  });

  it('rejects a message with both a handler and a binding', async () => {
    await expect(
      loadInbox(
        bound({
          handlers: async () => ({ up: ok, stop: ok }),
          bindings: { up: { tool: 'ports_up' } },
        }),
        undefined,
        tools,
      ),
    ).rejects.toThrow('addon demo: message up: both a handler and a binding');
  });

  it('rejects a message with neither', async () => {
    await expect(
      loadInbox(
        bound({ bindings: { up: { tool: 'ports_up' } } }),
        undefined,
        tools,
      ),
    ).rejects.toThrow('addon demo: no handler for message stop');
  });

  it('rejects a binding to a tool no addon declares', async () => {
    await expect(
      loadInbox(
        bound({
          bindings: { up: { tool: 'nope' }, stop: { tool: 'ports_down' } },
        }),
        undefined,
        tools,
      ),
    ).rejects.toThrow('addon demo: message up: unknown tool nope');
  });

  it('rejects a binding when no tools are loaded', async () => {
    await expect(
      loadInbox(
        bound({
          bindings: { up: { tool: 'ports_up' }, stop: { tool: 'ports_down' } },
        }),
      ),
    ).rejects.toThrow('addon demo: message up: unknown tool ports_up');
  });

  it('rejects fixed args on a message that declares input', async () => {
    await expect(
      loadInbox(
        bound({
          bindings: {
            up: { tool: 'ports_up' },
            stop: { tool: 'ports_down', args: { port: 1 } },
          },
        }),
        undefined,
        tools,
      ),
    ).rejects.toThrow(
      'addon demo: message stop: fixed args with a declared input',
    );
  });

  it('rejects an undeclared binding', async () => {
    await expect(
      loadInbox(
        bound({
          bindings: {
            up: { tool: 'ports_up' },
            stop: { tool: 'ports_down' },
            extra: { tool: 'ports_up' },
          },
        }),
        undefined,
        tools,
      ),
    ).rejects.toThrow('addon demo: binding extra is not declared');
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
