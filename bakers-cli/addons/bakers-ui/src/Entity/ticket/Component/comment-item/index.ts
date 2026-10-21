import { indentLine } from '../../../../Component/markdown/index.js';
import {
  type ExpandableView,
  expandableRows,
} from '../../../../Component/section-list/index.js';
import { humanizeAge } from '../../../../lib/format.js';
import type { StyledLine } from '../../../../lib/vnode.js';

/** One collapsible comment entry for the Comments tab. */
export interface CommentItem {
  /**
   * The `bb_comment` resource id — what this entry's nodes are keyed on
   * (BB-340 D4/R4).
   *
   * The comments re-sort on every read (newest first, by a total comparator), so
   * a positional key would move one comment's body onto another comment's node
   * after a reload with nothing on screen to say so.
   */
  id: string;
  type: string;
  author: string;
  created: string | null;
  /**
   * The comment body as ALREADY RENDERED rows — BB-372 D3.
   *
   * `commentItems` calls `markdownLines` on the body, so this component never
   * sees Markdown source and cannot parse anything itself.
   */
  bodyLines: StyledLine[];
  /**
   * The collapsed header's tail: the rendered FIRST line's text (D8).
   *
   * Text rather than spans, and that is a named degradation: the caret header row
   * is drawn bold as a whole, so it carries no inline styling.
   */
  preview: string;
}

/** The relative age of a comment's ISO `created`, or '—' when unknown. */
export function relativeCreated(
  created: string | null | undefined,
  nowSeconds: number,
): string {
  const ms = created ? Date.parse(created) : Number.NaN;
  return Number.isNaN(ms)
    ? '—'
    : humanizeAge(Math.floor(ms / 1000), nowSeconds);
}

// The Comments tab: one collapsible entry per comment. Collapsed = a single
// caret header row (`▸ type · author · age · preview`); expanded (`▾`) appends
// the full body, one row per body line. `headerRows[i]` is the row index of
// comment i's header (for selection highlight + scroll).
//
// BB-255 D2: this is a MAPPING onto `expandableRows`, not a second renderer.
// The caret/collapse/expand mechanics live once, beside `sectionRows`, so the
// Overview tab's Description entry offers literally the same interaction rather
// than a copy of it. The rendered text is unchanged — header text, the
// four-space body indent and the trailing blank all still come from here,
// because they are what a COMMENT looks like, not what an expandable entry
// looks like.
//
// BB-372 D5 — THE FOUR-SPACE INDENT IS APPLIED TO THE RENDERED LINE, with
// `Component/markdown`'s `indentLine`, and that ordering is load-bearing rather
// than tidy: four leading spaces prepended to Markdown SOURCE are an indented code
// block in CommonMark, so indenting first and rendering second would turn every
// comment body into a code block. Indenting an already-rendered line cannot, and
// there is no offset arithmetic anywhere to get wrong — the indent is one unstyled
// run ahead of the line's own runs.
export function commentRows(
  items: CommentItem[],
  {
    expanded = new Set<number>(),
    nowSeconds = 0,
    // BB-255 AC-11 review: read-only, like every expansion consumer — the
    // render path is handed one SHARED empty set (`expandedFor`).
  }: { expanded?: ReadonlySet<number>; nowSeconds?: number } = {},
): ExpandableView {
  return expandableRows(
    items.map((item) => ({
      key: `ticket-comment-${item.id}`,
      header: `${item.type} · ${item.author || '—'} · ${relativeCreated(item.created, nowSeconds)} · ${item.preview}`,
      collapsed: [],
      expanded: [
        ...item.bodyLines.map((line) => indentLine(line, 4)),
        // The blank that closes the entry — this component's own row, so a plain
        // string that nothing parses (D3).
        '',
      ],
    })),
    {
      expanded,
      emptyMessage: 'No comments.',
      emptyKey: 'ticket-comment-empty',
    },
  );
}
