import type { JsonApiClient } from 'dropsh/plugin';
import { HttpError } from 'dropsh/plugin';
import { describe, expect, it, vi } from 'vitest';
import { DrupalBbRemote } from '../src/index.js';

// Request shapes of the addon registration and inbox resources (contract 2).

function client(overrides: Partial<JsonApiClient>): JsonApiClient {
  return {
    get: vi.fn(),
    post: vi.fn(),
    ...overrides,
  } as unknown as JsonApiClient;
}

const definition = {
  name: 'fake',
  version: '0.0.1',
  contract: 2 as const,
  messages: { status: { label: 'Status', access: 'view' as const } },
};

describe('DrupalBbRemote — addon inbox messages', () => {
  it('registerAddons posts the definitions and returns accepted/rejected', async () => {
    const post = vi.fn(async () => ({
      data: {
        attributes: {
          accepted: [{ name: 'fake', version: '0.0.1', id: 'a-1' }],
          rejected: [],
        },
      },
    }));
    const remote = new DrupalBbRemote(client({ post }));
    const out = await remote.registerAddons('node-1', [definition]);
    expect(post).toHaveBeenCalledWith('bakers/addons', {
      data: { attributes: { conductor: 'node-1', addons: [definition] } },
    });
    expect(out.accepted).toEqual([
      { name: 'fake', version: '0.0.1', id: 'a-1' },
    ]);
  });

  it('registerAddons returns a 422 carrying rejected addons as a registration', async () => {
    const body = {
      data: {
        attributes: {
          accepted: [],
          rejected: [{ name: 'fake', version: '0.0.1', error: 'bad input' }],
        },
      },
    };
    const post = vi.fn(async () => {
      throw new HttpError(422, 'Unprocessable', body);
    });
    const remote = new DrupalBbRemote(client({ post }));
    const out = await remote.registerAddons('node-1', [definition]);
    expect(out.rejected).toEqual([
      { name: 'fake', version: '0.0.1', error: 'bad input' },
    ]);
  });

  it('registerAddons rethrows any other failure', async () => {
    const post = vi.fn(async () => {
      throw new HttpError(403, 'Forbidden', {});
    });
    const remote = new DrupalBbRemote(client({ post }));
    await expect(remote.registerAddons('node-1', [definition])).rejects.toThrow(
      'Forbidden',
    );
  });

  it('fetchInbox maps messages', async () => {
    const get = vi.fn(async () => ({
      data: {
        attributes: {
          messages: [
            {
              id: 'm-1',
              message_id: 'fake.echo',
              version: '0.0.1',
              ticket: 't-1',
              payload: { text: 'hi' },
              worktree_path: '/w/T-1',
              requested_by: 'user-uuid-1',
            },
          ],
        },
      },
    }));
    const remote = new DrupalBbRemote(client({ get }));
    const inbox = await remote.fetchInbox('node-1');
    expect(get).toHaveBeenCalledWith('bakers/inbox/node-1');
    expect(inbox).toEqual({
      messages: [
        {
          id: 'm-1',
          messageId: 'fake.echo',
          version: '0.0.1',
          ticketUuid: 't-1',
          payload: { text: 'hi' },
          worktreePath: '/w/T-1',
          requestedBy: 'user-uuid-1',
        },
      ],
    });
  });

  it('writeInboxResult posts status and result', async () => {
    const post = vi.fn(async () => ({}));
    const remote = new DrupalBbRemote(client({ post }));
    await remote.writeInboxResult('m-1', 'done', { markdown: 'ok' });
    await remote.writeInboxResult('m-1', 'running');
    expect(post).toHaveBeenNthCalledWith(1, 'bakers/inbox/m-1/result', {
      data: { attributes: { status: 'done', result: { markdown: 'ok' } } },
    });
    expect(post).toHaveBeenNthCalledWith(2, 'bakers/inbox/m-1/result', {
      data: { attributes: { status: 'running' } },
    });
  });
});
