import type { SectionLine } from '../section-list/index.js';

// BB-256 spec D11 — Stats' `/usage`-style bar rows.
//
// A SHARED component (the third in `src/Component/`), and it earns that place by
// carrying no entity vocabulary at all: it takes `{ label, numbers }` and draws
// bars. Nothing here knows a ticket from a run from a project — which is exactly
// what G4 asserts, and why Stats can render four different blocks from
// one function.
//
// It produces the ROWS OF ONE BLOCK. Stacking blocks under bold headings is
// `flattenSections`' job (`Component/section-list`), unchanged: this component
// only fills a block's body.
//
// BB-340 Task 13 — a row is CELLS AND THEIR BUDGETS, not a padded string.
// `lib/format.ts`'s `pad` used to fill the label field and a local `padNumber`
// the count columns, both of which had to measure the value in display columns
// first (`lib/width.ts`). The renderer places a value inside its budget, so the
// alignment is Yoga's and nothing here measures. The operator approved what that
// costs: the pipe prints the same values with one space between them and no
// column alignment, because a pipe runs no layout (spec F5, A4 re-pinned).

/** A filled bar cell. U+2588 FULL BLOCK. */
export const BAR_FULL = '█';
/** An empty bar cell. U+2591 LIGHT SHADE. */
export const BAR_EMPTY = '░';

/**
 * The bar's width in display columns.
 *
 * `█`/`░` are narrow per `lib/width-table.ts` — neither is in `WIDE_RANGES` — so
 * the row geometry BB-241's hit testing depends on is unaffected. They are NOT
 * ASCII, though, and both are East-Asian-AMBIGUOUS: a terminal configured
 * ambiguous-as-wide (common in CJK setups) renders them two columns and shifts
 * every number column at runtime while every test here stays green, because the
 * width table deliberately treats Ambiguous as narrow (the frame's box-drawing
 * characters depend on that). Accepted rather than mitigated — spec R9. If it
 * ever bites, the fix is an ASCII bar glyph, never a width-table change.
 */
export const BAR_WIDTH = 20;

/** The indent every row of a block carries, matching the other body renderers. */
const INDENT = '  ';

/**
 * The label column's budget: {@link INDENT} plus 27 columns of text.
 *
 * The text budget is what the field has to hold, and after BB-324 that is two
 * different kinds of text sharing one column: a breakdown row's bare entity name
 * (a real project name reaches 26 columns on its own — `bakers-e2e-project` plus a
 * suffix used to; a long one still does), and the group TITLE printed in the
 * header row's label field above it. Both declare the same budget, which is what
 * keeps a title, the labels it captions and the column titles on one geometry.
 *
 * The indent rides INSIDE the cell's text rather than beside it as a cell of its
 * own, so a row's first column starts where the other body renderers' rows do
 * and the row's own `gap` is not spent separating an empty cell from the label.
 */
const LABEL_WIDTH = INDENT.length + 27;

/** One number column's budget, in display columns. */
const NUMBER_WIDTH = 8;

/** One row of a block: a name and its counts, most-significant number last. */
export interface StatsPanelRow {
  label: string;
  /**
   * The counts to print, in column order. The LAST one is what the bar
   * measures — for a breakdown row that is the month, so a row whose day count
   * is zero still shows the activity it actually had.
   */
  numbers: number[];
}

export interface StatsPanelOptions {
  /**
   * Column titles, printed as a header row above the numbers. Omitted for a
   * single-number block, where the label already says which window it is.
   *
   * The mock in spec D11 hangs these titles off the block's HEADING line; they
   * are their own row here because the heading belongs to `flattenSections`,
   * which owns the bold-row set. Same information, one row lower, and the two
   * components keep their boundary.
   */
  columns?: readonly string[] | undefined;
  /**
   * The group's name, printed in the header row's already-empty label field
   * (BB-324 D4). A caller that renders several groups under one heading uses
   * it to say which group each block of bars is.
   *
   * The component stays ENTITY-NEUTRAL: this is a string, and nothing here knows
   * a ticket from a run. It declares exactly the data label's budget, so the
   * title, the labels beneath it and the column titles keep one geometry.
   */
  title?: string | undefined;
  /** What to render instead of rows when there are none (spec R7). */
  emptyMessage?: string | undefined;
}

/**
 * The bar for `value` within a group whose largest bar value is `max`.
 *
 * Scaled RELATIVE TO THE LARGEST VALUE IN ITS OWN GROUP, not to a limit. This is
 * the one place the `/usage` analogy does not carry: `/usage` measures against a
 * quota, and there is no quota here — so a full bar means "the biggest of these",
 * never "100 %". An all-zero group has no maximum to scale by and renders empty
 * rather than dividing by zero.
 */
function bar(value: number, max: number): string {
  const filled =
    max > 0
      ? Math.max(0, Math.min(BAR_WIDTH, Math.round((value / max) * BAR_WIDTH)))
      : 0;
  return BAR_FULL.repeat(filled) + BAR_EMPTY.repeat(BAR_WIDTH - filled);
}

/**
 * One block's body rows: an optional header row (the group's title, the column
 * titles, or both), then one row per entry.
 *
 * Every row declares the SAME cell budgets in the same order, which is what
 * keeps the header's titles over the columns they name — the structural form of
 * the claim the padded rows used to make by measuring each field.
 */
export function statsPanelRows(
  rows: readonly StatsPanelRow[],
  { columns, title, emptyMessage }: StatsPanelOptions = {},
): SectionLine[] {
  if (rows.length === 0) {
    return emptyMessage === undefined ? [] : [`${INDENT}${emptyMessage}`];
  }

  const barValue = (row: StatsPanelRow): number => row.numbers.at(-1) ?? 0;
  const max = Math.max(...rows.map(barValue));
  const number = (text: string) => ({
    text,
    width: NUMBER_WIDTH,
    right: true as const,
  });

  const out: SectionLine[] = [];
  if ((columns && columns.length > 0) || title !== undefined) {
    out.push({
      cells: [
        { text: `${INDENT}${title ?? ''}`, width: LABEL_WIDTH },
        // The bar's column, empty: the header row has no bar, and the cell is
        // what holds the column titles over the numbers rather than over it.
        { text: '', width: BAR_WIDTH },
        ...(columns ?? []).map(number),
      ],
    });
  }
  for (const row of rows) {
    out.push({
      cells: [
        { text: `${INDENT}${row.label}`, width: LABEL_WIDTH },
        { text: bar(barValue(row), max), width: BAR_WIDTH },
        ...row.numbers.map((n) => number(String(n))),
      ],
    });
  }
  return out;
}
