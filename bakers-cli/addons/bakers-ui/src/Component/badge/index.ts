import type { RGBA, VNode } from '@opentui/core';
import { FOREGROUND, FOREGROUND_HIGHLIGHT } from '../../lib/theme.js';
import { BOLD, paragraphNode, plainRun } from '../../lib/vnode.js';

export type BadgeVariant =
  | 'default'
  | 'success'
  | 'warning'
  | 'error'
  | 'info'
  | 'secondary';

/** The unbordered badge — the only form the TUI draws. */
export interface BadgeProps {
  id: string;
  label: string;
  variant?: BadgeVariant;
  color?: RGBA;
  bold?: boolean;
}

// Every status variant shares the highlight slot: the palette names roles, not
// hues (`lib/theme.ts`).
const variantColor = (variant: BadgeVariant): RGBA =>
  variant === 'secondary' ? FOREGROUND : FOREGROUND_HIGHLIGHT;

export const Badge = ({
  id,
  label,
  variant = 'default',
  color,
  bold = false,
}: BadgeProps): VNode =>
  paragraphNode({
    id,
    runs: [plainRun(label, bold ? BOLD : 0)],
    fg: color ?? variantColor(variant),
  });
