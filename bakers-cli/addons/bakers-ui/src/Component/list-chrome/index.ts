// BB-375 — shared full-screen body helpers: optional filter badges.
// Body frame lives on region-body ScrollBox (Kernel/regions.ts).

import { BoxRenderable, h, type VNode } from '@opentui/core';
import {
  BACKGROUND_ACTIVE,
  BORDER,
  DEFAULT_BACKGROUND,
  FOREGROUND,
  FOREGROUND_ACTIVE,
  textNode,
} from '../../lib/vnode.js';

/** One filter/action badge in the strip above a list table. */
export interface ListFilterBadge {
  /** Stable id suffix — node id is `${stripId}-${id}`. */
  id: string;
  /**
   * Shortcut plus a space plus the idle caption, e.g. `/ search` or `x closed`.
   * The first space-delimited token is the shortcut rendered before an active value.
   */
  label: string;
  /**
   * Active caption rendered after the shortcut (e.g. `closed: hidden`, `who: cw`).
   * Undefined or empty keeps the badge idle: {@link label} only, idle palette.
   */
  value?: string;
}

/**
 * Rounded filter chips in a row (idle outline + active FOREGROUND_ACTIVE fg).
 * Each badge is its own `borderStyle: 'rounded'` box — the panel border language.
 * Horizontal inset matches the body ScrollBox frame padding (BB-375).
 */
export const filterBadgeStrip = (
  id: string,
  badges: readonly ListFilterBadge[],
): VNode => {
  const nodes: VNode[] = [];
  for (const [index, badge] of badges.entries()) {
    if (index > 0) {
      nodes.push(
        textNode({
          id: `${id}-gap-${index}`,
          content: '  ',
          bg: DEFAULT_BACKGROUND,
          fg: BORDER,
        }),
      );
    }
    const value = badge.value;
    const active = value !== undefined && value !== '';
    const label = active ? value : badge.label;
    nodes.push(
      h(
        BoxRenderable,
        {
          id: `${id}-${badge.id}-chip`,
          border: true,
          borderStyle: 'rounded',
          borderColor: BORDER,
          backgroundColor: DEFAULT_BACKGROUND,
          flexShrink: 0,
          // One extra column of air inside the pill (rounder optical mass).
          paddingLeft: 2,
          paddingRight: 2,
          flexDirection: 'row',
        },
        ...(active
          ? [
              textNode({
                id: `${id}-${badge.id}-key`,
                content: `${badge.label.split(' ', 1)[0]} `,
                bg: DEFAULT_BACKGROUND,
                fg: FOREGROUND,
              }),
            ]
          : []),
        textNode({
          id: `${id}-${badge.id}`,
          content: label,
          bg: active ? BACKGROUND_ACTIVE : DEFAULT_BACKGROUND,
          fg: active ? FOREGROUND_ACTIVE : FOREGROUND,
        }),
      ),
    );
  }
  return h(
    BoxRenderable,
    {
      id,
      backgroundColor: DEFAULT_BACKGROUND,
      flexDirection: 'column',
      flexShrink: 0,
      // Match body ScrollBox horizontal inset (BB-375).
      paddingLeft: 1,
      paddingRight: 1,
      paddingTop: 0,
      paddingBottom: 0,
    },
    h(
      BoxRenderable,
      {
        id: `${id}-row`,
        flexDirection: 'row',
        flexWrap: 'wrap',
        flexShrink: 0,
        backgroundColor: DEFAULT_BACKGROUND,
        gap: 0,
      },
      ...nodes,
    ),
  );
};
