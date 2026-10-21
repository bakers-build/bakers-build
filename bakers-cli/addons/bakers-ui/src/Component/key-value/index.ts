import { BoxRenderable, h, type RGBA, type VNode } from '@opentui/core';
import { FOREGROUND } from '../../lib/theme.js';
import { paragraphNode, plainRun, UNDERLINE } from '../../lib/vnode.js';

export interface KeyValueItem {
  key: string;
  value: string;
  /** Drawn underlined — the value is a link the click acts on. */
  underline?: boolean;
  color?: RGBA;
  onMouseDown?: () => void;
}

export interface KeyValueProps {
  id: string;
  items: readonly KeyValueItem[];
  keyWidth?: number;
  separator?: string;
  keyColor?: RGBA;
  valueColor?: RGBA;
}

export const KeyValue = ({
  id,
  items,
  keyWidth,
  separator = ':',
  keyColor,
  valueColor,
}: KeyValueProps): VNode => {
  const resolvedKeyWidth =
    keyWidth ?? Math.max(0, ...items.map((item) => item.key.length)) + 1;
  const resolvedKeyColor = keyColor ?? FOREGROUND;
  const resolvedValueColor = valueColor ?? FOREGROUND;
  return h(
    BoxRenderable,
    { id, flexDirection: 'column', width: '100%' },
    // A fixed list per owner, rebuilt whole from the model on every draw, so
    // the position is a sound key for its rows.
    ...items.map((item, index) => {
      const row = `${id}-${index}`;
      return h(
        BoxRenderable,
        { id: row, flexDirection: 'row', gap: 1, width: '100%' },
        paragraphNode({
          id: `${row}-key`,
          runs: [plainRun(item.key.padEnd(resolvedKeyWidth, ' '))],
          fg: resolvedKeyColor,
        }),
        paragraphNode({
          id: `${row}-separator`,
          runs: [plainRun(separator)],
          fg: resolvedKeyColor,
        }),
        paragraphNode({
          id: `${row}-value`,
          runs: [plainRun(item.value, item.underline ? UNDERLINE : 0)],
          fg: item.color ?? resolvedValueColor,
          flexGrow: 1,
          flexShrink: 1,
          onMouseDown: item.onMouseDown,
        }),
      );
    }),
  );
};
