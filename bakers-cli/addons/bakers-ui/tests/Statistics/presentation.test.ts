import { expect, it } from 'vitest';
import type { StatisticFigureGroup } from '../../src/Statistics/client.js';
import { groupedFigureLines } from '../../src/Statistics/presentation.js';

it('prints server groups, labels, categories and measurements without composing figures', () => {
  const groups: StatisticFigureGroup[] = [
    {
      id: 'overview',
      label: 'Overview',
      figures: [
        {
          id: 'user_overview',
          label: 'My overview',
          description: '',
          widget: 'matrix',
          generated: 'g',
          filters: {},
          categories: [
            { key: 'day', label: 'Last 24 hours' },
            { key: 'week', label: 'Last 7 days' },
          ],
          measurements: [
            {
              id: 'closed_tickets',
              label: 'Closed tickets',
              value_type: 'integer',
              unit: 'tickets',
              values: { day: 0, week: 12 },
            },
            {
              id: 'tickets_per_run',
              label: 'Tickets per run',
              value_type: 'decimal',
              unit: 'tickets_per_run',
              values: { day: null, week: 1.25 },
            },
          ],
          empty: { is_empty: false, message: null },
          cache: { max_age: 0, contexts: [], tags: [] },
        },
      ],
    },
  ];

  expect(groupedFigureLines(groups)).toEqual([
    'Overview',
    'My overview',
    'Last 24 hours · Closed tickets: 0 · Tickets per run: —',
    'Last 7 days · Closed tickets: 12 · Tickets per run: 1.25',
    '',
  ]);
});

it('uses the server empty-state copy', () => {
  const groups: StatisticFigureGroup[] = [
    {
      id: 'breakdown',
      label: 'Breakdown',
      figures: [
        {
          id: 'projects',
          label: 'Projects',
          description: '',
          widget: 'grouped_horizontal_bars',
          generated: 'g',
          filters: {},
          categories: [],
          measurements: [],
          empty: { is_empty: true, message: 'No data for this selection.' },
          cache: { max_age: 0, contexts: [], tags: [] },
        },
      ],
    },
  ];
  expect(groupedFigureLines(groups)).toContain('No data for this selection.');
});
