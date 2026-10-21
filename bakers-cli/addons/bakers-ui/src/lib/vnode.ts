// BB-340 D1 — the three node shapes every converted screen is built from.
//
// A body is a COLUMN of rows; a row is either one piece of text or a ROW of
// fixed-width cells. That is the whole vocabulary, and it lives here because the
// props a row must carry are rules rather than taste — three of the five exist
// to prevent a measured defect, and each of the twelve remaining screens would
// otherwise restate them:
//
//  - `fg: DEFAULT_FOREGROUND` — without it the renderable's own hardcoded
//    truecolor white replaces the operator's theme (the BB-326 regression).
//  - `selectable: false` — a cockpit row is a picture of a screen, not a
//    document: a drag must not paint a selection over the click the kernel is
//    about to route.
//  - `attributes` STATED ON EVERY ROW, whether or not it is bold or selected.
//    `patchTree` writes only the props the next tree DECLARES and cannot clear
//    one it omits, so an attribute emitted for the selected row alone was set
//    once and never taken off again — measured in plan Task 7, where the
//    highlight stayed on the row the cursor started on and every row it passed
//    kept one. `Kernel/mount.ts` states the rule; this is where a screen stops
//    having to remember it.
//  - `height: 1` — a row is one physical row even when it is EMPTY. An
//    auto-height empty text collapses, and the blank between two sections is a
//    row like any other.
//  - `wrapMode: 'none'` wherever a cut must fall AT THE LAST COLUMN rather than
//    at the last word boundary before it. `@opentui/core@0.5.1` defaults to a
//    word wrap, and with `height: 1` only the first wrapped line is drawn, so a
//    row whose overflow began mid-word lost the whole of that word and left the
//    columns before the edge blank. Measured on the status footer, where an
//    over-long hint row ended four columns short of the terminal and took the
//    footer's last four cells with it (BB-340 Task 12). This is not
//    measurement — the cut is the renderer's, against a Yoga budget.
//
//    BB-345 CORRECTED THE SCOPE OF THIS RULE, which used to read "on a
//    FULL-WIDTH row (never on a cell)". It is on a full-width row AND on every
//    cell whose RESOLVED width is not a number this code holds — see `flexible`
//    in `textNode`. FOUR shapes qualify: the trailing `width: 0` column, any
//    column carrying a `grow`, any column carrying a `min` (a floor is what
//    makes a cell shrinkable, so it can resolve BELOW its declared width), and
//    any column whose `max` sits below its own width (a cap clamps the basis
//    even at `flexShrink: 0`). Each is filled past the width it resolves to, so
//    the row's highlight covers its blank columns, and the default word wrap
//    loses that fill.
//
//    A cell PINNED to its budget keeps `truncate` instead: its content is filled
//    to precisely that budget, so nothing overflows for a wrap to break. The
//    measurements behind the split are written out in `textNode`'s own branch
//    comments below rather than duplicated here. The last two shapes are the
//    halves the earlier passes missed, and they failed the same way: they kept
//    `truncate`, their over-pad word-wrapped, and `height: 1` drew the wrapped
//    line only, painting the cell BLANK. The `max` one is additionally fixed at
//    its SOURCE — `Entity/collection.ts`'s `tableRow` clamps the budget it hands
//    over to the width the column really declares, which is what makes the
//    marked cut agree with the applied cap; `flexible`'s cap clause is the
//    backstop for `textNode`'s other callers.
//
// NOTHING HERE MEASURES A STRING. A cell's width is a Yoga budget and `truncate`
// is what keeps an over-long value inside it (R5/D8): a helper that counted
// display columns to pad would be `lib/width.ts` under a new name, and deleting
// that file is half of what this ticket is for.

import {
  BoxRenderable,
  createTextAttributes,
  h,
  type MouseEvent,
  type RGBA,
  StyledText,
  type TextChunk,
  TextRenderable,
  type VNode,
} from '@opentui/core';
import { urlRuns } from './hyperlink.js';

/**
 * Palette lives in `theme.ts` (BB-375). Re-exported here so existing
 * `from '../lib/vnode.js'` call sites keep working. Indexed slots only —
 * never truecolor for chrome or selection (BB-326 / BB-340).
 */
export {
  BACKGROUND,
  BACKGROUND_ACTIVE,
  BORDER,
  BORDER_EMPHASIS,
  DEFAULT_BACKGROUND,
  DEFAULT_FOREGROUND,
  FOREGROUND,
  FOREGROUND_ACTIVE,
  FOREGROUND_HIGHLIGHT,
  SPLASH_MS,
  THEME_SLOTS,
} from './theme.js';

import {
  BACKGROUND_ACTIVE,
  DEFAULT_BACKGROUND,
  FOREGROUND,
  FOREGROUND_ACTIVE,
} from './theme.js';

/** A heading's weight — the `\x1b[1m` the row surface wrapped it in. */
export const BOLD = createTextAttributes({ bold: true });
/**
 * Inverse video attribute — kept exported for tests and any non-selection
 * callers. BB-375 selection uses {@link FOREGROUND_ACTIVE} fg instead of INVERSE.
 */
export const INVERSE = createTextAttributes({ inverse: true });
/**
 * Emphasis — BB-372 D7, and THE ONE NEW CODE on the wire.
 *
 * The cockpit's styling vocabulary is `bold`, `dim`, `inverse` and the indexed
 * theme slots in `theme.ts`; `tests/pty/verify-colors.mjs` holds that as a
 * CLOSED set (Fact 10). Italic widens it by exactly one parameter, `ESC[3m`, and
 * that file's `ALLOWED` map is where the widening is recorded with its reason.
 * It is not a colour and it invents no theme value — the terminal decides what
 * italic looks like, which is the property that map exists to protect (R3).
 */
export const ITALIC = createTextAttributes({ italic: true });
/**
 * A de-emphasised run — BB-372 D7.
 *
 * `dim` rather than `strikethrough`, which would widen the wire vocabulary a
 * SECOND time for a construct bakers.build bodies barely use. Already allowed: the
 * pre-swap kernel emitted `ESC[2m`.
 */
export const DIM = createTextAttributes({ dim: true });

/**
 * ONE STYLED STRETCH OF A ROW — BB-372 D11, and the whole of what this module
 * knows about per-run styling.
 *
 * It is deliberately NEUTRAL: `attributes` is an already-resolved
 * `createTextAttributes` bitmask and `fg` an already-chosen palette value. This
 * module used to take a `MarkdownSpan` and decide for itself that `italic: true`
 * means {@link ITALIC} and `code: true` means {@link BORDER} — which put Markdown
 * domain knowledge inside the package's most-shared render primitive, one that
 * twelve screens draw through and that no layering gate covers
 * (`assert-acyclic.mjs` checks PACKAGE edges, and both files lived in `lib/`).
 *
 * The mapping moved OUT, to `Component/markdown/`, and the import direction
 * inverted with it: the component knows the node vocabulary, the node vocabulary
 * knows nothing of Markdown. What is left here is what a renderer actually needs
 * — a stretch of text and the two things the chunk struct carries for it.
 */
export interface StyledRun {
  readonly text: string;
  readonly attributes: number;
  readonly fg?: RGBA;
}

/**
 * ONE PHYSICAL ROW that carries per-run styling — BB-372 D11.
 *
 * `text` is the runs concatenated, which is what a surface with no styling
 * prints; that is what makes `bakers ui <id> | cat` and the interactive tree the
 * same rendering by construction rather than by agreement (D4). `heading` is the
 * row's own weight. Neutral for the same reason {@link StyledRun} is: a producer
 * of styled rows is not necessarily a Markdown renderer, and the only consumers
 * — `Component/section-list` and this module — must not have to know that it is.
 */
export interface StyledLine {
  readonly text: string;
  readonly runs: readonly StyledRun[];
  /** WHAT the line is: drawn bold, and skipped by a body extract. */
  readonly heading: boolean;
}

/** Whether a run asks for anything at all — see {@link linked}'s early exit. */
const isStyled = (run: StyledRun): boolean =>
  run.attributes !== 0 || run.fg !== undefined;

export interface TextNodeInput {
  /** Entity-derived and unique in the tree; `mount.ts` patches by it (D4/R4). */
  readonly id: string;
  readonly content: string;
  readonly bold?: boolean;
  readonly selected?: boolean;
  /**
   * Explicit foreground override. Defaults to {@link FOREGROUND_ACTIVE} when selected,
   * otherwise {@link FOREGROUND}.
   */
  readonly fg?: RGBA;
  /**
   * Explicit cell background (`bg` / `backgroundColor` alias). Defaults to
   * {@link BACKGROUND_ACTIVE} when selected, otherwise {@link DEFAULT_BACKGROUND}.
   * Stated every frame so `patchTree` can clear a prior wash.
   */
  readonly bg?: RGBA;
  /** Alias for {@link bg} — matches Textarea's `backgroundColor` naming. */
  readonly backgroundColor?: RGBA;
  /**
   * The cell's width in columns, when this text is a column of a row.
   *
   * Absent for a full-width row, which takes its own width and is not clipped.
   * **0** is the TRAILING cell of a row: it takes whatever the fixed columns
   * left.
   */
  readonly width?: number;
  /**
   * BB-345 D3 — the cell's declared BOUNDS, for a cell that is a table column.
   *
   * `min` floors it, `max` caps it, `grow` is its share of the row's surplus.
   * Absent means today's behaviour exactly: a fixed cell that neither grows nor
   * shrinks. They are Yoga props and nothing here measures anything to compute
   * them — a column declares them as domain facts (see `ListColumn`).
   */
  readonly min?: number;
  readonly max?: number;
  readonly grow?: number;
  /**
   * What a click on this text means, for a row that has one (BB-340 Task 11).
   *
   * Only the chrome's header rows carry one, and they carry it on EVERY frame —
   * the handler itself decides whether its row is the one the click means,
   * because `applyProps` cannot clear a prop a later tree omits.
   */
  readonly onMouse?: ((event: MouseEvent) => void) | undefined;
  /**
   * The row's STYLED RUNS, for a row that carries per-run styling — BB-372
   * D5/D11, and the ONE prop this ticket adds.
   *
   * Absent means everything is exactly as it was: one attribute set for the whole
   * row. Present means {@link linked} splits on the union of these boundaries and
   * the row's URL runs, and OR-s each run's attributes onto the row's own. The
   * runs concatenate to `content` by construction ({@link StyledLine.text} IS the
   * runs joined), so the split can never change a glyph.
   */
  readonly runs?: readonly StyledRun[];
}

/**
 * A row's content, with every address in it marked as a HYPERLINK — BB-340
 * Task 12.
 *
 * `TextChunk.link` is a real field of `@opentui/core@0.5.1`'s chunk struct, and
 * the Zig core writes the `ESC]8;id=…;<url>ESC\` … `ESC]8;;ESC\` pair around the
 * run when it paints. So a URL the cockpit prints is something the operator can
 * tap rather than retype on a phone — BB-326's reason, unchanged.
 *
 * IT LIVES HERE BECAUSE `lib/styled-text.ts` IS GONE. That module did two
 * unrelated jobs: read SGR escapes back out of a composed line, and split the
 * result on `urlRuns`. The first died with the chrome's own conversion — nothing
 * composes an escape any more — and the second nearly went with it: measured on
 * a real pty, `verify-links.mjs` went from `OK` to three violations the moment
 * `lineNode` was deleted, because the Projects screen's base URL rides in the
 * chrome's meta row. The link half is not string measurement and not escape
 * parsing; it is what a row's content IS, so it belongs to the node vocabulary.
 *
 * Every converted row goes through it now, where before only the chrome's did.
 * That is the mechanism BB-326 described and `verify-links.mjs` names — "the
 * same mechanism links every URL in a ticket description, a comment and a run
 * log" — reaching those rows for the first time. `urlRuns` opens with a
 * `line.includes('://')` gate for exactly this call site, and a row with no
 * address is returned as the plain string it already was, allocating nothing.
 *
 * The chunks carry the row's OWN attributes, so a bold or inverted row stays
 * bold or inverted across the split: a chunk's attributes are what the renderer
 * paints, and chunks built without them would silently drop the row's weight.
 * The split is purely a split — the chunks concatenate to the same characters —
 * so a mis-scan can mis-attribute a link and can never change a glyph.
 *
 * BB-372 D5 — AND WHICH STRETCHES OF IT ARE STYLED.
 *
 * A row that carries per-run styling hands over `runs`, and the chunk boundaries
 * become the UNION of those boundaries and the URL runs. The two are genuinely
 * independent: `text (url)` is what an inline link renders as (D6), so a bare
 * address really does land inside a row that also has emphasis in it, and both
 * the link and the styling have to survive. A chunk's attributes are the row's
 * OR-ed with its run's — so the selection highlight still covers every chunk of
 * a selected row — and a run may additionally carry its own `fg`, which is how a
 * code stretch reaches indexed {@link BORDER}. WHICH run asks for which
 * attribute is not decided here (D11): the caller
 * hands over resolved values, so this function contains no Markdown knowledge.
 *
 * The URL scan still runs on the row's WHOLE text rather than per run, which is
 * what keeps `lib/hyperlink.ts`'s `…`-truncation rule meaning what it says.
 *
 * The early exit is unchanged in spirit and widened in fact: a row with no
 * address AND no styled run is returned as the plain string it already was,
 * allocating nothing. That is why a plain section's rows — and a body line that
 * happens to carry no markup — still hand a `string` to the renderable.
 */
const linked = (
  text: string,
  attributes: number,
  runs: readonly StyledRun[] | undefined,
): string | StyledText => {
  const addresses = urlRuns(text);
  const styled = runs?.some(isStyled) === true;
  if (addresses.length === 0 && !styled) return text;

  // The style segments, as `[0, end)` ranges in row order. A row with no runs is
  // ONE segment carrying the row's own attributes, which is exactly the old
  // behaviour; the tail clause is a backstop for a caller whose runs do not
  // cover the row (they always do — `StyledLine.text` is the runs joined).
  const segments: { end: number; attributes: number; fg?: RGBA }[] = [];
  if (runs === undefined || runs.length === 0) {
    segments.push({ end: text.length, attributes });
  } else {
    let at = 0;
    for (const run of runs) {
      at += run.text.length;
      segments.push({
        end: at,
        attributes: attributes | run.attributes,
        ...(run.fg === undefined ? {} : { fg: run.fg }),
      });
    }
    if (at < text.length) segments.push({ end: text.length, attributes });
  }

  // Every boundary either surface declares, in order. Splitting at the union is
  // what makes the two independent: a run that straddles an address is cut by
  // it, and an address inside a run keeps that run's styling.
  const cuts = new Set<number>([0, text.length]);
  for (const segment of segments) cuts.add(segment.end);
  for (const address of addresses) {
    cuts.add(address.start);
    cuts.add(address.end);
  }
  const points = [...cuts]
    .filter((point) => point >= 0 && point <= text.length)
    .sort((a, b) => a - b);

  const chunks: TextChunk[] = [];
  for (let i = 0; i + 1 < points.length; i += 1) {
    const start = points[i] as number;
    const end = points[i + 1] as number;
    if (start === end) continue;
    const segment =
      segments.find((candidate) => candidate.end > start) ??
      (segments.at(-1) as { end: number; attributes: number; fg?: RGBA });
    const address = addresses.find(
      (candidate) => candidate.start <= start && candidate.end >= end,
    );
    chunks.push({
      __isChunk: true,
      attributes: segment.attributes,
      text: text.slice(start, end),
      ...(segment.fg === undefined ? {} : { fg: segment.fg }),
      ...(address === undefined ? {} : { link: { url: address.url } }),
    });
  }
  return new StyledText(chunks);
};

/** One piece of text: a whole row, or one cell of one. */
export const textNode = ({
  id,
  content,
  bold = false,
  selected = false,
  fg,
  bg,
  backgroundColor,
  width,
  min,
  max,
  grow,
  onMouse,
  runs,
}: TextNodeInput): VNode => {
  // BB-375 D4 — selection is light-green FOREGROUND_ACTIVE fg, not inverse and not a
  // background wash. bg is STATED every frame so patchTree can clear a prior
  // paint when the cursor moves.
  const attributes = bold ? BOLD : 0;
  const resolvedBg =
    bg ??
    backgroundColor ??
    (selected ? BACKGROUND_ACTIVE : DEFAULT_BACKGROUND);
  const resolvedFg = fg ?? (selected ? FOREGROUND_ACTIVE : FOREGROUND);
  // BB-345 (re-entry) — "this cell can resolve to a width NOTHING DECLARES".
  // A `grow` lets it end up wider than its budget and a `min` lets it end up
  // narrower; either way the resolved width is Yoga's answer and not a number
  // this code holds, which is what decides how the cell is cut. Read by the
  // `width > 0` branch below — see the argument there.
  //
  // BB-345 (pass 3) — the third clause is a `max` BELOW the basis, and it is
  // the third way the same thing happens: Yoga's `maxWidth` clamps the basis
  // even at `flexShrink: 0` (measured — see `tableRow` in
  // `Entity/collection.ts`), so such a cell resolves narrower than it declares
  // exactly as a shrinkable one does, and with `truncate` and no `wrapMode` its
  // over-long content word-wrapped to a blank row.
  //
  // For a cell `tableRow` builds this clause is now INERT and deliberately so:
  // that function clamps the budget it hands over to `min(width, max)` in the
  // same fix, so a table cell's `max` can no longer sit below its own basis.
  // The clause exists for `textNode`'s OTHER callers — `cellsRow` and the
  // chrome pass their props directly — where a `{ width: 10, max: 5 }` would
  // otherwise still reach the trap. Belt and braces on purpose: the clamp is
  // what makes the marked cut agree with the applied cap, and this is what
  // makes the node itself safe for any caller.
  const flexible =
    (grow ?? 0) > 0 ||
    min !== undefined ||
    (max !== undefined && width !== undefined && max < width);
  return h(TextRenderable, {
    id,
    content: linked(content, attributes, runs),
    height: 1,
    fg: resolvedFg,
    bg: resolvedBg,
    selectable: false,
    attributes,
    ...(onMouse ? { onMouse } : {}),
    ...(width === undefined
      ? // A FULL-WIDTH ROW carries `wrapMode: 'none'` and NO `truncate`, and
        // the second half is the load-bearing one. A full-width row has no
        // `truncate` to state an edge, so without `wrapMode` the renderer
        // word-wraps it and `height: 1` then draws only the first wrapped
        // line: the row ends at the last word boundary before the edge and
        // leaves the columns after it blank, which on the status footer took
        // four cells off the inverse bar.
        //
        // WHAT IT MUST NOT CARRY IS BOTH. Combining `wrapMode: 'none'` with a
        // `truncate` makes the renderer cut the value in the MIDDLE
        // (`a-rea…ver-14`) instead of at the edge — measured on the ticket
        // table's conductor column. That measurement is the reason a cell
        // PINNED TO ITS BUDGET takes `truncate` and nothing else.
        //
        // BB-345 (re-entry) corrected what this comment used to claim: that
        // `wrapMode: 'none'` belongs "on a full-width row, never on a cell".
        // It is on every cell that can resolve to a width nothing declares —
        // the trailing column, a grower, and (since this round) a shrinkable
        // budgeted cell. See `flexible` above and the two branches below.
        //
        // The `shrink` branch that used to sit ahead of this one — a piece of
        // text the layout may shrink and clip, carrying `wrapMode: 'none'` AND
        // `truncate` — went with BB-346, which deleted the ticket detail's
        // own tab bar and with it that branch's only caller. It is dropped
        // here rather than kept for a hypothetical second caller: an unreached
        // branch is the orphan BB-340 shipped once already.
        { flexShrink: 0, wrapMode: 'none' as const }
      : width > 0
        ? {
            // BB-345 D3 — `width` is the flex BASIS, so a cell carrying both
            // a width and a `grow` means "at least this, then a share of the
            // surplus". MEASURED on a real renderer, not read off the typings:
            // a basis-8 cell with `flexGrow: 1, maxWidth: 13` came out 11
            // columns wide at 40 and exactly 13 from 60 columns up — the cap
            // applies, and it applies where the surplus would have overshot it.
            width,
            flexGrow: grow ?? 0,
            // Shrinkable exactly when a floor says how far. Without a `min`
            // the column keeps today's `flexShrink: 0`, which is what makes a
            // configuration that declares none of the three render unchanged.
            flexShrink: min === undefined ? 0 : 1,
            ...(min === undefined ? {} : { minWidth: min }),
            ...(max === undefined ? {} : { maxWidth: max }),
            // A budgeted cell that can resolve to a width NOTHING DECLARES is
            // filled and hard-clipped exactly like the trailing column below —
            // see the three measurements there. Only a cell pinned to its own
            // budget keeps `truncate` as the backstop it has always had: its
            // content is filled to precisely that budget, so nothing overflows
            // for `truncate` to cut.
            //
            // BB-345 (re-entry) — THE TEST IS `flexible`, NOT `grow`, and
            // that is a bug fix rather than a tidy-up. `grow` alone missed the
            // other half of the same matrix: a `min` sets `flexShrink: 1` two
            // lines up, so a cell carrying `{ width, min }` and no `grow`
            // resolves BELOW its declared width in a shrink — while
            // `cellFill`'s non-grower branch pads it to the FULL declared
            // width on the argument that such a cell "resolves to exactly
            // `columns`, so nothing overflows". With a `min` that argument does
            // not hold, the pad overflows, and with no `wrapMode` the renderer
            // WORD-WRAPS it; `height: 1` then draws the first wrapped line
            // only. `Entity/collection.ts` already records what that looks
            // like, measured: a 14-column STATE cell holding ` qualification`
            // plus surplus blanks "broke after the leading space and painted
            // BLANK". Same class as the dropped `maxWidth` below, worse
            // outcome — a blank cell rather than an over-wide one — so it is
            // fixed and pinned here before a column declares the pair. None
            // does today; `CONDUCTOR_TABLE.name` is the tree's only `min` and
            // it carries a `grow` as well.
            ...(flexible ? { wrapMode: 'none' as const } : { truncate: true }),
          }
        : {
            // A cell that can outgrow what it declares — the trailing column
            // (`width: 0`), and any column carrying a `grow`.
            //
            // BB-345 — `wrapMode: 'none'` WITHOUT `truncate` is the one
            // combination that both fills the cell and leaves its value alone,
            // and all three parts of that were measured on this renderer:
            //
            //  - the DEFAULT word wrap loses the cell's blank fill: with
            //    `height: 1` only the first wrapped line is drawn, and the
            //    wrapper breaks at the last boundary before the edge — so a
            //    10-column cell holding ` TITLE-MARK` painted ` TITLE-` and the
            //    row's highlight stopped three columns short of the terminal.
            //    A value with no boundary at all is worse: the break falls
            //    after the LEADING separator blank and the cell paints EMPTY.
            //  - adding `truncate` to `wrapMode: 'none'` cuts a value that
            //    FITS, because the fill is what overflows: measured,
            //    `Centralize the TUI list logic` came out
            //    `Centralize the TUI list...` in a cell wide enough for all of
            //    it.
            //  - `wrapMode: 'none'` alone hard-clips at the cell's own last
            //    column, which is exactly what a full-width row does two
            //    branches up. The value is cut at the edge instead of at the
            //    word boundary before it, so the operator sees MORE of it than
            //    the wrap showed; the cut stays the renderer's and unmarked,
            //    which is what a grower's cut already was (there is no declared
            //    width for `cellText` to mark it against).
            wrapMode: 'none' as const,
            flexGrow: grow ?? 1,
            flexShrink: 1,
            // `flexBasis: 0` IS LOAD-BEARING, and it is the one thing the
            // design could not read off the typings. Yoga's default basis is
            // `auto` — a cell's own CONTENT — and the trailing column's content
            // is an untruncated title. So a 200-character title made the row's
            // total basis exceed the terminal, the free space went NEGATIVE,
            // and in a shrink situation `flexGrow` is inert: measured, STATE
            // stayed 8 columns wide and cut `qualification` at 80, 120 AND 160
            // columns alike, i.e. cut while the row still had unused columns.
            // A zero basis makes the trailing column claim only the SURPLUS, so
            // the surplus exists to be claimed. It occupies the rest of the row
            // either way, which is why this is behaviour-preserving for a list
            // whose columns declare no bounds.
            flexBasis: 0,
            ...(min === undefined ? {} : { minWidth: min }),
            // BB-345 (re-entry) — the `max` this branch used to DROP.
            //
            // `Entity/collection.ts`'s `tableRow` computes a grower's ellipsis
            // against `column.max`, so a `width: 0, max: N` column MARKED its
            // cut at N while the cap itself never reached Yoga and the cell
            // grew straight past it: the marked cut and the applied cap
            // disagreed, silently, in a brand-new API. No shipped column
            // declares the pair today, which is why it is honoured — and
            // pinned in `tests-bun/Screen/list-table-layout.test.ts` — before
            // one does. Spread exactly as the `width > 0` branch spreads it,
            // for the same `exactOptionalPropertyTypes` reason.
            ...(max === undefined ? {} : { maxWidth: max }),
          }),
  });
};

/**
 * The node id of ONE selectable row — `<noun>-row-<entity id>`.
 *
 * BB-340 Task 11: the mouse routes by node identity now (spec D6), so a
 * screen publishes the id of each selectable row (`ScreenPresentation.rowIds`)
 * while its component builds the row under that id. Those are two places, and
 * this is what keeps them one expression: a click that resolves to nothing
 * because the two spelled the entity's row differently is exactly the silent
 * failure the id rule exists to prevent.
 */
export const rowNodeId = (noun: string, entityId: string): string =>
  `${noun}-row-${entityId}`;

/**
 * A left PRESS — never the release of the same click, never a drag.
 *
 * One physical click also delivers an `up`, and a drag arrives as its own type,
 * so a handler that acts on any of them fires its action twice. It lives here
 * with the node vocabulary rather than in the kernel because a converted screen
 * carries its own `onMouse` now — the ticket detail's tab bar is a row of nodes
 * that resolve their own click — and a screen may not import the kernel
 * (`tests/boundary.test.ts` G5). Two copies of this predicate is how one of them
 * ends up acting on the release.
 */
export const isLeftPress = (event: MouseEvent): boolean =>
  event.type === 'down' && event.button === 0;

const rowBox = (id: string, gap: number, cells: readonly VNode[]): VNode =>
  h(
    BoxRenderable,
    { id, flexDirection: 'row', height: 1, flexShrink: 0, gap },
    ...cells,
  );

/** A row of cells. `gap: 1` is the ` ` the columns used to be joined with. */
export const rowNode = (id: string, ...cells: readonly VNode[]): VNode =>
  rowBox(id, 1, cells);

/**
 * The same row with its cells TOUCHING — BB-345.
 *
 * A Yoga `gap` is EMPTY SPACE, not text, so nothing can attribute it: a row
 * whose cells are separated by one carries a hole between every pair of
 * columns, and a row-wide attribute — the selection highlight, the header's
 * bold — comes out as one fragment per cell rather than as a bar. Measured on
 * the tickets list at 120 columns: 58 of 120 columns inverse in EIGHT
 * fragments, which is what the operator reported as "nur der Titel innerhalb
 * der Row ist aktiv".
 *
 * The separator does not disappear with the gap; it moves into the cell that
 * FOLLOWS it as a leading blank column, where it is text and therefore carries
 * the row's attribute (`Entity/collection.ts`'s `tableRow`). The columns'
 * declared widths keep their meaning exactly — the separator was already an
 * implementation detail of the row, and this is the same detail spelled in the
 * one place an attribute can reach.
 */
export const seamlessRowNode = (
  id: string,
  ...cells: readonly VNode[]
): VNode => rowBox(id, 0, cells);

/**
 * One column of a row that is described rather than composed — BB-340 Task 13.
 *
 * `width` is a YOGA BUDGET, never a padding count: a component that knows its
 * columns says how wide each is and the renderer places the value inside it. The
 * alternative is what this ticket exists to delete — `lib/format.ts`'s `pad`
 * filling the field itself, which needs `lib/width.ts` to measure the value in
 * display columns first (R5/D8).
 */
export interface Cell {
  readonly text: string;
  /** Columns Yoga lays the cell out in; omitted takes the cell's own width. */
  readonly width?: number;
  /** Optional flexible-width bounds passed directly to Yoga by {@link textNode}. */
  readonly min?: number;
  readonly max?: number;
  readonly grow?: number;
  /**
   * Placed against the RIGHT edge of its budget — a number column.
   *
   * A `TextRenderable` paints its buffer from its own left edge whatever its
   * width, so the alignment is a BOX around it with `justifyContent: 'flex-end'`
   * and the text at its natural width. Yoga does the arithmetic, which is the
   * point: the right-aligned counts on the dashboard used to be built by
   * subtracting `displayWidth(value)` from the column.
   */
  readonly right?: boolean;
}

/**
 * A row of {@link Cell}s as renderables, alignment included.
 *
 * The cells are keyed by their POSITION within the row, and that is sound
 * exactly where the row's own id is entity-derived (D4/R4): a column set is
 * fixed and ordered, so cell 3 of a row is the same column in every frame, while
 * the row it belongs to moves with its entity.
 */
export const cellsRow = (
  id: string,
  cells: readonly Cell[],
  selected = false,
): VNode =>
  rowNode(
    id,
    ...cells.map((cell, index) => {
      const cellId = `${id}-${index}`;
      const text = (
        nodeId: string,
        sizing: Pick<Cell, 'width' | 'min' | 'max' | 'grow'> = {},
      ): VNode =>
        textNode({
          id: nodeId,
          content: cell.text,
          selected,
          ...(sizing.width === undefined ? {} : { width: sizing.width }),
          ...(sizing.min === undefined ? {} : { min: sizing.min }),
          ...(sizing.max === undefined ? {} : { max: sizing.max }),
          ...(sizing.grow === undefined ? {} : { grow: sizing.grow }),
        });
      return cell.right !== true
        ? text(cellId, cell)
        : h(
            BoxRenderable,
            {
              id: cellId,
              flexDirection: 'row',
              justifyContent: 'flex-end',
              height: 1,
              flexShrink: 0,
              ...(cell.width === undefined ? {} : { width: cell.width }),
            },
            text(`${cellId}-value`),
          );
    }),
  );

/** The stack a screen's body is: rows in the order they are drawn. */
export const columnNode = (id: string, ...children: readonly VNode[]): VNode =>
  h(BoxRenderable, { id, flexDirection: 'column', flexShrink: 0 }, ...children);

/**
 * A short PLAIN-TEXT notice as a body: `Loading tickets…`, an error and its
 * retry hint.
 *
 * BB-340 Task 12 — what took the bridge's place for the two states every
 * `AsyncScreen` shares. Those states are three lines of prose with no styling at
 * all, which is why they were the last thing still composed as rows: converting
 * them to per-cell nodes would have bought nothing. They still are prose; this
 * is only the sink change, and it is a component rather than a second
 * `linesToTree` — no SGR is read, because a notice carries none, and nothing is
 * measured.
 *
 * The row INDEX is a legitimate key here and nowhere a screen builds a list: a
 * notice is a fixed sequence of rows with no entity behind it and nothing that
 * can reorder underneath it (D4/R4 is about rows that stand for something).
 * `owner` is the screen's own id, so two screens' notices can never collide in
 * one tree.
 */
export const messageTree = (owner: string, lines: readonly string[]): VNode =>
  columnNode(
    `${owner}-message`,
    ...lines.map((line, index) =>
      textNode({ id: `${owner}-message-${index}`, content: line }),
    ),
  );

/**
 * The same stack, held `columns` in from the left — a hanging indent as a BOX.
 *
 * A `paddingLeft` on the text node itself does NOT move the text: measured on a
 * real renderer, a `TextRenderable` paints its buffer at its own origin and
 * ignores its padding, so the row came out flush. The indent therefore belongs
 * to a box around the rows, which is where `Widget/render.ts`'s caret block
 * already spends one. Written as a Yoga budget rather than as leading spaces in
 * the content, so nobody has to measure them back off a wrap budget again.
 */
export const indentedColumn = (
  id: string,
  columns: number,
  ...children: readonly VNode[]
): VNode =>
  h(
    BoxRenderable,
    { id, flexDirection: 'column', flexShrink: 0, paddingLeft: columns },
    ...children,
  );

/** A UNDERLINE run — a linked value in a key/value list. */
export const UNDERLINE = createTextAttributes({ underline: true });

/** One unstyled run, so callers never spell the struct for plain text. */
export const plainRun = (
  text: string,
  attributes = 0,
  fg?: RGBA,
): StyledRun => ({ text, attributes, ...(fg === undefined ? {} : { fg }) });

/**
 * The last content each paragraph was handed, by node id.
 *
 * `TextRenderable.content` re-buffers its text whenever it is handed a
 * DIFFERENT object, and a string is converted to a new one on every write. A
 * patch restates every prop on every draw, so without this a 500-line
 * description would re-buffer every paragraph on every keypress. Handing back
 * the identical `StyledText` for an unchanged paragraph makes that setter a
 * no-op.
 *
 * ponytail: bounded by clearing, not LRU — a session that opens thousands of
 * tickets rebuilds the cache once per 4096 paragraphs.
 */
const paragraphContent = new Map<string, { key: string; text: StyledText }>();
const PARAGRAPH_CACHE_LIMIT = 4096;

const colourKey = (fg: RGBA | undefined): string =>
  fg === undefined ? '' : String(fg.buffer);

const styledRuns = (id: string, runs: readonly StyledRun[]): StyledText => {
  const key = runs
    .map(
      (run) => `${run.attributes}\u0001${colourKey(run.fg)}\u0001${run.text}`,
    )
    .join('\u0002');
  const cached = paragraphContent.get(id);
  if (cached?.key === key) return cached.text;
  if (paragraphContent.size >= PARAGRAPH_CACHE_LIMIT) paragraphContent.clear();
  const text = new StyledText(
    runs.map(
      (run): TextChunk => ({
        __isChunk: true,
        text: run.text,
        attributes: run.attributes,
        ...(run.fg === undefined ? {} : { fg: run.fg }),
      }),
    ),
  );
  paragraphContent.set(id, { key, text });
  return text;
};

/**
 * A left press that the node consumes — the presentation-level `onMouseDown`
 * translated once. Propagation stops so the kernel's row binding on an
 * enclosing node (`ScreenPresentation.rowIds`) does not act on the same click.
 */
export const pressHandler = (
  action: (() => void) | undefined,
): ((event: MouseEvent) => void) | undefined =>
  action === undefined
    ? undefined
    : (event) => {
        if (!isLeftPress(event)) return;
        event.stopPropagation();
        action();
      };

export interface ParagraphInput {
  /** Entity-derived and unique in the tree, like every node's. */
  readonly id: string;
  readonly runs: readonly StyledRun[];
  readonly fg: RGBA;
  readonly attributes?: number;
  readonly width?: number | `${number}%` | 'auto';
  readonly wrapMode?: 'word' | 'none';
  readonly flexGrow?: number;
  readonly flexShrink?: number;
  readonly onMouseDown?: (() => void) | undefined;
}

/**
 * A paragraph: AUTO height and word-wrapped, unlike {@link textNode}, which is
 * one physical row by contract. Every mutable prop is stated on every call —
 * including an absent click handler — because a patch cannot clear what the
 * next tree omits.
 */
export const paragraphNode = ({
  id,
  runs,
  fg,
  attributes = 0,
  width = 'auto',
  wrapMode = 'word',
  flexGrow = 0,
  flexShrink = 1,
  onMouseDown,
}: ParagraphInput): VNode =>
  h(TextRenderable, {
    id,
    content: styledRuns(id, runs),
    fg,
    attributes,
    width,
    wrapMode,
    flexGrow,
    flexShrink,
    selectable: false,
    onMouseDown: pressHandler(onMouseDown),
  });
