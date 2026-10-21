// The fake addon's contract-2 inbox messages (BB-661): one view-access
// message, one that takes input, one that fails and one that never finishes
// on its own — enough to drive the conductor's inbox step in tests.
import type {
  InboxMessageHandler,
  InboxMessages,
} from '@bakers-build/conductor/contract';

const handlers: Record<string, InboxMessageHandler> = {
  status: async () => ({ markdown: 'fake: ok' }),
  echo: async (request) => ({
    markdown: String(request.payload?.text ?? ''),
  }),
  boom: async () => {
    throw new Error('boom');
  },
  slow: (request) =>
    new Promise((_resolve, reject) => {
      request.signal.addEventListener('abort', () =>
        reject(new Error('aborted')),
      );
    }),
};

export const fakeInbox: InboxMessages = {
  contract: 2,
  label: 'Fake',
  messages: {
    status: { label: 'Status', access: 'view' },
    echo: {
      label: 'Echo',
      access: 'view',
      input: {
        type: 'object',
        required: ['text'],
        properties: { text: { type: 'string' } },
      },
    },
    boom: { label: 'Boom', access: 'view' },
    slow: { label: 'Slow', access: 'view' },
  },
  handlers: async () => handlers,
};
