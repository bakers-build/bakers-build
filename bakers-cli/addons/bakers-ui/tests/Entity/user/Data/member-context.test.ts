import type { DrupalJsonApiParams } from 'drupal-jsonapi-params';
import { expect, it, vi } from 'vitest';
import { assertActiveMember } from '../../../../src/Entity/user/Data/member-context.js';
import type { DropshClient } from '../../../../src/types.js';

function clientWith(document: unknown): DropshClient {
  const collection = {
    where: vi.fn(),
    first: vi.fn(async () => ({ attr: () => 7 })),
  };
  collection.where.mockReturnValue(collection);
  return {
    collection: vi.fn(() => collection),
    get: vi.fn(async () => document),
  } as unknown as DropshClient;
}

it('accepts an active member of the selected parent', async () => {
  await expect(
    assertActiveMember(
      clientWith({
        data: [{ relationships: { uid: { data: { id: 'user-1' } } } }],
      }),
      'bb_team',
      'team-1',
      'user-1',
    ),
  ).resolves.toBeUndefined();
});

it('requests a total order on the membership walk', async () => {
  const client = clientWith({
    data: [{ relationships: { uid: { data: { id: 'user-1' } } } }],
  });
  await assertActiveMember(client, 'bb_team', 'team-1', 'user-1');
  const params = (client.get as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as
    | DrupalJsonApiParams
    | undefined;
  expect(decodeURIComponent(params?.getQueryString() ?? '')).toContain(
    'sort=drupal_internal__id',
  );
});

it('rejects a user absent from the selected parent', async () => {
  await expect(
    assertActiveMember(
      clientWith({ data: [] }),
      'bb_team',
      'team-1',
      'outsider',
    ),
  ).rejects.toThrow('not an active member');
});

it('rejects withheld membership rows instead of treating them as absence', async () => {
  await expect(
    assertActiveMember(
      clientWith({ data: [], meta: { omitted: { detail: 'forbidden' } } }),
      'bb_workspace',
      'workspace-1',
      'user-1',
    ),
  ).rejects.toThrow('withheld');
});
