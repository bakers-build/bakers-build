import { BoxRenderable, h, type RGBA, type VNode } from '@opentui/core';
import { FOREGROUND, FOREGROUND_HIGHLIGHT } from '../../lib/theme.js';
import { BOLD, DIM, paragraphNode, plainRun } from '../../lib/vnode.js';

export interface BarChartItem {
  label: string;
  value: number;
  color?: RGBA;
}

/** The horizontal chart — the only direction the TUI draws. */
export interface BarChartProps {
  id: string;
  data: readonly BarChartItem[];
  width?: number;
  showValues?: boolean;
  title?: string;
  maxValue?: number;
}

const BAR_CHAR = '█';
const EMPTY_CHAR = '░';

const pad = (str: string, length: number): string => {
  if (str.length >= length) {
    return str.slice(0, length);
  }
  return str.padEnd(length);
};

const padStart = (str: string, length: number): string => {
  if (str.length >= length) {
    return str.slice(0, length);
  }
  return ' '.repeat(length - str.length) + str;
};

export const BarChart = ({
  id,
  data,
  width = 30,
  showValues = true,
  title,
  maxValue: suppliedMax,
}: BarChartProps): VNode => {
  if (data.length === 0)
    return paragraphNode({
      id,
      runs: [plainRun('No data', DIM)],
      fg: FOREGROUND,
    });

  const maxValue = suppliedMax ?? Math.max(...data.map((d) => d.value));
  const maxLabelLen = Math.max(...data.map((d) => d.label.length));
  const maxValLen = Math.max(...data.map((d) => String(d.value).length));
  const barWidth = width - maxLabelLen - maxValLen - 3;

  return h(
    BoxRenderable,
    { id, flexDirection: 'column' },
    ...(title
      ? [
          paragraphNode({
            id: `${id}-title`,
            runs: [plainRun(title, BOLD)],
            fg: FOREGROUND_HIGHLIGHT,
          }),
        ]
      : []),
    // One bar per data item, in the caller's order.
    ...data.map((item, index) => {
      const row = `${id}-${index}`;
      const filled =
        maxValue === 0
          ? 0
          : Math.round((item.value / maxValue) * Math.max(1, barWidth));
      const empty = Math.max(0, barWidth - filled);
      return h(
        BoxRenderable,
        { id: row, flexDirection: 'row', gap: 1 },
        paragraphNode({
          id: `${row}-label`,
          runs: [plainRun(pad(item.label, maxLabelLen))],
          fg: FOREGROUND,
        }),
        paragraphNode({
          id: `${row}-bar`,
          runs: [plainRun(BAR_CHAR.repeat(filled) + EMPTY_CHAR.repeat(empty))],
          fg: item.color ?? FOREGROUND_HIGHLIGHT,
        }),
        ...(showValues
          ? [
              paragraphNode({
                id: `${row}-value`,
                runs: [plainRun(padStart(String(item.value), maxValLen), DIM)],
                fg: FOREGROUND,
              }),
            ]
          : []),
      );
    }),
  );
};
