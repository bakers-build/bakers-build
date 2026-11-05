// BB-372 V1 — the Markdown subset the TUI ticket detail renders, and every
// degradation of it (spec D2).
//
// The module under test is PURE TEXT: a body string in, one `MarkdownLine` per
// physical source line out. That is what makes this file the primary evidence
// for the subset — the row vocabulary, the producers and the real renderer all
// consume what these cases pin, so a construct asserted here cannot render
// differently in the tree than in `bakers ui <id> | cat` (D4).
//
// THE ONE INVARIANT THAT MATTERS (D2, R4): the rendering only ever deletes
// markers it MATCHED and inserts the prefixes D2 names. An unrecognised or
// unbalanced construct passes through unchanged. A mis-parse may lose a MARKER;
// it may never lose a CHARACTER OF CONTENT. `never eats content` below is that
// invariant as a test class of its own.

import { describe, expect, it } from 'vitest';
import type { MarkdownLine, MarkdownSpan } from '../../src/lib/markdown.js';
import { markdownLines } from '../../src/lib/markdown.js';

/** The one rendered line of a one-line body. */
const one = (source: string): MarkdownLine => {
  const lines = markdownLines(source);
  expect(
    lines,
    `one source line renders one row: ${JSON.stringify(source)}`,
  ).toHaveLength(1);
  return lines[0] as MarkdownLine;
};

/** The rendered text of a one-line body — what the pipe prints (D4). */
const text = (source: string): string => one(source).text;

/** The style flags a span carries, as a sorted, readable list. */
const flagsOf = (span: MarkdownSpan): string[] =>
  (['bold', 'italic', 'dim', 'code'] as const).filter(
    (flag) => span[flag] === true,
  );

/** One line as `[text, flags]` pairs — the whole styling of the row. */
const runs = (source: string): [string, string[]][] =>
  one(source).spans.map((span) => [span.text, flagsOf(span)]);

/** The rendered text of every row of a multi-line body. */
const rendered = (body: string): string[] =>
  markdownLines(body).map((line) => line.text);

// ─── the spans always concatenate to the text ────────────────────────────────

describe('the row surface and the styled surface never disagree', () => {
  // `MarkdownLine.text` IS the spans concatenated (D1). The pipe prints `text`
  // and the tree paints the spans, so a line whose spans do not add up to its
  // text is the two surfaces silently drifting apart.
  it('every line`s spans concatenate to its text, character for character', () => {
    const body = [
      '## A heading',
      '',
      'prose with **bold**, *em*, `code` and a [link](https://x.test/a).',
      '',
      '- a bullet',
      '- [ ] a task',
      '- [x] a done task',
      '1. an ordered item',
      '> a quote',
      '>> a nested quote',
      '---',
      '',
      '```ts',
      'const x = 1;',
      '```',
      '~~struck~~',
      '<https://x.test/auto>',
      'snake_case and feat/a_b_c',
      '\\*not em\\*',
      '| a | **b** |',
    ].join('\n');
    for (const line of markdownLines(body)) {
      expect(
        line.spans.map((span) => span.text).join(''),
        `spans of ${JSON.stringify(line.text)} must concatenate to it`,
      ).toBe(line.text);
    }
  });
});

// ─── ATX headings ───────────────────────────────────────────────────────────

describe('an ATX heading', () => {
  it('strips its markers at every level and declares itself a heading', () => {
    for (let level = 1; level <= 6; level += 1) {
      const line = one(`${'#'.repeat(level)} Goal`);
      expect(line.text, `level ${level}`).toBe('Goal');
      expect(line.heading, `level ${level} is a heading`).toBe(true);
      expect(line.spans, `level ${level} is one span`).toHaveLength(1);
    }
  });

  it('strips a CLOSING run of hashes too', () => {
    expect(text('## Goal ##')).toBe('Goal');
    expect(text('###### deep ######')).toBe('deep');
  });

  it('is not a heading without the space CommonMark asks for', () => {
    // `#844` is a run number, not a heading. The columned run rows never reach
    // this module at all (D3), but a body line may say `#4599` too.
    expect(one('#844 is a run').heading).toBe(false);
    expect(text('#844 is a run')).toBe('#844 is a run');
    expect(one('#hashtag').heading).toBe(false);
    expect(text('#hashtag')).toBe('#hashtag');
  });

  it('is ONE span when its content is plain, which is the ordinary heading', () => {
    // D2: a heading is "markers stripped, the whole row bold, heading: true", and
    // the row's weight is `SectionRow.bold` — not a span flag. So an ordinary
    // heading is exactly one unstyled span and the row carries the weight.
    expect(runs('## Context')).toEqual([['Context', []]]);
  });

  it('DOES run its content through the inline rules — measured on a live ticket', () => {
    // MEASURED, and the reason this differs from the plan's Task 1 wording ("one
    // span"): the PTY walk of the real BB-372 detail
    // (`node tests/pty/verify-markdown.mjs --ticket BB-372`; BB-371 D2 makes
    // the command the durable record) found a raw backtick on the
    // most-read row of the Comments tab — the collapsed header
    // `▸ spec · cw · 1h ago · Design — … every ` + '`bb_rich`' + ` body as
    // Markdown`, whose preview is that comment's ATX first line (D8).
    //
    // A heading that is not inline-rendered therefore leaves EXACTLY the defect
    // AC-1/AC-2 forbid, on a surface the operator reads constantly, and D2's
    // degradation list does not name it — so it would be an UNDOCUMENTED
    // degradation, which is the one thing AC-4 rules out. D2's "markers stripped"
    // is read as all of them.
    //
    // Nothing else about a heading changes: `heading` is still true, the row is
    // still bold as a whole, and a plain heading is still one span (above).
    expect(runs('## `bb_rich` bodies')).toEqual([
      ['bb_rich', ['code']],
      [' bodies', []],
    ]);
    expect(text('## a **strong** heading')).toBe('a strong heading');
    // And the R4 invariant still holds inside a heading.
    expect(text('## an unbalanced ** heading')).toBe(
      'an unbalanced ** heading',
    );
  });

  it('is not a heading past three columns of indent', () => {
    expect(one('    # indented four').heading).toBe(false);
  });
});

// ─── emphasis ───────────────────────────────────────────────────────────────

describe('emphasis', () => {
  it('renders **strong** bold with the markers gone', () => {
    expect(runs('**strong**')).toEqual([['strong', ['bold']]]);
    expect(runs('a **strong** b')).toEqual([
      ['a ', []],
      ['strong', ['bold']],
      [' b', []],
    ]);
  });

  it('renders *em* and _em_ italic', () => {
    expect(runs('*em*')).toEqual([['em', ['italic']]]);
    expect(runs('_em_')).toEqual([['em', ['italic']]]);
  });

  it('renders ***both*** and **_both_** bold AND italic', () => {
    expect(runs('***both***')).toEqual([['both', ['bold', 'italic']]]);
    expect(runs('**_both_**')).toEqual([['both', ['bold', 'italic']]]);
  });

  it('consumes a delimiter run SYMMETRICALLY and leaves the surplus literal', () => {
    // A run longer than the three delimiters this subset can spend used to be
    // eaten WHOLE on the opening side while the closing side gave its surplus
    // back, so `****x****` rendered `x*` — one stray marker, from one side only.
    // The rule now spends the same three delimiters at each inner edge and hands
    // the surplus back as literal text at both, which is what the invariant above
    // asks for: a marker the rule did not MATCH is not a marker it may delete.
    expect(text('****x****')).toBe('*x*');
    expect(runs('****x****')).toEqual([
      ['*', []],
      ['x', ['bold', 'italic']],
      ['*', []],
    ]);
  });

  it('renders ~~struck~~ DIM, not strikethrough (D7)', () => {
    // D7: `strikethrough` would widen the wire vocabulary a second time for a
    // construct bakers.build bodies barely use, so `~~` takes `dim`.
    expect(runs('~~struck~~')).toEqual([['struck', ['dim']]]);
  });
});

// ─── code spans ─────────────────────────────────────────────────────────────

describe('a code span', () => {
  it('drops its backticks and marks the span as code', () => {
    expect(runs('`code`')).toEqual([['code', ['code']]]);
  });

  it('can hold a backtick when it is fenced by two', () => {
    expect(runs('``code with a ` inside``')).toEqual([
      ['code with a ` inside', ['code']],
    ]);
  });

  it('resolves FIRST, so markers inside it survive as literal text', () => {
    // Order of resolution (D1/plan): escapes → code → links → strong → em →
    // strike. A code span holding `**` must keep its asterisks: an operator
    // pasting `**` into backticks means the characters.
    expect(runs('`**not bold**`')).toEqual([['**not bold**', ['code']]]);
    expect(runs('a `_x_` b')).toEqual([
      ['a ', []],
      ['_x_', ['code']],
      [' b', []],
    ]);
  });
});

// ─── lists ──────────────────────────────────────────────────────────────────

describe('a list item', () => {
  it('renders `-`, `*` and `+` as a bullet at its own indent', () => {
    expect(text('- one')).toBe('• one');
    expect(text('* one')).toBe('• one');
    expect(text('+ one')).toBe('• one');
    expect(text('  - two columns in')).toBe('  • two columns in');
    expect(text('    - four columns in')).toBe('    • four columns in');
  });

  it('renders a task item as a box, ticked or not', () => {
    expect(text('- [ ] open')).toBe('☐ open');
    expect(text('- [x] done')).toBe('☑ done');
    expect(text('- [X] done')).toBe('☑ done');
    expect(text('  - [ ] nested open')).toBe('  ☐ nested open');
  });

  it('keeps an ordered marker verbatim', () => {
    expect(text('1. first')).toBe('1. first');
    expect(text('1) first')).toBe('1) first');
    expect(text('  10. tenth')).toBe('  10. tenth');
  });

  it('renders the item`s CONTENT through the inline rules', () => {
    expect(runs('- a **bold** item')).toEqual([
      ['• ', []],
      ['a ', []],
      ['bold', ['bold']],
      [' item', []],
    ]);
    expect(runs('- [ ] **AC-1** holds')).toEqual([
      ['☐ ', []],
      ['AC-1', ['bold']],
      [' holds', []],
    ]);
  });

  it('renders the box of a task item that carries no text at all', () => {
    // `- [x]` with nothing after it is still a task item. The rule used to demand
    // whitespace after the `]`, so the line fell through to the bullet rule and
    // came out as `• [x]` — the box marker shown as prose. Nothing is inserted
    // where the source had nothing: the box is the whole row.
    expect(text('- [x]')).toBe('☑');
    expect(text('- [ ]')).toBe('☐');
    expect(text('  - [X]')).toBe('  ☑');
    // The whitespace is still REQUIRED for a row that has text, so a line the
    // rule cannot claim keeps every character it wrote.
    expect(text('- [x]done')).toBe('• [x]done');
  });

  it('is not a list item without the space after the marker', () => {
    expect(text('-not a bullet')).toBe('-not a bullet');
    expect(text('1.not ordered')).toBe('1.not ordered');
  });
});

// ─── fenced blocks ──────────────────────────────────────────────────────────

describe('a fenced block', () => {
  it('drops the fence rows and draws the content indented as code', () => {
    expect(rendered('```\nplain\n```')).toEqual(['  plain']);
    expect(rendered('```ts\nconst x = 1;\n```')).toEqual(['  const x = 1;']);
    expect(rendered('~~~\ntilde\n~~~')).toEqual(['  tilde']);
    const [row] = markdownLines('```\ncode\n```');
    expect(row?.spans.map((span) => [span.text, flagsOf(span)])).toEqual([
      ['  ', []],
      ['code', ['code']],
    ]);
  });

  it('does NOT parse its content as Markdown', () => {
    const lines = markdownLines(
      '```md\n## not a heading\n- not a bullet\n**not bold**\n```',
    );
    expect(lines.map((line) => line.text)).toEqual([
      '  ## not a heading',
      '  - not a bullet',
      '  **not bold**',
    ]);
    for (const line of lines) {
      expect(line.heading, 'nothing inside a fence is a heading').toBe(false);
    }
  });

  it('is NOT opened by a BACKTICK fence whose info string holds a backtick', () => {
    // CommonMark forbids a backtick in a backtick fence's info string, exactly so
    // that ```` ```code``` ```` stays a paragraph holding a code span. Reading it
    // as an opener dropped the row and emitted NOTHING — an empty rendering for a
    // non-empty body, which is the one outcome the R4 invariant rules out, and a
    // regression against the raw line the screen printed before this renderer.
    expect(runs('```code```')).toEqual([['code', ['code']]]);
    expect(rendered('```code``` and more')).toEqual(['code and more']);
    // A TILDE fence carries no such restriction, so `~~~a~~~b` opens one.
    expect(rendered('~~~a~~~b\ninside\n~~~')).toEqual(['  inside']);
    // And an ordinary info string still opens a backtick fence.
    expect(rendered('```ts\nconst x = 1;\n```')).toEqual(['  const x = 1;']);
  });

  it('DROPS the opening row of an UNTERMINATED fence — a named degradation', () => {
    // Deliberate, and documented in the README and in the reference (AC-4): under
    // CommonMark that row opens a code block whose info string is METADATA rather
    // than content, so it is dropped by the same rule that drops every other fence
    // row. Recognising it would need look-ahead over the rest of the body, which
    // the one-line-at-a-time block pass does not have and is not being given.
    expect(rendered('before\n```json')).toEqual(['before']);
    expect(rendered('```json')).toEqual([]);
  });

  it('runs an UNTERMINATED fence to the end of the body and never past it', () => {
    expect(rendered('before\n```\nstill code\n## still code')).toEqual([
      'before',
      '  still code',
      '  ## still code',
    ]);
    // The open-fence flag is held across the lines of ONE call only, so a body
    // whose fence never closes cannot swallow the next body — which is what the
    // flat `Comments` section would do with one stateful pass over all comments
    // (D3's rejected alternative).
    expect(rendered('## a heading after it')).toEqual(['a heading after it']);
  });
});

// ─── line endings ───────────────────────────────────────────────────────────

describe('a body whose line endings are not bare LF', () => {
  const BODY = [
    '## Goal',
    '',
    'prose with **bold** and `code`',
    '- a bullet',
    '- [ ] a task',
    '```ts',
    'const x = 1;',
    '```',
    '> quoted',
    '---',
  ].join('\n');

  it('renders CRLF exactly as it renders LF', () => {
    // A description authored through the control plane's web form arrives CRLF.
    // Every BLOCK rule anchors with `$` and matches with `.`, and neither reaches
    // past a trailing `\r`, so a CRLF body used to bypass the whole block pass:
    // no heading stripped, no bullet, no task box, no fence recognised, and a
    // stray `\r` left in the row's text. Normalising at the entry point is what
    // makes the two authoring paths one rendering.
    expect(rendered(BODY.replace(/\n/g, '\r\n'))).toEqual(rendered(BODY));
  });

  it('treats a lone CR as a line ending, as CommonMark does', () => {
    expect(rendered('## Goal\r- a bullet')).toEqual(['Goal', '• a bullet']);
  });

  it('leaves no carriage return in any rendered row', () => {
    for (const row of markdownLines(BODY.replace(/\n/g, '\r\n'))) {
      expect(row.text, 'a `\\r` is a line ending, never content').not.toContain(
        '\r',
      );
    }
  });
});

// ─── block quotes ───────────────────────────────────────────────────────────

describe('a block quote', () => {
  it('renders one bar per level and dims the quoted text', () => {
    expect(text('> quoted')).toBe('│ quoted');
    expect(text('>> nested')).toBe('│ │ nested');
    expect(text('>quoted')).toBe('│ quoted');
    for (const span of one('> quoted').spans) {
      expect(flagsOf(span), 'the whole quoted row is dim').toContain('dim');
    }
  });

  it('still renders the quoted content`s own inline styling', () => {
    expect(runs('> a **bold** quote')).toEqual([
      ['│ ', ['dim']],
      ['a ', ['dim']],
      ['bold', ['bold', 'dim']],
      [' quote', ['dim']],
    ]);
  });
});

// ─── thematic breaks ────────────────────────────────────────────────────────

describe('a thematic break', () => {
  it('renders a fixed eight-column rule, dim', () => {
    for (const source of ['---', '***', '___', '-----']) {
      expect(rendered(`\n${source}`)[1], source).toBe('────────');
      expect(
        flagsOf(markdownLines(`\n${source}`)[1]?.spans[0] as MarkdownSpan),
        source,
      ).toEqual(['dim']);
    }
  });

  it('leaves a SETEXT underline raw — the degradation D2 names', () => {
    // `---` under a paragraph line is a setext heading in CommonMark, and setext
    // headings are an explicit degradation: rendered raw, character for
    // character. A break is therefore only recognised where a block can START —
    // at the top of the body or after a blank line — which is the one extra
    // piece of look-back this rule needs and the whole of it.
    expect(rendered('Title\n---')).toEqual(['Title', '---']);
    expect(rendered('Title\n===')).toEqual(['Title', '===']);
    expect(rendered('Title\n\n---')).toEqual(['Title', '', '────────']);
  });
});

// ─── links ──────────────────────────────────────────────────────────────────

describe('a link', () => {
  it('renders `text (url)` — the address stays in the TEXT (D6)', () => {
    // Rejected alternative: show the label alone and hang the OSC 8 link on it.
    // `bakers ui <id> | cat` is read by humans AND by agents and carries no OSC 8
    // at all, so deleting the address from the text is silent data loss there.
    expect(text('[the MR](https://x.test/mr/1)')).toBe(
      'the MR (https://x.test/mr/1)',
    );
    expect(text('![a diagram](https://x.test/d.png)')).toBe(
      'a diagram (https://x.test/d.png)',
    );
  });

  it('unwraps an autolink to the bare address', () => {
    expect(text('<https://x.test/a>')).toBe('https://x.test/a');
  });

  it('leaves a bare address exactly as it is', () => {
    // `lib/hyperlink.ts` already makes it an OSC 8 link on the rendered text,
    // so there is nothing for this module to do.
    expect(text('see https://x.test/a for it')).toBe(
      'see https://x.test/a for it',
    );
  });

  it('renders the label`s own inline styling', () => {
    expect(runs('[**bold** label](https://x.test/a)')).toEqual([
      ['bold', ['bold']],
      [' label', []],
      [' (https://x.test/a)', []],
    ]);
  });
});

// ─── escapes ────────────────────────────────────────────────────────────────

describe('a backslash escape', () => {
  it('yields the literal character and consumes exactly one backslash', () => {
    expect(runs('\\*not em\\*')).toEqual([['*not em*', []]]);
    expect(text('\\_not em\\_')).toBe('_not em_');
    expect(text('\\`not code\\`')).toBe('`not code`');
    expect(text('\\[not a link\\]')).toBe('[not a link]');
    expect(text('\\~\\~not struck\\~\\~')).toBe('~~not struck~~');
    expect(text('a \\\\ backslash')).toBe('a \\ backslash');
  });

  it('leaves a backslash before an unescapable character alone', () => {
    expect(text('C:\\path\\to')).toBe('C:\\path\\to');
    expect(text('a trailing \\')).toBe('a trailing \\');
  });
});

// ─── R4 — the parser never eats content ─────────────────────────────────────

describe('R4 — an unbalanced construct comes back character for character', () => {
  // THE failure mode that matters. Every rule rejects rather than guesses when
  // it cannot resolve its construct, so the source characters survive.
  // `***` and `****` are deliberately IN PROSE here rather than alone on a line:
  // alone at a block start they are a thematic break, which is a rule of D2's
  // table and not an unbalanced construct. Surrounded by spaces they cannot open
  // emphasis (CommonMark's flanking rule), so the characters survive.
  const UNBALANCED = [
    '*',
    '**',
    'a *** b',
    'a **** b',
    '_',
    '__',
    '`',
    '``',
    '~~',
    '[',
    ']',
    '](',
    '**bold with no end',
    'trailing bold**',
    '*em with no end',
    '`code with no end',
    '~~struck with no end',
    '[label](no closing paren',
    '[label] (spaced)',
    '<not-an-autolink>',
    '<https://x.test/a',
    'a * b ** c _ d ` e ~~ f',
    '2 * 3 * 4 = 24',
  ];

  it.each(UNBALANCED)('leaves %j untouched', (source) => {
    expect(text(source)).toBe(source);
  });

  it('leaves a GFM table row raw — the degradation D2 names', () => {
    // `bb_rich` cannot render a pipe table either (the control plane's own
    // Markdown filter makes one `<p>`), and a row is one physical line here, so
    // there is no block for a table to be.
    expect(text('| a | b |')).toBe('| a | b |');
    expect(text('|---|---|')).toBe('|---|---|');
  });

  it('leaves raw HTML, a reference link and a footnote raw', () => {
    expect(text('<b>bold</b>')).toBe('<b>bold</b>');
    expect(text('[label][ref]')).toBe('[label][ref]');
    expect(text('[ref]: https://x.test/a')).toBe('[ref]: https://x.test/a');
    expect(text('a footnote[^1]')).toBe('a footnote[^1]');
  });

  it('never loses a content character — INCLUDING A SPACE — of a real body', () => {
    // The invariant stated as a property rather than as a case list: strip the
    // characters the rules are ALLOWED to delete from the source, strip the
    // prefixes they are allowed to INSERT from the rendering, and what is left
    // must be identical.
    const body = [
      '## Context',
      'The **gist** of it, with `code` and a [link](https://x.test/a).',
      '- [ ] **AC-1** the *first* one',
      '> a ~~struck~~ quote',
      'snake_case, feat/a_b_c, 2 * 3, a_b__c, C:\\path',
      'an unbalanced ** and a lone ` and a [',
      '```code``` is a code span, not a fence',
    ].join('\n');
    // A SPACE IS CONTENT, and the first form of this helper could not see one go
    // missing: it erased whitespace outright, so it only ever proved that no
    // non-whitespace character was lost. Every marker is therefore replaced BY a
    // space rather than deleted, and runs of whitespace are then collapsed. That
    // keeps the property green for the re-spacing the rules are entitled to — a
    // bullet's `• `, a task box, a quote bar, the fence indent, the ` (` a link
    // inserts before its address, all of which sit against a marker — while a
    // space lost BETWEEN TWO WORDS still fails it, which is the loss that matters.
    //
    // Two constructs are excluded BY NAME rather than by weakening this helper:
    //   • a TICKED task item (`- [x] …`) — the `x` is part of the marker, not
    //     content, and no character class can say so without erasing a real `x`;
    //   • a FENCED block — its fence rows are dropped, so row `i` no longer lines
    //     up with source line `i`, which is what this loop compares. The fence's
    //     own content is pinned character for character by the fence cases above.
    const strip = (value: string): string =>
      value
        .replace(/[#*_`~[\]()!<>+\-\\•☐☑│─]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    const rows = markdownLines(body);
    // The loop compares row `i` to source line `i`, so the property is only as
    // WIDE as the body while no row is dropped. Asserted rather than assumed: a
    // dropped row shortens the loop, and every line past it would then pass
    // vacuously — which is how a body-eating rule hides from its own property.
    expect(rows, 'every source line of this body renders a row').toHaveLength(
      body.split('\n').length,
    );
    for (const [index, line] of rows.entries()) {
      expect(
        strip(line.text),
        `row ${index} kept every content character`,
      ).toBe(strip(body.split('\n')[index] ?? ''));
    }
  });
});

// ─── R5 — `_` inside identifiers ────────────────────────────────────────────

describe('R5 — `_` is emphasis only at word boundaries', () => {
  it('leaves an identifier alone', () => {
    expect(text('snake_case')).toBe('snake_case');
    expect(text('feat/a_b_c')).toBe('feat/a_b_c');
    expect(text('a_b_c_d')).toBe('a_b_c_d');
  });

  it('leaves `__init__` alone — R5 wins over D2`s `__strong__` row', () => {
    // THE ONE PLACE THIS SPEC CONTRADICTS ITSELF, resolved and documented.
    // `__init__` and `__strong__` are structurally identical: both are a `__`
    // run at a word boundary around an alphanumeric word, and CommonMark reads
    // BOTH as strong. No local rule can tell them apart, so exactly one of D2's
    // `__strong__` row and R5's `__init__` case can hold.
    //
    // R5 wins, because it is the named RISK and because D2's own invariant
    // states the safe direction: a `__…__` run is never emphasis, so a dunder
    // survives, and `**strong**` — which every bakers.build body already uses — is the
    // way to write bold. Documented as a degradation in the README and in
    // `docs/addons/bakers-ui/reference.md` (D10/AC-4).
    expect(text('__init__')).toBe('__init__');
    expect(text('the __init__ method')).toBe('the __init__ method');
    expect(text('__strong__')).toBe('__strong__');
  });

  it('italicises `*` intraword, which keeps CommonMark`s laxer behaviour', () => {
    expect(runs('a*b*c')).toEqual([
      ['a', []],
      ['b', ['italic']],
      ['c', []],
    ]);
  });

  it('still italicises `_em_` at a word boundary', () => {
    expect(runs('an _emphasised_ word')).toEqual([
      ['an ', []],
      ['emphasised', ['italic']],
      [' word', []],
    ]);
    expect(runs('(_parenthesised_)')).toEqual([
      ['(', []],
      ['parenthesised', ['italic']],
      [')', []],
    ]);
  });
});

// ─── the two shell helpers MOVED OUT ─────────────────────────────────────────
//
// BB-372 D11 — `plainMarkdown` and `indentMarkdown` were tested here and now live
// in `Component/markdown/` as `plainLine`/`indentLine`, with their assertions
// restated against the neutral `StyledLine` in
// `tests/Component/markdown/index.test.ts`. Neither ever parsed anything, which is
// why they went with the rendering shell rather than staying with the parser. The
// assertions themselves are unchanged in substance: same texts, same ordering, same
// Fact 9 case (`- [ ] a task` indented four columns is `    ☐ a task`, never a code
// block).

// ─── the whole body ─────────────────────────────────────────────────────────

describe('markdownLines over a body', () => {
  it('renders one row per source line, except the fence rows it drops (R8)', () => {
    expect(markdownLines('a\nb\nc')).toHaveLength(3);
    expect(rendered('')).toEqual(['']);
    expect(rendered('\n')).toEqual(['', '']);
    // R8 — the row count a fenced body renders is what the expand produces, and
    // it is two rows short of the source.
    expect(markdownLines('a\n```\nx\n```\nb')).toHaveLength(3);
  });
});
