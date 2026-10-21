import { describe, expect, it } from 'bun:test';
import type { VNode } from '@opentui/core';
import { createTestRenderer } from '@opentui/core/testing';
import {
  type MountedTree,
  mountTree,
  patchTree,
  unmountTree,
} from '../../src/Kernel/mount.js';
import {
  SERIES_A,
  SERIES_B,
  SERIES_C,
  SERIES_D,
  SERIES_E,
  SERIES_F,
} from '../../src/lib/theme.js';
import type {
  StatisticFigure,
  StatisticFigureGroup,
} from '../../src/Statistics/client.js';
import { ComparisonChart } from '../../src/Statistics/comparison-chart.js';
import { StatisticsFigures } from '../../src/Statistics/figures.js';

const sampleFigure = (
  overrides: Partial<StatisticFigure> = {},
): StatisticFigure => ({
  id: 'comparison',
  label: 'Model comparison',
  description: '',
  widget: 'line',
  generated: '2026-01-04T00:00:00Z',
  filters: {},
  categories: [
    { key: '2026-01-01', label: '01 Jan' },
    { key: '2026-01-02', label: '02 Jan' },
    { key: '2026-01-04', label: '04 Jan' },
  ],
  measurements: [
    {
      id: 'a',
      label: 'Model A',
      value_type: 'integer',
      unit: 'count',
      values: { '2026-01-01': 10, '2026-01-02': 20, '2026-01-04': 15 },
    },
    {
      id: 'b',
      label: 'Model B',
      value_type: 'integer',
      unit: 'count',
      values: { '2026-01-01': 30, '2026-01-02': 10, '2026-01-04': 20 },
    },
  ],
  empty: { is_empty: false, message: null },
  cache: { max_age: 0, contexts: [], tags: [] },
  ...overrides,
});

const sampleGroup = (
  figure: StatisticFigure = sampleFigure(),
): StatisticFigureGroup => ({
  id: 'sample',
  label: 'Sample',
  figures: [figure],
});

type Setup = Awaited<ReturnType<typeof createTestRenderer>>;
type Build = (width: number, onResize: (width: number) => void) => VNode;

/**
 * A tree mounted the way a screen mounts it: built for the width the grid
 * last reported, and patched again on the next turn when the layout reports a
 * new one — a resize included.
 */
const live = (setup: Setup) => {
  let mounted: MountedTree | undefined;
  let build: Build | undefined;
  let width = setup.renderer.width;
  const tree = (): VNode =>
    (build as Build)(width, (next) => {
      if (next <= 0 || next === width) return;
      width = next;
      queueMicrotask(redraw);
    });
  const redraw = () => {
    if (mounted === undefined) return;
    mounted = patchTree(setup.renderer, mounted, tree());
    setup.renderer.requestRender();
  };
  return {
    render(next: Build) {
      build = next;
      mounted = mountTree(setup.renderer, setup.renderer.root, tree());
    },
    unmount() {
      if (mounted !== undefined) unmountTree(setup.renderer.root, mounted);
      mounted = undefined;
    },
  };
};
type Live = ReturnType<typeof live>;

const figures =
  (groups: StatisticFigureGroup[]): Build =>
  (width, onResize) =>
    StatisticsFigures({ id: 'statistics-grid', groups, width, onResize });

const paint = async (figure: StatisticFigure, width: number, height = 48) => {
  const setup = await createTestRenderer({ width, height });
  const root = live(setup);
  try {
    root.render(figures([sampleGroup(figure)]));
    const frame = await setup.waitForFrame((text) =>
      text.includes('Model comparison'),
    );
    const spans = setup.captureSpans().lines.map((line) => line.spans);
    return { frame, spans, setup, root };
  } catch (error) {
    root.unmount();
    setup.renderer.destroy();
    throw error;
  }
};

const finish = (root: Live, setup: Setup) => {
  root.unmount();
  setup.renderer.destroy();
};

const columnOf = (frame: string, token: string): number => {
  for (const row of frame.split('\n')) {
    const index = row.indexOf(token);
    if (index >= 0) return index;
  }
  return -1;
};

const rowOf = (frame: string, token: string): number => {
  const rows = frame.split('\n');
  return rows.findIndex((row) => row.includes(token));
};

describe('line comparison chart', () => {
  it('paints connected labels, dates and values at 52 columns', async () => {
    const { frame, setup, root } = await paint(sampleFigure(), 52);
    try {
      expect(frame).toContain('Model A 15');
      expect(frame).toContain('Model B 20');
      expect(frame).toContain('01 Jan');
      expect(frame).toContain('04 Jan');
      expect(frame).not.toContain('┄');
      expect(frame).toContain('10');
      expect(frame).toContain('20');
      expect(frame).toContain('15');
      expect(frame).toContain('30');
      expect(frame).toMatch(/●/);
      expect(frame).toMatch(/◆/);
      expect(frame).toMatch(/[╭╮╰╯━]/);
    } finally {
      finish(root, setup);
    }
  });

  it('paints six distinct markers and colours for six measurements', async () => {
    const labels = ['Opus', 'Grok', 'Sol', 'Astra', 'Luna', 'Other'];
    const measurements = labels.map((label, index) => ({
      id: `m${index}`,
      label,
      value_type: 'integer' as const,
      unit: 'count',
      values: {
        '2026-01-01': (index + 1) * 10,
        '2026-01-02': (index + 1) * 8,
        '2026-01-04': (index + 1) * 6,
      },
    }));
    const { frame, spans, setup, root } = await paint(
      sampleFigure({ measurements }),
      96,
    );
    try {
      for (const label of labels) {
        expect(frame).toContain(label);
      }
      for (const marker of ['●', '◆', '▲', '■', '✦', '○']) {
        expect(frame).toContain(marker);
      }
      const colours = [
        SERIES_A,
        SERIES_B,
        SERIES_C,
        SERIES_D,
        SERIES_E,
        SERIES_F,
      ];
      for (const colour of colours) {
        expect(spans.flat().some((span) => colour.equals(span.fg))).toBe(true);
      }
      const slots = colours.map((colour) => colour.slot);
      expect(new Set(slots).size).toBe(6);
    } finally {
      finish(root, setup);
    }
  });

  it('places the middle date one third across a shared value scale', async () => {
    const { frame, spans, setup, root } = await paint(sampleFigure(), 96);
    try {
      const start = columnOf(frame, '01 Jan');
      const middle = columnOf(frame, '02 Jan');
      const end = columnOf(frame, '04 Jan');
      expect(start).toBeGreaterThanOrEqual(0);
      expect(end).toBeGreaterThan(start);
      const span = end - start;
      expect(Math.abs(middle - start - span / 3)).toBeLessThanOrEqual(1);

      const a20 = rowOf(frame, '●');
      expect(a20).toBeGreaterThanOrEqual(0);
      const peakA = frame
        .split('\n')
        .map((row, index) => ({ row, index }))
        .filter(({ row }) => row.includes('●'));
      const peakB = frame
        .split('\n')
        .map((row, index) => ({ row, index }))
        .filter(({ row }) => row.includes('◆'));
      const aPeakRow = Math.min(...peakA.map(({ index }) => index));
      const bPeakRow = Math.min(...peakB.map(({ index }) => index));
      expect(bPeakRow).toBeLessThan(aPeakRow);

      const paintedA = spans.flat().some((span) => SERIES_A.equals(span.fg));
      const paintedB = spans.flat().some((span) => SERIES_B.equals(span.fg));
      expect(paintedA).toBe(true);
      expect(paintedB).toBe(true);
    } finally {
      finish(root, setup);
    }
  });

  it('keeps exact values through a native resize', async () => {
    const setup = await createTestRenderer({ width: 96, height: 48 });
    const root = live(setup);
    try {
      root.render(figures([sampleGroup()]));
      const wide = await setup.waitForFrame((text) =>
        text.includes('Model A 15'),
      );
      expect(wide).toContain('Model B 20');
      setup.resize(52, 48);
      const narrow = await setup.waitForFrame((text) =>
        text.includes('Model A 15'),
      );
      expect(narrow).toContain('01 Jan');
      expect(narrow).not.toContain('┄');
      setup.resize(96, 48);
      const restored = await setup.waitForFrame((text) =>
        text.includes('Model B 20'),
      );
      expect(restored).toContain('Model A 15');
    } finally {
      finish(root, setup);
    }
  });

  it('names empty, invalid, narrow and gap cases without inventing zeros', async () => {
    const empty = await paint(
      sampleFigure({
        measurements: [
          {
            id: 'a',
            label: 'Model A',
            value_type: 'integer',
            unit: 'count',
            values: {
              '2026-01-01': null,
              '2026-01-02': null,
              '2026-01-04': null,
            },
          },
          {
            id: 'b',
            label: 'Model B',
            value_type: 'integer',
            unit: 'count',
            values: {
              '2026-01-01': null,
              '2026-01-02': null,
              '2026-01-04': null,
            },
          },
        ],
      }),
      96,
    );
    try {
      expect(empty.frame).toContain('No comparison values for this period.');
      expect(empty.frame).toContain('Model A');
      expect(empty.frame).toContain('Model B');
      expect(empty.frame).not.toContain('└');
    } finally {
      finish(empty.root, empty.setup);
    }

    const invalid = await paint(
      sampleFigure({
        categories: [
          { key: '2026-01-04', label: '04 Jan' },
          { key: '2026-01-02', label: '02 Jan' },
          { key: '2026-01-01', label: '01 Jan' },
        ],
      }),
      96,
    );
    try {
      expect(invalid.frame).toContain('Comparison data is invalid.');
      expect(invalid.frame).toContain('Model A');
      expect(invalid.frame).toContain('15');
    } finally {
      finish(invalid.root, invalid.setup);
    }

    const gaps = await paint(
      sampleFigure({
        measurements: [
          {
            id: 'a',
            label: 'Model A',
            value_type: 'integer',
            unit: 'count',
            values: {
              '2026-01-01': 10,
              '2026-01-02': null,
              '2026-01-04': 15,
            },
          },
          {
            id: 'b',
            label: 'Model B',
            value_type: 'integer',
            unit: 'count',
            values: {
              '2026-01-01': 30,
              '2026-01-02': 10,
              '2026-01-04': 20,
            },
          },
        ],
      }),
      96,
    );
    try {
      expect(gaps.frame).toContain('—');
      expect(gaps.frame).toContain('Model A 15');
      expect(gaps.frame).toContain('Model B 20');
    } finally {
      finish(gaps.root, gaps.setup);
    }

    const zero = await paint(
      sampleFigure({
        measurements: [
          {
            id: 'a',
            label: 'Model A',
            value_type: 'integer',
            unit: 'count',
            values: { '2026-01-01': 0, '2026-01-02': 0, '2026-01-04': 0 },
          },
          {
            id: 'b',
            label: 'Model B',
            value_type: 'integer',
            unit: 'count',
            values: { '2026-01-01': 0, '2026-01-02': 0, '2026-01-04': 0 },
          },
        ],
      }),
      96,
    );
    try {
      expect(zero.frame).toMatch(/●/);
      expect(zero.frame).toContain('Model A');
      expect(zero.frame).toContain('Model B');
      expect(zero.frame).not.toContain('No comparison values for this period.');
    } finally {
      finish(zero.root, zero.setup);
    }
  });

  it('centers a singleton and keeps signed decimals plus long names', async () => {
    const single = await paint(
      sampleFigure({
        categories: [{ key: '2026-01-01', label: '01 Jan' }],
        measurements: [
          {
            id: 'a',
            label: 'Model A',
            value_type: 'integer',
            unit: 'count',
            values: { '2026-01-01': 4 },
          },
          {
            id: 'b',
            label: 'Model B',
            value_type: 'integer',
            unit: 'count',
            values: { '2026-01-01': 8 },
          },
        ],
      }),
      96,
    );
    try {
      expect(single.frame).toMatch(/●/);
      expect(single.frame).toMatch(/◆/);
      expect(single.frame).toContain('01 Jan');
    } finally {
      finish(single.root, single.setup);
    }

    const signed = await paint(
      sampleFigure({
        measurements: [
          {
            id: 'a',
            label: 'Model A',
            value_type: 'decimal',
            unit: 'count',
            values: {
              '2026-01-01': -2.5,
              '2026-01-02': 0.5,
              '2026-01-04': 1.25,
            },
          },
          {
            id: 'b',
            label: 'Model B',
            value_type: 'decimal',
            unit: 'count',
            values: { '2026-01-01': 4, '2026-01-02': -1, '2026-01-04': 2 },
          },
        ],
      }),
      96,
    );
    try {
      expect(signed.frame).toContain('-2.5');
      expect(signed.frame).toContain('1.25');
      expect(signed.frame).toContain('Model A 1.25');
    } finally {
      finish(signed.root, signed.setup);
    }

    const long = await paint(
      sampleFigure({
        measurements: [
          {
            id: 'a',
            label: 'Model Αα very long unicode name',
            value_type: 'integer',
            unit: 'count',
            values: { '2026-01-01': 10, '2026-01-02': 20, '2026-01-04': 15 },
          },
          {
            id: 'b',
            label: 'Model B',
            value_type: 'integer',
            unit: 'count',
            values: { '2026-01-01': 30, '2026-01-02': 10, '2026-01-04': 20 },
          },
        ],
      }),
      52,
    );
    try {
      expect(long.frame).toContain('Model B 20');
      expect(long.frame.split('\n').every((row) => row.length <= 52)).toBe(
        true,
      );
    } finally {
      finish(long.root, long.setup);
    }
  });

  it('rejects duplicate times and keeps coincident endpoint labels readable', async () => {
    const duplicate = await paint(
      sampleFigure({
        categories: [
          { key: '2026-01-01', label: '01 Jan' },
          { key: '2026-01-01', label: 'also 01 Jan' },
        ],
        measurements: [
          {
            id: 'a',
            label: 'Model A',
            value_type: 'integer',
            unit: 'count',
            values: { '2026-01-01': 10 },
          },
          {
            id: 'b',
            label: 'Model B',
            value_type: 'integer',
            unit: 'count',
            values: { '2026-01-01': 30 },
          },
        ],
      }),
      96,
    );
    try {
      expect(duplicate.frame).toContain('Comparison data is invalid.');
      expect(duplicate.frame).toContain('10');
      expect(duplicate.frame).toContain('30');
    } finally {
      finish(duplicate.root, duplicate.setup);
    }

    const coincident = await paint(
      sampleFigure({
        measurements: [
          {
            id: 'a',
            label: 'Model A',
            value_type: 'integer',
            unit: 'count',
            values: { '2026-01-01': 10, '2026-01-02': 20, '2026-01-04': 20 },
          },
          {
            id: 'b',
            label: 'Model B',
            value_type: 'integer',
            unit: 'count',
            values: { '2026-01-01': 30, '2026-01-02': 10, '2026-01-04': 20 },
          },
        ],
      }),
      96,
    );
    try {
      expect(coincident.frame).toContain('Model A 20');
      expect(coincident.frame).toContain('Model B 20');
    } finally {
      finish(coincident.root, coincident.setup);
    }
  });

  it('paints a shared-column peak as a plot glyph', async () => {
    const start = Date.UTC(2026, 0, 1);
    const categories = Array.from({ length: 40 }, (_, index) => {
      const key = new Date(start + index * 86400000).toISOString().slice(0, 10);
      return { key, label: key.slice(5) };
    });
    const aValues: Record<string, number | null> = {};
    const bValues: Record<string, number | null> = {};
    for (const category of categories) {
      aValues[category.key] = 1;
      bValues[category.key] = 1;
    }
    aValues[categories[19]?.key ?? '2026-01-20'] = 40;
    const setup = await createTestRenderer({ width: 34, height: 28 });
    const root = live(setup);
    try {
      root.render(() =>
        ComparisonChart({
          id: 'chart',
          figure: sampleFigure({
            categories,
            measurements: [
              {
                id: 'a',
                label: 'Model A',
                value_type: 'integer',
                unit: 'count',
                values: aValues,
              },
              {
                id: 'b',
                label: 'Model B',
                value_type: 'integer',
                unit: 'count',
                values: bValues,
              },
            ],
          }),
          width: 34,
        }),
      );
      const frame = await setup.waitForFrame((text) => text.includes('40'));
      const lines = frame.split('\n');
      const baseline = lines.findIndex((line) => line.includes('└'));
      expect(baseline).toBeGreaterThan(0);
      const topPlot = lines
        .slice(0, Math.min(3, baseline))
        .map((line) => {
          const axis = line.indexOf('│');
          return axis >= 0 ? line.slice(axis + 1) : '';
        })
        .join('');
      expect(topPlot).toMatch(/[╭╮╰╯━┃●]/);
    } finally {
      finish(root, setup);
    }
  });

  it('keeps a dense isolated peak in the value rows', async () => {
    const categories = Array.from({ length: 12 }, (_, index) => {
      const day = String(index + 1).padStart(2, '0');
      return { key: `2026-01-${day}`, label: `${day} Jan` };
    });
    const aValues: Record<string, number | null> = {};
    const bValues: Record<string, number | null> = {};
    for (const category of categories) {
      aValues[category.key] = 1;
      bValues[category.key] = 1;
    }
    aValues['2026-01-06'] = 40;
    const dense = await paint(
      sampleFigure({
        categories,
        measurements: [
          {
            id: 'a',
            label: 'Model A',
            value_type: 'integer',
            unit: 'count',
            values: aValues,
          },
          {
            id: 'b',
            label: 'Model B',
            value_type: 'integer',
            unit: 'count',
            values: bValues,
          },
        ],
      }),
      52,
    );
    try {
      expect(dense.frame).toContain('40');
      expect(dense.frame).toContain('06 Jan');
    } finally {
      finish(dense.root, dense.setup);
    }
  });

  it('names an insufficient plot width and still lists values', async () => {
    const setup = await createTestRenderer({ width: 24, height: 20 });
    const root = live(setup);
    try {
      root.render(() =>
        ComparisonChart({ id: 'chart', figure: sampleFigure(), width: 24 }),
      );
      const frame = await setup.waitForFrame((text) =>
        text.includes('too narrow'),
      );
      expect(frame.replace(/\s+/g, ' ')).toContain(
        'Plot area is too narrow to draw this comparison.',
      );
      expect(frame).toContain('10');
      expect(frame).toContain('30');
      expect(frame).not.toContain('└');
    } finally {
      finish(root, setup);
    }
  });
});
