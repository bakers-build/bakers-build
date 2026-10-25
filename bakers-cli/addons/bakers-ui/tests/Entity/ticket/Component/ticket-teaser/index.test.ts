import { describe, expect, it } from 'vitest';
import {
  ticketTeaserLines,
  ticketTeaserTree,
} from '../../../../../src/Entity/ticket/Component/ticket-teaser/index.js';
import type { TicketDetailDocument } from '../../../../../src/types.js';
import { idsOf, renderTree } from '../../../../render-tree.js';

// BB-223 AC-7 (spec Decision 13, variant A): a compact block rendered from the
// field set the Drupal view-mode display lists, instead of the tabbed detail.
// Pure `document → string[]`, no I/O.

const full: TicketDetailDocument = {
  data: {
    id: 'u1',
    type: 'bb_ticket--bb_ticket',
    attributes: {
      identifier: 'BB-223',
      title: 'bakers ui deep links',
      state: 'coding',
      derived_status: 'running',
      since_label: '3h',
      claim_machine: 'cw-framework',
      assignee_name: 'Christian Wiedemann',
      assignee_initials: 'CW',
      workflow: 'bb_work',
      priority: 2,
    },
  },
};

/** The single line containing `needle`, for readable assertions. */
function lineWith(lines: string[], needle: string): string {
  const hit = lines.find((l) => l.includes(needle));
  if (hit === undefined) {
    throw new Error(`no line contains '${needle}' in:\n${lines.join('\n')}`);
  }
  return hit;
}

describe('ticketTeaserLines — the `teaser` field set', () => {
  const lines = ticketTeaserLines(full, 'teaser');

  it('leads with the identifier and the title', () => {
    expect(lines[0]).toContain('BB-223');
    expect(lines[0]).toContain('bakers ui deep links');
  });

  it.each([
    ['state', 'coding'],
    ['derived status', 'running'],
    ['since', '3h'],
    ['assignee', 'Christian Wiedemann'],
    ['claim machine', 'cw-framework'],
  ])('renders the %s field (%s)', (_label, value) => {
    expect(lines.join('\n')).toContain(value);
  });

  it('does NOT render the board_card-only fields', () => {
    // `type` (workflow) and `priority` belong to the board_card display, not the
    // teaser one — the field sets are read off two different YAML files.
    expect(lines.join('\n')).not.toContain('bb_work');
  });

  it('renders no tab bar (it replaces the tabbed detail, not decorates it)', () => {
    expect(lines.join('\n')).not.toContain('Comments');
  });
});

describe('ticketTeaserLines — the `board_card` field set', () => {
  const lines = ticketTeaserLines(full, 'board_card');

  it('leads with the identifier and the title', () => {
    expect(lines[0]).toContain('BB-223');
    expect(lines[0]).toContain('bakers ui deep links');
  });

  it.each([
    ['state', 'coding'],
    ['type', 'bb_work'],
    ['derived status', 'running'],
    ['priority', '2'],
    ['claim machine (the footer slot)', 'cw-framework'],
  ])('renders the %s field (%s)', (_label, value) => {
    expect(lines.join('\n')).toContain(value);
  });

  it('does NOT render the teaser-only fields', () => {
    // `since` and the assignee are hidden on the board_card display.
    expect(lines.join('\n')).not.toContain('Christian Wiedemann');
  });
});

// BB-340 D1 — the SAME field set, as the renderable tree the screen hands over.
// `ticketTeaserLines` above stays because the compact block is also what a PIPE
// prints (`--view teaser`, spec F5): the rows and the tree are two shapes of one
// keyed source, so they cannot describe different tickets.
describe('ticketTeaserTree — the tree the screen hands over', () => {
  it('carries the same values as the rows, in the same order', () => {
    // The label and its value are separate CELLS now, so the tree's text is the
    // pair rather than one padded string. Joining the pair back is what makes the
    // two shapes comparable without measuring anything (D8).
    const tree = ticketTeaserTree(full, 'teaser');
    expect(renderTree(tree).join('\n')).toContain('Christian Wiedemann');
    expect(renderTree(tree)).toContain('state');
    expect(renderTree(tree)).toContain('coding');
    const rows = ticketTeaserLines(full, 'teaser');
    expect(renderTree(tree)[0], 'the heading row is one cell').toBe(rows[0]);
  });

  it('keys every row on the FIELD it renders, never on its position', () => {
    expect(idsOf(ticketTeaserTree(full, 'teaser'))).toEqual([
      'ticket-teaser',
      'ticket-teaser-heading',
      'ticket-teaser-gap',
      'ticket-teaser-row-state',
      'ticket-teaser-label-state',
      'ticket-teaser-value-state',
      'ticket-teaser-row-status',
      'ticket-teaser-label-status',
      'ticket-teaser-value-status',
      'ticket-teaser-row-since',
      'ticket-teaser-label-since',
      'ticket-teaser-value-since',
      'ticket-teaser-row-assignee',
      'ticket-teaser-label-assignee',
      'ticket-teaser-value-assignee',
      'ticket-teaser-row-claim',
      'ticket-teaser-label-claim',
      'ticket-teaser-value-claim',
    ]);
  });

  it('renders the board_card field set under its own keys', () => {
    const ids = idsOf(ticketTeaserTree(full, 'board_card'));
    expect(ids).toContain('ticket-teaser-row-type');
    expect(ids).toContain('ticket-teaser-row-priority');
    expect(ids, 'the teaser-only fields are absent').not.toContain(
      'ticket-teaser-row-assignee',
    );
  });
});

describe('ticketTeaserLines — degradation', () => {
  it('falls back to the shared em-dash placeholder for missing fields', () => {
    const bare: TicketDetailDocument = {
      data: { id: 'u1', attributes: { identifier: 'BB-9' } },
    };
    const lines = ticketTeaserLines(bare, 'teaser');
    expect(lines[0]).toContain('BB-9');
    expect(lineWith(lines, 'state')).toContain('—');
    expect(lineWith(lines, 'assignee')).toContain('—');
  });

  it('renders an empty document without throwing', () => {
    expect(() => ticketTeaserLines({}, 'teaser')).not.toThrow();
    expect(ticketTeaserLines({}, 'board_card').length).toBeGreaterThan(0);
  });
});
