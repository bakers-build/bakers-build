import { expect, it } from 'vitest';
import {
  buildRunQueryParams,
  DEFAULT_RUN_CRITERIA,
  describeCriteria,
  hasActiveCriteria,
  type RunCriteria,
} from '../../../../src/Entity/run/Data/query.js';

const qs = (
  projectId: string,
  criteria: RunCriteria,
  page?: { size: number; index: number },
) =>
  decodeURIComponent(
    buildRunQueryParams(projectId, criteria, page).getQueryString(),
  );

// BB-292 — the run list's sparse fieldset, its INCLUDE fieldset and its page.
it('requests only the rendered run fields plus the ticket identifier (AC-2)', () => {
  const s = qs('P1', { closed: false });
  expect(s).toMatch(
    /fields\[bb_run--bb_run\]=drupal_internal__id,state,state_at_start,agent,started_at,created,heartbeat,claim_expires_at,closed,ticket_id/,
  );
  // The measured headline: the sideloaded tickets carried 191.4 KB of whole
  // ticket resources to render one column of identifiers.
  expect(s).toMatch(/fields\[bb_ticket--bb_ticket\]=identifier/);
  expect(s).toMatch(/page\[limit\]=20/);
  expect(s).not.toMatch(/description/);
});

it('pages and keeps the scope and closed criterion (AC-3, AC-4)', () => {
  for (const index of [0, 1, 5]) {
    const s = qs('P1', { closed: true }, { size: 20, index });
    expect(s).toMatch(/ticket_id\.project_id\.id/);
    expect(s).toMatch(/filter\[closed\]=1/);
    expect(s).toContain('sort=-started_at,-drupal_internal__id');
    if (index > 0)
      expect(s).toMatch(new RegExp(`page\\[offset\\]=${index * 20}`));
    else expect(s).not.toMatch(/page\[offset\]/);
  }
});

it('default criteria: scope + closed=0 + include + sort + page', () => {
  const s = qs('proj-1', DEFAULT_RUN_CRITERIA);
  expect(s).toContain('filter[ticket_id.project_id.id]=proj-1');
  expect(s).toContain('filter[closed]=0');
  expect(s).toContain('include=ticket_id');
  expect(s).toContain('sort=-started_at,-drupal_internal__id');
  // 50 until BB-292; the cap is the ticket, not a casualty of it. 15 until
  // the operator's live review set it to 20.
  expect(s).toContain('page[limit]=20');
});

it('closed-only emits filter[closed]=1, never a boolean literal', () => {
  const s = qs('proj-1', { closed: true });
  expect(s).toContain('filter[closed]=1');
  expect(s).not.toMatch(/filter\[closed\]=(true|false)/);
});

it('closed null emits no closed filter', () => {
  expect(qs('proj-1', { closed: null })).not.toMatch(/filter\[closed\]/);
});

it('hasActiveCriteria / describeCriteria follow the ticket shape (AC-6)', () => {
  expect(hasActiveCriteria({ closed: false })).toBe(true);
  expect(hasActiveCriteria({ closed: null })).toBe(false);
  expect(describeCriteria({ closed: false })).toBe('closed:hidden');
  expect(describeCriteria({ closed: true })).toBe('closed:only');
  expect(describeCriteria({ closed: null })).toBe('');
});

// The conductor-scoped held-work query.
import { buildConductorRunQueryParams } from '../../../../src/Entity/run/Data/query.js';

const conductorQs = (
  conductorId: string,
  page?: { size: number; index: number },
) =>
  decodeURIComponent(
    buildConductorRunQueryParams(conductorId, page).getQueryString(),
  );

it('scopes held work to the conductor and to the non-terminal states', () => {
  const s = conductorQs('C1');
  expect(s).toContain('filter[conductor_id.id]=C1');
  expect(s).toContain('filter[state][condition][path]=state');
  expect(s).toContain('filter[state][condition][operator]=IN');
  expect(s).toContain('filter[state][condition][value][0]=claimed');
  expect(s).toContain('filter[state][condition][value][1]=running');
  expect(s).not.toContain('filter[closed]');
  expect(s).toContain('sort=-started_at,-drupal_internal__id');
});

it('loads the ticket title beside the identifier, which the project list does not', () => {
  const s = conductorQs('C1');
  expect(s).toContain('fields[bb_ticket--bb_ticket]=identifier,title');
});

it('pages the held-work read', () => {
  expect(conductorQs('C1')).toContain('page[limit]=20');
  expect(conductorQs('C1', { size: 20, index: 2 })).toContain(
    'page[offset]=40',
  );
  expect(conductorQs('C1', { size: 20, index: 0 })).not.toContain(
    'page[offset]',
  );
});
