import { BoxRenderable, h, type RGBA, type VNode } from '@opentui/core';
import { BORDER } from '../../lib/theme.js';

export interface DividerProps {
  id: string;
  color?: RGBA;
}

// One array for every divider: `border` re-applies Yoga borders when it is
// handed a different value, and a patch restates it on every draw.
const TOP: ['top'] = ['top'];

/** The horizontal, unlabelled rule — the only shape the TUI draws. */
export const Divider = ({ id, color }: DividerProps): VNode =>
  h(
    BoxRenderable,
    { id, flexDirection: 'row' },
    h(BoxRenderable, {
      id: `${id}-rule`,
      flexGrow: 1,
      borderStyle: 'single',
      borderColor: color ?? BORDER,
      border: TOP,
    }),
  );
