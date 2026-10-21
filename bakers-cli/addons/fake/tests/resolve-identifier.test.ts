import { describe, expect, it } from 'vitest';
import { fakeRemote } from '../src/remote.js';

describe('resolveTicketByIdentifier', () => {
  it('resolves a known identifier to uuid+title, unknown to null', async () => {
    const remote = await fakeRemote({
      tickets: {
        'uuid-134': {
          identifier: 'BB-134',
          title: 'Do a thing',
          state: 'done',
        },
      },
    }).createRemote({ site: { base_url: 'http://x' } } as never);

    expect(await remote.resolveTicketByIdentifier('bakers', 'BB-134')).toEqual({
      uuid: 'uuid-134',
      title: 'Do a thing',
    });
    expect(
      await remote.resolveTicketByIdentifier('bakers', 'BB-999'),
    ).toBeNull();
  });
});
