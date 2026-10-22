import { describe, expect, it, spyOn } from 'bun:test';
import { ScrollBoxRenderable } from '@opentui/core';
import { register, resetCollector } from '../../src/Extension/store.js';
import { columnNode, textNode } from '../../src/lib/vnode.js';
import {
  BaseScreen,
  presentation,
  type ScreenContext,
} from '../../src/Screen/screen.js';
import type { RendererServices } from '../../src/types.js';
import { bootTui, settle } from '../tui-harness.js';

type Widget = 'matrix' | 'line' | 'grouped_horizontal_bars';

interface FigureInput {
  id: string;
  label: string;
  widget: Widget;
  description?: string;
  categories?: Array<{ key: string; label: string; partial?: boolean }>;
  measurements?: Array<{
    id: string;
    label: string;
    value_type?: 'integer' | 'decimal';
    unit?: string;
    values: Record<string, number | null>;
  }>;
  filters?: Record<
    string,
    {
      label: string;
      value: string;
      options: Array<{ value: string; label: string }>;
    }
  >;
  empty?: { is_empty: boolean; message: string | null };
}

const figure = (input: FigureInput) => ({
  id: input.id,
  label: input.label,
  widget: input.widget,
  description: input.description ?? '',
  generated: '2026-09-21T00:00:00Z',
  filters: input.filters ?? {},
  categories: input.categories ?? [
    { key: 'day', label: 'Last 24 hours' },
    { key: 'week', label: 'Last 7 days' },
    { key: 'month', label: 'Last 30 days' },
  ],
  measurements: (
    input.measurements ?? [
      {
        id: input.id,
        label: input.label,
        values: { day: 0, week: 123456, month: 987654 },
      },
    ]
  ).map((measurement) => ({
    value_type: 'integer' as const,
    unit: 'count',
    ...measurement,
  })),
  empty: input.empty ?? { is_empty: false, message: null },
  cache: { max_age: 0, contexts: [], tags: [] },
});

interface FigureGroupInput {
  id: string;
  label: string;
  figures: ReturnType<typeof figure>[];
}

function statisticsServices(
  figures: ReturnType<typeof figure>[],
  groupsOverride?: FigureGroupInput[],
) {
  const queries: string[] = [];
  let reads = 0;
  const groups = groupsOverride ?? [
    { id: 'activity', label: 'Server activity', figures },
  ];
  const services: RendererServices = {
    baseUrl: 'https://example.test',
    currentUser: 'operator',
    client: {
      collection: () => {
        const collection: import('../../src/types.js').Collection = {
          where: () => collection,
          sort: () => collection,
          page: () => collection,
          first: async () => null,
          list: async () => [],
        };
        return collection;
      },
      get: async (path, params) => {
        if (path === 'user/user') return { data: [{ id: 'account' }] };
        if (path === 'bakers/statistics') {
          reads++;
          queries.push(
            decodeURIComponent(
              String((params as { getQueryString(): string }).getQueryString()),
            ),
          );
          return {
            data: {
              attributes: { groups },
            },
          };
        }
        return { data: [] };
      },
    },
  };
  return { services, queries, reads: () => reads };
}

describe('atomic statistics in the running cockpit', () => {
  it('scrolls many figures rapidly without update errors', async () => {
    const world = statisticsServices(
      Array.from({ length: 24 }, (_, index) =>
        figure({
          id: `many-${index}`,
          label: `Figure ${index}`,
          widget: index % 3 === 0 ? 'line' : 'matrix',
        }),
      ),
    );
    const tui = await bootTui({
      services: world.services,
      columns: 120,
      rows: 30,
    });
    const errors = spyOn(process.stderr, 'write');
    try {
      const body = tui.renderer.root.findDescendantById('region-body');
      if (!(body instanceof ScrollBoxRenderable))
        throw new Error('Missing scrolling body');
      for (let index = 0; index < 80; index++) {
        tui.mockInput.pressKey(index < 40 ? '\u001b[B' : '\u001b[A');
        if (index === 39) expect(body.scrollTop).toBeGreaterThan(0);
      }
      await settle();
      await tui.renderOnce();
      expect(
        errors.mock.calls.map(([message]) => String(message)).join(''),
      ).not.toContain('keypress handler threw');
      expect(body.scrollTop).toBe(0);
      expect(
        tui.renderer.root.findDescendantById('figure-many-23'),
      ).toBeDefined();
      expect(world.reads()).toBe(1);
    } finally {
      errors.mockRestore();
      tui.mockInput.pressKey('q');
      await tui.running;
      await tui.stop();
    }
  });

  it('renders one grouped response and preserves it across resize and reload', async () => {
    const world = statisticsServices([
      figure({ id: 'first', label: 'Activity first', widget: 'matrix' }),
      figure({ id: 'last', label: 'Activity last', widget: 'matrix' }),
    ]);
    const tui = await bootTui({
      services: world.services,
      columns: 80,
      rows: 30,
    });
    try {
      expect(tui.frame()).toContain('Server activity');
      expect(tui.frame()).toContain('Activity first');
      expect(tui.frame()).toContain('123456');
      expect(world.reads()).toBe(1);

      for (const columns of [120, 40, 80]) {
        tui.resize(columns, 24);
        await settle();
        await tui.renderOnce();
        expect(world.reads()).toBe(1);
        const grid = tui.renderer.root.findDescendantById('statistics-grid');
        const first = tui.renderer.root.findDescendantById('figure-first');
        const last = tui.renderer.root.findDescendantById('figure-last');
        if (!grid || !first || !last) throw new Error('Missing atomic figures');
        expect(first.width).toBe(grid.width - 2);
        expect(last.y).toBeGreaterThanOrEqual(first.y + first.height);
        const body = tui.renderer.root.findDescendantById('region-body');
        if (!(body instanceof ScrollBoxRenderable))
          throw new Error('Missing scrolling body');
        expect(body.border).toBe(false);
        body.scrollTo({ x: 0, y: body.scrollHeight });
        await tui.renderOnce();
        expect(tui.frame()).toContain('987654');
      }

      await tui.press('R');
      expect(world.reads()).toBe(2);
      expect(
        world.queries.every((query) => query.includes('user_id=account')),
      ).toBe(true);
    } finally {
      tui.mockInput.pressKey('q');
      await tui.running;
      await tui.stop();
    }
  });

  it('renders line categories and cycles the single combined range preset', async () => {
    const world = statisticsServices([
      figure({
        id: 'daily',
        label: 'Daily work',
        widget: 'line',
        categories: [
          { key: '2026-09-20', label: 'Sep 20' },
          { key: '2026-09-21', label: 'Sep 21', partial: true },
        ],
        measurements: [
          {
            id: 'closed',
            label: 'Closed',
            values: { '2026-09-20': 5, '2026-09-21': 9 },
          },
        ],
        filters: {
          period: {
            label: 'Period',
            value: '7',
            options: [
              { value: '7', label: '7 days' },
              { value: '30', label: '30 days' },
              { value: '365', label: '1 year' },
            ],
          },
        },
      }),
    ]);
    const tui = await bootTui({
      services: world.services,
      columns: 80,
      rows: 30,
    });
    try {
      expect(tui.frame()).toContain('Daily work');
      expect(tui.frame()).toContain('Current day partial (UTC)');
      // The single Range control renders once, as a boxed filter chip above
      // every figure group — not as a per-card tab, not a plain
      // text header, and no longer two independent
      // chips.
      expect(tui.frame()).toContain('╭');
      expect(tui.frame()).toContain('t Range(7d·daily)');
      // Cycling the single chip through its three presets sends the three
      // combined values in turn — the server's response drives what the
      // chip renders next (it is static in this mock, which is why only the
      // request's filter value is asserted past the first press).
      await tui.press('t');
      expect(world.reads()).toBe(2);
      expect(world.queries.at(-1)).toContain('filter[period]=30');
      await tui.press('t');
      expect(world.reads()).toBe(3);
      expect(world.queries.at(-1)).toContain('filter[period]=365');
      await tui.press('t');
      expect(world.reads()).toBe(4);
      expect(world.queries.at(-1)).toContain('filter[period]=7');
    } finally {
      tui.mockInput.pressKey('q');
      await tui.running;
      await tui.stop();
    }
  });

  it('renders grouped horizontal bars from aligned measurements', async () => {
    const world = statisticsServices([
      figure({
        id: 'people',
        label: 'Work by person',
        widget: 'grouped_horizontal_bars',
        categories: [
          { key: 'ada', label: 'Ada' },
          { key: 'grace', label: 'Grace' },
        ],
        measurements: [
          { id: 'tickets', label: 'Tickets', values: { ada: 2, grace: 7 } },
          { id: 'runs', label: 'Runs', values: { ada: 3, grace: 11 } },
        ],
      }),
    ]);
    const tui = await bootTui({
      services: world.services,
      columns: 40,
      rows: 40,
    });
    try {
      const frame = tui.frame();
      expect(frame).toContain('Work by person');
      expect(frame).toContain('Ada');
      expect(frame).toContain('Grace');
      expect(frame).toContain('Tickets');
      expect(frame).toContain('Runs');
      const card = tui.renderer.root.findDescendantById('figure-people');
      if (!card) throw new Error('Missing grouped-bars figure');
      for (const child of card.getChildren()) {
        expect(child.x + child.width).toBeLessThanOrEqual(card.x + card.width);
      }
    } finally {
      tui.mockInput.pressKey('q');
      await tui.running;
      await tui.stop();
    }
  });

  it('formats billion-scale bar-figure values correctly, on the widget every shipped token trend actually uses', async () => {
    // Every shipped figure is 'grouped_horizontal_bars' or 'matrix' — none is
    // 'line' — so the regression this case pins (a single-divide formatter
    // rendering 844,000,000 as "844.0k") has to be observed
    // on the single-measurement bar path via formatAxisMagnitude, the same
    // path a real Tokens trend renders through.
    const world = statisticsServices([
      figure({
        id: 'tokens',
        label: 'Token spend',
        widget: 'grouped_horizontal_bars',
        categories: [
          { key: '2026-09-20', label: 'Sep 20' },
          { key: '2026-09-21', label: 'Sep 21' },
        ],
        measurements: [
          {
            id: 'run_tokens',
            label: 'Run tokens',
            values: { '2026-09-20': 400_000_000, '2026-09-21': 844_000_000 },
          },
        ],
      }),
    ]);
    for (const columns of [80, 120]) {
      const tui = await bootTui({
        services: world.services,
        columns,
        rows: 30,
      });
      try {
        const frame = tui.frame();
        expect(frame).toContain('Token spend');
        // Regression for a single-divide formatter: dividing by 1000 exactly
        // once renders 844,000,000 as "844.0k".
        expect(frame).not.toContain('844.0k');
        expect(frame).toContain('844.0M');
        expect(frame).not.toContain('400.0k');
        expect(frame).toContain('400.0M');
      } finally {
        tui.mockInput.pressKey('q');
        await tui.running;
        await tui.stop();
      }
    }
  });

  it('renders billion-scale values exactly in the matrix table, unabbreviated', async () => {
    // Every shipped matrix figure is an Overview, over the fixed rolling
    // `windows` categories (24h/7d/30d) — never over days or months — so
    // this case uses that same category shape rather than a day key no
    // shipped matrix carries. The matrix is an exact-value table: unlike the
    // bar/axis formatters, its cells must show the raw number, not a
    // k/M-abbreviated one.
    const world = statisticsServices([
      figure({
        id: 'tokens-matrix',
        label: 'Token overview',
        widget: 'matrix',
        categories: [
          { key: 'day', label: 'Last 24 hours' },
          { key: 'week', label: 'Last 7 days' },
          { key: 'month', label: 'Last 30 days' },
        ],
        measurements: [
          {
            id: 'run_tokens',
            label: 'Run tokens',
            values: { day: 0, week: 400_000_000, month: 844_000_000 },
          },
        ],
      }),
    ]);
    const tui = await bootTui({
      services: world.services,
      columns: 80,
      rows: 30,
    });
    try {
      const frame = tui.frame();
      expect(frame).not.toContain('844.0k');
      expect(frame).not.toContain('844.0M');
      expect(frame).toContain('844000000');
    } finally {
      tui.mockInput.pressKey('q');
      await tui.running;
      await tui.stop();
    }
  });

  it('renders the matrix with categories as rows and measurements as columns', async () => {
    const world = statisticsServices([
      figure({
        id: 'crossed',
        label: 'Activity matrix',
        widget: 'matrix',
        categories: [
          { key: 'ada', label: 'Ada' },
          { key: 'grace', label: 'Grace' },
        ],
        measurements: [
          { id: 'closed', label: 'Closed', values: { ada: 3, grace: 30 } },
          { id: 'runs', label: 'Runs', values: { ada: 5, grace: 50 } },
        ],
      }),
    ]);
    const tui = await bootTui({
      services: world.services,
      columns: 80,
      rows: 30,
    });
    try {
      const frame = tui.frame();
      const rows = frame.split('\n');
      const headerRow = rows.find(
        (row) => row.includes('Closed') && row.includes('Runs'),
      );
      if (!headerRow) throw new Error('Missing matrix header row');
      const adaRow = rows.find((row) => row.includes('Ada'));
      const graceRow = rows.find((row) => row.includes('Grace'));
      if (!adaRow || !graceRow) throw new Error('Missing category rows');
      // Categories (Ada, Grace) are rows; measurements (Closed, Runs) are the
      // header. If orientation were transposed, "Closed"/"Runs" would appear
      // as row labels instead.
      expect(adaRow).not.toContain('Closed');
      expect(graceRow).not.toContain('Closed');
    } finally {
      tui.mockInput.pressKey('q');
      await tui.running;
      await tui.stop();
    }
  });

  it.each([
    80, 120,
  ])('names the partial caption by the active period preset and shows the figure description at %i columns', async (columns) => {
    const world = statisticsServices([
      figure({
        id: 'monthly',
        label: 'Monthly work',
        widget: 'grouped_horizontal_bars',
        description: 'Tickets over time, by day or month.',
        categories: [
          { key: '2026-08', label: 'Aug 2026' },
          { key: '2026-09', label: 'Sep 2026', partial: true },
        ],
        measurements: [
          {
            id: 'closed',
            label: 'Closed',
            values: { '2026-08': 5, '2026-09': 2 },
          },
        ],
        filters: {
          period: {
            label: 'Period',
            value: '365',
            options: [
              { value: '7', label: '7 days' },
              { value: '30', label: '30 days' },
              { value: '365', label: '1 year' },
            ],
          },
        },
      }),
    ]);
    const tui = await bootTui({
      services: world.services,
      columns,
      rows: 30,
    });
    try {
      const frame = tui.frame();
      expect(frame).toContain('Current month partial (UTC)');
      expect(frame).not.toContain('Current day partial (UTC)');
      expect(frame).toContain('Tickets over time, by day or month.');
    } finally {
      tui.mockInput.pressKey('q');
      await tui.running;
      await tui.stop();
    }
  });

  it('shows the unattributed model with its share and keeps long labels distinct', async () => {
    const world = statisticsServices([
      figure({
        id: 'models',
        label: 'Token spend by model',
        widget: 'grouped_horizontal_bars',
        categories: [
          {
            key: 'claude-opus-4-6-extended-thinking',
            label: 'claude-opus-4-6-extended-thinking',
          },
          {
            key: 'claude-sonnet-4-6-fast-context',
            label: 'claude-sonnet-4-6-fast-context',
          },
          { key: 'unattributed', label: 'Unattributed' },
        ],
        measurements: [
          {
            id: 'run_tokens',
            label: 'Run tokens',
            values: {
              'claude-opus-4-6-extended-thinking': 700,
              'claude-sonnet-4-6-fast-context': 200,
              unattributed: 100,
            },
          },
        ],
      }),
    ]);
    for (const columns of [80, 120]) {
      const tui = await bootTui({
        services: world.services,
        columns,
        rows: 30,
      });
      try {
        const frame = tui.frame();
        expect(frame).toContain('Unattributed');
        // Unattributed is 100 of 1000 total => 10.0%.
        expect(frame).toContain('10.0%');
        expect(frame).toContain('70.0%');
        expect(frame).toContain('20.0%');
        expect(frame).toContain('claude-opus-4-6-extended-thinking');
        expect(frame).toContain('claude-sonnet-4-6-fast-context');
        const card = tui.renderer.root.findDescendantById('figure-models');
        if (!card) throw new Error('Missing grouped-bars figure');
        for (const child of card.getChildren()) {
          expect(child.x + child.width).toBeLessThanOrEqual(
            card.x + card.width,
          );
        }
      } finally {
        tui.mockInput.pressKey('q');
        await tui.running;
        await tui.stop();
      }
    }
  });

  it('has no clipped or overlapping figure children at 80 and 120 columns', async () => {
    const world = statisticsServices([
      figure({ id: 'first', label: 'Activity first', widget: 'matrix' }),
      figure({
        id: 'tokens',
        label: 'Token spend',
        widget: 'line',
        measurements: [
          {
            id: 'run_tokens',
            label: 'Run tokens',
            values: { day: 400_000_000, week: 800_000_000, month: 844_000_000 },
          },
        ],
      }),
    ]);
    for (const columns of [80, 120]) {
      const tui = await bootTui({
        services: world.services,
        columns,
        rows: 40,
      });
      try {
        await tui.renderOnce();
        const grid = tui.renderer.root.findDescendantById('statistics-grid');
        if (!grid) throw new Error('Missing statistics grid');
        const first = tui.renderer.root.findDescendantById('figure-first');
        const tokens = tui.renderer.root.findDescendantById('figure-tokens');
        if (!first || !tokens) throw new Error('Missing figures');
        expect(first.width).toBeLessThanOrEqual(grid.width);
        expect(tokens.width).toBeLessThanOrEqual(grid.width);
        expect(tokens.y).toBeGreaterThanOrEqual(first.y + first.height);
      } finally {
        tui.mockInput.pressKey('q');
        await tui.running;
        await tui.stop();
      }
    }
  });

  it('renders Overview first, unconditionally, above the chip bar and tab group', async () => {
    const overview = figure({
      id: 'user_overview',
      label: 'Account overview',
      widget: 'matrix',
      categories: [
        { key: 'day', label: 'Last 24 hours' },
        { key: 'week', label: 'Last 7 days' },
        { key: 'month', label: 'Last 30 days' },
      ],
      measurements: [
        {
          id: 'closed_tickets',
          label: 'Closed tickets',
          values: { day: 1, week: 5, month: 20 },
        },
      ],
    });
    const tickets = figure({
      id: 'user_tickets_trend',
      label: 'Tickets trend',
      widget: 'grouped_horizontal_bars',
      measurements: [
        { id: 'closed_tickets', label: 'Closed', values: { day: 3 } },
      ],
      filters: {
        period: {
          label: 'Period',
          value: '7',
          options: [
            { value: '7', label: '7 days' },
            { value: '30', label: '30 days' },
          ],
        },
      },
    });
    const runs = figure({
      id: 'user_runs_trend',
      label: 'Runs trend',
      widget: 'grouped_horizontal_bars',
      measurements: [{ id: 'runs', label: 'Runs', values: { day: 4 } }],
    });
    const world = statisticsServices(
      [],
      [
        { id: 'overview', label: 'Overview', figures: [overview] },
        { id: 'tickets', label: 'Tickets', figures: [tickets] },
        { id: 'runs', label: 'Runs', figures: [runs] },
      ],
    );
    const tui = await bootTui({
      services: world.services,
      columns: 80,
      rows: 40,
    });
    try {
      await tui.renderOnce();
      const frame = tui.frame();
      const lines = frame.split('\n');
      const overviewLine = lines.findIndex((line) =>
        line.includes('Account overview'),
      );
      const chipLine = lines.findIndex((line) =>
        line.includes('t Range(7d·daily)'),
      );
      const tabLine = lines.findIndex((line) => line.includes('[Tickets]'));
      if (overviewLine < 0 || chipLine < 0 || tabLine < 0) {
        throw new Error('Missing Overview, chip bar or tab group');
      }
      // Overview renders first — no chip bar above it, and it is not one of
      // the switchable tabs.
      expect(overviewLine).toBeLessThan(chipLine);
      expect(chipLine).toBeLessThan(tabLine);
      expect(frame).not.toContain('[Overview]');
      // Overview's own figure carries no period/granularity filter, so no
      // chip renders above its own content — only one chip strip total,
      // appearing once, below Overview.
      const chipOccurrences = lines.filter((line) =>
        line.includes('t Range(7d·daily)'),
      ).length;
      expect(chipOccurrences).toBe(1);
    } finally {
      tui.mockInput.pressKey('q');
      await tui.running;
      await tui.stop();
    }
  });

  it('renders each figure group as its own sub-tab, switched with left/right', async () => {
    const tickets = figure({
      id: 'user_tickets_trend',
      label: 'Tickets trend',
      widget: 'grouped_horizontal_bars',
      categories: [
        { key: '2026-09-19', label: 'Sep 19' },
        { key: '2026-09-20', label: 'Sep 20' },
      ],
      measurements: [
        {
          id: 'closed_tickets',
          label: 'Closed tickets',
          values: { '2026-09-19': 1, '2026-09-20': 10 },
        },
      ],
    });
    const runs = figure({
      id: 'user_runs_trend',
      label: 'Runs trend',
      widget: 'grouped_horizontal_bars',
      measurements: [{ id: 'runs', label: 'Runs', values: { day: 4 } }],
    });
    const tokens = figure({
      id: 'user_tokens_trend',
      label: 'Tokens trend',
      widget: 'grouped_horizontal_bars',
      measurements: [
        { id: 'run_tokens', label: 'Run tokens', values: { day: 900 } },
      ],
    });
    const world = statisticsServices(
      [],
      [
        { id: 'tickets', label: 'Tickets', figures: [tickets] },
        { id: 'runs', label: 'Runs', figures: [runs] },
        { id: 'tokens', label: 'Tokens', figures: [tokens] },
      ],
    );
    for (const columns of [80, 120]) {
      const tui = await bootTui({
        services: world.services,
        columns,
        rows: 30,
      });
      try {
        await tui.renderOnce();
        // Only the first tab's figures are on screen — not stacked sections.
        expect(tui.frame()).toContain('Tickets trend');
        expect(tui.frame()).not.toContain('Runs trend');
        expect(tui.frame()).not.toContain('Tokens trend');
        expect(tui.frame()).toContain('[Tickets]');

        await tui.press('\x1b[C');
        expect(tui.frame()).toContain('Runs trend');
        expect(tui.frame()).not.toContain('Tickets trend');
        expect(tui.frame()).not.toContain('Tokens trend');
        expect(tui.frame()).toContain('[Runs]');

        await tui.press('\x1b[C');
        expect(tui.frame()).toContain('Tokens trend');
        expect(tui.frame()).not.toContain('Tickets trend');
        expect(tui.frame()).not.toContain('Runs trend');

        await tui.press('\x1b[D');
        expect(tui.frame()).toContain('Runs trend');
      } finally {
        tui.mockInput.pressKey('q');
        await tui.running;
        await tui.stop();
      }
    }
  });

  it('scales a single-measurement trend bar against the shared max across the visible period, not each row’s own 100%', async () => {
    const tickets = figure({
      id: 'user_tickets_trend',
      label: 'Tickets trend',
      widget: 'grouped_horizontal_bars',
      categories: [
        { key: '2026-09-19', label: 'Sep 19' },
        { key: '2026-09-20', label: 'Sep 20' },
      ],
      measurements: [
        {
          id: 'closed_tickets',
          label: 'Closed tickets',
          values: { '2026-09-19': 1, '2026-09-20': 10 },
        },
      ],
    });
    const world = statisticsServices(
      [],
      [{ id: 'tickets', label: 'Tickets', figures: [tickets] }],
    );
    for (const columns of [80, 120]) {
      const tui = await bootTui({
        services: world.services,
        columns,
        rows: 30,
      });
      try {
        await tui.renderOnce();
        const card = tui.renderer.root.findDescendantById(
          'figure-user_tickets_trend',
        );
        if (!card) throw new Error('Missing trend figure');
        // Two bars, one per category (day). The 10-value day's filled run of
        // bar glyphs must be roughly ten times the 1-value day's — not both
        // maxed out at their own row's 100%, which is what a per-row-normalised
        // single measurement always renders regardless of its actual value.
        const frame = tui.frame();
        // The bar glyphs sit on the line right after the category heading in
        // this renderer, so search a small window instead of the same line.
        const lines = frame.split('\n');
        const sepIndex19 = lines.findIndex((line) => line.includes('Sep 19'));
        const sepIndex20 = lines.findIndex((line) => line.includes('Sep 20'));
        const fillCount = (index: number) => {
          for (
            let offset = 0;
            offset < 4 && index + offset < lines.length;
            offset++
          ) {
            const line = lines[index + offset] ?? '';
            const matches = line.match(/█+/);
            if (matches) return matches[0].length;
          }
          return 0;
        };
        const smallFill = fillCount(sepIndex19);
        const largeFill = fillCount(sepIndex20);
        expect(largeFill).toBeGreaterThan(smallFill * 2);
        expect(card.width).toBeGreaterThan(0);
      } finally {
        tui.mockInput.pressKey('q');
        await tui.running;
        await tui.stop();
      }
    }
  });

  it('renders the server empty message without changing the figure schema', async () => {
    const world = statisticsServices([
      figure({
        id: 'empty',
        label: 'No activity',
        widget: 'matrix',
        categories: [],
        measurements: [],
        empty: { is_empty: true, message: 'Nothing recorded yet.' },
      }),
    ]);
    const tui = await bootTui({
      services: world.services,
      columns: 60,
      rows: 20,
    });
    try {
      expect(tui.frame()).toContain('No activity');
      expect(tui.frame()).toContain('Nothing recorded yet.');
    } finally {
      tui.mockInput.pressKey('q');
      await tui.running;
      await tui.stop();
    }
  });
});

describe('every statistics scope in the running cockpit', () => {
  const TEAM = 'team-1';
  const WORKSPACE = 'workspace-1';
  const MEMBER = 'member-1';
  const STRANGER = 'stranger-1';
  const PROJECT = 'project-1';

  /** Holds the router's navigate seam while the launcher tab is shown. */
  const seam: { navigate?: ScreenContext['navigate'] } = {};
  class LauncherScreen extends BaseScreen {
    static readonly route = {
      id: 'test.launcher',
      path: '/launcher',
      tab: { id: 'launcher', label: 'Launcher', scope: 'root', weight: 999 },
      fallback: { routeId: 'my.work' },
    };
    readonly id = LauncherScreen.route.id;
    override enter(context: ScreenContext): void {
      seam.navigate = context.navigate;
      context.requestDraw();
    }
    present() {
      return presentation(
        columnNode(
          'test-launcher',
          textNode({ id: 'test-launcher-text', content: 'LAUNCHER' }),
        ),
      );
    }
  }

  function scopedServices() {
    const queries: string[] = [];
    const collection = (type: string) => {
      const result: import('../../src/types.js').Collection = {
        where: () => result,
        sort: () => result,
        page: () => result,
        first: async () =>
          type === 'bb_team' || type === 'bb_workspace'
            ? {
                id: type,
                type,
                attr: (key: string) =>
                  key === 'drupal_internal__id' ? 7 : undefined,
                rel: () => null,
                rels: () => [],
              }
            : null,
        list: async () => [],
      };
      return result;
    };
    const services: RendererServices = {
      baseUrl: 'https://example.test',
      currentUser: 'operator',
      workspaceId: WORKSPACE,
      client: {
        collection,
        get: async (path, params) => {
          if (path === 'user/user') return { data: [{ id: 'account' }] };
          if (path === 'og_membership/default')
            return {
              data: [
                {
                  id: 'membership',
                  type: 'og_membership--default',
                  relationships: { uid: { data: { id: MEMBER } } },
                },
              ],
            };
          if (path === 'bakers/statistics') {
            queries.push(
              decodeURIComponent(
                String(
                  (params as { getQueryString(): string }).getQueryString(),
                ),
              ),
            );
            return {
              data: {
                attributes: {
                  groups: [
                    {
                      id: 'activity',
                      label: 'Server activity',
                      figures: [
                        figure({
                          id: 'scoped',
                          label: 'Scoped figure',
                          widget: 'matrix',
                        }),
                      ],
                    },
                  ],
                },
              },
            };
          }
          return { data: [] };
        },
        update: async () => ({}),
        create: async () => ({}),
      },
    };
    return { services, queries };
  }

  const cases = [
    { route: 'my.stats', params: {}, context: 'user_id=account' },
    {
      route: 'project.stats',
      params: {
        projectId: PROJECT,
        projectName: 'bakers',
        projectSlug: 'bakers',
      },
      context: `project_id=${PROJECT}`,
    },
    {
      route: 'team.stats',
      params: { teamId: TEAM, teamName: 'crew' },
      context: `team_id=${TEAM}`,
    },
    {
      route: 'workspace.member.stats',
      params: { userId: MEMBER, userName: 'member' },
      context: `user_id=${MEMBER}`,
    },
    {
      route: 'team.member.stats',
      params: {
        teamId: TEAM,
        teamName: 'crew',
        userId: MEMBER,
        userName: 'member',
      },
      context: `team_id=${TEAM}`,
    },
  ] as const;

  const boot = async () => {
    resetCollector();
    register('test/launcher', (api) => api.add(LauncherScreen));
    const world = scopedServices();
    const tui = await bootTui({
      services: world.services,
      columns: 100,
      rows: 40,
      useProductLanding: true,
      tui: { isWorkspaceAdmin: true },
    });
    for (let step = 0; step < 8 && seam.navigate === undefined; step++)
      await tui.press('\x1b[Z');
    if (seam.navigate === undefined) throw new Error('launcher unreachable');
    return { tui, world, navigate: seam.navigate };
  };

  it.each(cases)('reads and paints $route with its own context', async ({
    route,
    params,
    context,
  }) => {
    const { tui, world, navigate } = await boot();
    try {
      navigate(route, params);
      for (
        let pass = 0;
        pass < 20 && !tui.frame().includes('Scoped figure');
        pass++
      ) {
        await settle();
        await tui.renderOnce();
      }
      expect(tui.frame()).toContain('Server activity');
      expect(tui.frame()).toContain('Scoped figure');
      expect(tui.frame()).toContain('987654');
      expect(world.queries.at(-1)).toContain(context);
    } finally {
      seam.navigate = undefined;
      resetCollector();
      tui.mockInput.pressKey('q');
      await tui.running;
      await tui.stop();
    }
  });

  it.each([
    'workspace.member.stats',
    'team.member.stats',
  ] as const)('rejects a user who is not an active member on %s', async (route) => {
    const { tui, world, navigate } = await boot();
    try {
      navigate(route, {
        teamId: TEAM,
        teamName: 'crew',
        userId: STRANGER,
        userName: 'stranger',
      });
      for (
        let pass = 0;
        pass < 20 && !tui.frame().includes('not an active member');
        pass++
      ) {
        await settle();
        await tui.renderOnce();
      }
      expect(tui.frame()).toContain('not an active member');
      expect(tui.frame()).not.toContain('Scoped figure');
      expect(world.queries).toHaveLength(0);
    } finally {
      seam.navigate = undefined;
      resetCollector();
      tui.mockInput.pressKey('q');
      await tui.running;
      await tui.stop();
    }
  });
});
