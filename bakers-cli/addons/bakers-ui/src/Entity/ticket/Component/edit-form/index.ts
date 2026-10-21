// The "Edit ticket" popup's body (BB-233, widened by BB-308 / BB-360), as
// CHROME around its declaration — a genuine sibling of `Component/create-form`
// now, not a second implementation of it.
//
// BB-257 (re-entry) AC-13/AC-14. What this file used to carry, and why each
// piece had to go:
//
//   * its own `wrap()`, measured in UTF-16 CODE UNITS while every other
//     measurement in the package counts display columns. For ASCII the two agree
//     exactly, which is why it survived a review — but a server message carrying
//     CJK or an emoji wrapped one column short per wide character and the frame
//     clipped what it drew. Two units of measure in one package is a latent
//     defect, not a style point;
//   * its own `labelOf`, a second vocabulary for what a select shows;
//   * `mark(0)`/`mark(1)`/`mark(2)`, row indices hand-counted off a declaration
//     that already knows them;
//   * and no way to render a `multiselect` or an `autocomplete` at all, so a
//     kind the other popup gained was a kind this one could not have.
//
// All four are the same absence: there was no per-kind renderer to share. There
// is now, so this file is the run warning, the legend and the footer — the three
// things that really are this popup's own — around one call.
//
// BB-313 (D4) finally makes the claim above literally true: the field list is
// HANDED IN rather than imported. There are two declarations now — with and
// without Cancel ticket — so importing either here would make this file a
// second decider that can drift from the screen's. It names no field; it renders
// the list it is given.
//
// BB-360 removes the State select legend. Parent and Labels are ordinary
// declared fields drawn by the shared widget layer.
//
// BB-340 Task 9 — and it returns a RENDERABLE TREE. The rows are gone with the
// caret they carried: this popup's two `text` fields hold their insertion point
// as a `FieldTextarea` node inside `renderDeclaredFieldsTree`'s tree, so the
// `onCaret` channel that rebased a widget's row onto this function's array — and
// the array itself — have nothing left to describe.

import type { VNode } from '@opentui/core';
import { columnNode, indentedColumn, textNode } from '../../../../lib/vnode.js';
import { wrapToWidth } from '../../../../lib/width.js';
import {
  findOption,
  renderDeclaredFieldsTree,
} from '../../../../Widget/index.js';
import type { ActiveRunInfo } from '../../../run/Data/active-run.js';
import type { FieldDef } from '../../Form/create.js';
import type {
  EditFieldId,
  EditFormOptions,
  EditFormState,
} from '../../Form/edit.js';

/**
 * The chrome around the fields: what went wrong, and who is live.
 *
 * BB-391 dropped the auth-profile member. It named the profile the write would
 * actually use, which mattered while a connection declared two of them differing
 * only by OAuth scope and the popup could be on the wrong one. BB-359 moved
 * capability onto OG ranks, so the row named something no operator could act on.
 */
export interface EditFormChrome {
  /** The server's own message for the last rejected write (AC-5). */
  message?: string | undefined;
  /** The live run on this ticket, if any (AC-8 / spec Decision 6). */
  activeRun?: ActiveRunInfo | null | undefined;
  /**
   * Usable width inside the popup box. Load-bearing for AC-5: the kernel
   * truncates every row to this width, and a real 403 detail is ~145 chars —
   * *"The current user is not allowed to PATCH the selected field
   * (conductor_id). Assigning a conductor requires the \"assign bakers
   * conductor\" permission."* Emitting it as one row would clip it at "the
   * selected field" and drop the half that says what to DO. So it is wrapped
   * here, where the body is built.
   */
  width?: number | undefined;
}

const DEFAULT_WIDTH = 58;

/** The id the popup's body column is rooted at. */
export const EDIT_FORM_REGION = 'edit-form';

/**
 * The columns the warning's continuation rows are indented by.
 *
 * A YOGA BUDGET, not a measurement (`lib/vnode.ts`): the rows sit inside a box
 * whose `paddingLeft` is this number, where they used to carry two spaces the
 * component had to measure with `displayWidth` to take them off the wrap budget
 * again. One number, spent once, in the layout.
 */
const WARNING_INDENT = 2;

/** Four assignment/time fields plus structure: `assignee_user_id` is human
 *  ownership, `conductor_id` is what dispatches, the two durations are the
 *  ACCOUNTED time (BB-308) — not the run footprint the Runs tab shows — and
 *  Parent/Labels are structural (BB-360). The duration grammar is named
 *  because the popup has no validation channel: an unparseable entry is
 *  silently left unwritten, so the accepted spelling has to be on screen. */
const LEGEND =
  'Assignee = human ownership · Reviewers = named reviewers · Conductor = who works it next · ' +
  'Estimate/Spent = accounted time, not the run footprint (1d 2h 30m, 90m, or a bare number as minutes) · ' +
  'Parent = optional parent ticket · Labels = multi-select from bb_labels · ' +
  'Cancel ticket abandons a non-terminal ticket (Esc closes and writes nothing)';

/**
 * A block of chrome prose, wrapped so the frame never has to clip it.
 *
 * STILL MEASURED, and deliberately: `@opentui/core@0.5.1`'s own `wrapMode:
 * 'word'` breaks a line that exactly fills the width one word early and leaves
 * the break's whitespace at the head of the next row. Measured on this popup's
 * own 403 detail at 40 columns, three of its four rows differ from
 * `wrapToWidth`'s — so letting the renderable wrap would change what the
 * operator reads. See `Widget/text.ts` for the same finding on a field's value.
 */
const proseNodes = (text: string, width: number, id: string): VNode[] =>
  wrapToWidth(text, width).map((row, index) =>
    textNode({ id: `${id}-${index}`, content: row }),
  );

/** …and the same, indented under the warning it continues. */
const underNode = (text: string, width: number, id: string): VNode =>
  indentedColumn(
    id,
    WARNING_INDENT,
    ...proseNodes(text, width - WARNING_INDENT, `${id}-row`),
  );

/**
 * Render the popup body as the tree the kernel puts inside the modal box.
 *
 * Every text node is ONE physical row — the draw loop's one-entry-one-row
 * invariant — so an embedded newline in a server message is split, not passed
 * through.
 */
export function editFormTree(
  fields: readonly FieldDef<EditFieldId>[],
  s: EditFormState,
  opts: EditFormOptions,
  chrome: EditFormChrome = {},
): VNode {
  const width = chrome.width ?? DEFAULT_WIDTH;
  const rows: VNode[] = [];

  // Decision 6: warn, then do what was asked. Both hazards AC-8 names are
  // server invariants (a same-state duplicate run is refused with
  // `claim_conflict`; a live run is owned by `bb_run`, not by the ticket's
  // assignment) — so the UI's job here is legibility, not enforcement.
  const run = chrome.activeRun;
  if (run) {
    // `claim_machine` is populated only while a machine actually holds the
    // claim — measured live on BB-233 mid-run as EMPTY while
    // `derived_status` was already `running`, which made the warning say
    // "by a conductor". The assigned conductor's own label is right here in
    // the options list, so prefer it and keep the vague wording as the last
    // rung, for a live run on a ticket with no conductor at all.
    const who =
      run.machine ||
      findOption(opts.conductors, s.conductor)?.label ||
      'a conductor';
    rows.push(
      ...proseNodes(
        `⚠ ${run.identifier} is being worked on by ${who} (run: ${run.runState}).`,
        width,
        'edit-form-run',
      ),
      underNode(
        'Reassigning does not stop that run;',
        width,
        'edit-form-run-keeps',
      ),
      underNode(
        'clearing the conductor stops the NEXT dispatch.',
        width,
        'edit-form-run-next',
      ),
      textNode({ id: 'edit-form-run-gap', content: '' }),
    );
  }

  const errors = (opts.errors ?? {}) as Record<string, string | undefined>;
  const reason = (field: {
    label: string;
    kind: string;
    from?: string | undefined;
  }): string | undefined => {
    const message = field.from === undefined ? undefined : errors[field.from];
    return message === undefined
      ? undefined
      : `${field.kind === 'multiselect' ? field.label : `${field.label} options`} could not be loaded: ${message}`;
  };
  rows.push(
    renderDeclaredFieldsTree(fields, s, opts, { width, errorFor: reason }),
  );
  rows.push(textNode({ id: 'edit-form-gap', content: '' }));
  rows.push(...proseNodes(LEGEND, width, 'edit-form-legend'));

  // BB-391: the server's message is the whole of this line now. It used to
  // share the slot with a `writes as: <profile>` row shown when there was no
  // message; with one identity that row named nothing actionable, so the slot
  // is simply empty until the server has something to say.
  if (chrome.message !== undefined && chrome.message !== '') {
    rows.push(...proseNodes(chrome.message, width, 'edit-form-message'));
  }
  return columnNode(EDIT_FORM_REGION, ...rows);
}
