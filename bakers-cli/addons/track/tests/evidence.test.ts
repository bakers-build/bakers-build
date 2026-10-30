import { createBbConnectionClient } from '@bakers-build/core';
import { describe, expect, it } from 'vitest';
import { loadEvidence } from '../src/evidence.js';

const owner = '11111111-1111-4111-8111-111111111111';
function row(
  type: string,
  id: string,
  attributes: Record<string, unknown>,
  relations: Record<string, string> = {},
) {
  return {
    type: `${type}--${type}`,
    id,
    attributes,
    relationships: Object.fromEntries(
      Object.entries(relations).map(([key, value]) => [
        key,
        {
          data: {
            type:
              key === 'owner_user_id' ? 'user--user' : 'bb_ticket--bb_ticket',
            id: value,
          },
        },
      ]),
    ),
  };
}
function run(
  id: string,
  start: string | null,
  end: string | null,
  who = owner,
) {
  return row(
    'bb_run',
    id,
    {
      started_at: start,
      closed_date: end,
      state: end ? 'done' : 'running',
      state_at_start: 'coding',
    },
    { owner_user_id: who, ticket_id: 'ticket-a', conductor_id: 'conductor-a' },
  );
}
function worklog(id: string, values: Record<string, unknown> = {}) {
  return {
    id,
    work_date: '2026-10-12',
    state: 'recorded',
    duration_seconds: 3600,
    description: null,
    source_keys: [],
    project_id: null,
    ticket_id: null,
    submission_id: null,
    ...values,
  };
}
function page(
  data: unknown[],
  extra: { omitted?: boolean; next_offset?: number | null } = {},
) {
  return {
    data,
    projects: [],
    tickets: [],
    omitted: false,
    next_offset: null,
    ...extra,
  };
}
async function fixture(overrides: Record<string, unknown> = {}) {
  const urls: URL[] = [];
  const documents: Record<string, unknown> = {
    '/jsonapi/': { meta: { links: { me: { meta: { id: owner } } } } },
    [`/jsonapi/user/user/${owner}`]: {
      data: {
        type: 'user--user',
        id: owner,
        attributes: {
          timezone: 'Europe/Berlin',
          work_schedule: {
            day_0: 32400,
            day_1: 32400,
            day_2: 32400,
            day_3: 32400,
            day_4: 32400,
            day_5: 0,
            day_6: 0,
          },
        },
      },
    },
    '/jsonapi/bb_run/bb_run': {
      data: [
        run('r1', '2026-10-11T21:00:00Z', '2026-10-12T07:00:00Z'),
        run('r2', '2026-10-12T06:00:00Z', '2026-10-12T08:00:00Z'),
        run(
          'foreign',
          '2026-10-12T09:00:00Z',
          '2026-10-12T10:00:00Z',
          'someone-else',
        ),
      ],
      included: [
        row(
          'bb_ticket',
          'ticket-a',
          { identifier: 'EX-1', title: 'Example' },
          { project_id: 'project-a' },
        ),
        row('bb_project', 'project-a', { name: 'Project' }),
      ],
      links: {
        next: {
          href: 'https://example.invalid/jsonapi/bb_run/bb_run?page[offset]=50',
        },
      },
    },
    '/jsonapi/bb_run/bb_run:50': {
      data: [
        run('r2', '2026-10-12T06:00:00Z', '2026-10-12T08:00:00Z'),
        run('r3', '2026-10-12T11:01:00Z', '2026-10-12T16:02:00Z'),
        run('history', '2026-10-05T08:00:00Z', '2026-10-05T09:00:00Z'),
      ],
    },
    '/jsonapi/bb_activity/bb_activity': {
      data: [
        row(
          'bb_activity',
          'event1',
          { created: '2026-10-12T09:00:00Z', kind: 'status_changed' },
          { actor: owner, ticket_id: 'ticket-a', run_id: 'r2' },
        ),
      ],
    },
    worklogs: page([
      worklog('w1', {
        description: 'Work',
        ticket_id: 'ticket-a',
        project_id: 'project-a',
      }),
      worklog('w2', {
        state: 'proposed',
        duration_seconds: 7200,
        description: 'Draft',
        project_id: 'project-a',
      }),
    ]),
    ...overrides,
  };
  const options: Parameters<typeof createBbConnectionClient>[1] = {
    auth: {
      apply: async (req) => ({
        ...req,
        headers: { ...req.headers, Authorization: 'Bearer fixture' },
      }),
    },
    http: {
      send: async (req) => {
        expect(req.method).toBe('GET');
        expect(req.headers.Authorization).toBe('Bearer fixture');
        const url = new URL(req.url);
        urls.push(url);
        const offset = url.searchParams.get('page[offset]');
        const key =
          url.pathname + (offset && offset !== '0' ? `:${offset}` : '');
        if (!(key in documents)) throw new Error(`Unexpected request ${url}`);
        const body = documents[key];
        if (body instanceof Error) throw body;
        return { status: 200, headers: {}, body: JSON.stringify(body) };
      },
    },
  };
  const client = await createBbConnectionClient(
    {
      site: { base_url: 'https://example.invalid', jsonapi_prefix: '/jsonapi' },
      plugins: [],
    },
    options,
  );
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  // The `tool_api__bakers_worklog_list` MCP tool; `worklogs` is page 0, `worklogs:<offset>` later pages.
  const worklogClient = {
    call: async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      const offset = Number(args.offset ?? 0);
      const body = documents[offset ? `worklogs:${offset}` : 'worklogs'];
      if (body === undefined) throw new Error(`Unexpected call ${offset}`);
      if (body instanceof Error) throw body;
      return { content: [], structuredContent: body };
    },
  };
  return { client, worklogClient, urls, calls };
}
const selection = { from: '2026-10-12', to: '2026-10-13' };

describe('personal track evidence', () => {
  it('collects owned runs across pages, merges overlaps and retains independent worklog totals', async () => {
    const { client, worklogClient, urls } = await fixture();
    const report = await loadEvidence(client, selection, worklogClient);
    expect(report.owner_id).toBe(owner);
    expect(report.days.map((d: { date: string }) => d.date)).toEqual([
      '2026-10-12',
      '2026-10-13',
    ]);
    expect(report.days[0]).toMatchObject({
      run_count: 3,
      recorded_seconds: 3600,
      proposed_seconds: 7200,
      schedule_seconds: 32400,
      clusters: [
        { start: '2026-10-11T22:00:00.000Z', end: '2026-10-12T08:00:00.000Z' },
        { start: '2026-10-12T11:01:00.000Z', end: '2026-10-12T16:02:00.000Z' },
      ],
      gaps: [
        {
          start: '2026-10-12T08:00:00.000Z',
          end: '2026-10-12T11:01:00.000Z',
          seconds: 10860,
        },
      ],
    });
    expect(
      report.days[0].baseline.map((b: { date: string; run_count: number }) => [
        b.date,
        b.run_count,
      ]),
    ).toEqual([
      ['2026-10-05', 1],
      ['2026-09-28', 0],
      ['2026-09-21', 0],
      ['2026-09-14', 0],
    ]);
    expect(report.days[1].run_count).toBe(0);
    expect(report.tickets['ticket-a'].title).toBe('Example');
    expect(report.days[0].activities).toHaveLength(1);
    const runUrls = urls.filter((url) => url.pathname.endsWith('/bb_run'));
    expect(runUrls).toHaveLength(2);
    const query = decodeURIComponent(runUrls[0].search);
    expect(query).toContain('owner_user_id.id');
    expect(query).toContain(owner);
    expect(query).toContain('closed_date');
    expect(query).not.toContain('assignee_user_id');
    expect(query).not.toContain('run_log');
    expect(query).toContain('ticket_id.project_id');
    expect(
      urls.some((url) => /bb_ticket\/bb_ticket\//.test(url.pathname)),
    ).toBe(false);
  });

  it('uses 25-hour civil days and keeps open endpoints unknown', async () => {
    const { client, worklogClient } = await fixture({
      '/jsonapi/bb_run/bb_run': {
        data: [
          run('dst', '2026-10-24T22:00:00Z', '2026-10-25T23:00:00Z'),
          run('open', '2026-10-25T12:00:00Z', null),
        ],
      },
    });
    const report = await loadEvidence(
      client,
      { from: '2026-10-25', to: '2026-10-25' },
      worklogClient,
    );
    expect(report.days[0]).toMatchObject({
      start: '2026-10-24T22:00:00.000Z',
      end: '2026-10-25T23:00:00.000Z',
      schedule_seconds: 0,
      span_complete: false,
    });
    expect(
      report.days[0].runs.find((r: { id: string }) => r.id === 'open'),
    ).toMatchObject({ end: null, full_duration_seconds: null });
  });

  it('never reports omitted or unplaceable run evidence as verified zero', async () => {
    const { client, worklogClient } = await fixture({
      '/jsonapi/bb_run/bb_run': {
        data: [run('bad', null, null)],
        meta: { omitted: { detail: 'Not all resources are available' } },
      },
    });
    const report = await loadEvidence(client, selection, worklogClient);
    expect(report.complete).toBe(false);
    expect(report.days[1].run_count).toBeNull();
    expect(report.days[0].baseline[0].run_count).toBeNull();
    expect(report.days[0].recorded_seconds).toBe(3600);
    expect(report.evidence_gaps.length).toBeGreaterThan(0);
  });

  it('fails a later page without returning a partial success', async () => {
    const { client, worklogClient } = await fixture({
      '/jsonapi/bb_run/bb_run:50': new Error('page unavailable'),
    });
    await expect(
      loadEvidence(client, selection, worklogClient),
    ).rejects.toThrow('page unavailable');
  });

  it.each([
    { from: '2026-02-30', to: '2026-03-02' },
    { from: '2026-10-13', to: '2026-10-12' },
    { from: '2025-01-01', to: '2026-12-31' },
    { ...selection, timezone: 'not/a-zone' },
  ])('rejects invalid selection %j', async (input) => {
    const { client, worklogClient } = await fixture();
    await expect(loadEvidence(client, input, worklogClient)).rejects.toThrow();
  });
});

it('does not silently turn malformed or non-advancing pages into an empty day', async () => {
  for (const page of [
    { links: {} },
    { data: [], links: { next: '/jsonapi/bb_run/bb_run?page[offset]=0' } },
  ]) {
    const { client, worklogClient } = await fixture({
      '/jsonapi/bb_run/bb_run': page,
    });
    await expect(
      loadEvidence(client, selection, worklogClient),
    ).rejects.toThrow(/response|pagination/);
  }
});

it('keeps pagination after an empty access-filtered page and discloses omitted worklogs independently', async () => {
  const { client, worklogClient } = await fixture({
    '/jsonapi/bb_run/bb_run': {
      data: [],
      links: { next: '/jsonapi/bb_run/bb_run?page[offset]=50' },
    },
    worklogs: page([], { omitted: true }),
  });
  const report = await loadEvidence(client, selection, worklogClient);
  expect(report.days[0].run_count).toBe(2);
  expect(report.days[0].recorded_seconds).toBeNull();
  expect(report.complete).toBe(false);
});

it('retains events on owned runs outside the run interval without admitting foreign actors', async () => {
  const owned = run('earlier', '2026-09-01T08:00:00Z', '2026-09-01T09:00:00Z');
  const { client, worklogClient } = await fixture({
    '/jsonapi/bb_activity/bb_activity': {
      data: [
        row(
          'bb_activity',
          'own-event',
          { created: '2026-10-12T09:00:00Z', kind: 'run_ended' },
          { actor: 'system', run_id: 'earlier', ticket_id: 'ticket-a' },
        ),
        row(
          'bb_activity',
          'foreign-event',
          { created: '2026-10-12T09:00:00Z', kind: 'created' },
          { actor: 'someone-else', ticket_id: 'ticket-a' },
        ),
      ],
      included: [owned],
    },
  });
  const report = await loadEvidence(client, selection, worklogClient);
  expect(report.days[0].activities.map((a: { id: string }) => a.id)).toEqual([
    'own-event',
  ]);
  expect(report.days[0].run_count).toBe(3);
});

it('discloses an invalid worklog state instead of reporting verified zero bookings', async () => {
  const { client, worklogClient } = await fixture({
    worklogs: page([worklog('unknown', { state: 'deleted' })]),
  });
  const report = await loadEvidence(client, selection, worklogClient);
  expect(report.complete).toBe(false);
  expect(report.days[0].recorded_seconds).toBeNull();
});

it('does not claim a completed gap or a known count on later dates after an unknown endpoint', async () => {
  const { client, worklogClient } = await fixture({
    '/jsonapi/bb_run/bb_run': {
      data: [run('open', '2026-10-12T08:00:00Z', null)],
    },
  });
  const report = await loadEvidence(client, selection, worklogClient);
  expect(report.complete).toBe(false);
  expect(report.days[0].runs[0].end).toBeNull();
  expect(report.days[1]).toMatchObject({
    run_count: null,
    span_complete: false,
    gaps: [],
  });
});

it('uses a 23-hour spring day and excludes runs ending exactly at its start', async () => {
  const { client, worklogClient } = await fixture({
    '/jsonapi/bb_run/bb_run': {
      data: [
        run('spring', '2026-03-28T23:00:00Z', '2026-03-29T22:00:00Z'),
        run('before', '2026-03-28T20:00:00Z', '2026-03-28T23:00:00Z'),
      ],
    },
  });
  const report = await loadEvidence(
    client,
    { from: '2026-03-29', to: '2026-03-29' },
    worklogClient,
  );
  expect(report.days[0]).toMatchObject({
    run_count: 1,
    known_duration_seconds: 82800,
    start: '2026-03-28T23:00:00.000Z',
    end: '2026-03-29T22:00:00.000Z',
  });
});

it('retains a zero-duration run at the earliest historical midnight', async () => {
  const instant = '2026-09-13T22:00:00Z';
  const { client, worklogClient, urls } = await fixture({
    '/jsonapi/bb_run/bb_run': {
      data: [run('instant', instant, instant)],
    },
  });
  const report = await loadEvidence(client, selection, worklogClient);
  expect(report.days[0].baseline[3]).toMatchObject({
    date: '2026-09-14',
    run_count: 1,
    known_duration_seconds: 0,
  });
  const query = urls.find((url) =>
    url.pathname.endsWith('/bb_run'),
  )?.searchParams;
  const operators = [...(query?.entries() ?? [])]
    .filter(([, value]) => value === 'closed_date')
    .map(([path]) => query?.get(path.replace('[path]', '[operator]')));
  expect(operators).toEqual(expect.arrayContaining(['>=', 'IS NULL']));
});

it('rejects impossible returned worklog dates before reporting daily or weekly totals', async () => {
  const { client, worklogClient } = await fixture({
    worklogs: page([worklog('bad-date', { work_date: '2026-02-30' })]),
  });
  await expect(
    loadEvidence(
      client,
      { from: '2026-02-23', to: '2026-03-01' },
      worklogClient,
    ),
  ).rejects.toThrow(/Invalid civil date/);
});

it.each([
  'ticket-project',
  'activity-ticket',
  'worklog-ticket',
  'worklog-project',
])('discloses missing %s context while retaining independent counts and totals', async (missing) => {
  const overrides: Record<string, unknown> = {};
  if (missing === 'ticket-project')
    overrides['/jsonapi/bb_run/bb_run'] = {
      data: [run('r1', '2026-10-12T06:00:00Z', '2026-10-12T07:00:00Z')],
      included: [
        row(
          'bb_ticket',
          'ticket-a',
          { title: 'Example' },
          { project_id: 'missing' },
        ),
      ],
    };
  if (missing === 'activity-ticket')
    overrides['/jsonapi/bb_activity/bb_activity'] = {
      data: [
        row(
          'bb_activity',
          'event',
          { created: '2026-10-12T09:00:00Z' },
          { actor: owner, ticket_id: 'missing' },
        ),
      ],
    };
  if (missing.startsWith('worklog-'))
    overrides.worklogs = page([
      worklog('worklog', {
        [missing === 'worklog-ticket' ? 'ticket_id' : 'project_id']: 'missing',
      }),
    ]);
  const { client, worklogClient } = await fixture(overrides);
  const report = await loadEvidence(client, selection, worklogClient);
  expect(report.complete).toBe(false);
  expect(report.evidence_gaps.join(' ')).toMatch(/unavailable.*context/);
  expect(report.days[0].run_count).toBe(missing === 'ticket-project' ? 1 : 3);
  expect(report.days[0].recorded_seconds).toBe(3600);
  expect(report.weeks[0].recorded_seconds).toBe(3600);
});

it('filters Drupal timestamp fields with Unix seconds so real runs and activities are not excluded', async () => {
  const { client, worklogClient, urls } = await fixture();
  await loadEvidence(client, selection, worklogClient);
  const runQuery = urls.find((url) =>
    url.pathname.endsWith('/bb_run'),
  )!.searchParams;
  expect(runQuery.get('filter[started_at][condition][value]')).toBe(
    '1791928800',
  );
  expect(runQuery.get('filter[created][condition][value]')).toBe('1791928800');
  expect(runQuery.get('filter[closed_date][condition][value]')).toBe(
    '1789336800',
  );
  const activityQuery = urls.find((url) =>
    url.pathname.endsWith('/bb_activity'),
  )!.searchParams;
  expect(activityQuery.get('filter[created][value]')).toBe('1791756000');
  expect(activityQuery.get('filter[1][condition][value]')).toBe('1791928800');
});

it('pages the worklog tool by next_offset over the whole selected weeks', async () => {
  const { client, worklogClient, calls } = await fixture({
    worklogs: page([worklog('w1')], { next_offset: 50 }),
    'worklogs:50': page([worklog('w3', { work_date: '2026-10-13' })]),
  });
  const report = await loadEvidence(client, selection, worklogClient);
  expect(calls).toEqual([
    {
      name: 'tool_api__bakers_worklog_list',
      args: { from: '2026-10-12', to: '2026-10-18', limit: 50, offset: 0 },
    },
    {
      name: 'tool_api__bakers_worklog_list',
      args: { from: '2026-10-12', to: '2026-10-18', limit: 50, offset: 50 },
    },
  ]);
  expect(report.worklogs.map((w: { id: string }) => w.id)).toEqual([
    'w1',
    'w3',
  ]);
  expect(report.days[1].recorded_seconds).toBe(3600);
});

it('takes ticket and project context from the worklog tool and rejects non-advancing pages', async () => {
  const withContext = await fixture({
    worklogs: {
      ...page([
        worklog('w9', { ticket_id: 'ticket-w', project_id: 'project-w' }),
      ]),
      tickets: [
        {
          id: 'ticket-w',
          identifier: 'EX-9',
          title: 'Nine',
          project_id: 'project-w',
        },
      ],
      projects: [{ id: 'project-w', name: 'Worklog project' }],
    },
  });
  const report = await loadEvidence(
    withContext.client,
    selection,
    withContext.worklogClient,
  );
  expect(report.tickets['ticket-w']).toEqual({
    identifier: 'EX-9',
    title: 'Nine',
    project_id: 'project-w',
  });
  expect(report.projects['project-w']).toEqual({ name: 'Worklog project' });
  expect(report.complete).toBe(true);
  for (const worklogs of [page([], { next_offset: 0 }), { data: 'nope' }]) {
    const { client, worklogClient } = await fixture({ worklogs });
    await expect(
      loadEvidence(client, selection, worklogClient),
    ).rejects.toThrow(/response|pagination/);
  }
});
