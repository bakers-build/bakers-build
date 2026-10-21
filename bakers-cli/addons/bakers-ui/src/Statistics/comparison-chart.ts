import { BoxRenderable, h, type RGBA, type VNode } from '@opentui/core';
import {
  FOREGROUND,
  SERIES_A,
  SERIES_B,
  SERIES_C,
  SERIES_D,
  SERIES_E,
  SERIES_F,
} from '../lib/theme.js';
import { BOLD, paragraphNode, plainRun } from '../lib/vnode.js';
import { displayWidth, truncateToWidth, wrapToWidth } from '../lib/width.js';
import type { StatisticFigure, StatisticMeasurement } from './client.js';
import { formatAxisMagnitude } from './presentation.js';

const MIN_PLOT_ROWS = 8;
const MAX_PLOT_ROWS = 12;
const MIN_PLOT_WIDTH = 20;
const Y_TICK_COUNT = 4;
const MARKERS = ['●', '◆', '▲', '■', '✦', '○'] as const;
const SERIES_COLOURS = [
  SERIES_A,
  SERIES_B,
  SERIES_C,
  SERIES_D,
  SERIES_E,
  SERIES_F,
] as const;
const CROSS = '┼';
const INVALID_MESSAGE = 'Comparison data is invalid.';
const EMPTY_MESSAGE = 'No comparison values for this period.';
const NARROW_MESSAGE = 'Plot area is too narrow to draw this comparison.';

interface Cell {
  ch: string;
  fg: RGBA;
  owner: string;
  marker: boolean;
  bold: boolean;
}

interface ParsedPoint {
  key: string;
  label: string;
  time: number;
  values: Array<number | null>;
}

interface SeriesStyle {
  id: string;
  label: string;
  marker: string;
  fg: RGBA;
}

export function ComparisonChart({
  id,
  figure,
  width,
}: {
  id: string;
  figure: StatisticFigure;
  width: number;
}): VNode {
  const rows = layoutChart(figure, Math.max(1, width));
  // A chart is a fixed grid of rows: the row index is its identity.
  return h(
    BoxRenderable,
    { id, flexDirection: 'column', flexShrink: 0 },
    ...rows.map((row, index) => chartRow(`${id}-${index}`, row)),
  );
}

/** One plot row as one text, its cells merged into runs of equal style. */
function chartRow(id: string, cells: Cell[]): VNode {
  const runs: Array<{ text: string; fg: RGBA; bold: boolean }> = [];
  for (const cell of cells) {
    const last = runs.at(-1);
    if (last?.fg.equals(cell.fg) && last.bold === cell.bold)
      last.text += cell.ch;
    else runs.push({ text: cell.ch, fg: cell.fg, bold: cell.bold });
  }
  return paragraphNode({
    id,
    runs: runs.map((run) => plainRun(run.text, run.bold ? BOLD : 0, run.fg)),
    fg: FOREGROUND,
    wrapMode: 'none',
    flexShrink: 0,
  });
}

function layoutChart(figure: StatisticFigure, width: number): Cell[][] {
  const styles = seriesStyles(figure.measurements);
  const parsed = parsePoints(figure);
  if (parsed.kind === 'invalid') {
    return [
      ...messageRows(INVALID_MESSAGE, width),
      ...legendRows(styles, width),
      ...tableRows(figure, styles, width),
    ];
  }
  const points = parsed.points;
  const observed = points.flatMap((point) =>
    point.values.filter((value): value is number => value !== null),
  );
  if (observed.length === 0) {
    return [
      ...messageRows(EMPTY_MESSAGE, width),
      ...legendRows(styles, width),
      ...tableRows(figure, styles, width),
    ];
  }

  const domain = valueDomain(observed);
  const yLabels = yTickLabels(domain);
  const yGutter =
    Math.max(4, ...yLabels.map((label) => displayWidth(label))) + 1;
  const latestLabels = styles.map((style, index) => {
    const latest = latestValue(points, index);
    return latest === null
      ? style.label
      : `${style.label} ${formatExact(latest)}`;
  });
  let labelGutter = Math.min(
    Math.max(8, ...latestLabels.map((label) => displayWidth(label))),
    Math.max(8, width - yGutter - 1 - MIN_PLOT_WIDTH),
  );
  let plotWidth = width - yGutter - 1 - labelGutter;
  const neededWidth = Math.max(MIN_PLOT_WIDTH, points.length);
  if (plotWidth < neededWidth && labelGutter > 8) {
    const steal = Math.min(labelGutter - 8, neededWidth - plotWidth);
    labelGutter -= steal;
    plotWidth += steal;
  }
  if (plotWidth < MIN_PLOT_WIDTH) {
    return [
      ...messageRows(NARROW_MESSAGE, width),
      ...legendRows(styles, width),
      ...tableRows(figure, styles, width),
    ];
  }

  const times = points.map((point) => point.time);
  const tMin = times[0] ?? 0;
  const tMax = times.at(-1) ?? tMin;
  const placed = points.map((point) => ({
    ...point,
    col: timeToColumn(point.time, tMin, tMax, plotWidth),
  }));
  const plotRows = fittedPlotRows(placed, domain);
  const plot = Array.from({ length: plotRows }, () =>
    Array.from({ length: plotWidth }, () => blank()),
  );
  const columns = placed.map((point) => ({
    ...point,
    rows: point.values.map((value) =>
      value === null ? null : valueToRow(value, domain, plotRows),
    ),
  }));

  for (let series = 0; series < styles.length; series += 1) {
    const style = styles[series];
    if (!style) continue;
    const available: Array<{ col: number; row: number }> = [];
    let run: Array<{ col: number; row: number }> = [];
    for (const point of columns) {
      const row = point.rows[series];
      if (typeof row !== 'number') {
        drawAsciichartLine(plot, run, style);
        run = [];
        continue;
      }
      const item = { col: point.col, row };
      run.push(item);
      available.push(item);
    }
    drawAsciichartLine(plot, run, style);
    const endpoint = available.at(-1);
    if (endpoint) {
      put(
        plot,
        endpoint.col,
        endpoint.row,
        style.marker,
        style.fg,
        style.id,
        true,
      );
    }
  }

  const rows: Cell[][] = [];
  for (let row = 0; row < plotRows; row += 1) {
    const tick = yTickAtRow(row, domain, yGutter, plotRows);
    const axis = cell('│', FOREGROUND, 'axis');
    const labels = Array.from({ length: labelGutter }, () => blank());
    placeEndpointLabels(labels, columns, styles, row, labelGutter, plotRows);
    rows.push([...tick, axis, ...(plot[row] ?? []), ...labels]);
  }

  const baseline = [
    ...spaces(yGutter),
    cell('└', FOREGROUND, 'axis'),
    ...Array.from({ length: plotWidth }, () => cell('─', FOREGROUND, 'axis')),
    ...spaces(labelGutter),
  ];
  rows.push(padRow(baseline, width));
  rows.push(
    padRow(
      [...spaces(yGutter + 1), ...xLabelRow(columns, plotWidth, labelGutter)],
      width,
    ),
  );
  rows.push(spaces(width));
  rows.push(...legendRows(styles, width));
  rows.push(spaces(width));
  rows.push(...tableRows(figure, styles, width));
  return rows.map((row) => padRow(row, width));
}

function seriesStyles(measurements: StatisticMeasurement[]): SeriesStyle[] {
  return measurements.map((measurement, index) => ({
    id: measurement.id,
    label: measurement.label,
    marker: MARKERS[index] ?? '■',
    fg: SERIES_COLOURS[index] ?? FOREGROUND,
  }));
}

function parsePoints(
  figure: StatisticFigure,
): { kind: 'ok'; points: ParsedPoint[] } | { kind: 'invalid' } {
  const points: ParsedPoint[] = [];
  let previous: number | undefined;
  for (const category of figure.categories) {
    const time = parseTimeKey(category.key);
    if (time === null || (previous !== undefined && time <= previous)) {
      return { kind: 'invalid' };
    }
    previous = time;
    const values = figure.measurements.map((measurement) => {
      const value = measurement.values[category.key];
      if (value === undefined) return null;
      if (value !== null && !Number.isFinite(value)) return Number.NaN;
      return value;
    });
    if (
      values.some((value) => typeof value === 'number' && Number.isNaN(value))
    ) {
      return { kind: 'invalid' };
    }
    points.push({
      key: category.key,
      label: category.label,
      time,
      values,
    });
  }
  return { kind: 'ok', points };
}

function parseTimeKey(key: string): number | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(key)) {
    const time = Date.parse(`${key}T00:00:00Z`);
    return Number.isFinite(time) ? time : null;
  }
  if (/^\d{4}-\d{2}$/.test(key)) {
    const time = Date.parse(`${key}-01T00:00:00Z`);
    return Number.isFinite(time) ? time : null;
  }
  return null;
}

function valueDomain(values: number[]): { min: number; max: number } {
  const minValue = Math.min(0, ...values);
  const maxValue = Math.max(0, ...values);
  if (minValue === maxValue) return { min: 0, max: 1 };
  return { min: minValue, max: maxValue };
}

function timeToColumn(
  time: number,
  tMin: number,
  tMax: number,
  plotWidth: number,
): number {
  if (tMax === tMin) return Math.floor((plotWidth - 1) / 2);
  return Math.round(((time - tMin) / (tMax - tMin)) * (plotWidth - 1));
}

function fittedPlotRows(
  points: Array<{ col: number; values: Array<number | null> }>,
  domain: { min: number; max: number },
): number {
  const span = domain.max - domain.min;
  if (span === 0) return MIN_PLOT_ROWS;
  let limit = MAX_PLOT_ROWS;
  const seriesCount = points[0]?.values.length ?? 0;
  for (let series = 0; series < seriesCount; series += 1) {
    let previous: { col: number; value: number } | undefined;
    for (const point of points) {
      const value = point.values[series];
      if (value === null || value === undefined) {
        previous = undefined;
        continue;
      }
      if (previous) {
        const columns = Math.max(1, Math.abs(point.col - previous.col));
        const delta = Math.abs(value - previous.value);
        if (delta > 0) {
          limit = Math.min(limit, 1 + (columns * span) / delta);
        }
      }
      previous = { col: point.col, value };
    }
  }
  return Math.max(MIN_PLOT_ROWS, Math.min(MAX_PLOT_ROWS, Math.floor(limit)));
}

function valueToRow(
  value: number,
  domain: { min: number; max: number },
  plotRows: number,
): number {
  const span = domain.max - domain.min;
  if (span === 0) return plotRows - 1;
  return Math.round((1 - (value - domain.min) / span) * (plotRows - 1));
}

function yTickLabels(domain: { min: number; max: number }): string[] {
  return Array.from({ length: Y_TICK_COUNT }, (_, index) => {
    const t = index / (Y_TICK_COUNT - 1);
    const value = domain.max - t * (domain.max - domain.min);
    return formatAxisMagnitude(displayTick(value, domain));
  });
}

function displayTick(
  value: number,
  domain: { min: number; max: number },
): number {
  if (domain.min === 0 && domain.max === 1) return 0;
  return value;
}

function yTickAtRow(
  row: number,
  domain: { min: number; max: number },
  yGutter: number,
  plotRows: number,
): Cell[] {
  for (let index = 0; index < Y_TICK_COUNT; index += 1) {
    const tickRow = Math.round((index / (Y_TICK_COUNT - 1)) * (plotRows - 1));
    if (tickRow !== row) continue;
    const t = index / (Y_TICK_COUNT - 1);
    const value = domain.max - t * (domain.max - domain.min);
    const label = formatAxisMagnitude(displayTick(value, domain));
    return cellsFromText(
      `${padStart(label, yGutter - 1)} `,
      FOREGROUND,
      'axis',
    );
  }
  return spaces(yGutter);
}

function drawAsciichartLine(
  plot: Cell[][],
  points: Array<{ col: number; row: number }>,
  style: SeriesStyle,
): void {
  const columns = collapseColumns(points);
  for (const column of columns) {
    if (column.minRow === column.maxRow) continue;
    for (let row = column.minRow; row <= column.maxRow; row += 1) {
      putStroke(plot, column.col, row, '┃', style);
    }
  }
  if (columns.length < 2) return;
  const first = columns[0];
  const last = columns.at(-1);
  if (!first || !last) return;
  const start = Math.min(first.col, last.col);
  const end = Math.max(first.col, last.col);
  const rowAt: number[] = [];
  for (let col = start; col <= end; col += 1) {
    rowAt[col] = interpolatedRow(columns, col);
  }
  for (let col = start; col < end; col += 1) {
    const r0 = rowAt[col];
    const r1 = rowAt[col + 1];
    if (r0 === undefined || r1 === undefined) continue;
    if (r0 === r1) {
      putStroke(plot, col, r0, '━', style);
      continue;
    }
    putStroke(plot, col, r0, r0 < r1 ? '╮' : '╯', style);
    putStroke(plot, col, r1, r0 < r1 ? '╰' : '╭', style);
    const lo = Math.min(r0, r1);
    const hi = Math.max(r0, r1);
    for (let row = lo + 1; row < hi; row += 1) {
      putStroke(plot, col, row, '┃', style);
    }
  }
}

function collapseColumns(
  points: Array<{ col: number; row: number }>,
): Array<{ col: number; row: number; minRow: number; maxRow: number }> {
  const columns: Array<{
    col: number;
    row: number;
    minRow: number;
    maxRow: number;
  }> = [];
  for (const point of points) {
    const last = columns.at(-1);
    if (last && last.col === point.col) {
      last.minRow = Math.min(last.minRow, point.row);
      last.maxRow = Math.max(last.maxRow, point.row);
      last.row = point.row;
      continue;
    }
    columns.push({
      col: point.col,
      row: point.row,
      minRow: point.row,
      maxRow: point.row,
    });
  }
  return columns;
}

function interpolatedRow(
  points: Array<{ col: number; row: number }>,
  col: number,
): number {
  const first = points[0];
  const last = points.at(-1);
  if (!first || !last) return 0;
  if (col <= first.col) return first.row;
  if (col >= last.col) return last.row;
  for (let index = 0; index < points.length - 1; index += 1) {
    const from = points[index];
    const to = points[index + 1];
    if (!from || !to) continue;
    if (col < from.col || col > to.col) continue;
    if (to.col === from.col) return to.row;
    const t = (col - from.col) / (to.col - from.col);
    return Math.round(from.row + t * (to.row - from.row));
  }
  return last.row;
}

function put(
  plot: Cell[][],
  col: number,
  row: number,
  ch: string,
  fg: RGBA,
  owner: string,
  marker: boolean,
): void {
  const line = plot[row];
  if (!line || col < 0 || col >= line.length) return;
  const current = line[col];
  if (!current) return;
  if (current.marker && !marker) return;
  if (
    current.owner !== '' &&
    current.owner !== owner &&
    current.owner !== 'axis' &&
    current.ch !== ' '
  ) {
    line[col] = {
      ch: CROSS,
      fg: FOREGROUND,
      owner: 'both',
      marker: false,
      bold: true,
    };
    return;
  }
  line[col] = {
    ch,
    fg,
    owner,
    marker,
    bold: owner !== '' && owner !== 'axis' && owner !== 'text',
  };
}

function putStroke(
  plot: Cell[][],
  col: number,
  row: number,
  ch: string,
  style: SeriesStyle,
): void {
  put(plot, col, row, ch, style.fg, style.id, false);
}

function placeEndpointLabels(
  gutter: Cell[],
  columns: Array<{ rows: Array<number | null>; values: Array<number | null> }>,
  styles: SeriesStyle[],
  row: number,
  labelGutter: number,
  plotRows: number,
): void {
  const placedRows: number[] = [];
  styles.forEach((style, series) => {
    const latest = latestObservation(columns, series);
    if (!latest) return;
    let target = latest.row;
    if (placedRows.includes(target)) {
      target = Math.min(plotRows - 1, target + 1);
      if (placedRows.includes(target)) {
        target = Math.max(0, latest.row - 1);
      }
    }
    placedRows.push(target);
    if (target !== row) return;
    const text = truncateToWidth(
      `${style.label} ${formatExact(latest.value)}`,
      labelGutter,
    );
    const written = cellsFromText(
      padEnd(text, labelGutter),
      style.fg,
      style.id,
    );
    for (let index = 0; index < gutter.length; index += 1) {
      const next = written[index];
      if (next) gutter[index] = next;
    }
  });
}

function latestObservation(
  columns: Array<{ rows: Array<number | null>; values: Array<number | null> }>,
  series: number,
): { row: number; value: number } | null {
  for (let index = columns.length - 1; index >= 0; index -= 1) {
    const row = columns[index]?.rows[series];
    const value = columns[index]?.values[series];
    if (
      row !== null &&
      row !== undefined &&
      value !== null &&
      value !== undefined
    ) {
      return { row, value };
    }
  }
  return null;
}

function latestValue(points: ParsedPoint[], series: number): number | null {
  for (let index = points.length - 1; index >= 0; index -= 1) {
    const value = points[index]?.values[series];
    if (value !== null && value !== undefined) return value;
  }
  return null;
}

function xLabelRow(
  columns: Array<{ col: number; label: string }>,
  plotWidth: number,
  labelGutter: number,
): Cell[] {
  const line = Array.from({ length: plotWidth + labelGutter }, () => blank());
  let occupiedUntil = -1;
  for (const point of columns) {
    const text = point.label;
    const width = displayWidth(text);
    const start = point.col;
    if (start <= occupiedUntil) continue;
    if (start + width > plotWidth + labelGutter) continue;
    const written = cellsFromText(text, FOREGROUND, 'axis');
    written.forEach((cell, offset) => {
      if (start + offset < line.length) line[start + offset] = cell;
    });
    occupiedUntil = start + width;
  }
  return line;
}

function legendRows(styles: SeriesStyle[], width: number): Cell[][] {
  const row = Array.from({ length: width }, () => blank());
  let cursor = 0;
  styles.forEach((style, index) => {
    const chunk = `${style.marker} ${style.label}`;
    const written = cellsFromText(
      truncateToWidth(chunk, Math.max(0, width - cursor)),
      style.fg,
      style.id,
    );
    written.forEach((cell) => {
      if (cursor < width) row[cursor++] = cell;
    });
    if (index < styles.length - 1 && cursor + 2 < width) {
      row[cursor++] = blank();
      row[cursor++] = blank();
    }
  });
  return [row];
}

function tableRows(
  figure: StatisticFigure,
  styles: SeriesStyle[],
  width: number,
): Cell[][] {
  const dateHeader = 'Date';
  const dateWidth = Math.max(
    displayWidth(dateHeader),
    ...figure.categories.map((category) => displayWidth(category.label)),
  );
  const valueWidths = styles.map((style, series) =>
    Math.max(
      displayWidth(style.label),
      ...figure.categories.map((category) =>
        displayWidth(
          formatExact(
            figure.measurements[series]?.values[category.key] ?? null,
          ),
        ),
      ),
    ),
  );
  const header = [
    padEnd(dateHeader, dateWidth),
    ...styles.map((style, index) =>
      padStart(style.label, valueWidths[index] ?? 0),
    ),
  ].join('  ');
  const rows = [
    cellsFromText(truncateToWidth(header, width), FOREGROUND, 'text'),
    ...figure.categories.map((category) => {
      const line = [
        padEnd(category.label, dateWidth),
        ...styles.map((_, series) =>
          padStart(
            formatExact(
              figure.measurements[series]?.values[category.key] ?? null,
            ),
            valueWidths[series] ?? 0,
          ),
        ),
      ].join('  ');
      return cellsFromText(truncateToWidth(line, width), FOREGROUND, 'text');
    }),
  ];
  return rows.map((row) => padRow(row, width));
}

function messageRows(message: string, width: number): Cell[][] {
  const lines = wrapToWidth(message, Math.max(1, width));
  return lines.map((line) =>
    padRow(cellsFromText(line, FOREGROUND, 'text'), width),
  );
}

function formatExact(value: number | null): string {
  if (value === null) return '—';
  return Number.isInteger(value) ? String(value) : String(value);
}

function blank(): Cell {
  return { ch: ' ', fg: FOREGROUND, owner: '', marker: false, bold: false };
}

function cell(ch: string, fg: RGBA, owner: string): Cell {
  return {
    ch,
    fg,
    owner,
    marker: false,
    bold: owner !== '' && owner !== 'axis' && owner !== 'text',
  };
}

function spaces(count: number): Cell[] {
  return Array.from({ length: Math.max(0, count) }, () => blank());
}

function cellsFromText(text: string, fg: RGBA, owner: string): Cell[] {
  return [...text].map((ch) => cell(ch, fg, owner));
}

function padRow(row: Cell[], width: number): Cell[] {
  if (row.length === width) return row;
  if (row.length > width) return row.slice(0, width);
  return [...row, ...spaces(width - row.length)];
}

function padStart(text: string, columns: number): string {
  const used = displayWidth(text);
  if (used >= columns) return truncateToWidth(text, columns);
  return `${' '.repeat(columns - used)}${text}`;
}

function padEnd(text: string, columns: number): string {
  const used = displayWidth(text);
  if (used >= columns) return truncateToWidth(text, columns);
  return `${text}${' '.repeat(columns - used)}`;
}
