import { expect, it } from 'vitest';
import {
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
