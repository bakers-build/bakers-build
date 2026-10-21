import { BoxRenderable, h, type RGBA, type VNode } from '@opentui/core';
import {
  FOREGROUND,
  FOREGROUND_ACTIVE,
  FOREGROUND_HIGHLIGHT,
} from '../../lib/theme.js';
import {
  DIM,
  paragraphNode,
  plainRun,
  type StyledRun,
} from '../../lib/vnode.js';

export interface HeatMapProps {
  id: string;
  data: number[][];
  rowLabels?: string[];
  colLabels?: string[];
  cellLabels?: string[][];
  /** Low to high; indexed palette slots only. */
  colorScale?: readonly RGBA[];
  cellWidth?: number;
  showValues?: boolean;
  showLegend?: boolean;
  minValue?: number;
  maxValue?: number;
}

/**
 * Low → high intensity as three palette slots, so the scale follows the
 * operator's terminal theme like every other colour the cockpit paints.
 */
export const HEAT_SCALE: readonly RGBA[] = [
  FOREGROUND,
  FOREGROUND_HIGHLIGHT,
  FOREGROUND_ACTIVE,
];

const SHADE_CHARS = [' ', '░', '▒', '▓', '█'];

const getColorForValue = (
  value: number,
  min: number,
  max: number,
  scale: readonly RGBA[],
): RGBA => {
  if (max === min) return scale[Math.floor(scale.length / 2)] ?? FOREGROUND;
  const t = (value - min) / (max - min);
  const index = Math.min(
    scale.length - 1,
    Math.max(0, Math.round(t * (scale.length - 1))),
  );
  return scale[index] ?? scale[0] ?? FOREGROUND;
};

const getShadeForValue = (value: number, min: number, max: number): string => {
  if (max === min) return SHADE_CHARS[2] ?? '▒';
  const t = (value - min) / (max - min);
  const index = Math.min(
    SHADE_CHARS.length - 1,
    Math.max(0, Math.round(t * (SHADE_CHARS.length - 1))),
  );
  return SHADE_CHARS[index] ?? SHADE_CHARS[0] ?? ' ';
};

const padCenter = (value: string, width: number): string => {
  if (value.length >= width) return value;
  const total = width - value.length;
  const left = Math.floor(total / 2);
  return ' '.repeat(left) + value + ' '.repeat(total - left);
};

const padStart = (value: string, width: number): string =>
  value.length >= width ? value.slice(0, width) : value.padStart(width);

/** One grid row as one text: the cells touch, so their runs are the row. */
const gridRow = (id: string, runs: readonly StyledRun[]): VNode =>
  paragraphNode({
    id,
    runs,
    fg: FOREGROUND,
    wrapMode: 'none',
    flexShrink: 0,
  });

export const HeatMap = ({
  id,
  data,
  rowLabels,
  colLabels,
  cellLabels,
  colorScale = HEAT_SCALE,
  cellWidth = 5,
  showValues = false,
  showLegend = true,
  minValue,
  maxValue,
}: HeatMapProps): VNode => {
  const firstRow = data[0];
  if (data.length === 0 || !firstRow || firstRow.length === 0)
    return paragraphNode({
      id,
      runs: [plainRun('No data', DIM)],
      fg: FOREGROUND,
    });

  const numCols = firstRow.length;
  const allValues = data.flat();
  const min = minValue ?? Math.min(...allValues);
  const max = maxValue ?? Math.max(...allValues);
  const rowLabelWidth = rowLabels
    ? Math.max(...rowLabels.map((label) => label.length)) + 1
    : 0;

  const rows: VNode[] = [];
  if (colLabels)
    rows.push(
      gridRow(`${id}-columns`, [
        ...(rowLabelWidth > 0
          ? [plainRun(' '.repeat(rowLabelWidth + 1), DIM, FOREGROUND)]
          : []),
        ...Array.from({ length: numCols }, (_, column) =>
          plainRun(
            padCenter(colLabels[column] ?? String(column), cellWidth),
            DIM,
            FOREGROUND,
          ),
        ),
      ]),
    );
  data.forEach((row, rowIndex) => {
    rows.push(
      gridRow(`${id}-row-${rowIndex}`, [
        ...(rowLabels
          ? [
              plainRun(
                `${padStart(rowLabels[rowIndex] ?? String(rowIndex), rowLabelWidth)} `,
                DIM,
                FOREGROUND,
              ),
            ]
          : []),
        ...row.map((value, column) =>
          plainRun(
            showValues
              ? padCenter(
                  cellLabels?.[rowIndex]?.[column] ?? String(Math.round(value)),
                  cellWidth,
                )
              : getShadeForValue(value, min, max).repeat(cellWidth),
            0,
            getColorForValue(value, min, max, colorScale),
          ),
        ),
      ]),
    );
  });
  if (showLegend)
    rows.push(
      h(
        BoxRenderable,
        { id: `${id}-legend`, flexDirection: 'row', marginTop: 1 },
        gridRow(`${id}-legend-scale`, [
          plainRun('Low ', DIM, FOREGROUND),
          ...colorScale.map((colour) => plainRun('█ ', 0, colour)),
          plainRun('High', DIM, FOREGROUND),
        ]),
      ),
    );
  return h(BoxRenderable, { id, flexDirection: 'column' }, ...rows);
};
