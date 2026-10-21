// BB-375 — footer actions: action-item chips + withActionPipes (│ between them).
// No footer fill — chips sit on the terminal default (same as header).

import { BoxRenderable, h, type VNode } from '@opentui/core';
import { BORDER, FOREGROUND_ACTIVE, textNode } from '../../lib/vnode.js';

/**
 * One footer action — the atomic chip screens publish.
 * Rendered as `key` ({@link FOREGROUND_ACTIVE} fg) plus optional muted `:Label`.
 */
export interface ActionItem {
  /** Stable id — nodes are `${id}-key` / `${id}-sfx`. */
  id: string;
  /** Active key glyph, e.g. `e`, `Tab`, `→`. */
  key: string;
  /**
   * Plain label without a colon (`edit`, `next`). Title-cased and prefixed
   * with `:` at render time. Omit for a bare key (`Enter`).
   */
  label?: string;
}

/** Build an {@link ActionItem} — the usual screen-side constructor. */
export const actionItem = (
  id: string,
  key: string,
  label?: string,
): ActionItem => (label === undefined ? { id, key } : { id, key, label });

/** Legacy ladder string for assertions (`n new · e edit`). */
export const formatActionLadder = (
  items: readonly ActionItem[] | undefined,
): string =>
  (items ?? [])
    .map((item) =>
      item.label !== undefined ? `${item.key} ${item.label}` : item.key,
    )
    .join(' · ');

/** Box-drawing pipe — sits optically higher than ASCII `|`. */
export const footerSep = (id: string): VNode =>
  textNode({ id, content: ' │ ', fg: BORDER });

/** First letter upper for labels (`edit` → `Edit`). */
const titleCase = (label: string): string =>
  label.length === 0 ? label : label.charAt(0).toUpperCase() + label.slice(1);

/**
 * Render one action-item as FOREGROUND_ACTIVE-fg key + optional muted `:Label`.
 * Also used by the kernel basics row (`Esc:back`, `q:quit`).
 */
export const renderActionItem = (
  item: Pick<ActionItem, 'id' | 'key' | 'label'> & { suffix?: string },
): VNode[] => {
  const suffix =
    item.suffix ??
    (item.label !== undefined ? `:${titleCase(item.label)}` : undefined);
  const nodes: VNode[] = [
    textNode({
      id: `${item.id}-key`,
      content: item.key,
      fg: FOREGROUND_ACTIVE,
      bold: true,
    }),
  ];
  if (suffix !== undefined) {
    nodes.push(
      textNode({
        id: `${item.id}-sfx`,
        content: suffix,
        fg: BORDER,
      }),
    );
  }
  return nodes;
};

/**
 * Low-level chip used by kernel basics that already pass a ready `:suffix`
 * (e.g. `:quit`). Screen actions prefer {@link actionItem}.
 */
export const footerKey = (id: string, key: string, suffix?: string): VNode[] =>
  suffix === undefined
    ? renderActionItem({ id, key })
    : renderActionItem({ id, key, suffix });

/**
 * A segment inside {@link withActionPipes}: an {@link ActionItem}, or already
 * rendered nodes (plain text, {@link footerKey} chips, …).
 */
export type ActionSegment = ActionItem | readonly VNode[];

const isActionItem = (segment: ActionSegment): segment is ActionItem =>
  !Array.isArray(segment);

/**
 * Wrapper that inserts `│` between segments — action-items or prebuilt node
 * groups. Callers never place separators by hand.
 */
export const withActionPipes = (
  sepIdPrefix: string,
  segments: readonly ActionSegment[],
): VNode[] => {
  const parts: VNode[] = [];
  let placed = 0;
  for (const segment of segments) {
    const nodes = isActionItem(segment)
      ? renderActionItem(segment)
      : [...segment];
    if (nodes.length === 0) continue;
    if (placed > 0) parts.push(footerSep(`${sepIdPrefix}-${placed}`));
    parts.push(...nodes);
    placed += 1;
  }
  return parts;
};

/** Pipe-joined chips from an action-item list (thin wrapper over {@link withActionPipes}). */
export const footerActionChips = (
  items: readonly ActionItem[],
  sepIdPrefix = 'footer-actions-sep',
): VNode[] => withActionPipes(sepIdPrefix, items);

/**
 * Full screen-actions row: lead pad + piped action-items + width pad.
 * Returns `null` when `items` is empty — caller omits the row.
 */
export const footerActions = (
  id: string,
  items: readonly ActionItem[],
  width: number,
): VNode | null => {
  if (items.length === 0) return null;
  return h(
    BoxRenderable,
    {
      id,
      flexDirection: 'row',
      height: 1,
      flexShrink: 0,
      width: '100%',
    },
    textNode({
      id: `${id}-lead`,
      content: ' ',
    }),
    ...withActionPipes(`${id}-sep`, items),
    textNode({
      id: `${id}-pad`,
      content: ' '.repeat(width),
    }),
  );
};

/** @deprecated Use {@link footerActions}. */
export const footerActionsRow = footerActions;

/**
 * Parse a legacy ladder string (`n new · e edit`) into action-items.
 * Prefer publishing {@link ActionItem} arrays from screens directly.
 */
export const parseFooterLadder = (
  ladder: string,
  idPrefix = 'footer-action',
): ActionItem[] => {
  const segments = ladder
    .split(/\s·\s/)
    .map((s) => s.trim())
    .filter((s) => s !== '');
  const items: ActionItem[] = [];
  for (const [i, seg] of segments.entries()) {
    const m = /^(\S+)(?:\s+(.+))?$/.exec(seg);
    if (m === null) continue;
    const key = m[1];
    if (key === undefined) continue;
    const label = m[2];
    items.push(actionItem(`${idPrefix}-${i}`, key, label));
  }
  return items;
};
