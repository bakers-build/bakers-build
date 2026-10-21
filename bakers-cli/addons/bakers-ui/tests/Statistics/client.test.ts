import type { DrupalJsonApiParams } from 'drupal-jsonapi-params';
import { expect, it } from 'vitest';
import { loadGroupStatistics } from '../../src/Statistics/client.js';
import type { DropshClient } from '../../src/types.js';

function fakeClient(document: unknown): {
  client: DropshClient;
  calls: Array<{ path: string; params: unknown }>;
} {
  const calls: Array<{ path: string; params: unknown }> = [];
  return {
    calls,
    client: {
      get: async (path, params) => {
        calls.push({ path, params });
        return document;
      },
      collection: () => ({}) as never,
      update: async () => ({}),
    },
  };
}

const query = (params: unknown): string =>
  decodeURIComponent((params as DrupalJsonApiParams).getQueryString());

const FIGURE = {
  id: 'user_activity',
  label: 'Activity',
  description: 'Closed tickets and runs by day.',
  widget: 'line',
  generated: '2026-09-20T12:00:00+00:00',
  filters: {
    period: {
      label: 'Period',
      value: '30',
      options: [
        { value: '7', label: '7 days' },
        { value: '30', label: '30 days' },
      ],
    },
  },
  categories: [
    { key: '2026-09-19', label: 'Sep 19' },
    { key: '2026-09-20', label: 'Sep 20', partial: true },
  ],
  measurements: [
    {
      id: 'closed_tickets',
      label: 'Closed tickets',
      value_type: 'integer',
      unit: 'tickets',
      values: { '2026-09-19': 2, '2026-09-20': 0 },
    },
    {
      id: 'runs',
      label: 'Runs',
      value_type: 'integer',
      unit: 'runs',
      values: { '2026-09-19': 3, '2026-09-20': 1 },
    },
  ],
  empty: { is_empty: false, message: null },
  cache: { max_age: 0, contexts: ['user.permissions'], tags: [] },
};

const DOCUMENT = {
  data: {
    type: 'bakers-statistics',
    id: 'statistics',
    attributes: {
      groups: [{ id: 'activity', label: 'Activity', figures: [FIGURE] }],
    },
  },
};

it('reads ordered, atomic groups in one request with named contexts and filters', async () => {
  const { client, calls } = fakeClient(DOCUMENT);
  const result = await loadGroupStatistics(
    client,
    { team: 'team-1', user: 'user-1' },
    { period: '30' },
  );

  expect(calls).toHaveLength(1);
  expect(calls[0]?.path).toBe('bakers/statistics');
  expect(query(calls[0]?.params)).toContain('team_id=team-1');
  expect(query(calls[0]?.params)).toContain('user_id=user-1');
  expect(query(calls[0]?.params)).toContain('filter[period]=30');
  expect(result).toEqual({
    kind: 'ok',
    groups: [{ id: 'activity', label: 'Activity', figures: [FIGURE] }],
  });
});

it('does not discover or merge individual figures in the client', async () => {
  const { client, calls } = fakeClient(DOCUMENT);
  const result = await loadGroupStatistics(client, { project: 'project-1' });

  expect(calls.map((call) => call.path)).toEqual(['bakers/statistics']);
  expect(query(calls[0]?.params)).toContain('project_id=project-1');
  expect(result.kind).toBe('ok');
});

it('accepts PHP empty maps without treating the figure as malformed', async () => {
  const emptyFigure = {
    ...FIGURE,
    filters: [],
    categories: [],
    measurements: FIGURE.measurements.map((measurement) => ({
      ...measurement,
      values: [],
    })),
    empty: { is_empty: true, message: 'No data for this selection.' },
  };
  const { client } = fakeClient({
    data: {
      attributes: {
        groups: [{ id: 'activity', label: 'Activity', figures: [emptyFigure] }],
      },
    },
  });

  const result = await loadGroupStatistics(client, { user: 'user-1' });

  expect(result).toEqual({
    kind: 'ok',
    groups: [
      {
        id: 'activity',
        label: 'Activity',
        figures: [
          {
            ...emptyFigure,
            filters: {},
            measurements: emptyFigure.measurements.map((measurement) => ({
              ...measurement,
              values: {},
            })),
          },
        ],
      },
    ],
  });
});

it('rejects a malformed grouped document instead of inventing an empty result', async () => {
  const { client } = fakeClient({ data: { attributes: { groups: null } } });
  const result = await loadGroupStatistics(client, { user: 'user-1' });
  expect(result.kind).toBe('error');
});

it('distinguishes an absent endpoint from a JSON:API error', async () => {
  const client = (body: unknown): DropshClient => ({
    get: async () => {
      throw Object.assign(new Error('HTTP 404'), { status: 404, body });
    },
    collection: () => ({}) as never,
    update: async () => ({}),
  });
  await expect(
    loadGroupStatistics(client('<html>Not found</html>'), { user: 'u1' }),
  ).resolves.toEqual({ kind: 'unsupported' });
  const failed = await loadGroupStatistics(
    client({ errors: [{ detail: 'Unknown user.' }] }),
    { user: 'u1' },
  );
  expect(failed).toEqual({ kind: 'error', message: 'Unknown user.' });
});
