import { BoxRenderable, h, type RGBA, type VNode } from '@opentui/core';
import { BarChart } from '../Component/bar-chart/index.js';
import { Card } from '../Component/card/index.js';
import { HeatMap } from '../Component/heat-map/index.js';
import {
  FOREGROUND,
  SERIES_A,
  SERIES_B,
  SERIES_C,
  SERIES_D,
} from '../lib/theme.js';
import { BOLD, paragraphNode, plainRun } from '../lib/vnode.js';
import type { StatisticFigure, StatisticFigureGroup } from './client.js';
import { ComparisonChart } from './comparison-chart.js';
import { formatAxisMagnitude } from './presentation.js';

// Per-measurement bar colours: the comparison-series slots, in the order the
// line chart uses them, so a measurement keeps its colour across widgets.
const COLORS: readonly RGBA[] = [SERIES_A, SERIES_B, SERIES_C, SERIES_D];
const valueAt = (figure: StatisticFigure, measurement: number, key: string) =>
  figure.measurements[measurement]?.values[key] ?? null;
const numeric = (value: number | null): number => value ?? 0;
const shown = (value: number | null): string =>
  value === null ? '—' : String(value);

const text = (id: string, content: string, attributes = 0): VNode =>
  paragraphNode({
    id,
    runs: [plainRun(content, attributes)],
    fg: FOREGROUND,
  });

const column = (id: string, gap: number, ...children: VNode[]): VNode =>
  h(BoxRenderable, { id, flexDirection: 'column', gap }, ...children);

function matrixDisplay(
  id: string,
  figure: StatisticFigure,
  width: number,
): VNode {
  // Categories are rows, measurements are columns — matching the web UI's
  // matrix orientation.
  const rawValues = figure.categories.map((category) =>
    figure.measurements.map((_, measurement) =>
      numeric(valueAt(figure, measurement, category.key)),
    ),
  );
  const labels = figure.categories.map((category) =>
    figure.measurements.map((_, measurement) =>
      shown(valueAt(figure, measurement, category.key)),
    ),
  );
  // Shade each column (measurement) against its own maximum rather than the
  // whole matrix's maximum, so columns with a smaller value range still show
  // visible contrast. HeatMap itself only supports one global min/max, so the
  // per-column scaling happens here: values are rescaled to 0-100 percent of
  // their column's own max before being handed to the HeatMap module.
  const columnMaximums = figure.measurements.map((_, measurement) =>
    Math.max(0, ...rawValues.map((row) => row[measurement] ?? 0)),
  );
  const shadeValues = rawValues.map((row) =>
    row.map((value, column) => {
      const columnMax = columnMaximums[column] ?? 0;
      return columnMax > 0 ? (value / columnMax) * 100 : 0;
    }),
  );
  const labelWidth = Math.max(
    1,
    ...figure.categories.map((category) => category.label.length),
  );
  const cellWidth = Math.max(
    7,
    Math.floor(
      (Math.max(width, 20) - labelWidth - 2) /
        Math.max(1, figure.measurements.length),
    ),
  );
  return HeatMap({
    id,
    data: shadeValues,
    rowLabels: figure.categories.map((category) => category.label),
    colLabels: figure.measurements.map((measurement) => measurement.label),
    cellLabels: labels,
    cellWidth,
    showValues: true,
    showLegend: false,
    minValue: 0,
    maxValue: 100,
  });
}

function partialPeriodUnit(figure: StatisticFigure): string {
  return figure.period?.grouping ?? 'day';
}

// Shared above every widget: which trailing period is still filling in (the
// figure's own categories carry the `partial` flag — see
// MeasurementEvaluator::buckets()) and what the figure means, in the
// figure's own words. Rendered once here rather than per-widget so every
// shipped widget (matrix, grouped_horizontal_bars) gets both without having
// to know about them.
function figureCaption(id: string, figure: StatisticFigure): VNode | null {
  const partial = figure.categories.some((category) => category.partial);
  if (!partial && !figure.description) return null;
  return column(
    id,
    0,
    ...(figure.description
      ? [text(`${id}-description`, figure.description)]
      : []),
    ...(partial
      ? [
          text(
            `${id}-partial`,
            `Current ${partialPeriodUnit(figure)} partial (UTC)`,
          ),
        ]
      : []),
  );
}

function groupedHorizontalBars(
  id: string,
  figure: StatisticFigure,
  width: number,
): VNode {
  const maximum = Math.max(
    0,
    ...figure.categories.flatMap((category) =>
      figure.measurements.map((measurement) =>
        numeric(measurement.values[category.key] ?? null),
      ),
    ),
  );
  // Share = this category's slice of the measurement's total across every
  // category (e.g. one model's percent of total token spend) — every
  // category, including "Unattributed", gets its share shown.
  const totals = new Map(
    figure.measurements.map((measurement) => [
      measurement.id,
      figure.categories.reduce(
        (sum, category) =>
          sum + numeric(measurement.values[category.key] ?? null),
        0,
      ),
    ]),
  );
  const shareOf = (measurementId: string, value: number): string => {
    const total = totals.get(measurementId) ?? 0;
    return total > 0 ? ` (${((value / total) * 100).toFixed(1)}%)` : '';
  };
  // With a single measurement the bar's own label (normally the measurement
  // name) would just repeat that one static string on every row and eat
  // into the label-width budget the bar itself needs, which is what let long
  // category (model) labels crowd out or collapse against the bar. Elide it
  // — the category heading above already names the row.
  const single = figure.measurements[0];
  const singleMeasurement = figure.measurements.length === 1;
  return column(
    id,
    1,
    ...figure.categories.map((category) => {
      const row = `${id}-${category.key}`;
      return column(
        row,
        0,
        text(`${row}-label`, category.label, BOLD),
        BarChart({
          id: `${row}-bars`,
          data: figure.measurements.map((measurement, index) => {
            const value = numeric(measurement.values[category.key] ?? null);
            return {
              label: singleMeasurement
                ? ''
                : `${measurement.label}${shareOf(measurement.id, value)}`,
              value,
              color: COLORS[index % COLORS.length] as RGBA,
            };
          }),
          maxValue: maximum,
          // The bar chart's own showValues renders the raw number,
          // which is unreadable at token-spend (billion) scale — the
          // formatted line below (or inline per-row text, for multiple
          // measurements) replaces it.
          showValues: false,
          width,
        }),
        singleMeasurement && single
          ? text(
              `${row}-value`,
              `${formatAxisMagnitude(numeric(valueAt(figure, 0, category.key)))}${shareOf(
                single.id,
                numeric(valueAt(figure, 0, category.key)),
              )}`,
            )
          : h(
              BoxRenderable,
              { id: `${row}-values`, flexDirection: 'row', gap: 2 },
              ...figure.measurements.map((measurement, index) =>
                text(
                  `${row}-value-${measurement.id}`,
                  `${measurement.label}: ${formatAxisMagnitude(
                    numeric(valueAt(figure, index, category.key)),
                  )}`,
                ),
              ),
            ),
      );
    }),
  );
}

function figureDisplay(
  id: string,
  figure: StatisticFigure,
  width: number,
): VNode {
  if (figure.empty.is_empty)
    return text(
      `${id}-empty`,
      figure.empty.message ?? 'No data for this selection.',
    );
  const caption = figureCaption(`${id}-caption`, figure);
  const widget =
    figure.widget === 'matrix'
      ? matrixDisplay(`${id}-matrix`, figure, width)
      : figure.widget === 'line'
        ? ComparisonChart({ id: `${id}-line`, figure, width })
        : groupedHorizontalBars(`${id}-bars`, figure, width);
  return column(id, 1, ...(caption === null ? [] : [caption]), widget);
}

export interface StatisticsFiguresProps {
  /** The grid's own id; every group and figure inside derives from it. */
  readonly id: string;
  readonly groups: readonly StatisticFigureGroup[];
  /** The grid's laid-out width, as last reported through {@link onResize}. */
  readonly width: number;
  /** Called with the grid's new width whenever the layout resizes it. */
  readonly onResize: (width: number) => void;
}

/**
 * The figure groups as cards. The charts are laid out for `width` — the
 * screen's last measurement of this grid — and the grid reports its real
 * width after every layout, so a first estimate is corrected on the next draw
 * instead of the charts waiting for a measurement to appear at all.
 */
export function StatisticsFigures({
  id,
  groups,
  width,
  onResize,
}: StatisticsFiguresProps): VNode {
  const contentWidth = Math.max(1, width - 2);
  return h(
    BoxRenderable,
    {
      id,
      width: '100%',
      paddingLeft: 1,
      paddingRight: 1,
      flexDirection: 'column',
      gap: 0,
      onSizeChange(this: BoxRenderable) {
        onResize(this.width);
      },
    },
    ...groups.map((group) =>
      column(
        `${id}-${group.id}`,
        0,
        h(BoxRenderable, { id: `${id}-${group.id}-spacer`, height: 1 }),
        text(`${id}-${group.id}-label`, group.label, BOLD),
        ...group.figures.map((figure) =>
          h(
            BoxRenderable,
            {
              id: `figure-${figure.id}`,
              width: contentWidth,
              flexShrink: 0,
              flexDirection: 'column',
            },
            Card({
              id: `figure-${figure.id}-card`,
              title: figure.label,
              width: contentWidth,
              paddingX: 1,
              children: [
                column(
                  `figure-${figure.id}-display`,
                  1,
                  figureDisplay(
                    `figure-${figure.id}-widget`,
                    figure,
                    Math.max(15, contentWidth - 4),
                  ),
                ),
              ],
            }),
          ),
        ),
      ),
    ),
  );
}
