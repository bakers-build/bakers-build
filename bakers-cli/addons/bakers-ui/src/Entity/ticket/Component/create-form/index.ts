// The "New ticket" popup (BB-190) as CHROME around its declaration.
//
// It renders no field. It walks `FIELDS` through the widget layer and adds the
// one thing that is genuinely the FORM's rather than a kind's: the note for a
// bag whose failure has no field to be reported at. Everything this file used to
// spell out — prose wrap, the search box, the suggestion window, the checkbox
// list, the `< value >` ring, `[ … ]`, and the field order written out by name —
// now lives once, per kind, in `src/Widget/` (BB-257 re-entry AC-10/AC-11).
//
// The consequence worth stating: adding a field to `Form/create.ts` makes it
// appear here, in declaration order, with no edit to this file.
//
// BB-340 Task 9 — and it returns a RENDERABLE TREE. The rows are gone with the
// caret channel they carried: the Title and Description values and the Parent
// field's query are `FieldTextarea` nodes inside `renderDeclaredFieldsTree`'s
// tree, so there is no row for `onCaret` to rebase and no array for the screen
// to rebase again onto its own.

import type { VNode } from '@opentui/core';
import { columnNode, textNode } from '../../../../lib/vnode.js';
import {
  note,
  renderDeclaredFieldsTree,
  widgetFor,
} from '../../../../Widget/index.js';
import type {
  CreateFieldId,
  CreateFormOptions,
  CreateFormState,
  FieldDef,
} from '../../Form/create.js';

/** The chrome the kernel wraps this tree in. */
export interface CreateFormChrome {
  /**
   * Usable width inside the popup box. Load-bearing for AC-1: the kernel draws
   * every row as `'│ ' + fitLine(row, width) + ' │'`, and `fitLine` TRUNCATES
   * with an ellipsis — so a description line longer than this budget lost its
   * tail and the writer could not read back what they had typed (BB-257 F1).
   * Wrapping therefore happens below this line, where it is known which rows are
   * prose; the overlay draws two different popups and knows nothing of that.
   */
  width?: number | undefined;
  /**
   * A failure line drawn inside the popup (BB-309 D6).
   *
   * The same channel `editFormTree` already has, and for the same reason: a
   * rejected write must be reported WHERE the writer is looking, without
   * costing them the text they typed. It sits at the top beside the
   * option-load note, because that is where this popup already reports a thing
   * that belongs to no single field.
   */
  message?: string | undefined;
}

const DEFAULT_WIDTH = 58;

/** The id the popup's body column is rooted at. */
export const CREATE_FORM_REGION = 'create-form';

/** The whole load failed, rather than one bag. It belongs to no field. */
const WHOLE_FORM = 'The form options';

/**
 * The two properties this component reads off a declaration.
 *
 * Structural on purpose, so the same function serves both the narrowed
 * `FieldDef<CreateFieldId>` the popup declares and the plain `FieldDecl` the
 * widget layer hands to `errorFor` — no cast at either call site.
 */
interface Bagged {
  label: string;
  kind: string;
  from?: string | undefined;
}

/**
 * How a failed bag is NAMED.
 *
 * A field's label names the single value it holds ("Parent", "Assignee"), so
 * the collection behind it is `<label> options`. A multiselect's label already
 * IS the collection's name ("Labels"), so it needs no suffix. Derived rather
 * than tabulated, because a table of bag names is a second copy of the
 * declaration and drifts from it the moment a field is renamed.
 */
const bagName = (field: Bagged): string =>
  field.kind === 'multiselect' ? field.label : `${field.label} options`;

/** Render the "New ticket" popup as the tree the kernel frames. */
export function createFormTree(
  fields: FieldDef<CreateFieldId>[],
  s: CreateFormState,
  opts: CreateFormOptions,
  chrome: CreateFormChrome = {},
): VNode {
  const width = chrome.width ?? DEFAULT_WIDTH;
  // Keyed by BAG, which is what `from` names; the typed shape is the adapter's
  // business, and reading it by key is what keeps this loop declaration-driven.
  const errors = (opts.errors ?? {}) as Record<string, string | undefined>;

  const reason = (field: Bagged): string | undefined => {
    const message = field.from === undefined ? undefined : errors[field.from];
    return message === undefined
      ? undefined
      : `${bagName(field)} could not be loaded: ${message}`;
  };

  // A bag whose kind draws its own failure reports at the field; every other
  // one, plus a whole-form failure, collapses into ONE row at the top. It is a
  // note, not a refusal: a failed OPTION read must not cost the writer the
  // description they opened the popup to type (D4).
  const formLevel = fields
    .filter((f) => !widgetFor(f).ownsError)
    .map(reason)
    .filter((sentence): sentence is string => sentence !== undefined);
  if (errors.form !== undefined) {
    formLevel.push(`${WHOLE_FORM} could not be loaded: ${errors.form}`);
  }

  /** A `⚠` note, wrapped, as the rows it occupies. */
  const noteNodes = (text: string, id: string): VNode[] =>
    note(text, '', width).map((row, index) =>
      textNode({ id: `${id}-${index}`, content: row }),
    );

  return columnNode(
    CREATE_FORM_REGION,
    ...(formLevel.length > 0
      ? noteNodes(formLevel.join('; '), 'create-form-load-note')
      : []),
    // `note` supplies the `⚠` sigil itself, so the message is passed plain —
    // and it WRAPS, which is what keeps a long server message off the frame's
    // ellipsis (the same reason the option-load note above it wraps).
    ...(chrome.message ? noteNodes(chrome.message, 'create-form-message') : []),
    renderDeclaredFieldsTree(fields, s, opts, {
      width,
      errorFor: reason,
      // A form-level failure means no read succeeded, so an empty bag may not
      // be reported as genuinely empty either — the note above is then the only
      // truthful thing on screen.
      trusted: formLevel.length === 0,
    }),
  );
}
