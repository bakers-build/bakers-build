// BB-223 AC-7 — the compact ticket block behind `bakers ui <ticket> --view
// teaser|board_card` (spec Decision 13, variant A).
//
// THE FIELD SETS BELOW ARE A DELIBERATE DUPLICATE of two Drupal displays:
//   config/sync/core.entity_view_display.bb_ticket.bb_ticket.teaser.yml
//     → bb_theme:ticket-row — identifier, title, state, derived_status,
//       since_label, claim_machine, assignee_{name,initials,color}
//   config/sync/core.entity_view_display.bb_ticket.bb_ticket.board_card.yml
//     → bb_theme:board-card — identifier, title, state, workflow(type),
//       derived_status, priority, url; footer slot: claim_machine
//
// Why duplicated: those displays are display_builder→SDC bindings producing
// HTML, JSON:API never serves rendered output, and NEITHER the `session` nor the
// `pm` scope may read `entity_view_display` (both come back empty with
// "insufficient authorization"). Reading the mapping at runtime — variant B — is
// the named follow-up in the spec's *Out of scope*; it needs a `bb_session`
// read permission in `config/sync` AND the recipe copy, plus proof that
// `third_party_settings` survives JSON:API serialization. When that lands, this
// module is the ONE place that changes; the `--view` CLI surface is identical
// either way. Until then, this file drifting from those YAMLs is the accepted
// cost, named in Decision 13.

import type { VNode } from '@opentui/core';
import { asString } from '../../../../lib/format.js';
import { columnNode, rowNode, textNode } from '../../../../lib/vnode.js';
import type { TicketDetailDocument, UiViewMode } from '../../../../types.js';

/** The same em-dash placeholder ticket-table/run-table use for a missing value. */
const MISSING = '—';

/** Left column width, so the labels line up like the other components' columns. */
const LABEL_WIDTH = 10;

/** The id every node of the block hangs under. */
const BLOCK_ID = 'ticket-teaser';

/**
 * One row of the compact block: the heading, the blank under it, or a labelled
 * field (BB-340 D4).
 *
 * `key` says WHICH field this is, so a node is keyed on what it renders rather
 * than on where it sits — the two modes list different fields in different
 * places, and only the key makes those two trees comparable.
 */
interface TeaserRow {
  readonly key: string;
  /** The left column, or null for a row that is a single full-width cell. */
  readonly label: string | null;
  readonly value: string;
}

/** An attribute as a display string, or the shared placeholder. */
function attr(attributes: Record<string, unknown>, key: string): string {
  const raw = attributes[key];
  if (typeof raw === 'string' && raw !== '') return raw;
  if (typeof raw === 'number') return String(raw);
  return MISSING;
}

/**
 * A ticket compacted to the field set of its Drupal view-mode display, as KEYED
 * rows — the ONE description of what `--view teaser|board_card` shows.
 *
 * It stays the single source for both shapes below because this block is BOTH a
 * screen and a pipe: `bakers ui BB-1 --view teaser | cat` prints it as text
 * (spec F5) while the interactive screen hands over renderables. Deriving both
 * from here is what keeps them from describing different tickets.
 *
 * `full` never reaches here — the screen renders the tabbed detail for it — but
 * it is accepted and treated as `teaser` so the function is total.
 */
export function ticketTeaserRows(
  document: TicketDetailDocument,
  mode: UiViewMode,
): TeaserRow[] {
  const a: Record<string, unknown> = document.data?.attributes ?? {};
  const field = (key: string, value: string): TeaserRow => ({
    key,
    label: key,
    value,
  });
  const head: TeaserRow[] = [
    {
      key: 'heading',
      label: null,
      value: `${attr(a, 'identifier')} · ${attr(a, 'title')}`,
    },
    { key: 'gap', label: null, value: '' },
  ];

  if (mode === 'board_card') {
    return [
      ...head,
      field('state', attr(a, 'state')),
      field('type', attr(a, 'workflow')),
      field('status', attr(a, 'derived_status')),
      field('priority', attr(a, 'priority')),
      field('claim', attr(a, 'claim_machine')),
    ];
  }

  // `teaser`. The display binds assignee_name + assignee_initials + a colour;
  // the terminal block shows the name with the initials as its short handle.
  const name = attr(a, 'assignee_name');
  const initials = asString(a.assignee_initials);
  const assignee =
    name === MISSING
      ? (initials ?? MISSING)
      : initials
        ? `${name} (${initials})`
        : name;

  return [
    ...head,
    field('state', attr(a, 'state')),
    field('status', attr(a, 'derived_status')),
    field('since', attr(a, 'since_label')),
    field('assignee', assignee),
    field('claim', attr(a, 'claim_machine')),
  ];
}

/**
 * The block as ROWS OF TEXT — what a pipe prints (spec F5).
 *
 * `padEnd` rather than `lib/width.ts`: this is the same UTF-16 padding the block
 * has always used, kept byte for byte because plan Task 10 diffs this output
 * against a capture taken before the conversion. The TREE below is where the
 * column becomes a Yoga budget instead.
 */
export function ticketTeaserLines(
  document: TicketDetailDocument,
  mode: UiViewMode,
): string[] {
  return ticketTeaserRows(document, mode).map((row) =>
    row.label === null
      ? row.value
      : `${row.label.padEnd(LABEL_WIDTH)} ${row.value}`,
  );
}

/**
 * The block as the renderable tree the screen hands over (BB-340 D1).
 *
 * A labelled field is a row of two cells — the label in a {@link LABEL_WIDTH}
 * budget, the value taking what is left — where the text shape pads. `rowNode`'s
 * `gap: 1` is the single space between them, so the picture is the one the rows
 * describe without anything here counting a display column (R5/D8).
 *
 * MOUNTED WHOLE, and trivially so: the field set is a fixed literal of at most
 * seven rows, well under `@opentui/core@0.5.1`'s 16 382 renderables.
 */
export function ticketTeaserTree(
  document: TicketDetailDocument,
  mode: UiViewMode,
): VNode {
  return columnNode(
    BLOCK_ID,
    ...ticketTeaserRows(document, mode).map((row) =>
      row.label === null
        ? textNode({ id: `${BLOCK_ID}-${row.key}`, content: row.value })
        : rowNode(
            `${BLOCK_ID}-row-${row.key}`,
            textNode({
              id: `${BLOCK_ID}-label-${row.key}`,
              content: row.label,
              width: LABEL_WIDTH,
            }),
            textNode({
              id: `${BLOCK_ID}-value-${row.key}`,
              content: row.value,
              width: 0,
            }),
          ),
    ),
  );
}
