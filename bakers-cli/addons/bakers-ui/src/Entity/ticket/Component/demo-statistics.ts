import type {
  StatisticFigure,
  StatisticFigureGroup,
} from '../../../Statistics/client.js';

/**
 * Local example data for the optional Statistics demo tab.
 *
 * Shaped as the server's configured-figure contract, so the demo paints through
 * the same `StatisticsFigures` composition the production Stats screens use
 * rather than through a separate set of demo-only widgets. No value here is
 * read from or written to a control plane.
 */
export interface StatisticExample {
  readonly name: string;
  readonly groups: readonly StatisticFigureGroup[];
}

const DAYS = [
  '2026-09-21',
  '2026-09-22',
  '2026-09-23',
  '2026-09-24',
  '2026-09-25',
  '2026-09-26',
  '2026-09-27',
];
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const STATES = ['Ready', 'Coding', 'Review', 'Done'];

const figure = (
  id: string,
  label: string,
  widget: StatisticFigure['widget'],
  categories: StatisticFigure['categories'],
  measurements: Array<{
    id: string;
    label: string;
    values: Record<string, number | null>;
  }>,
): StatisticFigure => {
  const empty = measurements.every((measurement) =>
    Object.values(measurement.values).every((value) => value === null),
  );
  return {
    id,
    label,
    description: '',
    widget,
    generated: '2026-09-27T00:00:00Z',
    filters: {},
    categories,
    measurements: measurements.map((measurement) => ({
      value_type: 'integer',
      unit: 'count',
      ...measurement,
    })),
    empty: {
      is_empty: empty,
      message: empty ? 'No example values for this scenario.' : null,
    },
    cache: { max_age: 0, contexts: [], tags: [] },
  };
};

const example = (
  name: string,
  states: readonly number[],
  trend: readonly number[],
): StatisticExample => {
  const value = (values: readonly number[], index: number) =>
    values[index] ?? null;
  return {
    name,
    groups: [
      {
        id: 'demo',
        label: 'Example statistics',
        figures: [
          figure(
            'demo-states',
            'Tickets by state',
            'matrix',
            STATES.map((state, index) => ({
              key: `state-${index}`,
              label: state,
            })),
            [
              {
                id: 'tickets',
                label: 'Tickets',
                values: Object.fromEntries(
                  STATES.map((_, index) => [
                    `state-${index}`,
                    value(states, index),
                  ]),
                ),
              },
            ],
          ),
          figure(
            'demo-share',
            'Share by state',
            'grouped_horizontal_bars',
            STATES.map((state, index) => ({
              key: `share-${index}`,
              label: state,
            })),
            [
              {
                id: 'share',
                label: 'Tickets',
                values: Object.fromEntries(
                  STATES.map((_, index) => [
                    `share-${index}`,
                    value(states, index),
                  ]),
                ),
              },
            ],
          ),
          figure(
            'demo-completed',
            'Completed per day',
            'line',
            DAYS.map((day, index) => ({
              key: day,
              label: WEEKDAYS[index] ?? day,
            })),
            [
              {
                id: 'completed',
                label: 'Completed',
                values: Object.fromEntries(
                  DAYS.map((day, index) => [day, value(trend, index)]),
                ),
              },
            ],
          ),
        ],
      },
    ],
  };
};

export const STATISTIC_EXAMPLES: readonly StatisticExample[] = [
  example('Steady week', [12, 7, 4, 26], [3, 5, 4, 8, 6, 9, 11]),
  example('Busy week', [5, 14, 8, 42], [5, 8, 6, 13, 9, 15, 18]),
  example('Empty project', [], []),
];
