import { describe, expect, it } from 'vitest';
import { fakeRemote } from '../src/remote.js';

describe('resolveTicketByIdentifier', () => {
  it('keeps UUID lookups within the selected project', async () => {
    const remote = await fakeRemote({
      tickets: {
        foreign: {
          identifier: 'SHOP-42',
          title: 'Foreign',
          state: 'done',
          projectId: 'foreign-project',
        },
        own: {
          identifier: 'SHOP-42',
          title: 'Own',
          state: 'done',
          projectId: 'own-project',
        },
      },
    }).createRemote({ site: { base_url: 'http://x' } } as never);
    expect(
      await remote.resolveTicketByIdentifier(
        { uuid: 'own-project' },
        'SHOP-42',
      ),
    ).toEqual({ uuid: 'own', title: 'Own' });
    expect(
      await remote.resolveTicketByIdentifier(
        { uuid: 'missing-project' },
        'SHOP-42',
      ),
    ).toBeNull();
  });
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
