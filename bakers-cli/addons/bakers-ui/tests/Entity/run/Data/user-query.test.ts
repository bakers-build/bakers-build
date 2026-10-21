import { expect, it, vi } from 'vitest';
import {
  buildTeamMemberRunQueryParams,
  buildUserRunQueryParams,
  DEFAULT_RUN_CRITERIA,
} from '../../../../src/Entity/run/Data/query.js';

const qs = (userId: string, criteria = DEFAULT_RUN_CRITERIA) =>
  decodeURIComponent(
    buildUserRunQueryParams(userId, criteria).getQueryString(),
  );

// BB-377 D2 — runs carry no user of their own; attribution is through the
// ticket assignee, the same path `user_runs_totals`'s `scope.field` walks.
it('filters by ticket_id.assignee_user_id.id and default closed=hidden', () => {
  const s = qs('u-1');
  expect(s).toContain('filter[ticket_id.assignee_user_id.id]=u-1');
  expect(s).toContain('filter[closed]=0');
  expect(s).not.toMatch(/ticket_id\.project_id\.id/);
  expect(s).toContain('sort=-started_at,-drupal_internal__id');
  expect(s).toMatch(/page\[limit\]=20/);
});

it('filters team-member runs by assignee and linked projects', () => {
  const query = decodeURIComponent(
    buildTeamMemberRunQueryParams(
      'u-1',
      ['p-1', 'p-2'],
      DEFAULT_RUN_CRITERIA,
    ).getQueryString(),
  );
  expect(query).toContain('filter[ticket_id.assignee_user_id.id]=u-1');
  expect(query).toContain(
    'filter[ticket_id.project_id.id][condition][operator]=IN',
  );
  expect(query).toContain(
    'filter[ticket_id.project_id.id][condition][value][0]=p-1',
  );
  expect(query).toContain(
    'filter[ticket_id.project_id.id][condition][value][1]=p-2',
  );
  expect(query).toContain('sort=-started_at,-drupal_internal__id');
});

it('does not issue an unscoped request for a team with no projects', async () => {
  const { loadTeamMemberRuns } = await import(
    '../../../../src/Entity/run/Data/runs.js'
  );
  const get = vi.fn();
  const result = await loadTeamMemberRuns(
    { get } as never,
    'u-1',
    [],
    DEFAULT_RUN_CRITERIA,
  );
  expect(result.rows).toEqual([]);
  expect(get).not.toHaveBeenCalled();
});

it('rejects omitted team-member run pages', async () => {
  const { loadTeamMemberRuns } = await import(
    '../../../../src/Entity/run/Data/runs.js'
  );
  const get = vi.fn(async () => ({ data: [], meta: { omitted: {} } }));
  await expect(
    loadTeamMemberRuns(
      { get } as never,
      'u-1',
      ['p-1'],
      DEFAULT_RUN_CRITERIA,
      1,
    ),
  ).rejects.toThrow('withheld');
});
