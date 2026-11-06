import { expect, it } from 'vitest';
import {
  buildUserTicketQueryParams,
  DEFAULT_TICKET_CRITERIA,
} from '../../../../src/Entity/ticket/Data/query.js';

const qs = (userId: string, criteria = DEFAULT_TICKET_CRITERIA) =>
  decodeURIComponent(
    buildUserTicketQueryParams(userId, criteria).getQueryString(),
  );

// BB-377 D2 — user ticket list filters by assignee, keeps the closed cycle.
it('filters by assignee_user_id.id and applies the default closed=hidden', () => {
  const s = qs('u-1');
  expect(s).toContain('filter[assignee_user_id.id]=u-1');
  expect(s).toContain('filter[closed]=0');
  expect(s).not.toMatch(/project_id\.id/);
  expect(s).toContain('sort=-changed,-drupal_internal__id');
  expect(s).toMatch(/page\[limit\]=20/);
});

it('honours closed-only and closed-null like the project builder', () => {
  expect(qs('u-1', { ...DEFAULT_TICKET_CRITERIA, closed: true })).toContain(
    'filter[closed]=1',
  );
  expect(qs('u-1', { ...DEFAULT_TICKET_CRITERIA, closed: null })).not.toMatch(
    /filter\[closed\]/,
  );
});
