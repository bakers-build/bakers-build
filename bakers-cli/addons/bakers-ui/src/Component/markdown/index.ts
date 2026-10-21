// THE MARKDOWN COMPONENT — BB-372 D11, and the one place the cockpit knows
// what Markdown is.
//
// WHY IT EXISTS. Markdown arrived in this package as two halves that landed in
// two wrong places. `lib/markdown.ts` is a pure parser and belongs where it is,
// but the STYLING half — which span kind means which terminal attribute and which
// palette colour — ended up inside `lib/vnode.ts`, the package's most-shared
// render primitive, the one twelve screens draw through. `Component/section-list`
// then named `MarkdownLine`/`MarkdownSpan` throughout its own contract. So a
// generic node vocabulary and a generic list primitive both carried Markdown
// domain knowledge, and no gate caught it: `scripts/assert-acyclic.mjs` enforces
// PACKAGE layering, and both files live in `lib/`.
//
// THE SHAPE. This directory owns all of it, and the import direction inverts:
//
//   Component/markdown  →  lib/vnode   (attributes, palette, the neutral run)
//   Component/markdown  →  lib/markdown (the pure parser, no @opentui/core)
//   lib/vnode           →  nothing about Markdown
//   Component/section-list → lib/vnode  (StyledLine, never MarkdownLine)
//
// THE HARD CONSTRAINT, and the reason this is not a paint-only component: the
// non-interactive pipe prints `row.text` and NOTHING ELSE. AC-3's parity is
// structural precisely because a rendered row carries its rendered TEXT, so
// `bakers ui <id> | cat` and the interactive tree are the same rendering by
// construction rather than by agreement (D4). A component that emitted only
// VNodes would cut the pipe off that rendering and restore the
// two-renderers-disagree defect this ticket exists to remove. So the output here
// is DATA — a {@link StyledLine}: rendered text, resolved runs, and the row's own
// weight — and `Component/section-list`'s `lineText` keeps working unchanged.
//
// THE PAINTER sits here too (`Markdown`, `MarkdownLines`, `HeadlineMarkdown`):
// it turns those same styled rows into renderables, so there is one style rule
// for a body whether it is piped or drawn, and no second mapping of span kinds
// to colours anywhere else.
//
// WHY `plainLine` AND `indentLine` LIVE HERE rather than in the parser: neither
// parses. `plainLine` is D3's plain path expressed as a value, and `indentLine`
// prepends blanks to an ALREADY RENDERED line — which is the whole point of it
// (four leading spaces prepended to SOURCE would be an indented code block in
// CommonMark, so applying the indent after rendering is what makes that
// impossible rather than merely unlikely, Fact 9). Both are shell work on a
// rendered line, so they sit with the shell.

import { BoxRenderable, h, type VNode } from '@opentui/core';
import type { MarkdownLine, MarkdownSpan } from '../../lib/markdown.js';
import { markdownLines as parseMarkdown } from '../../lib/markdown.js';
import {
  BOLD,
  BORDER,
  DIM,
  FOREGROUND,
  FOREGROUND_HIGHLIGHT,
  ITALIC,
  paragraphNode,
  plainRun,
  type StyledLine,
  type StyledRun,
} from '../../lib/vnode.js';

/**
 * ONE SPAN AS THE RUN A RENDERER CAN PAINT — D7/D11, and the mapping this
 * component owns.
 *
 * `bold`, `italic` and `dim` are ATTRIBUTES and OR together into one bitmask;
 * `code` is a COLOUR and not an attribute at all, which is why a code span that
 * is also emphasised carries both. The colour is {@link BORDER} (indexed, same
 * slot as ordinary foreground after BB-375 dropped cyan) — never a truecolor
 * triplet.
 *
 * `strikethrough` and `underline` are deliberately absent: underline is what a
 * terminal hyperlink looks like and would collide with D6's `text (url)`, and
 * `~~struck~~` is mapped onto `dim` rather than widening the wire vocabulary a
 * second time for a construct bakers.build bodies barely use.
 */
export const styledRunOf = (span: MarkdownSpan): StyledRun => ({
  text: span.text,
  attributes:
    (span.bold === true ? BOLD : 0) |
    (span.italic === true ? ITALIC : 0) |
    (span.dim === true ? DIM : 0),
  // Spread rather than `fg: undefined`, for `exactOptionalPropertyTypes`: an
  // unstyled run must state no colour, so `lib/vnode.ts`'s early exit can still
  // hand the plain string straight to the renderable.
  ...(span.code === true ? { fg: BORDER } : {}),
});

/**
 * ONE PARSED LINE AS A NEUTRAL STYLED LINE.
 *
 * `text` is carried through UNTOUCHED — that is the pipe constraint in one line
 * of code. The styling step may not change a glyph, and it cannot: it only ever
 * reads a span's flags.
 */
export const styledLineOf = (line: MarkdownLine): StyledLine => ({
  text: line.text,
  runs: line.spans.map(styledRunOf),
  heading: line.heading,
});

/** A `bb_rich` body as the physical rows a surface draws or prints — D1. */
export function markdownLines(body: string): StyledLine[] {
  return parseMarkdown(body).map(styledLineOf);
}

/** A line NOTHING parses — one unstyled run (D3's plain path, as a value). */
export function plainLine(text: string): StyledLine {
  return {
    text,
    runs: text === '' ? [] : [{ text, attributes: 0 }],
    heading: false,
  };
}

/**
 * The same line held `columns` in from the left — D5.
 *
 * The indent is an unstyled run PREPENDED TO A RENDERED LINE, never four spaces
 * prepended to the source — see this file's header for why that ordering is
 * load-bearing rather than tidy.
 */
export function indentLine(source: StyledLine, columns: number): StyledLine {
  const blanks = ' '.repeat(columns);
  return {
    text: `${blanks}${source.text}`,
    runs: [{ text: blanks, attributes: 0 }, ...source.runs],
    heading: source.heading,
  };
}

/**
 * THE RUN LOG'S OWN MINIMAL RULE — BB-372 D9, and it has exactly ONE caller:
 * `Entity/run/Component/run-detail`.
 *
 * An ATX heading (`#`…`######`) renders as bold with the markers stripped;
 * everything else is returned unchanged. Bullets, emphasis and code fences stay
 * raw.
 *
 * ITS DOC COMMENT ONCE CLAIMED THE OPPOSITE OF WHAT IS NOW TRUE — that it is "ONE
 * function, because every renderer of a body line goes through it". Since
 * BB-372 no body line goes through it at all: a `bb_rich` body is rendered by
 * {@link markdownLines} and reaches a row as a `StyledLine` (D3), and
 * `Component/section-list`'s `sectionRows`/`expandableRows` do not parse a plain
 * string.
 *
 * IT LIVED IN `Component/section-list` UNTIL D11 MOVED IT HERE. That was where it
 * sat while it really was the rule for EVERY body row; once it was not, all it left
 * behind was a Markdown rule inside a generic list primitive. The rule is unchanged,
 * character for character; only its address is.
 *
 * The run log keeps the narrow rule DELIBERATELY, not by omission. A log entry is
 * MACHINE OUTPUT, not authored Markdown: an agent line full of `*`, `_` and
 * backticks would be re-styled and have characters deleted by a renderer meant
 * for prose. Routing the log through the full subset is a separate ticket, not a
 * silent side effect of this one.
 */
export function markdownRow(line: string): { text: string; bold: boolean } {
  const md = /^(#{1,6})\s+(.*)$/.exec(line);
  return md ? { text: md[2] ?? '', bold: true } : { text: line, bold: false };
}

export interface MarkdownProps {
  id: string;
  /** Markdown source, parsed with the production line/span parser. */
  source: string;
  width?: number;
}

export interface MarkdownLinesProps {
  id: string;
  /** Rows as {@link markdownLines} renders them. */
  lines: readonly StyledLine[];
  width?: number;
  /** Brighter body copy — terminal cells have no font size. */
  emphasis?: boolean;
}

/** Collapse blank runs to one blank row and trim blank rows at either end. */
const compactLines = (lines: readonly StyledLine[]): readonly StyledLine[] => {
  const compacted: StyledLine[] = [];
  for (const line of lines) {
    if (line.text === '' && compacted.at(-1)?.text === '') continue;
    compacted.push(line);
  }
  while (compacted.at(0)?.text === '') compacted.shift();
  while (compacted.at(-1)?.text === '') compacted.pop();
  return compacted;
};

/**
 * A row's runs as painted: a heading or an emphasised body is bold and
 * highlighted, and a run's own colour (code) wins over both.
 */
const paintedRuns = (line: StyledLine, emphasis: boolean): StyledRun[] => {
  const strong = line.heading || emphasis;
  return line.runs.map((run) =>
    plainRun(
      run.text,
      run.attributes | (strong ? BOLD : 0),
      run.fg ?? (strong ? FOREGROUND_HIGHLIGHT : FOREGROUND),
    ),
  );
};

/** Styled rows as one column of wrapped paragraphs, blank rows kept one high. */
export const MarkdownLines = ({
  id,
  lines,
  width,
  emphasis = false,
}: MarkdownLinesProps): VNode =>
  h(
    BoxRenderable,
    { id, flexDirection: 'column', width: width ?? '100%' },
    // The rows of one body, in order: their position is their identity, and
    // every row restates all of its props.
    ...compactLines(lines).map((line, index) =>
      line.text === ''
        ? h(BoxRenderable, { id: `${id}-${index}`, height: 1 })
        : paragraphNode({
            id: `${id}-${index}`,
            runs: paintedRuns(line, emphasis),
            fg: FOREGROUND,
            width: '100%',
            flexShrink: 0,
          }),
    ),
  );

/** A Markdown source, parsed and painted. */
export const Markdown = ({ id, source, width }: MarkdownProps): VNode =>
  MarkdownLines({
    id,
    lines: markdownLines(source),
    ...(width === undefined ? {} : { width }),
  });

export interface HeadlineMarkdownProps {
  id: string;
  headline: string;
  children: readonly VNode[];
  paddingBottom?: number;
  paddingLeft?: number;
  /**
   * The id the HEADLINE row carries — a selectable entry's row id, which the
   * kernel scrolls to and binds clicks on. The headline text inside it owns
   * {@link onMouseDown} and consumes the press.
   */
  headlineId?: string;
  onMouseDown?: () => void;
}

/** A `* headline` row above an indented body. */
export const HeadlineMarkdown = ({
  id,
  headline,
  children,
  paddingBottom = 1,
  paddingLeft = 1,
  headlineId,
  onMouseDown,
}: HeadlineMarkdownProps): VNode => {
  const row = headlineId ?? `${id}-headline`;
  return h(
    BoxRenderable,
    {
      id,
      flexDirection: 'column',
      width: '100%',
      flexShrink: 0,
      paddingBottom,
    },
    h(
      BoxRenderable,
      { id: row, flexDirection: 'row', flexShrink: 0 },
      paragraphNode({
        id: `${row}-text`,
        runs: [plainRun(`* ${headline}`)],
        fg: FOREGROUND,
        width: '100%',
        flexShrink: 0,
        onMouseDown,
      }),
    ),
    h(
      BoxRenderable,
      {
        id: `${id}-body`,
        flexDirection: 'column',
        width: '100%',
        flexShrink: 0,
        paddingLeft,
      },
      ...children,
    ),
  );
};
