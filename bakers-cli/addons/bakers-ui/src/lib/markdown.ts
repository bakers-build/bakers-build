// BB-372 D1 — ONE renderer for every `bb_rich` body the cockpit shows, and
// nothing else.
//
// A body string in, one {@link MarkdownLine} per PHYSICAL ROW out. It is pure
// text: no `@opentui/core` import, no palette, no renderable. "What a construct
// MEANS" lives here; "WHICH SGR that is" is `Component/markdown/`'s, which maps a
// span kind onto the `BOLD`/`ITALIC`/`DIM` attributes and the `BORDER` palette slot
// `lib/vnode.ts` owns — so the two questions remain two files and this one stays
// testable as a string→data function.
//
// BB-372 D11 — THIS MODULE IS THE PARSER AND NOTHING ELSE. It said "which SGR
// that is stays in `lib/vnode.ts`" while it was true, and it was the wrong place:
// the mapping sat inside the package's most-shared render primitive. The shell
// around this parser — the styling, the plain path, the indent — is
// `Component/markdown/`, which is the only module that imports this one.
//
// ---------------------------------------------------------------------------
// THE SUBSET IS LINE-ORIENTED, AND THAT IS A CAPABILITY STATEMENT (D2)
// ---------------------------------------------------------------------------
//
// A cockpit row is ONE physical line: every row node carries `height: 1` and
// `wrapMode: 'none'`, and the cut at the right edge is the renderer's against a
// Yoga budget. So this module maps one source line to one rendered line, with
// exactly one piece of block state (an open fence). No paragraph reflow, no
// wrapping, NOTHING MEASURED — `lib/width.ts`'s deletion is not being undone. A
// construct that needs reflow to be readable cannot be supported here, which is
// why GFM tables are an explicit degradation rather than an omission.
//
// The supported subset and the named degradations are written out for the
// operator in the package `README.md` and in `docs/advanced/cli/ui.md`
// (D10/AC-4). What follows is the same list as code.
//
// ---------------------------------------------------------------------------
// THE ONE INVARIANT (D2, R4)
// ---------------------------------------------------------------------------
//
//   The rendering only ever deletes markers it MATCHED and inserts the prefixes
//   D2 names. An unrecognised or unbalanced construct passes through unchanged.
//   A mis-parse can lose a MARKER; it can never lose a CHARACTER OF CONTENT.
//
// Every rule below therefore REJECTS rather than guesses: an unclosed code span
// emits its backticks, an unmatched `[` emits itself, an emphasis run with no
// closer emits its asterisks. `tests/lib/markdown.test.ts` holds that as a test
// class of its own, including the property form — strip the characters a rule
// may delete and the prefixes it may insert, and source and rendering are the
// same string.
//
// ---------------------------------------------------------------------------
// `_` IS EMPHASIS ONLY AS A SINGLE DELIMITER AT A WORD BOUNDARY (R5)
// ---------------------------------------------------------------------------
//
// `snake_case`, `feat/a_b_c` and `__init__` appear in real bakers.build bodies, and a
// renderer that restyled them would be deleting characters an author meant. So
// `_` follows CommonMark's INTRAWORD rule (a `_` touching an alphanumeric on its
// inner side is literal) AND a `_` run of two or more is never emphasis at all.
//
// THAT SECOND HALF IS WHERE THE SPEC CONTRADICTED ITSELF, and this is the
// resolution. D2's table lists `__strong__` as bold; R5 requires `__init__` to
// come back unchanged. The two strings are structurally identical — a `__` run at
// a word boundary around an alphanumeric word — and CommonMark reads both as
// strong, so no local rule can tell them apart and exactly one of the two can
// hold. R5 wins: it is the named risk, D2's own invariant states the safe
// direction, and `**strong**` (which every bakers.build body already uses) remains the
// way to write bold. `__strong__` is documented as a degradation instead.
//
// `*` keeps CommonMark's laxer behaviour, so `a*b*c` italicises `b`.

/** One styled run of a rendered line. `code` is a colour, the rest attributes. */
export interface MarkdownSpan {
  readonly text: string;
  readonly bold?: boolean;
  readonly italic?: boolean;
  readonly dim?: boolean;
  readonly code?: boolean;
}

/**
 * One PHYSICAL ROW of a rendered body.
 *
 * `text` is the spans concatenated — what a surface with no styling prints — and
 * that is what makes `bakers ui <id> | cat` and the interactive tree the same
 * rendering by construction rather than by agreement (D4).
 *
 * BB-372 D11 — THIS TYPE NO LONGER REACHES A ROW. It used to be the third
 * variant of `Component/section-list`'s `SectionLine` and this comment used to say
 * so; `Component/markdown/` now maps it onto `lib/vnode.ts`'s neutral `StyledLine`
 * at its own boundary, so the parser's vocabulary stops at that boundary. What is
 * unchanged is the discriminant PROPERTY: a row carrying runs is a rendered body
 * row, a plain `string` is text nothing parses (D3).
 */
export interface MarkdownLine {
  readonly text: string;
  readonly spans: readonly MarkdownSpan[];
  /** WHAT the line is: an ATX heading — drawn bold, and skipped by the extract. */
  readonly heading: boolean;
}

/** The four style flags, as one value the recursive inline pass can extend. */
interface Flags {
  readonly bold: boolean;
  readonly italic: boolean;
  readonly dim: boolean;
  readonly code: boolean;
}

const PLAIN: Flags = { bold: false, italic: false, dim: false, code: false };

/**
 * A span carrying ONLY the flags that are on.
 *
 * Deliberate: a consumer compares spans structurally, and `bold: false` on every
 * span would make an unstyled run look like a styled one that happens to be off.
 */
const span = (text: string, flags: Flags): MarkdownSpan => ({
  text,
  ...(flags.bold ? { bold: true as const } : {}),
  ...(flags.italic ? { italic: true as const } : {}),
  ...(flags.dim ? { dim: true as const } : {}),
  ...(flags.code ? { code: true as const } : {}),
});

/** The characters a backslash may escape — CommonMark's set, narrowed to ours. */
const ESCAPABLE = '\\`*_{}[]()#+-.!<>~|';

/** How many of `char` sit at `at`, as one delimiter run. */
const runLength = (source: string, at: number, char: string): number => {
  let length = 0;
  while (source[at + length] === char) length += 1;
  return length;
};

const isSpace = (char: string | undefined): boolean =>
  char === undefined || char === '' || /\s/.test(char);

const isPunctuation = (char: string | undefined): boolean =>
  char !== undefined && char !== '' && /[!-/:-@[-`{-~]/.test(char);

const isWord = (char: string | undefined): boolean =>
  char !== undefined && /[\p{L}\p{N}]/u.test(char);

/**
 * CommonMark's flanking rules, which is what keeps `2 * 3 * 4` from italicising.
 *
 * A run can OPEN only if it is left-flanking — nothing but a non-space follows
 * it — and can CLOSE only if it is right-flanking. Without them a delimiter with
 * a space on both sides pairs with the next one and swallows the text between,
 * which is the R4 failure mode in its most ordinary form.
 */
const leftFlanking = (source: string, at: number, length: number): boolean => {
  const before = at === 0 ? '' : source[at - 1];
  const after = source[at + length];
  if (isSpace(after)) return false;
  return !isPunctuation(after) || isSpace(before) || isPunctuation(before);
};

const rightFlanking = (source: string, at: number, length: number): boolean => {
  const before = at === 0 ? '' : source[at - 1];
  const after = source[at + length];
  if (isSpace(before)) return false;
  return !isPunctuation(before) || isSpace(after) || isPunctuation(after);
};

/** The next run of `char` at least `need` long that may close — or none. */
function closingRun(
  source: string,
  from: number,
  char: string,
  need: number,
): { at: number; length: number } | null {
  let at = from;
  while (at < source.length) {
    if (source[at] === '\\') {
      at += 2;
      continue;
    }
    if (source[at] !== char) {
      at += 1;
      continue;
    }
    const length = runLength(source, at, char);
    if (length >= need && rightFlanking(source, at, length)) {
      return { at, length: need };
    }
    at += length;
  }
  return null;
}

/** The index of the code-span closer: a run of EXACTLY `length` backticks. */
function codeCloser(source: string, from: number, length: number): number {
  let at = from;
  while (at < source.length) {
    if (source[at] !== '`') {
      at += 1;
      continue;
    }
    const run = runLength(source, at, '`');
    if (run === length) return at;
    at += run;
  }
  return -1;
}

/** The matching `]` of the `[` at `at`, honouring nesting and escapes. */
function labelEnd(source: string, at: number): number {
  let depth = 0;
  for (let i = at; i < source.length; i += 1) {
    const char = source[i];
    if (char === '\\') {
      i += 1;
      continue;
    }
    if (char === '[') depth += 1;
    else if (char === ']') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** The matching `)` of the `(` at `at`, honouring nesting and escapes. */
function targetEnd(source: string, at: number): number {
  let depth = 0;
  for (let i = at; i < source.length; i += 1) {
    const char = source[i];
    if (char === '\\') {
      i += 1;
      continue;
    }
    if (char === '(') depth += 1;
    else if (char === ')') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** An inline link or image at `at` (`[`), fully resolved — or null. */
function readLink(
  source: string,
  at: number,
): { label: string; url: string; end: number } | null {
  const close = labelEnd(source, at);
  if (close === -1 || source[close + 1] !== '(') return null;
  const target = targetEnd(source, close + 1);
  if (target === -1) return null;
  const url = source.slice(close + 2, target);
  if (url === '') return null;
  return { label: source.slice(at + 1, close), url, end: target + 1 };
}

/**
 * One source line's INLINE constructs as styled runs.
 *
 * Order of resolution: escapes → code spans → links/autolinks → strike →
 * emphasis. Code resolves before everything else because an operator who pasted
 * `**` into backticks means the characters; escapes resolve before code for the
 * same reason one step further out.
 *
 * `flags` is what the ENCLOSING construct already decided — a block quote's
 * `dim`, an outer `**`'s bold — so nesting is a recursive call rather than a
 * second set of rules.
 */
function inlineRuns(source: string, flags: Flags): MarkdownSpan[] {
  const out: MarkdownSpan[] = [];
  let plain = '';
  const flush = (): void => {
    if (plain !== '') {
      out.push(span(plain, flags));
      plain = '';
    }
  };
  let at = 0;
  while (at < source.length) {
    const char = source[at] as string;

    if (char === '\\') {
      const next = source[at + 1];
      if (next !== undefined && ESCAPABLE.includes(next)) {
        plain += next;
        at += 2;
        continue;
      }
      plain += char;
      at += 1;
      continue;
    }

    if (char === '`') {
      const open = runLength(source, at, '`');
      const close = codeCloser(source, at + open, open);
      if (close !== -1 && close > at + open) {
        flush();
        out.push(
          span(source.slice(at + open, close), { ...flags, code: true }),
        );
        at = close + open;
        continue;
      }
      plain += source.slice(at, at + open);
      at += open;
      continue;
    }

    // An image is a link whose `!` is dropped: D6 renders both as `text (url)`,
    // and the alt text IS the text a terminal can show of an image.
    if (char === '[' || (char === '!' && source[at + 1] === '[')) {
      const bracket = char === '[' ? at : at + 1;
      const link = readLink(source, bracket);
      if (link !== null) {
        flush();
        out.push(...inlineRuns(link.label, flags));
        out.push(span(` (${link.url})`, flags));
        at = link.end;
        continue;
      }
      plain += char;
      at += 1;
      continue;
    }

    if (char === '<') {
      const close = source.indexOf('>', at + 1);
      const inner = close === -1 ? '' : source.slice(at + 1, close);
      if (close !== -1 && /^https?:\/\/[^\s<>]+$/.test(inner)) {
        flush();
        out.push(span(inner, flags));
        at = close + 1;
        continue;
      }
      plain += char;
      at += 1;
      continue;
    }

    if (char === '~' && source[at + 1] === '~') {
      const close = closingRun(source, at + 2, '~', 2);
      if (close !== null && close.at > at + 2 && leftFlanking(source, at, 2)) {
        flush();
        out.push(
          ...inlineRuns(source.slice(at + 2, close.at), {
            ...flags,
            dim: true,
          }),
        );
        at = close.at + 2;
        continue;
      }
      plain += '~~';
      at += 2;
      continue;
    }

    if (char === '*' || char === '_') {
      const length = runLength(source, at, char);
      const emphasised = emphasis(source, at, char, length, flags);
      if (emphasised !== null) {
        // The delimiters this subset could not SPEND are content again. They go
        // into the plain buffer rather than out as their own span, so they merge
        // with the text before them exactly as any other unmatched marker does.
        plain += source.slice(at, emphasised.start);
        flush();
        out.push(...emphasised.runs);
        at = emphasised.end;
        continue;
      }
      plain += source.slice(at, at + length);
      at += length;
      continue;
    }

    plain += char;
    at += 1;
  }
  flush();
  return out;
}

/**
 * One emphasis run at `at`, or null when nothing resolves it.
 *
 * `start` is where the delimiters actually SPENT begin, which is not always `at`:
 * this subset has three styles to give — italic, bold, both — so it can spend at
 * most three delimiters, and a longer run has a surplus. The surplus is spent at
 * NEITHER edge: the opening side keeps the run's outermost delimiters (`start`
 * moves inward) and the closing side keeps its outermost too (`closingRun` hands
 * back `need`, so the tail of the closing run stays in the stream). Both surpluses
 * come back as literal text, which is the invariant at the top of this file read
 * strictly — a delimiter the rule did not MATCH is not one it may delete.
 *
 * The asymmetry that made this comment necessary: the opening run used to be
 * consumed WHOLE while the closing run gave its surplus back, so `****x****`
 * rendered `x*`. CommonMark would pair all four off as nested strong; this subset
 * cannot nest that far, and leaving the leftovers visible at both edges is the
 * behaviour the invariant asks for. Full CommonMark emphasis parity is not a goal.
 */
function emphasis(
  source: string,
  at: number,
  char: string,
  length: number,
  flags: Flags,
): { runs: MarkdownSpan[]; end: number; start: number } | null {
  // R5 — a `__` run is never emphasis, and a `_` touching a word is literal.
  if (char === '_') {
    if (length !== 1) return null;
    const before = at === 0 ? '' : source[at - 1];
    if (isWord(before)) return null;
  }
  const need = Math.min(length, 3);
  if (!leftFlanking(source, at, length)) return null;
  const close = closingRun(source, at + length, char, need);
  if (close === null || close.at <= at + length) return null;
  if (char === '_' && isWord(source[close.at + close.length])) return null;
  const inner: Flags = {
    ...flags,
    bold: flags.bold || need >= 2,
    italic: flags.italic || need === 1 || need >= 3,
  };
  return {
    runs: inlineRuns(source.slice(at + length, close.at), inner),
    start: at + length - need,
    end: close.at + close.length,
  };
}

const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/;
const CLOSING_HASHES = /[ \t]+#+[ \t]*$/;
const THEMATIC_BREAK = /^ {0,3}(?:-{3,}|\*{3,}|_{3,})[ \t]*$/;
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;
// The trailing text is OPTIONAL, so `- [x]` with nothing after it is still a task
// item and still draws its box. Requiring the whitespace dropped such a row
// through to the bullet rule, which then showed the box marker as prose (`• [x]`).
// The whitespace is still required BEFORE text: `- [x]done` is not a task item,
// and falling through keeps every character of it.
const TASK_ITEM = /^([ \t]*)[-*+][ \t]+\[([ xX])\](?:([ \t]+)(.*))?$/;
const BULLET_ITEM = /^([ \t]*)[-*+]([ \t]+)(.*)$/;
const ORDERED_ITEM = /^([ \t]*)(\d{1,9}[.)])([ \t]+)(.*)$/;

/** The thematic break's fixed width — a rule, never a measurement (D2). */
const RULE = '────────';

/** How far a fenced block's content is held in from the left. */
const FENCE_INDENT = '  ';

const line = (
  spans: readonly MarkdownSpan[],
  heading = false,
): MarkdownLine => ({
  text: spans.map((one) => one.text).join(''),
  spans,
  heading,
});

// `plainMarkdown` and `indentMarkdown` LIVED HERE UNTIL BB-372 D11 MOVED THEM TO
// `Component/markdown/` as `plainLine`/`indentLine`. Neither ever parsed anything:
// one is the plain path as a value, the other prepends blanks to an ALREADY
// RENDERED line. They are the rendering shell's work, not the parser's, and this
// module is the parser — so they went with the shell. Nothing else about them
// changed; they operate on the neutral `StyledLine` the shell hands out.

/** One source line as a rendered row. `blockStart` = a block may begin here. */
function blockLine(source: string, blockStart: boolean): MarkdownLine {
  // A thematic break is only recognised where a block can START — the top of the
  // body or after a blank line. That single piece of look-back is what keeps a
  // SETEXT underline (`---` under a paragraph line) raw, which is the
  // degradation D2 names; `===` is never a break at all.
  if (blockStart && THEMATIC_BREAK.test(source)) {
    return line([span(RULE, { ...PLAIN, dim: true })]);
  }

  const heading = HEADING.exec(source);
  if (heading !== null) {
    // The WHOLE row is bold — that is `SectionRow.bold`, taken from `heading`,
    // not a span flag — and the CONTENT still goes through the inline rules.
    //
    // MEASURED. Not inline-rendering a heading leaves a raw backtick on the most
    // read row of the Comments tab: a collapsed header's preview is that comment's
    // ATX first line (D8), and bakers.build handoffs open with headings like
    // `## Design — … every `bb_rich` body as Markdown`. The PTY walk of the live
    // ticket found exactly that — `node tests/pty/verify-markdown.mjs --ticket
    // BB-372` reported the raw backtick on that row (BB-371 D2: the command,
    // not a stored artifact, is the durable record) — which
    // is the defect AC-1/AC-2 forbid and a degradation D2's list does not name —
    // and an UNDOCUMENTED degradation is the one thing AC-4 rules out. So D2's
    // "markers stripped" is read as all of them, and the plan's Task 1 wording
    // ("one span") holds for the ordinary heading, whose content is plain.
    const text = (heading[2] ?? '').replace(CLOSING_HASHES, '');
    return line(inlineRuns(text, PLAIN), true);
  }

  let rest = source.replace(/^ {0,3}/, '');
  let quoted = 0;
  while (rest.startsWith('>')) {
    quoted += 1;
    rest = rest.slice(1);
    if (rest.startsWith(' ')) rest = rest.slice(1);
  }
  if (quoted > 0) {
    const dim: Flags = { ...PLAIN, dim: true };
    return line([span('│ '.repeat(quoted), dim), ...inlineRuns(rest, dim)]);
  }

  const task = TASK_ITEM.exec(source);
  if (task !== null) {
    const box = (task[2] ?? ' ') === ' ' ? '☐' : '☑';
    // `task[3] ?? ''`, not `?? ' '`: a row with no text had no whitespace after
    // the marker either, and this rule inserts a box, never a space.
    return line([
      span(`${task[1] ?? ''}${box}${task[3] ?? ''}`, PLAIN),
      ...inlineRuns(task[4] ?? '', PLAIN),
    ]);
  }

  const bullet = BULLET_ITEM.exec(source);
  if (bullet !== null) {
    // `•` replaces the marker CHARACTER and the whitespace after it is kept
    // verbatim, so a two-column nesting indent stays exactly where it was.
    return line([
      span(`${bullet[1] ?? ''}•${bullet[2] ?? ' '}`, PLAIN),
      ...inlineRuns(bullet[3] ?? '', PLAIN),
    ]);
  }

  const ordered = ORDERED_ITEM.exec(source);
  if (ordered !== null) {
    return line([
      span(`${ordered[1] ?? ''}${ordered[2] ?? ''}${ordered[3] ?? ' '}`, PLAIN),
      ...inlineRuns(ordered[4] ?? '', PLAIN),
    ]);
  }

  return line(inlineRuns(source, PLAIN));
}

/**
 * A `bb_rich` body as the rows the cockpit draws — the one entry point.
 *
 * The block state is a single open-fence flag, held across the lines of THIS
 * call only. That bound is load-bearing: the flat `Comments` section renders
 * every comment's body, and one stateful pass across all of them would let an
 * unterminated fence in one comment swallow the next (D3's rejected
 * alternative).
 *
 * A fence's own rows are DROPPED, so a fenced body renders two rows fewer than
 * its source has lines — the number `descriptionSummary`'s `… +N more lines`
 * counts, because it is the number expanding actually produces (D8/R8). An
 * UNTERMINATED fence loses its opening row to that same rule: under CommonMark
 * the row opens a code block whose info string is metadata rather than content,
 * and telling it apart from a closed fence would need look-ahead this one-line-at-
 * a-time pass does not have. It is a NAMED degradation, written out for the
 * operator in the README and in `docs/advanced/cli/ui.md` (AC-4).
 *
 * CRLF IS NORMALISED FIRST, and that is not cosmetic. Every block rule anchors
 * with `$` and matches with `.`, and neither reaches past a trailing `\r`, so a
 * body split on `\n` alone left one on each line and NO block rule matched: a CRLF
 * description — which is what the control plane's web form writes — rendered with
 * the inline rules only. A lone `\r` is a line ending too, as CommonMark has it.
 */
export function markdownLines(body: string): MarkdownLine[] {
  const out: MarkdownLine[] = [];
  let fence: { char: string; length: number } | null = null;
  let blockStart = true;
  for (const source of body.replace(/\r\n?/g, '\n').split('\n')) {
    if (fence !== null) {
      const close = FENCE_CLOSE.exec(source);
      if (
        close !== null &&
        (close[1] ?? '').startsWith(fence.char) &&
        (close[1] ?? '').length >= fence.length
      ) {
        fence = null;
        blockStart = true;
        continue;
      }
      // Content, held two columns in and drawn in the cockpit's accent colour —
      // and NOT parsed: a `## ` inside a fence is a comment in some language.
      out.push(
        line(
          source === ''
            ? [{ text: FENCE_INDENT }]
            : [{ text: FENCE_INDENT }, span(source, { ...PLAIN, code: true })],
        ),
      );
      continue;
    }
    const open = FENCE_OPEN.exec(source);
    // A BACKTICK fence's info string may not contain a backtick — CommonMark's
    // rule, and the reason ```` ```code``` ```` is a paragraph holding a code span
    // rather than an opener. Reading it as one dropped the row and emitted
    // nothing at all: an empty rendering for a non-empty body, which is the ONE
    // outcome the invariant at the top of this file rules out. Falling through to
    // `blockLine` renders the code span the author wrote. A TILDE fence carries no
    // such restriction, so `~~~a~~~b` opens one and the guard must not reach it.
    const marker = open?.[1] ?? '';
    const opensFence =
      marker !== '' && (marker[0] !== '`' || !(open?.[2] ?? '').includes('`'));
    if (opensFence) {
      fence = { char: marker[0] as string, length: marker.length };
      blockStart = false;
      continue;
    }
    out.push(blockLine(source, blockStart));
    blockStart = source.trim() === '';
  }
  return out;
}
