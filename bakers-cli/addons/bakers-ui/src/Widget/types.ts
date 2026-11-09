// BB-257 (re-entry) — the WIDGET contract: one renderer per field KIND.
//
// The layer the review found missing. Without it `createFormLines` carried prose
// wrap, a search box, a suggestion window, a checkbox list, a `< value >` ring
// and `[ … ]` inline, and `editFormLines` carried a second, smaller copy — so a
// change to how a kind looks had to be made twice, and was made differently.
//
// Two rules shape the interface:
//
//   1. `render` takes ONE context type for every kind, so the component's
//      iteration is `widgetFor(field).render(ctx)` with no per-kind cast at the
//      call site. Every narrowing a kind needs (this field's text, its picked
//      id, its chosen set, its bag) is a typed accessor on the context, so the
//      one place that knows the state is flat and keyed by field id is the
//      context builder — not five widgets and two components.
//   2. A widget is ENTITY-AGNOSTIC. It knows `FieldDecl`, `Option` and display
//      columns; it knows nothing of tickets, projects, JSON:API or services. So
//      any wording a kind cannot invent (what an ABSENT bag means) rides on the
//      declaration as plain text, and any option LOADING a field needs is
//      declared beside the service that performs it — see `option-source.ts`.

import type { FieldDecl, Option } from '../Form/index.js';

/** Everything a widget may read while rendering one field. */
export interface WidgetContext {
  /** The declaration being rendered — plain, printable data. */
  readonly field: FieldDecl;
  /** Whether the form's cursor is on this field. */
  readonly active: boolean;
  /** The kernel's within-field cursor — per kind: a character offset in a
   *  text value (BB-283), a multiselect row, a suggestion row. */
  readonly cursor: number;
  /** Display columns the popup body may use, border excluded. */
  readonly width: number;
  /** Columns the `<label>:` prefix occupies before an INLINE value, shared by
   *  every field in the declaration that has one so the values line up. */
  readonly labelColumn: number;
  /** Columns the active marker occupies on a field's first row. */
  readonly markWidth: number;
  /** The ready-made failure sentence for this field's bag, when it failed and
   *  this kind draws its own failure (`ownsError`). Naming a bag is the
   *  component's business — it is the layer that knows what the bags are for. */
  readonly error: string | undefined;
  /**
   * Whether an empty bag may be REPORTED as empty.
   *
   * False when a form-level failure means no read succeeded at all, so
   * "(none available)" would be a claim the popup cannot support.
   */
  readonly trusted: boolean;
  /** This field's option bag, or `undefined` when the bag is ABSENT. */
  list(): Option[] | undefined;
  /** This field's value as text (a `text` field). */
  text(): string;
  /** This field's picked id, or null (a `select`/`autocomplete` field). */
  selected(): string | null;
  /** The ids this field has toggled on (a `multiselect` field). */
  chosen(): ReadonlySet<string>;
  /** The text typed into this field's search box (an `autocomplete` field). */
  query(): string;
}

/**
 * BB-326 — where a kind's insertion point goes, for the kinds that have one.
 *
 * NOT A DRAWING. The `text` field used to splice an inverse-video cell into its
 * own row; on an operator decision — they drive the cockpit over mosh from a
 * phone, where mosh's local predictive echo needs a real cursor to predict at —
 * the insertion point became a terminal cursor instead. A terminal cursor is not
 * a character, so it cannot be expressed in the rows a widget returns: it is
 * published as a POSITION and `renderWidget` turns it into a `FieldTextarea`
 * node, which owns the cell and the cursor.
 *
 * IT LIVES HERE NOW, and that is the whole shape of BB-340 Task 9. It used to
 * be `types.ts`'s `TextCaret`, in the shared types, because three layers that may
 * not import each other all spoke it — `Widget/` published it, `Screen/` carried
 * it on the presentation and `Kernel/` consumed it, each restating the one
 * coordinate space it owned (a widget row, a `lines` index, a box row). The
 * screens hand over trees, so nothing rebases it: `renderWidget` spends `row` and
 * `column` as the block's position in the layout and Yoga places it. One layer
 * speaks it, and it is this one.
 *
 * `row` indexes the rows `render` returned and `column` counts display columns
 * from the popup body's left edge.
 */
export interface FieldCaret {
  /** The row the value block starts on, among the rows `render` returned. */
  readonly row: number;
  /** Display columns from the body's left edge to the value block. */
  readonly column: number;
  /** The value block's display width in columns... */
  readonly width: number;
  /** ...and its height in rows. */
  readonly height: number;
  /**
   * The value block's rows joined by `\n`.
   *
   * ONE WRAP: the widget wraps once and hands the rows here, so the height the
   * layout reserves and the text the renderable paints cannot disagree about
   * where a line breaks.
   */
  readonly text: string;
  /** The insertion point's offset into {@link text} (UTF-16 code units). */
  readonly offset: number;
  /**
   * What to paint when {@link text} is empty.
   *
   * An empty `text` field still occupies a row so the popup's rows keep lining
   * up with its fields, and the block is what stands on that row — so it has to
   * be told the same word the composed row said, or an empty active field would
   * go blank the moment it got the cursor.
   */
  readonly placeholder: string | undefined;
}

export interface FieldWidget {
  /**
   * The rows this field occupies, WITHOUT the active marker: the caller prefixes
   * it to row 0, which is why a widget's continuation rows carry their own
   * absolute indent rather than a relative one.
   */
  render(ctx: WidgetContext): string[];
  /**
   * Where this kind's insertion point goes, when it is active and has one.
   *
   * Optional because most kinds have none at all: a `select` is a ring, a
   * `multiselect` a checklist, an `action` a button. Two kinds implement it —
   * `text` (the value block) and, since BB-326's widget-fit F2 conversion,
   * `autocomplete` (the query row, whose `▌` character it replaced with a real
   * terminal cursor).
   */
  caret?(ctx: WidgetContext): FieldCaret | undefined;
  /**
   * Whether this kind draws its bag's failure itself.
   *
   * A kind with a block of its own can put a `⚠` note in it; a one-line
   * `< value >` has nowhere to put one, so its failure is reported by the
   * component as a form-level note instead — Labels and Parent at the field,
   * Assignee and Conductor at the top — expressed as a property of the kind.
   */
  readonly ownsError: boolean;
  /** Whether this kind renders a value INLINE after its label, and therefore
   *  takes part in the shared label column. */
  readonly inlineValue: boolean;
}
