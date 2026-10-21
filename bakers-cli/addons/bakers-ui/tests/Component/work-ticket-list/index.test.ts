import { expect, it } from 'vitest';
import { workTicketSections } from '../../../src/Component/work-ticket-list/index.js';

it('renders every ticket once and marks unassigned work in its status section', () => {
  const unassigned = {
    id: 'ticket-1',
    identifier: 'BB-1',
    title: 'Needs an owner',
    assigneeId: null,
  };
  const sections = workTicketSections({
    running: [unassigned],
    waiting: [
      {
        id: 'ticket-2',
        identifier: 'BB-2',
        title: 'Queued',
        assigneeId: 'user-1',
      },
    ],
  });

  expect(sections.map((section) => section.heading)).toEqual([
    'Running',
    'Waiting',
  ]);
  expect(
    sections.flatMap((section) => section.rows.map((row) => row.id)),
  ).toEqual(['ticket-1', 'ticket-2']);
  expect(sections[0]?.rows[0]?.cells.map((cell) => cell.text)).toEqual([
    'BB-1',
    'Unassigned',
    'Needs an owner',
  ]);
});

it('keeps identifier and marker fixed while the title owns remaining width', () => {
  const sections = workTicketSections({
    running: [],
    waiting: [
      {
        id: 'ticket-2',
        identifier: 'BB-2',
        title: 'A long title',
        assigneeId: 'user-1',
      },
    ],
  });

  const section = sections.find(({ heading }) => heading === 'Waiting');
  expect(
    section?.rows[0]?.cells.map(({ width, grow }) => ({ width, grow })),
  ).toEqual([
    { width: 12, grow: undefined },
    { width: 12, grow: undefined },
    { width: 0, grow: 1 },
  ]);
});
