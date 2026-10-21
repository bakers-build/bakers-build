import { expect, it } from 'vitest';
import { editParentOptionSource } from '../../../../src/Entity/ticket/Form/edit-parent-source.js';
import { fakeClient } from '../../../test-support.js';

const PROJECT = 'pppppppp-0000-0000-0000-000000000001';
const SELF = 'cccccccc-0000-0000-0000-000000000001';
const OTHER = 'cccccccc-0000-0000-0000-000000000002';
const THIRD = 'cccccccc-0000-0000-0000-000000000003';
const PATH = 'bb_ticket/bb_ticket';

const ticket = (id: string, identifier: string, title: string) => ({
  type: 'bb_ticket--bb_ticket',
  id,
  attributes: { identifier, title },
});

it('BB-360 D5: parent candidates exclude the open ticket itself', async () => {
  const client = fakeClient({
    documents: {
      [PATH]: {
        data: [
          ticket(SELF, 'BB-360', 'self'),
          ticket(OTHER, 'BB-1', 'other work'),
          ticket(THIRD, 'BB-2', 'third'),
        ],
      },
    },
  });
  const source = editParentOptionSource(client, PROJECT, SELF);
  const outcome = await source.load('');
  expect(outcome.options.map((o) => o.id)).toEqual([OTHER, THIRD]);
  expect(outcome.options.map((o) => o.id)).not.toContain(SELF);
});

it('uses identifier+title match mode (label composed for both halves)', async () => {
  const client = fakeClient({
    documents: {
      [PATH]: {
        data: [ticket(OTHER, 'BB-1', 'other work')],
      },
    },
  });
  const source = editParentOptionSource(client, PROJECT, SELF);
  const outcome = await source.load('');
  expect(outcome.options[0]?.label).toBe('BB-1 · other work');
  expect(source.bag).toBe('parents');
});
