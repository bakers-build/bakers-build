import { expect, it, vi } from 'vitest';
import {
  buildTeamMemberTicketQueryParams,
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

it('filters team-member tickets by assignee and linked projects', () => {
  const query = decodeURIComponent(
    buildTeamMemberTicketQueryParams(
      'u-1',
      ['p-1', 'p-2'],
      DEFAULT_TICKET_CRITERIA,
    ).getQueryString(),
  );
  expect(query).toContain('filter[assignee_user_id.id]=u-1');
  expect(query).toContain('filter[project_id.id][condition][operator]=IN');
  expect(query).toContain('filter[project_id.id][condition][value][0]=p-1');
  expect(query).toContain('filter[project_id.id][condition][value][1]=p-2');
  expect(query).toContain('sort=-changed,-drupal_internal__id');
});

it('does not issue an unscoped request for a team with no projects', async () => {
  const { loadTeamMemberTickets } = await import(
    '../../../../src/Entity/ticket/Data/tickets.js'
  );
  const get = vi.fn();
  const result = await loadTeamMemberTickets(
    { get } as never,
    'u-1',
    [],
    DEFAULT_TICKET_CRITERIA,
  );
  expect(result.rows).toEqual([]);
  expect(get).not.toHaveBeenCalled();
});

it('rejects omitted team-member ticket pages', async () => {
  const { loadTeamMemberTickets } = await import(
    '../../../../src/Entity/ticket/Data/tickets.js'
  );
  const get = vi.fn(async () => ({ data: [], meta: { omitted: {} } }));
  await expect(
    loadTeamMemberTickets(
      { get } as never,
      'u-1',
      ['p-1'],
      DEFAULT_TICKET_CRITERIA,
      1,
    ),
  ).rejects.toThrow('withheld');
});

it('honours closed-only and closed-null like the project builder', () => {
  expect(qs('u-1', { ...DEFAULT_TICKET_CRITERIA, closed: true })).toContain(
    'filter[closed]=1',
  );
  expect(qs('u-1', { ...DEFAULT_TICKET_CRITERIA, closed: null })).not.toMatch(
    /filter\[closed\]/,
  );
});
