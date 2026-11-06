import type { VNode } from '@opentui/core';
import {
  type Cell,
  cellsRow,
  type StyledLine,
  type StyledRun,
  textNode,
} from '../../lib/vnode.js';
import { plainLine } from '../markdown/index.js';

/**
 * A section body row that is COLUMNS rather than prose — BB-340 Task 13.
 *
 * The original producer is the ticket detail's Runs table, which used to
 * compose its columns into one padded string with `lib/format.ts`'s `pad`.
 * Producers describe their cells instead: the tree lays them
 * out with Yoga budgets, and a surface with no layout — the pipe — prints
 * {@link lineText}'s join. That is the operator-approved cost of retiring the
 * padding, and it is what lets `pad` (and with it two of `lib/width.ts`'s
 * consumers) go.
 */
export interface SectionCells {
  readonly cells: readonly Cell[];
}

/**
 * One body row of a section — BB-372 D3, where the third variant arrived.
 *
 * A body DECLARES ITSELF MARKDOWN; a plain string stays plain:
 *
 *  - a `string` is PLAIN TEXT, rendered verbatim and **never parsed**;
 *  - a {@link SectionCells} is columns, unchanged (a run number opens with `#`);
 *  - a {@link StyledLine} is an ALREADY RENDERED body row, carrying its styled
 *    runs and its `heading` flag.
 *
 * BB-372 D11 — the third variant is NEUTRAL. It used to be `MarkdownLine`, which
 * made this generic list primitive name a domain it does not own; a producer of
 * styled rows is not necessarily a Markdown renderer, and `Component/markdown/` is
 * where that domain lives now.
 *
 * That is what makes AC-5 STRUCTURAL rather than careful. `Assignment`, `Time`,
 * `Branch`, `Links`, `Labels` and the run table hand over plain strings, so no
 * Markdown rule can reach them — a branch called `feat/a_b_c` or a link title
 * holding a `*` cannot be re-styled or re-spelled by a parser that never sees it.
 * It is also strictly LESS parsing than before BB-372, when
 * `Component/markdown/`'s `markdownRow` ran over every one of those rows.
 *
 * The rejected alternative was a block-aware pass inside {@link sectionRows} over
 * `section.lines`, for exactly that reason: it would run the renderer over every
 * non-Markdown section, and the flat `Comments` section would run one stateful
 * pass across ALL comments' bodies, letting an unterminated fence in one comment
 * swallow the next.
 */
export type SectionLine = string | SectionCells | StyledLine;

/** Whether a line is columns rather than prose — `cells` is the discriminant. */
const isCells = (line: SectionLine): line is SectionCells =>
  typeof line !== 'string' && 'cells' in line;

/**
 * A line as the text a surface with no layout prints.
 *
 * The separator is ONE space because that is the gap `lib/vnode.ts`'s `rowNode`
 * puts between two cells: the pipe and the tree then say the same thing about
 * what separates two columns, and only the alignment inside a column is the
 * renderer's own.
 *
 * BB-372 D4 — for a {@link StyledLine} this returns the RENDERED text, which is the
 * whole of how parity is achieved: `SectionRow.text` carries it and the pipe
 * prints exactly that, so `bakers ui <id> | cat` and the interactive tree are the
 * same rendering by construction. The tree merely adds the attributes a pipe
 * cannot carry. There is no raw-only pipe path left to disagree (AC-3).
 */
export const lineText = (line: SectionLine): string => {
  if (typeof line === 'string') return line;
  if (isCells(line)) {
    return line.cells
      .map((cell) => cell.text)
      .join(' ')
      .replace(/\s+$/, '');
  }
  return line.text;
};

/**
 * Any body line as a RENDERED line — BB-372 D3/D8.
 *
 * A plain or columned row is LIFTED (one unparsed span) rather than refused,
 * because a consumer that needs rendered lines — the collapsible Description
 * entry, whose extract reads `line.heading` — is handed a `Description` section
 * whose empty state is the plain string `No description.` Lifting never parses,
 * so nothing here can re-introduce a Markdown rule on the plain path.
 */
export const styledOf = (line: SectionLine): StyledLine =>
  typeof line === 'string' || isCells(line) ? plainLine(lineText(line)) : line;

/** A titled block of already-flattened physical rows. */
export interface Section {
  heading: string;
  lines: SectionLine[];
}

/**
 * One flattened row: its text, whether it is bold, and WHICH ROW IT IS
 * (BB-340 D3/D4).
 *
 * `key` is what a converted screen turns into its node's `props.id`, so a row
 * has to be able to say what it is rather than where it sits. It is scoped by
 * the section's own HEADING — `per-user-0`, never `row-14` — so a section keeps
 * its keys when the section above it is absent. Two sections sharing a heading
 * would collide, and `Kernel/mount.ts` refuses a repeated id loudly rather than
 * patching one row's content onto another's node.
 */
export interface SectionRow {
  readonly key: string;
  readonly text: string;
  readonly bold: boolean;
  /**
   * The row's columns, when it has any — see {@link SectionCells}.
   *
   * `text` is the same row for a surface that cannot lay one out, so a consumer
   * that only prints never has to know the difference; {@link sectionRowNode} is
   * where the difference is made.
   */
  readonly cells?: readonly Cell[];
  /**
   * The row's STYLED RUNS, for a row that carries per-run styling — BB-372
   * D5/D11.
   *
   * Absent means everything is exactly as it was: one attribute set for the whole
   * row. `text` is the same row for a surface that cannot paint a run, so the
   * pipe never has to know the difference (D4). Already-resolved attributes and
   * colours: WHICH run asks for which is `Component/markdown/`'s business, not
   * this primitive's.
   */
  readonly runs?: readonly StyledRun[];
}

/**
 * One body line as the row it is — the ONE place D3's three variants are read
 * apart, so a flat section and a collapsible entry cannot answer differently for
 * the same line.
 */
const bodyRow = (key: string, line: SectionLine): SectionRow => {
  // Columns are never read as Markdown: a run number opens with `#`, and the ATX
  // rule would both bold the row and eat the number.
  if (isCells(line)) {
    return { key, text: lineText(line), bold: false, cells: line.cells };
  }
  // A plain string is PLAIN. Nothing parses it (D3) — which is what puts
  // `Assignment`, `Branch`, `Links` and `Labels` structurally out of reach.
  if (typeof line === 'string') return { key, text: line, bold: false };
  return {
    key,
    text: line.text,
    // An ATX heading inside a body is the ROW's weight, exactly as it was; what
    // decides it is now the rendered line's own flag rather than a re-match.
    bold: line.heading,
    runs: line.runs,
  };
};

/**
 * A heading as an id fragment: `PER USER` → `per-user`.
 *
 * Exported because a tab that renders one of its sections as a COLLAPSIBLE entry
 * has to key that entry the same way `sectionRows` keys a flat one — otherwise
 * the same section would carry different node ids depending on which tab reached
 * it, and `patchTree` would rebuild it instead of writing to it (BB-340 D4).
 */
export const sectionKey = (heading: string): string =>
  heading
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/**
 * The same, for a heading that is DATA rather than one of the built-in set —
 * BB-373 AC-10.
 *
 * {@link sectionKey} is LOSSY: it lowercases and collapses every run of
 * non-alphanumeric characters onto one `-`. That is injective over the closed
 * built-in headings (`Per user`, `Latest summary`), and it stops being injective
 * the moment a contributed panel heads its sections with whatever it is
 * listing. The shipped artifacts viewer heads them with paths under the ticket's
 * tree, so `/`, `.` and `-` all land on the same character and two ordinary
 * captures collapse onto one key:
 *
 *     playwright/logs/walk.txt  ->  playwright-logs-walk-txt
 *     playwright/logs-walk.txt  ->  playwright-logs-walk-txt
 *
 * A key is an IDENTITY — `Kernel/mount.ts` refuses a repeated id, and it refuses
 * it while MOUNTING, past the host's guard around `panel.sections()` and on a
 * draw path with no `catch` — so a lossy key is not a cosmetic collision, it is
 * the cockpit going down on a message naming neither the addon nor the file.
 *
 * SO THE SEPARATORS ARE ENCODED RATHER THAN COLLAPSED. Every UTF-8 byte outside
 * `[a-z0-9]` becomes `_<hex>`, two digits, lower case. The escape has a fixed
 * length and `_` is itself escaped (`_5f`), so the mapping is reversible and
 * therefore injective — including over case (`README.txt` and `readme.txt` are
 * two files on this filesystem) and over a heading that already looks like an
 * escape.
 *
 * WHY THE OUTPUT CARRIES NO `-`, which is a second property and not a side
 * effect. A key never becomes an id on its own: it is always suffixed
 * (`-heading`, `-gap`, `-empty`, `-header`, `-<index>`). Injectivity of the key
 * alone would not settle the id, because the suffix boundary would be
 * ambiguous — with `-` allowed inside a key, section `a` at body index 12 and
 * section `a-1` at body index 2 would both be `a-12`. With no `-` inside a key
 * the first `-` after the screen's own prefix always ends the key, so a key and
 * its suffix are both recovered from an id and two ids can only be equal when
 * both halves are. Within one section the suffixes are distinct by construction:
 * the indices are digits and the four literals are not.
 *
 * NOT THE BUILT-IN PATH. `sectionRows` and the ticket detail's tabs keep
 * {@link sectionKey} as their default, so no built-in node id moves (AC-2) — a
 * `_` in a key is exactly the mark of a heading that came from a contribution.
 *
 * WHAT THIS STILL DOES NOT FIX, said plainly: two panel sections carrying the
 * SAME heading. No injective map over headings can separate two identical
 * headings, so that case remains the loud refusal it is today. It is out of
 * scope for BB-373 and belongs to whatever gives a panel section an identity
 * distinct from its title.
 */
export const panelSectionKey = (heading: string): string =>
  Array.from(new TextEncoder().encode(heading), (byte) =>
    (byte >= 0x30 && byte <= 0x39) || (byte >= 0x61 && byte <= 0x7a)
      ? String.fromCharCode(byte)
      : `_${byte.toString(16).padStart(2, '0')}`,
  ).join('');

/**
 * Flatten `{heading, lines}` sections into KEYED rows: the heading, its body,
 * and the blank line that closes the section.
 *
 * The one description of what a section renders as. {@link flattenSections}
 * derives the row surface from it and a converted screen derives its nodes from
 * it, so the two cannot answer differently for the same document — which is the
 * property that lets a screen hand over renderables while its pipe keeps
 * emitting the bytes it always did (spec F5).
 */
export function sectionRows(
  sections: Section[],
  // BB-373 — HOW a heading becomes a key, as an argument. The built-in
  // derivation stays the default so every existing caller keys exactly as it
  // did (AC-2); a caller whose headings are data passes
  // {@link panelSectionKey}, which is injective over them.
  keyOf: (heading: string) => string = sectionKey,
): SectionRow[] {
  const out: SectionRow[] = [];
  for (const section of sections) {
    const id = keyOf(section.heading);
    out.push({ key: `${id}-heading`, text: section.heading, bold: true });
    section.lines.forEach((line, index) => {
      out.push(bodyRow(`${id}-${index}`, line));
    });
    out.push({ key: `${id}-gap`, text: '', bold: false });
  }
  return out;
}

/**
 * One flattened row as the node a converted screen hands over — BB-340 D1.
 *
 * The ONE place a `SectionRow` becomes a renderable, so the two screens that
 * render section rows (the ticket detail's tabs, the project overview) cannot
 * disagree about what a columned row looks like. `prefix` is the screen's own
 * body id, which is what keeps two screens' rows apart in one tree.
 */
export const sectionRowNode = (
  prefix: string,
  row: SectionRow,
  selected = false,
): VNode =>
  row.cells === undefined
    ? textNode({
        id: `${prefix}-${row.key}`,
        content: row.text,
        bold: row.bold,
        selected,
        // BB-372 D5 — spread rather than passed as `undefined`, for
        // `exactOptionalPropertyTypes`: a row with no runs declares none, and
        // `linked()` then returns the plain string it always did.
        ...(row.runs === undefined ? {} : { runs: row.runs }),
      })
    : cellsRow(`${prefix}-${row.key}`, row.cells, selected);

// The same rows as plain text plus the INDICES that are bold (section headings +
// a rendered body's own ATX headings) — the shape the row surface needs. The
// RUNS are dropped on this path by definition: a pipe carries no styling, and
// `row.text` is already the rendered text, so what it prints is what the tree
// draws minus the attributes (BB-372 D4). Headings carry NO
// ANSI here: the draw step applies bold after fit(), so sanitizeDisplay never
// sees (and never strips) the ESC.
export function flattenSections(sections: Section[]): {
  lines: string[];
  boldRows: Set<number>;
} {
  const rows = sectionRows(sections);
  return {
    lines: rows.map((row) => row.text),
    boldRows: new Set(rows.flatMap((row, index) => (row.bold ? [index] : []))),
  };
}

/**
 * One collapsible entry: a caret header row plus the rows shown in each state.
 *
 * BB-255 D2: the Comments tab's collapse/expand interaction and the Overview
 * tab's Description are ONE primitive rather than two renderers that happen to
 * agree — AC-2 asks for "the same expand interaction the Comments tab offers",
 * and structural sharing is the only form of that claim a test can hold.
 */
export interface ExpandableEntry {
  /**
   * What this entry IS, as an id fragment (BB-340 D4/R4) — a comment's uuid,
   * a section's slug. Its rows are keyed under it, so an entry's content and its
   * identity move together when the list re-sorts.
   */
  key: string;
  /** The header row's text, after the caret. */
  header: string;
  /**
   * Rows shown while collapsed (indented like the expanded body).
   *
   * BB-372 D3 — a {@link SectionLine}, so a rendered body row keeps its runs
   * on this surface too and a plain string is still never parsed.
   */
  collapsed: SectionLine[];
  /** Rows shown while expanded. */
  expanded: SectionLine[];
}

/** The rendered rows of a list of expandable entries. */
export interface ExpandableView {
  rows: SectionRow[];
  /** `headerRows[i]` is the row index of entry i's header — the selection map. */
  headerRows: number[];
  selectable: number;
}

/**
 * Expandable entries as KEYED rows: one caret header row per entry (`▸`
 * collapsed, `▾` expanded) followed by that state's rows. `headerRows[i]` is
 * entry i's header row, which is both the highlight target and the click map
 * (the rows are NOT uniformly spaced — an expanded entry appends its body).
 *
 * Zero entries render `emptyMessage` and nothing selectable, so an empty list is
 * an explicit statement rather than a blank screen.
 *
 * BB-340 D1/D3 — rows rather than lines-plus-a-`boldRows`-set, and the two
 * halves of that are the same change: the caller turns each row into a node, so
 * "this row is a heading" is a prop on the node and no longer an index into a
 * surface somebody else styles. `SectionRow` is the shape {@link sectionRows}
 * already produces, so a tab that mixes flat sections with expandable ones has
 * one row type rather than two.
 */
export function expandableRows(
  entries: ExpandableEntry[],
  {
    expanded = new Set<number>(),
    emptyMessage,
    emptyKey,
    // BB-255 AC-11 review: `ReadonlySet` because the render path is handed ONE
    // shared empty set for every not-yet-expanded tab (`expandedFor`) — growing
    // it here would leak one tab's expansion into all the others. The renderer
    // only ever calls `.has()`, so the narrowing costs it nothing.
  }: {
    expanded?: ReadonlySet<number>;
    emptyMessage: string;
    emptyKey: string;
  },
): ExpandableView {
  if (!entries.length) {
    return {
      rows: [{ key: emptyKey, text: emptyMessage, bold: false }],
      headerRows: [],
      selectable: 0,
    };
  }
  const rows: SectionRow[] = [];
  const headerRows: number[] = [];
  entries.forEach((entry, i) => {
    headerRows.push(rows.length);
    rows.push({
      key: `${entry.key}-header`,
      text: `${expanded.has(i) ? '▾' : '▸'} ${entry.header}`,
      bold: true,
    });
    const body = expanded.has(i) ? entry.expanded : entry.collapsed;
    body.forEach((line, index) => {
      rows.push(bodyRow(`${entry.key}-${index}`, line));
    });
  });
  return { rows, headerRows, selectable: entries.length };
}
