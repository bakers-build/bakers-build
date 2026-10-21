import { describe, expect, it, vi } from 'vitest';
import { formatActionLadder } from '../../../src/Component/footer-actions/index.js';
import {
  handleTicketCopy,
  ticketCopyActions,
  ticketEditAction,
  ticketHeaderTree,
  ticketTitleOf,
} from '../../../src/Entity/ticket/Component/ticket-detail/index.js';
import type { ScreenContext } from '../../../src/Screen/screen.js';
import type { TicketDetailDocument } from '../../../src/types.js';
import { childIdsOf, renderTree } from '../../render-tree.js';

const DOC: TicketDetailDocument = {
  data: {
    type: 'bb_ticket--bb_ticket',
    id: 'ticket-uuid',
    attributes: {
      identifier: 'BB-1',
      title: 'a title',
      state: 'active',
    },
    relationships: { labels: { data: [] } },
  },
  included: [],
};

const LONG_ASSIGNEE =
  'Alexandria-Catherine von Longername-the-Third of the Southern Workshop';

const assignedDoc = (
  extras: Partial<NonNullable<TicketDetailDocument['data']>> = {},
  included: NonNullable<TicketDetailDocument['included']> = [],
): TicketDetailDocument => ({
  data: {
    type: 'bb_ticket--bb_ticket',
    id: 'ticket-uuid',
    attributes: {
      identifier: 'BB-1',
      title: 'a title',
      state: 'active',
      ...((extras.attributes as Record<string, unknown> | undefined) ?? {}),
    },
    relationships: {
      labels: { data: [] },
      ...(extras.relationships ?? {}),
    },
  },
  included,
});

function context(): ScreenContext {
  return {
    params: { ticketId: 'route-ticket' },
    services: { baseUrl: 'https://bakers.example.test' },
    copyToClipboard: vi.fn(() => 'copied'),
  } as unknown as ScreenContext;
}

const headerText = (document: TicketDetailDocument): string =>
  renderTree(ticketHeaderTree(document, 'BB-1', 'a title', [])).join('\n');

describe('ticket chrome helpers', () => {
  it('builds the header rows without a screen', () => {
    const tree = ticketHeaderTree(DOC, 'BB-1', 'a title', []);
    // New two-line header: title + meta (state · assignee · labels).
    // DOC has state 'active', no assignee (→ '—'), no labels (→ '—').
    // The meta filter drops '—' parts, so only 'active' remains.
    expect(childIdsOf(tree, 'ticket-detail-header')).toEqual([
      'ticket-detail-header-title',
      'ticket-detail-header-meta',
    ]);
  });

  it('shows assignee on the meta line; created-by is not in the header', () => {
    const text = headerText(
      assignedDoc(
        {
          attributes: { assignee_name: 'Pat', owner_name: 'Owner' },
          relationships: {
            assignee_user_id: { data: { id: 'user-1' } },
            owner_user_id: { data: { id: 'owner-1' } },
          },
        },
        [
          {
            id: 'user-1',
            type: 'user--user',
            attributes: { display_name: 'Pat', name: 'pat' },
          },
          {
            id: 'owner-1',
            type: 'user--user',
            attributes: { display_name: 'Owner', name: 'owner' },
          },
        ],
      ),
    );
    // Assignee appears on the meta line without a prefix.
    expect(text).toContain('Pat');
    // Created-by is no longer rendered in the header.
    expect(text).not.toContain('Created by:');
    expect(text).not.toContain('Owner');
  });

  it('drops the assignee dash from the meta line when there is no assignee', () => {
    // DOC has no assignee (→ '—') and state 'active'. '—' parts are filtered
    // out, so the meta line is just the state.
    const rows = renderTree(ticketHeaderTree(DOC, 'BB-1', 'a title', []));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain('BB-1');
    expect(rows[1]).toBe('active');
    // Created-by is absent from the header entirely.
    expect(rows.join('\n')).not.toContain('Created by:');
    expect(rows.join('\n')).not.toContain('Assigned:');
  });

  it('wraps a long meta line at 60 columns and keeps each part on its own segment', () => {
    const tree = ticketHeaderTree(
      assignedDoc({ attributes: { assignee_name: LONG_ASSIGNEE } }),
      'BB-1',
      'a title',
      [],
    );
    const rows = renderTree(tree);
    // The meta line contains the long assignee name.
    const metaText = rows.slice(1).join(' ');
    expect(metaText).toContain(LONG_ASSIGNEE);
    // Created-by is not anywhere in the header.
    expect(rows.join('\n')).not.toContain('Created by:');
    expect(rows.join('\n')).not.toContain('Assigned:');
    // The combined meta string is longer than 60 chars, so it wraps.
    const combined = `active  ·  ${LONG_ASSIGNEE}`;
    expect(combined.length).toBeGreaterThan(60);
  });

  it('shows label names on the meta line and omits created-by from the header', () => {
    // DOC has state 'active', no assignee — the meta line is just 'active'
    // because the '—' assignee is dropped.
    const noLabelText = headerText(DOC);
    expect(noLabelText).not.toContain('Labels:');
    expect(noLabelText).not.toContain('Created by:');
    const many = headerText(
      assignedDoc(
        {
          relationships: {
            labels: {
              data: [
                { id: 'l-1' },
                { id: 'l-2' },
                { id: 'l-3' },
                { id: 'l-4' },
                { id: 'l-5' },
              ],
            },
          },
        },
        [
          {
            id: 'l-1',
            type: 'bb_term--bb_labels',
            attributes: { name: 'work:code' },
          },
          {
            id: 'l-2',
            type: 'bb_term--bb_labels',
            attributes: { name: 'priority:high' },
          },
          {
            id: 'l-3',
            type: 'bb_term--bb_labels',
            attributes: { name: 'area:tui' },
          },
          {
            id: 'l-4',
            type: 'bb_term--bb_labels',
            attributes: { name: 'needs:review' },
          },
          {
            id: 'l-5',
            type: 'bb_term--bb_labels',
            attributes: { name: 'blocked' },
          },
        ],
      ),
    );
    // Label names appear on the meta line without a 'Labels:' prefix.
    // The line may wrap, so check each name individually.
    for (const label of [
      'work:code',
      'priority:high',
      'area:tui',
      'needs:review',
      'blocked',
    ]) {
      expect(many, `label "${label}" is in the header`).toContain(label);
    }
    // Created-by is no longer in the header.
    expect(many).not.toContain('Created by:');
  });

  it('derives the ticket title with the existing fallbacks', () => {
    expect(ticketTitleOf(DOC)).toEqual({
      identifier: 'BB-1',
      title: 'a title',
    });
    expect(
      ticketTitleOf({ data: DOC.data && { ...DOC.data, attributes: {} } }),
    ).toEqual({
      identifier: '',
      title: 'ticket',
    });
  });

  it('offers y and Y and nothing else', () => {
    expect(formatActionLadder(ticketCopyActions())).toBe(
      'y copy id · Y copy link',
    );
  });

  it('copies the open ticket identifier and link', () => {
    const ctx = context();
    expect(handleTicketCopy('y', ctx, DOC)).toBe('copied BB-1');
    expect(handleTicketCopy('Y', ctx, DOC)).toBe('copied the link to BB-1');
    expect(ctx.copyToClipboard).toHaveBeenNthCalledWith(1, 'BB-1');
    expect(ctx.copyToClipboard).toHaveBeenNthCalledWith(
      2,
      'https://bakers.example.test/admin/bakers/ticket/ticket-uuid',
    );
  });

  it('leaves a key that is not y or Y unhandled', () => {
    expect(handleTicketCopy('s', context(), DOC)).toBeUndefined();
  });

  it('builds the edit action from the document and route context', () => {
    expect(ticketEditAction(context(), DOC)).toEqual({
      type: 'navigate',
      routeId: 'ticket.assignment.edit',
      params: { ticketId: 'ticket-uuid' },
    });
    expect(ticketEditAction(context(), undefined)).toEqual({
      type: 'navigate',
      routeId: 'ticket.assignment.edit',
      params: { ticketId: 'route-ticket' },
    });
  });
});
