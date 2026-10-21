import { BoxRenderable, h, type RGBA, type VNode } from '@opentui/core';
import { BORDER, FOREGROUND } from '../../lib/theme.js';
import {
  BOLD,
  DIM,
  paragraphNode,
  plainRun,
  pressHandler,
} from '../../lib/vnode.js';

export type BorderStyle = 'single' | 'double' | 'rounded' | 'heavy';

export interface CardProps {
  /** Entity-derived; the card's parts derive their ids from it. */
  id: string;
  title?: string;
  subtitle?: string;
  children: readonly VNode[];
  borderColor?: RGBA;
  width?: number | `${number}%`;
  onMouseDown?: () => void;
  borderStyle?: BorderStyle;
  paddingX?: number;
  paddingY?: number;
}

export const Card = ({
  id,
  title,
  subtitle,
  children,
  borderColor,
  width,
  onMouseDown,
  borderStyle = 'rounded',
  paddingX = 1,
  paddingY = 0,
}: CardProps): VNode => {
  const heading: VNode[] = [];
  if (title)
    heading.push(
      paragraphNode({
        id: `${id}-title`,
        runs: [plainRun(title, BOLD)],
        fg: FOREGROUND,
      }),
    );
  if (subtitle)
    heading.push(
      paragraphNode({
        id: `${id}-subtitle`,
        runs: [plainRun(subtitle, DIM)],
        fg: FOREGROUND,
      }),
    );
  return h(
    BoxRenderable,
    {
      id,
      flexDirection: 'column',
      border: true,
      borderStyle,
      borderColor: borderColor ?? BORDER,
      width: width ?? 'auto',
      paddingLeft: paddingX,
      paddingRight: paddingX,
      paddingTop: paddingY,
      paddingBottom: paddingY,
      onMouseDown: pressHandler(onMouseDown),
    },
    ...(heading.length > 0
      ? [
          h(
            BoxRenderable,
            {
              id: `${id}-heading`,
              flexDirection: 'column',
              paddingBottom: 1,
            },
            ...heading,
          ),
        ]
      : []),
    h(
      BoxRenderable,
      { id: `${id}-content`, flexDirection: 'column' },
      ...children,
    ),
  );
};
