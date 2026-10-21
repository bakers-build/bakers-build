// The ONE JSON:API collection-document shape and the ONE page read (BB-294).
//
// Slice-less on purpose, directly under `Entity/` beside `transport.ts`,
// `count.ts` and `cycle.ts`. That is the only placement every slice's `Data/` may
// import: `tests/boundary.test.ts` G2 forbids a data module from reaching another
// slice, and its `sliceOf` returns undefined for a file sitting here, so these
// edges are not cross-slice ones.
//
// Before this file the document was declared FIVE times — in ticket/Data/tickets,
// run/Data/runs, ticket/Data/parents, project/Data/projects and
// conductor/Data/own-conductor — and only the first two carried `links.next`. Same
// name, different shapes: the drift BB-292's "mirroring Task 3 exactly so the
// two lists cannot drift" was meant to prevent had already happened.

import type { VNode } from '@opentui/core';
// TYPE-ONLY, and load-bearing that it is: `listTableRows` describes the shape a
// surface with no layout prints, and `Component/section-list` is where that shape
// is declared. A VALUE edge from here into the shared component drawer would put
// a renderer's code on the path of every `Data/` module that names a column set;
// naming the type costs nothing at runtime and cannot execute a line of it.
import type {
  SectionCells,
  SectionLine,
} from '../Component/section-list/index.js';
import {
  columnNode,
  rowNodeId,
  seamlessRowNode,
  textNode,
} from '../lib/vnode.js';
import { displayWidth, truncateToWidth } from '../lib/width.js';
import type { DropshClient, JsonApiResource } from '../types.js';

/** A JSON:API collection document (the raw shape `client.get` returns). */
export interface JsonApiCollectionDoc {
  data?: JsonApiResource[];
  included?: JsonApiResource[];
  /**
   * The document-level `meta`. BB-305 makes every `bb_*` collection report its
   * total here (`BbResourceType::includeCount()` -> TRUE, applied by
   * `BbResourceTypeRepository::countsCollections()`); see {@link Page.total}.
   *
   * Optional and loosely typed on purpose: a control plane that predates BB-305
   * answers either with no `meta` at all or with a `meta` carrying only `omitted`
   * — both measured this session — and neither is an error.
   */
  meta?: { count?: unknown; omitted?: unknown };
  /**
   * JSON:API's own paging links. `next` is the ONLY valid end-of-list signal, and
   * it stays so after BB-305: a page can simply BE the last one, and `next` is
   * what says whether it is. `rows.length === limit` cannot answer that — a full
   * page is exactly as consistent with "more follows" as with "that was all", and
   * the run collection's last page is short for the ordinary reason that
   * collections do not divide evenly.
   *
   * (BB-305 does retire the older reason given here — that access filtering
   * emptied pages after `page[limit]` had bounded the query, so a SHORT page said
   * nothing at all. Its query-level access filtering makes pages full again. The
   * conclusion is unchanged; only the argument for it is.)
   *
   * Optional, because the three non-paged readers (the parent picker, the projects
   * screen, the own-conductor lookup) read one bounded bag and never page.
   */
  links?: { next?: unknown };
}

/**
 * The collection total a document reports, or null when it reports none.
 *
 * Defensive by contract rather than by suspicion: this value is rendered to the
 * operator as a total, so anything that is not a usable count must become the
 * explicit unknown instead of a guess (AC 8.5). A count that is absent, not a
 * number, not finite, or negative is no count.
 */
function readTotal(doc: JsonApiCollectionDoc | undefined): number | null {
  const count = doc?.meta?.count;
  if (typeof count !== 'number') return null;
  if (!Number.isFinite(count) || count < 0) return null;
  return count;
}

/**
 * The window a paged read ASKED the server for: the request's own `page[offset]`
 * and `page[limit]` (BB-312 D3).
 *
 * A fact about the REQUEST, never an inference about the pages before it. Both
 * list queries send `page[limit]=size` and `page[offset]=index * size`
 * (`Entity/*​/Data/query.ts`), and since BB-305 the server skips and counts the
 * same access-filtered collection — which is what lets a screen turn an offset
 * into a position at all.
 */
export interface PageWindow {
  /** Rows of the collection the request told the server to skip. */
  offset: number;
  /** Rows the request told the server to return at most. */
  limit: number;
}

/**
 * One page of rows plus everything the screen states about it.
 *
 * Carried together so a `hasNext`, a page number or a total cannot go stale beside
 * fresh rows (BB-292 D4/D4a).
 */
export interface Page<Row> {
  rows: Row[];
  hasNext: boolean;
  /** The page these rows CAME FROM, not the one most recently requested. */
  page: number;
  /**
   * The size of the filtered collection as the SERVER reported it, or null when it
   * reported none (BB-292 D6e).
   *
   * It rides the page response's `meta.count`, so it costs no read of its own and
   * cannot describe a different collection than the rows beside it: the server
   * applied one query and answered both from it. That is why the earlier background
   * walk — 28 sequential reads for the open-run collection — is gone rather than
   * kept as a fallback.
   *
   * A number renders as `20 of 107 ticket(s)`; `null` renders as `20 of ?
   * ticket(s)` (D6d), which is a visible statement that this control plane reports
   * no total — never a number nobody established.
   */
  total: number | null;
  /**
   * The window these rows were read with, or `null` when they no longer fill a
   * window that positions them (BB-312 D3/D4).
   *
   * Required and explicitly nullable, exactly like {@link Page.total}: "not
   * established" occupies the field's own place instead of being spelled by an
   * absent key. `null` means the screen states a row COUNT; a window means it may
   * state a RANGE, under the test in `ListScreen.countLabel`.
   */
  window: PageWindow | null;
  /** Present and true when JSON:API withheld primary collection rows. */
  withheld?: true;
}

/**
 * One column of a flat list table (BB-294).
 *
 * `fields` is the load-bearing member and the reason this type is not just a
 * `{label, width, get}` triple: it names the JSON:API attributes and
 * relationships this column's value is built from, so a slice can DERIVE its
 * sparse fieldset from its column set instead of maintaining a second list beside
 * it. A column that is not requested cannot exist, because the column IS the
 * request (BB-292 AC 5 made the mismatch a compile error; this makes it
 * unrepresentable).
 *
 * One column may name SEVERAL fields — the run list's STATE reads `state`,
 * `heartbeat` and `claim_expires_at` through `deriveRunStatus` — and the fieldset
 * is a superset of the columns' union, because some fields are requested for the
 * client-side predicates and rendered by nothing.
 *
 * BB-340 Task 7 — it outlived `lib/table.ts`, whose `renderTable` the tree
 * replaced, and it lives HERE rather than beside its one renderer in
 * `Screen/list-screen.ts` (which is where the plan put it) because the two column
 * SETS are declared in `Entity/*​/Data/`, and `tests/boundary.test.ts` G2 forbids a
 * data module the `Screen/` directory outright. This file is the placement that
 * rule leaves — the same one its own header argues for.
 */
export interface ListColumn<Row, Ctx = void> {
  /** Stable identity for the column; not rendered, and the id its cells carry. */
  readonly key: string;
  readonly label: string;
  /** Display columns to lay out; **0** is the trailing column, which takes the
   *  rest of the row. */
  readonly width: number;
  /** The attributes/relationships this column's value is built from. */
  readonly fields: readonly string[];
  /**
   * BB-345 D3 — the column's LAYOUT, DECLARED and never measured.
   *
   * `width` above is the Yoga basis it has today. `min` is what the column is
   * never squeezed below, `max` what it never grows past, and `grow` its share of
   * the row's surplus (0 or absent = never grows). A column that declares none of
   * the three renders exactly as it did before this ticket, which is what keeps
   * the current appearance a DECISION rather than an accident of the refactor.
   *
   * A BOUND ON THE WRONG SIDE OF `width` IS MEANINGFUL, and since the third pass
   * of BB-345 the code honours it rather than half-honouring it (see the
   * `declared` derivation in {@link tableRow}). Both readings are of the resolved
   * width, not of the basis:
   *
   *  - `max` BELOW `width` NARROWS the column to `max`, because Yoga's `maxWidth`
   *    clamps the basis whether or not the cell may shrink. It is the way to say
   *    "this column is `max` wide" for a column that is also a grower elsewhere,
   *    and it is what the value is cut against — the ellipsis falls at `max`, not
   *    at the unreachable `width`.
   *  - `min` ABOVE `width` WIDENS it to `min`, because `minWidth` wins over both
   *    the basis and the cap. So `{ width: 5, min: 20 }` is a 20-column column
   *    that a shrink may take back down to 20 and no further — which is to say
   *    it is simply 20 wide.
   *
   * Neither is a shape any column ships today; both are honoured so that the
   * first one to declare it gets what it declared. The pair is pinned on the real
   * renderer in `tests-bun/Screen/list-table-layout.test.ts`.
   *
   * A `max` is a DOMAIN constant — `qualification` is the longest member of the
   * ticket workflow's state_flow, hence STATE's 13 — and never a measurement of
   * the page. Sizing a column from its content is the property BB-340 measured
   * `TextTableRenderable` for and rejected it over: the columns shift under the
   * operator every time the page's data changes (spec D4).
   */
  readonly min?: number;
  readonly max?: number;
  readonly grow?: number;
  /**
   * Size this column to the longest value in the rows being rendered, never
   * below `width` and never below the header's own label.
   *
   * The other columns of this tree are DECLARED widths and deliberately so — a
   * domain constant like STATE's 13 is the length of `qualification`. An
   * identifier has no such constant: its length is the project's prefix plus a
   * number, so a fixed column cuts exactly the number that distinguishes one
   * ticket from the next (BB-549). One width per render, shared by the header
   * and every row, is what keeps the column aligned.
   *
   * Deliberately uncapped: a cap puts the ellipsis back on the number. The
   * surplus demand is paid by the row's grower, which is the title.
   */
  readonly fit?: boolean;
  get(row: Row, ctx: Ctx): unknown;
}

/**
 * BB-345 D2 — one list, declared once.
 *
 * The three members that describe THE LIST move off the per-call options object,
 * because they are not properties of this frame: `noun` prefixes every node id
 * the tree declares AND names the count the footer states, `emptyMessage` is what
 * stands in place of the rows, and `header` says whether this list has one.
 * `selectedIndex` stays a per-call option — it is the only one that changes
 * between two frames of the same list.
 *
 * That split is the mechanism behind the id rule: {@link listRowIds} and
 * {@link listTableTree} read ONE `noun`, so a screen can no longer key its rows
 * `project-picker-candidate-<id>` while publishing `project-picker-row-<id>` as
 * the node a click lands on — a mismatch whose only symptom is a click that
 * resolves to nothing.
 *
 * `Row extends { id: string }` sits here rather than being restated per screen
 * for the same reason: every list's row identity is `rowNodeId(noun, row.id)`.
 */
export interface ListTable<Row extends { id: string }, Ctx = void> {
  /** The id prefix every node of this list carries — `ticket`, `run`, `project`. */
  readonly noun: string;
  readonly columns: readonly ListColumn<Row, Ctx>[];
  /** The one row shown in place of the rows when there are none. */
  readonly emptyMessage: string;
  /** A bold header row above the data rows. Default true; the project picker is
   *  the one list that declares it away — it is a question, not a record set. */
  readonly header?: boolean;
}

/**
 * One cell's text: the value, cut with an ELLIPSIS when it does not fit.
 *
 * PLACEMENT of the cell is Yoga's — a column's `width` is its budget, and
 * `truncate` (`lib/vnode.ts`) is the renderer's backstop. What Yoga cannot say is
 * that something was REMOVED: `@opentui/core@0.5.1` cuts at the last word
 * boundary inside the budget and appends nothing, so `cancelled` reached the
 * operator as `cancelle` in the ticket list's 8-column STATE column and
 * `qualification` as `qualific` — a cut value that reads as a typo. Measured on a
 * real pty at 120x40; the ellipsis is what makes the difference legible.
 *
 * `lib/format.ts`'s deleted `pad()` cut at `width - 1` and appended `…`, and this
 * is that one behaviour and nothing else. The padding it also did is NOT Yoga's —
 * an earlier revision of this comment said so, and BB-345 made it false in the
 * same commit that wrote it: a Yoga budget places a cell but writes no glyph into
 * the columns its value does not reach, which is why the selection highlight came
 * out in fragments. The pad is {@link cellFill}'s again, deliberately, and the
 * argument for it is written there and in {@link tableRow}. What did NOT come
 * back is `pad`'s reason for existing: `cellFill` fills to a width the COLUMN
 * DECLARES, never to one measured off the page.
 * Reaching `lib/width.ts` for the measurement is a DELIBERATE decision on top of
 * A2 already being reported as missed
 * — the module survives this ticket, so the alternative is not "no measurement"
 * but "an illegible cut", and R5's rule against re-implementing it under another
 * name is honoured by calling it rather than copying it.
 *
 * `width <= 0` is the TRAILING column — "no budget", not "zero budget": it takes
 * whatever the fixed columns left, how much that is is Yoga's answer, and `pad`
 * rendered it raw for the same reason.
 */
const cellText = (raw: unknown, width: number): string => {
  const text = raw === null || raw === undefined ? '' : String(raw);
  if (width <= 0 || displayWidth(text) <= width) return text;
  return `${truncateToWidth(text, width - 1)}…`;
};

/**
 * The fill for a cell whose resolved width nothing declares — a GROWING column.
 *
 * A grower has no declared width by construction: it takes whatever the row's
 * budgeted columns left, and how much that is is Yoga's answer, arrived at long
 * after this tree is built. So its content is padded PAST any width it could
 * resolve to and the renderer cuts the surplus — measured: a `width: 0` cell
 * whose content was padded to 200 painted 49 inverse columns at a 60-column
 * terminal, the code never knowing the 49.
 *
 * 512 is deliberate on both sides. Too small leaves the bar short of the right
 * edge on a wide terminal — a visible defect, and the one this fill exists to
 * prevent; 512 is four times the cockpit's own 120-column default and beyond any
 * terminal it is realistically painted into, and a display wide enough to beat it
 * would end the bar early rather than break anything. Too large costs bytes on
 * every painted row: the string is built per cell per frame, and at 512 one
 * grower across ~40 visible rows is ~20 kB of transient string per frame. Only a
 * column that GROWS pays it — a budgeted column is padded to its own declared
 * width instead, which is a handful of blanks.
 */
const GROWN_CELL_FILL = 512;

/** The pad, allocated ONCE and sliced rather than rebuilt per cell. */
const BLANKS = ' '.repeat(GROWN_CELL_FILL);

/**
 * A cell's content, PADDED so the row's attribute covers the columns the value
 * does not — BB-345, the mechanism behind the continuous bar.
 *
 * CONTENT GENERATION, NOT LAYOUT MEASUREMENT, and the distinction is the whole
 * argument for it: the target is a number the COLUMN DECLARES, never a width
 * measured off the page (spec D4), and the cell resolves to exactly the columns
 * it resolved to before — Yoga is handed the same budget either way. `cellText`
 * and `elideLeft` are sanctioned `displayWidth` callers because they mark a cut
 * against a declared width; this is the same shape, one step further: it FILLS
 * to a declared width. {@link fitColumns} is the one caller that measures a
 * value instead, and it does so to PRODUCE the declared width before any cell
 * exists, so the rule this paragraph states still holds below it.
 *
 * The two branches are not a style choice, they are what the renderer allows:
 *
 *  - A column that cannot grow resolves to exactly `columns`, so its content is
 *    padded to exactly `columns` and never overflows. That matters: an
 *    OVER-padded fixed cell is an overflowing cell, and the renderer answers an
 *    overflow by word-wrapping it. With `height: 1` only the first wrapped line
 *    is drawn — measured, a 14-column STATE cell holding ` qualification` plus
 *    surplus blanks broke after the leading space and painted BLANK.
 *
 *    BB-345 (re-entry) — "resolves to exactly `columns`" HOLDS ONLY WHILE THE
 *    CELL CANNOT SHRINK, and a `min` is what makes it able to: `textNode` sets
 *    `flexShrink: 1` the moment a floor says how far. Such a cell is still padded
 *    to its full declared width here — the pad is what the row's highlight rides
 *    on, and shortening it to the floor would end the bar early whenever the cell
 *    resolved above it. What changed is on the renderer's side: `textNode` now
 *    gives every cell that can resolve to an undeclared width, shrinkable ones
 *    included, `wrapMode: 'none'`, so the surplus is HARD-CLIPPED instead of
 *    word-wrapped and the failure measured just above cannot occur. The two files
 *    have to agree about this and the agreement is the fix; see `flexible` in
 *    `lib/vnode.ts`.
 *  - A column that grows has no such number, so it is over-padded on purpose and
 *    the wrap discards the surplus. Measured on this renderer: the blanks reach
 *    the cell's own right edge before the wrap takes effect, at every shape this
 *    table builds (grower first in the row, grower after a fixed column, and a
 *    `max`-capped grower between two).
 *
 * `wrapMode: 'none'` is NOT the alternative for the second branch. Measured: it
 * turns the overflow into the renderer's own `…` truncation, so a value that fits
 * its cell perfectly comes out cut — `Centralize the TUI list…` in a cell wide
 * enough for the whole of it.
 */
const cellFill = (text: string, columns: number, grows: boolean): string =>
  grows
    ? `${text}${BLANKS}`
    : `${text}${BLANKS.slice(0, Math.max(0, columns - displayWidth(text)))}`;

/**
 * A row of cells, one per column, placed by YOGA and PAINTED to its edges.
 *
 * A column's `width` is its Yoga budget; the only thing measured here is whether
 * the value outgrew it, so that {@link cellText} can say so. That is the boundary
 * R5/D8 draws: `lib/table.ts`'s `pad()` FILLED the field itself, which is the
 * work Yoga does now. The trailing column declares width 0 and takes what is
 * left.
 *
 * BB-345 — TWO THINGS BEYOND THAT MAKE THE ROW'S ATTRIBUTES A CONTINUOUS BAR,
 * and neither is layout:
 *
 *  1. Each cell's content is padded with blanks past its own DECLARED width
 *     ({@link cellFill}), so the attribute covers the cell's unused columns as
 *     well as its glyphs. This is CONTENT GENERATION, not measurement: the pad
 *     is as long as a number the column declares, and no value is ever measured
 *     to compute it. `lib/vnode.ts`'s "NOTHING HERE MEASURES A STRING" still
 *     binds for LAYOUT, and this changes no layout — a padded cell resolves to
 *     exactly the columns it resolved to before.
 *  2. The row is a {@link seamlessRowNode}, and the ` ` that was its Yoga `gap`
 *     is a leading blank column of the cell that FOLLOWS it. A gap carries no
 *     text and so can carry no attribute; a blank column of a cell does. Every
 *     cell but the first is therefore ONE column wider than its column declares,
 *     bounds included, and the row's total is unchanged: the same
 *     `sum(width) + (n - 1)` the gap produced.
 *
 * The two ids are handed in rather than derived from one another, because an
 * entity id contains hyphens: a cell keyed `<row id>-<column>` would be
 * indistinguishable from a row of some other entity, and "which nodes are the
 * rows" is a question the mouse and every test has to be able to answer.
 */
const tableRow = <Row, Ctx>(
  ids: { readonly row: string; readonly cell: (key: string) => string },
  columns: readonly ListColumn<Row, Ctx>[],
  value: (column: ListColumn<Row, Ctx>) => unknown,
  { selected, bold }: { readonly selected: boolean; readonly bold: boolean },
): VNode =>
  seamlessRowNode(
    ids.row,
    ...columns.map((column, index) => {
      // The separator, owned by the cell that follows it. The first cell has
      // none: a row starts at the row's own left edge.
      const lead = index === 0 ? '' : ' ';
      // A `width: 0` column IS a grower — `textNode` gives it `flexGrow: 1` when
      // it declares none — so both spellings of "this cell can outgrow what it
      // declares" ask for the over-padded fill.
      const grows = column.width === 0 || (column.grow ?? 0) > 0;
      // BB-345 (pass 3) — THE WIDTH A NON-GROWING COLUMN REALLY DECLARES,
      // which is not always its `width`, and the single number both the fill
      // and the cut below are derived from.
      //
      // `width` is the Yoga BASIS; the bounds are what Yoga resolves it to. A
      // `maxWidth` clamps the basis whether or not the cell may shrink —
      // MEASURED, and it is the only thing the typings could not have said: a
      // `{ width: 14, max: 6 }` column with `flexShrink: 0` resolved to 7
      // columns (6 plus its separator) in a row with 11 columns of surplus, so
      // the column after it started 8 columns earlier than its basis implied.
      // A `minWidth` then wins over both, which is Yoga's own precedence.
      // `max(min ?? 0, min(width, max ?? width))` is that precedence written
      // out, and it is a NO-OP for every column that declares no bound and for
      // every `min` below / `max` above the basis — which is every column this
      // tree ships (none declares a `max` at all).
      //
      // Deriving it HERE is what keeps the two files from disagreeing, and the
      // disagreement was two live defects rather than an untidiness:
      //
      //  - `cellFill` padded to the basis while the cell resolved to the cap,
      //    so the content overflowed. Such a cell was not `flexible` in
      //    `lib/vnode.ts` — a cap is neither a `grow` nor a `min` — so it kept
      //    `truncate: true` with no `wrapMode`, the renderer WORD-WRAPPED the
      //    overflow and `height: 1` drew the first wrapped line: measured, a
      //    `{ width: 14, max: 6 }` cell holding `qualification` painted BLANK,
      //    the break falling after the leading separator. Same shape as the
      //    `min` case recorded in {@link cellFill}, one more way in.
      //  - `cut` was `column.width`, so the ellipsis was marked at the BASIS
      //    while the applied cap was the `max`: a value between the two was
      //    silently not marked as cut, and one longer than the basis was marked
      //    in a column the operator never sees. Widening `flexible` alone fixes
      //    the blank cell and leaves THIS half broken, which is why the fix is
      //    here and the predicate is only the backstop for `textNode`'s other
      //    callers.
      //
      // The `min > width` case is the same expression's other edge and was
      // cosmetic rather than lost text: such a cell resolves to its FLOOR, and
      // padding it to the basis ended the row's highlight 15 columns before the
      // cell did (measured on a `{ width: 5, min: 20 }` probe: 14 inverse
      // columns where the row paints 29). It cannot wrap, because a `min` makes
      // the cell `flexible` and so already gives it `wrapMode: 'none'`.
      //
      // A GROWER keeps its basis untouched. Its resolved width is a share of
      // the row's surplus rather than a clamp of its basis, its fill is
      // {@link GROWN_CELL_FILL} and not a declared number at all, and lowering
      // its basis would change how the OTHER growers of the row divide that
      // surplus — a real rendering change, on the one shape this ticket ships.
      const declared = grows
        ? column.width
        : Math.max(
            column.min ?? 0,
            Math.min(column.width, column.max ?? column.width),
          );
      const budget = column.width > 0 ? declared + lead.length : 0;
      // BB-345 — the width the VALUE is cut against, which is not the Yoga
      // basis once a column can grow. A grower's `width` is where its share
      // STARTS, so cutting there would mark an ellipsis at 14 in a cell Yoga
      // resolved to 32 — the projects and conductors lists both have such a
      // column. What a grower can be cut against is its `max`, if it declares
      // one; where it declares none there is no declared width at all, and the
      // cut falls to the renderer's own clip, unmarked (spec AC 5). `0` is
      // `cellText`'s "no budget", which is what the trailing column always
      // passed.
      const cut = grows ? (column.max ?? 0) : declared;
      return textNode({
        id: ids.cell(column.key),
        content: cellFill(
          `${lead}${cellText(value(column), cut)}`,
          budget,
          grows,
        ),
        width: budget,
        // BB-345 D3 — the column's declared bounds, handed to Yoga to execute.
        // SPREAD rather than assigned, because `exactOptionalPropertyTypes` makes
        // `min: undefined` a different thing from an absent `min`: the absent one
        // is what means "this column keeps today's behaviour", and `textNode` is
        // where that turns into `flexShrink: 0` and no bound at all. Each bound
        // carries the separator too, or a `min` would floor the cell one column
        // below the columns its own column declares.
        ...(column.min === undefined ? {} : { min: column.min + lead.length }),
        ...(column.max === undefined ? {} : { max: column.max + lead.length }),
        ...(column.grow === undefined ? {} : { grow: column.grow }),
        selected,
        // BB-345 D5 — STATED ON EVERY ROW, off included, for the reason
        // `lib/vnode.ts` gives about `selected` right beside it: `applyProps`
        // writes only what the next tree declares, so a `bold` emitted for the
        // header alone would be set once and never taken off the row that
        // inherited its node.
        bold,
      });
    }),
  );

/** A column-driven list's row ids in selection order — see `lib/vnode.ts`'s
 *  `rowNodeId`. Beside {@link listTableTree}, which keys the rows under it, and
 *  reading the SAME `noun` off the same configuration (BB-345 D2). */
export const listRowIds = <Row extends { id: string }, Ctx>(
  table: ListTable<Row, Ctx>,
  rows: readonly Row[],
): string[] => rows.map((row) => rowNodeId(table.noun, row.id));

/** What {@link listTableTree} needs beyond the configuration and the rows: the
 *  one member that is per-FRAME rather than per-list (BB-345 D2). */
export interface ListTableOptions {
  /** The row the cursor stands on, or -1 for none. */
  readonly selectedIndex: number;
}

/**
 * The column set as RENDERED: a `fit` column resolved against the rows this
 * frame carries, every other column untouched.
 *
 * Measured with `displayWidth`, like every other measurement in this tree, so a
 * wide glyph costs the columns it paints rather than the characters it has.
 * That makes this the one caller that measures a VALUE rather than marking a cut
 * against a width already declared (see {@link tableRow}) — which is the point:
 * it turns the longest value of this frame INTO the declared width, once, before
 * a cell is built, so every cell below still resolves against a number the
 * column declares.
 */
const fitColumns = <Row, Ctx>(
  columns: readonly ListColumn<Row, Ctx>[],
  rows: readonly Row[],
  ctx: Ctx,
): readonly ListColumn<Row, Ctx>[] =>
  columns.map((column) =>
    column.fit !== true
      ? column
      : {
          ...column,
          width: rows.reduce(
            (widest, row) =>
              Math.max(
                widest,
                displayWidth(String(column.get(row, ctx) ?? '')),
              ),
            Math.max(column.width, displayWidth(column.label)),
          ),
        },
  );

/**
 * BB-340 D1 — a column-driven list as the renderable tree a screen hands over.
 *
 * One node per row, keyed `<noun>-row-<entity id>` (D4/R4) and never by position:
 * a list re-sorts on every search, page and reload, and a positional key would
 * move one ticket's cells onto another ticket's node with nothing on screen to
 * say so. The cells are keyed within their row by the COLUMN's own `key`, which
 * is what makes the whole set unique by construction.
 *
 * MEASURED, so the choice is not re-litigated: `TextTableRenderable` was tried and
 * rejected. It is ONE renderable whose rows are internal cell views, so no row can
 * carry a `props.id` — the identity `Kernel/mount.ts` patches by, and the identity
 * the mouse will need when it moves onto the renderables — and its column widths
 * are computed from the CONTENT, so the columns would shift every time the page's
 * data changes.
 *
 * THE HIGHLIGHT IS A FULL-WIDTH BAR, and BB-345 is where that was decided.
 * Until then this file argued the opposite — that a bar "needs the row's blank
 * columns painted, and the only ways to paint them are a padded string or a fixed
 * colour, and both are worse". The operator overruled it on sight: a highlight
 * covering only the glyphs came out as one fragment per cell, 58 of 120 columns
 * in eight pieces, and read as "only the title of the row is active". The two
 * costs that argument weighed are not the ones that were paid, either. The fill
 * is a blank run as long as a number the COLUMN DECLARES, so no value is measured
 * to build it and `lib/width.ts` is not resurrected under a new name (see
 * {@link tableRow}); and the paint is still the operator's own inverse attribute,
 * so no colour is frozen and the BB-326 regression stays fixed. What the
 * argument got right is that the row's blank columns have to be painted — it was
 * wrong that the only ways of doing it were the two bad ones.
 *
 * BB-340 Task 8 moved it HERE from `Screen/list-screen.ts`, where Task 7 first
 * wrote it, for the reason {@link ListColumn} gives above it: the run table has a
 * SECOND consumer in the ticket detail's Runs tab (BB-255 AC-6 renders a run
 * the same way on both screens), that consumer is a `Component/`, and
 * `tests/boundary.test.ts` G5 forbids anything but an entity-local `Screen/` the
 * `Screen/` directory. Duplicating the renderer instead would have made "one
 * renderer, so the two screens cannot disagree" false.
 */
export function listTableTree<Row extends { id: string }, Ctx>(
  table: ListTable<Row, Ctx>,
  rows: readonly Row[],
  ctx: Ctx,
  { selectedIndex }: ListTableOptions,
): VNode {
  const { noun, columns, emptyMessage, header = true } = table;
  const rendered = fitColumns(columns, rows, ctx);
  return columnNode(
    `${noun}-table`,
    // BB-345 D5/D6 — the header is BOLD, which is what distinguishes it from a
    // data row, and it is optional because one list is not a record set: the
    // project picker asks a question and configures it away.
    ...(header
      ? [
          tableRow(
            {
              row: `${noun}-header`,
              cell: (key) => `${noun}-header-${key}`,
            },
            rendered,
            (column) => column.label,
            { selected: false, bold: true },
          ),
        ]
      : []),
    ...(rows.length === 0
      ? [textNode({ id: `${noun}-empty`, content: emptyMessage })]
      : rows.map((row, index) =>
          tableRow(
            {
              row: rowNodeId(noun, row.id),
              cell: (key) => `${noun}-cell-${row.id}-${key}`,
            },
            rendered,
            (column) => column.get(row, ctx),
            { selected: index === selectedIndex, bold: false },
          ),
        )),
  );
}

/**
 * BB-345 D7 — the SAME list for the surface that has no layout:
 * `bakers ui bakers.build-nnn | cat`.
 *
 * BB-340 F5 keeps the pipe's own output, and this keeps its BYTES while
 * retiring the last per-entity column→row mapper (`run-table`'s `runTableRows`):
 * each cell carries the value and the column's own budget exactly as that emitted
 * them, and `Component/section-list`'s `lineText` still joins them with ONE
 * space. A configuration therefore feeds both surfaces, which is what makes "one
 * component renders every list" true of the run table rather than of its terminal
 * half only.
 *
 * The values are RAW here where {@link listTableTree} runs them through
 * {@link cellText}. That is not an oversight and not a second rendering rule: the
 * ellipsis exists because a Yoga budget cuts silently, and a pipe has no budget
 * to cut against — it prints whatever it is given, at whatever width the reader's
 * terminal or file happens to be. Cutting here would be a cut nobody asked for.
 *
 * The header follows `table.header`, so a headerless list prints headerless and
 * the two surfaces cannot disagree about whether this list has one.
 */
export function listTableRows<Row extends { id: string }, Ctx>(
  table: ListTable<Row, Ctx>,
  rows: readonly Row[],
  ctx: Ctx,
): SectionLine[] {
  const line = (
    value: (column: ListColumn<Row, Ctx>) => unknown,
  ): SectionCells => ({
    cells: table.columns.map((column) => {
      const raw = value(column);
      return {
        text: raw === null || raw === undefined ? '' : String(raw),
        width: column.width,
      };
    }),
  });
  const head = table.header === false ? [] : [line((column) => column.label)];
  if (rows.length === 0) return [...head, table.emptyMessage];
  return [
    ...head,
    ...rows.map((row) => line((column) => column.get(row, ctx))),
  ];
}

/**
 * Read one page of a collection and map it to rows.
 *
 * `mapRows` receives `data` AND `included` so each slice keeps its own sideload
 * indexing — the ticket list indexes every include by id, the run list builds a
 * ticket-only map — without this function knowing either.
 */
export async function loadPage<Row>(
  client: DropshClient,
  path: string,
  params: unknown,
  mapRows: (data: JsonApiResource[], included: JsonApiResource[]) => Row[],
  page: number,
  window: PageWindow,
): Promise<Page<Row>> {
  const doc = (await client.get(path, params)) as
    | JsonApiCollectionDoc
    | undefined;
  return {
    rows: mapRows(doc?.data ?? [], doc?.included ?? []),
    hasNext: Boolean(doc?.links?.next),
    page,
    total: readTotal(doc),
    window,
    ...(doc?.meta?.omitted !== undefined ? { withheld: true as const } : {}),
  };
}
