// BB-257 (re-entry) — the registry, and the ONE iteration both popups render
// their fields through (AC-10 / AC-11 / AC-13).
//
// A popup component is now: whatever chrome it owns, plus
// `renderDeclaredFieldsTree`, plus whatever chrome it owns. It never names a
// field, never spells a label and never renders a kind — so adding a field to a
// declaration makes it appear, in declaration order, with no edit here or in
// either component.

import { BoxRenderable, h, type VNode } from '@opentui/core';
import type { FieldDecl, FieldKind, Option } from '../Form/index.js';
import { columnNode, textNode } from '../lib/vnode.js';
import actionWidget from './action.js';
import autocompleteWidget from './autocomplete.js';
import { inlineLabelColumn, MARK_WIDTH } from './chrome.js';
import multiselectWidget from './multiselect.js';
import selectWidget from './select.js';
import textWidget from './text.js';
import { FieldTextarea } from './textarea.js';
import type { FieldCaret, FieldWidget, WidgetContext } from './types.js';

/**
 * Every kind's widget, and the only mapping from a kind to a renderer.
 *
 * Typed `Record<FieldKind, …>` on purpose: adding a kind to the kernel's union
 * without adding its widget here is a COMPILE error, which is what makes "every
 * kind a popup can display has exactly one place that renders it" (AC-10) a
 * property of the build rather than of a reviewer's attention.
 */
export const WIDGETS: Record<FieldKind, FieldWidget> = {
  text: textWidget,
  select: selectWidget,
  multiselect: multiselectWidget,
  autocomplete: autocompleteWidget,
  action: actionWidget,
};

/** The widget a declaration is rendered by. */
export const widgetFor = (field: FieldDecl): FieldWidget => WIDGETS[field.kind];

/** What a popup passes in around its declaration. */
export interface FieldsChrome {
  /** Display columns the popup body may use, border excluded. */
  width: number;
  /**
   * The ready-made failure sentence for a field's bag.
   *
   * Composed by the COMPONENT, because naming a bag ("Parent options", "Labels")
   * is a statement about what the bag is for, which is the layer that knows.
   * Only consulted for a kind that draws its own failure; every other bag's
   * failure is the component's own form-level note.
   */
  errorFor?: ((field: FieldDecl) => string | undefined) | undefined;
  /** False when a form-level failure means no read succeeded — see
   *  `WidgetContext.trusted`. Defaults to true. */
  trusted?: boolean | undefined;
}

const MARK_ACTIVE = '▸ ';
const MARK_IDLE = '  ';

const asSet = (value: unknown): ReadonlySet<string> =>
  value instanceof Set ? (value as ReadonlySet<string>) : new Set<string>();

/**
 * One context per declared field, in declaration order.
 *
 * `state` and `options` are the caller's own shapes; the ONE place in the
 * package that has to know they are flat and keyed by field id is the pair of
 * casts below. Every widget reads through the typed accessors instead, so no
 * kind — and no call site — carries a cast of its own.
 */
function contextsFor<
  S extends { active: number; cursor: number },
  O extends object,
>(
  fields: readonly FieldDecl[],
  state: S,
  options: O,
  chrome: FieldsChrome,
): WidgetContext[] {
  const values = state as unknown as Record<string, unknown>;
  const bags = options as unknown as Record<string, Option[] | undefined>;
  const labelColumn = inlineLabelColumn(
    fields.filter((f) => widgetFor(f).inlineValue).map((f) => f.label),
  );
  return fields.map((field, index) => ({
    field,
    active: state.active === index,
    cursor: state.cursor,
    width: chrome.width,
    labelColumn,
    markWidth: MARK_WIDTH,
    error: widgetFor(field).ownsError ? chrome.errorFor?.(field) : undefined,
    trusted: chrome.trusted ?? true,
    list: () => (field.from === undefined ? undefined : bags[field.from]),
    text: () => {
      const v = values[field.id];
      return typeof v === 'string' ? v : '';
    },
    selected: () => {
      const v = values[field.id];
      return typeof v === 'string' ? v : null;
    },
    chosen: () => asSet(values[field.id]),
    query: () => {
      const v = field.query === undefined ? '' : values[field.query];
      return typeof v === 'string' ? v : '';
    },
  }));
}

const markFor = (ctx: WidgetContext): string =>
  ctx.active ? MARK_ACTIVE : MARK_IDLE;

/**
 * BB-340 D3 — the insertion point as a RENDERABLE, in flow.
 *
 * The rows the widget composed for `caret.row … caret.row + caret.height - 1`
 * carry exactly the characters `caret.text` holds — one `wrapToWidthRows` call
 * feeds both — so the block is replaced rather than painted over. `paddingLeft`
 * is the indent those rows carried as spaces; a Yoga budget, not a measurement.
 */
const caretBlock = (field: FieldDecl, caret: FieldCaret): VNode =>
  h(
    BoxRenderable,
    {
      id: `field-${field.id}-input-row`,
      flexDirection: 'row',
      height: caret.height,
      flexShrink: 0,
      paddingLeft: caret.column,
    },
    h(FieldTextarea, {
      id: `field-${field.id}-input`,
      // `value` BEFORE `caretOffset`: `patchTree` assigns in declaration order
      // and `setText` resets the offset.
      value: caret.text,
      caretOffset: caret.offset,
      placeholder: caret.placeholder ?? null,
      // ONE COLUMN WIDER than the text it holds: a terminal cursor at the end
      // of a row sits one past its last character, and a cursor outside the
      // viewport makes the editor scroll sideways — which would paint a shifted
      // window of a row the layout composed unshifted.
      width: caret.width + 1,
      height: caret.height,
      flexShrink: 0,
    }),
  );

/**
 * One field, as the column of nodes it occupies.
 *
 * The row index is a legitimate key HERE and nowhere a list is built: a field's
 * own rows cannot reorder underneath it — the kind decides how many there are
 * and in which order — while the FIELD's id is the declaration's own, because
 * reordering a declaration must not patch one field's content onto another's
 * node (D4/R4).
 */
export function renderWidget(ctx: WidgetContext): VNode {
  const widget = widgetFor(ctx.field);
  const rows = widget.render(ctx);
  const caret = ctx.active ? widget.caret?.(ctx) : undefined;
  const nodes: VNode[] = [];
  rows.forEach((row, i) => {
    if (caret !== undefined && i >= caret.row) {
      if (i === caret.row) nodes.push(caretBlock(ctx.field, caret));
      // The widget owns these rows now; emitting them as text as well would
      // paint the same characters twice, once under a live cursor.
      if (i < caret.row + caret.height) return;
    }
    nodes.push(
      textNode({
        id: `field-${ctx.field.id}-row-${i}`,
        content: i === 0 ? `${markFor(ctx)}${row}` : row,
      }),
    );
  });
  return columnNode(`field-${ctx.field.id}`, ...nodes);
}

/**
 * BB-340 — a declaration's fields as a renderable TREE, and the ONLY surface.
 *
 * `renderDeclaredFields` stood beside this until Task 9 Step 5, composing the
 * same fields as rows of text for the four popups that still handed the kernel
 * a `string[]`. All four hand over a tree now, so the rows had nothing left to
 * feed and the `onCaret` channel they carried had nothing left to describe: the
 * insertion point is a NODE here, laid out where the widget put it, and there is
 * no row for a caller to rebase it onto.
 */
export function renderDeclaredFieldsTree<
  S extends { active: number; cursor: number },
  O extends object,
>(
  fields: readonly FieldDecl[],
  state: S,
  options: O,
  chrome: FieldsChrome,
): VNode {
  return columnNode(
    FIELDS_REGION,
    ...contextsFor(fields, state, options, chrome).map(renderWidget),
  );
}

/** The id the fields column is rooted at, so a caller can nest it by name. */
export const FIELDS_REGION = 'form-fields';
