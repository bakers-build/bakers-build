// BB-372 D11 — THE SEAM THIS COMPONENT NOW OWNS: span kind → attributes + palette.
//
// The mapping used to live in `lib/vnode.ts`, the package's most-shared render
// primitive: it imported `MarkdownSpan` and decided for itself that `italic: true`
// means `ESC[3m` and `code: true` means BORDER. Nothing caught that —
// `assert-acyclic.mjs` enforces PACKAGE layering and both files sat in `lib/`. The
// mapping moved here, the import direction inverted (component → vnode), and this
// file is the test that mapping now has of its own.
//
// The hard constraint on this component, asserted below and not merely stated: it
// is NOT paint-only. Its output is DATA — rendered text plus resolved styling —
// because the non-interactive pipe prints `row.text` and nothing else. A component
// that emitted only VNodes would cut the pipe off and restore the
// two-renderers-disagree defect this ticket exists to remove (AC-3, D4).

import { describe, expect, it } from 'vitest';
import {
  indentLine,
  markdownLines,
  plainLine,
  styledLineOf,
  styledRunOf,
} from '../../../src/Component/markdown/index.js';
import { markdownLines as parseMarkdown } from '../../../src/lib/markdown.js';
import { BOLD, BORDER, DIM, ITALIC } from '../../../src/lib/vnode.js';

// ─── the mapping, one span kind at a time ────────────────────────────────────

describe('styledRunOf — the span kind → attribute/palette mapping (D7/D11)', () => {
  it('carries the text through untouched', () => {
    expect(styledRunOf({ text: 'plain' }).text).toBe('plain');
  });

  it('an unstyled span asks for nothing at all', () => {
    const run = styledRunOf({ text: 'plain' });
    expect(run.attributes).toBe(0);
    expect(
      run.fg,
      'an unstyled run states no colour of its own',
    ).toBeUndefined();
  });

  it('bold, italic and dim map to their attribute constants', () => {
    expect(styledRunOf({ text: 'b', bold: true }).attributes).toBe(BOLD);
    expect(styledRunOf({ text: 'i', italic: true }).attributes).toBe(ITALIC);
    expect(styledRunOf({ text: 'd', dim: true }).attributes).toBe(DIM);
  });

  it('combines flags into ONE attribute value', () => {
    expect(
      styledRunOf({ text: 'bi', bold: true, italic: true }).attributes,
    ).toBe(BOLD | ITALIC);
  });

  it('a code span is a COLOUR, not an attribute — BORDER (indexed)', () => {
    // D7 / BB-375: code uses indexed BORDER (same slot as FOREGROUND; no cyan).
    const run = styledRunOf({ text: 'code', code: true });
    expect(run.attributes, 'code adds no attribute').toBe(0);
    expect(run.fg).toBe(BORDER);
  });

  it('a code span that is ALSO emphasised keeps both', () => {
    const run = styledRunOf({ text: 'x', code: true, bold: true });
    expect(run.attributes).toBe(BOLD);
    expect(run.fg).toBe(BORDER);
  });
});

// ─── the line, and the pipe constraint ───────────────────────────────────────

describe('styledLineOf — a parsed line as a neutral styled line', () => {
  it('carries the RENDERED TEXT, which is what keeps the pipe honest (D4/AC-3)', () => {
    const [parsed] = parseMarkdown('a **bold** word');
    const line = styledLineOf(parsed as never);
    expect(line.text, 'the pipe prints exactly this').toBe('a bold word');
  });

  it('keeps the heading flag', () => {
    const [heading] = parseMarkdown('## Goal');
    const [prose] = parseMarkdown('Goal');
    expect(styledLineOf(heading as never).heading).toBe(true);
    expect(styledLineOf(prose as never).heading).toBe(false);
  });

  it('maps every span in order, and the runs concatenate to the text', () => {
    const [parsed] = parseMarkdown('a **bold** and `code` word');
    const line = styledLineOf(parsed as never);
    expect(line.runs.map((run) => run.text).join('')).toBe(line.text);
    expect(line.runs.map((run) => [run.text, run.attributes])).toEqual([
      ['a ', 0],
      ['bold', BOLD],
      [' and ', 0],
      ['code', 0],
      [' word', 0],
    ]);
    expect(line.runs[3]?.fg).toBe(BORDER);
  });
});

describe('markdownLines — parse and style in one call', () => {
  it('renders every row of a body, and no row loses a character to the styling', () => {
    const body = [
      '## A heading',
      '',
      'prose with **bold**, *em*, `code` and a [link](https://x.test/a).',
      '',
      '- a bullet',
      '> a quote',
      '~~struck~~',
    ].join('\n');
    const lines = markdownLines(body);
    // Parity with the parser: the styling step may not touch a single glyph, or
    // `bakers ui <id> | cat` and the tree stop being the same rendering (D4).
    expect(lines.map((line) => line.text)).toEqual(
      parseMarkdown(body).map((line) => line.text),
    );
    for (const line of lines) {
      expect(
        line.runs.map((run) => run.text).join(''),
        `runs of ${JSON.stringify(line.text)} must concatenate to it`,
      ).toBe(line.text);
    }
  });

  it('emits DATA, never a VNode — the pipe reads `text` and nothing else', () => {
    for (const line of markdownLines('a **bold** word')) {
      expect(typeof line.text).toBe('string');
      expect(Array.isArray(line.runs)).toBe(true);
    }
  });
});

// ─── the two shell helpers, moved here from `lib/markdown.ts` (D11) ──────────
//
// Neither parses anything: `plainLine` is the plain path as a value and
// `indentLine` prepends blanks to an ALREADY RENDERED line. They are the shell's
// work, not the parser's, which is why they live with the shell now. Their
// assertions are the ones `tests/lib/markdown.test.ts` held, restated against the
// neutral line.

describe('plainLine — a line NOTHING parses (D3)', () => {
  it('is one unstyled run', () => {
    expect(plainLine('x')).toEqual({
      text: 'x',
      runs: [{ text: 'x', attributes: 0 }],
      heading: false,
    });
  });

  it('does not read its argument as Markdown', () => {
    expect(plainLine('## not parsed')).toEqual({
      text: '## not parsed',
      runs: [{ text: '## not parsed', attributes: 0 }],
      heading: false,
    });
  });

  it('an empty line carries no run at all', () => {
    expect(plainLine('')).toEqual({ text: '', runs: [], heading: false });
  });
});

describe('indentLine — the same line held in from the left (D5)', () => {
  const one = (source: string) => markdownLines(source)[0] as never;

  it('prepends the blanks as an unstyled run, keeping the rest in order', () => {
    const indented = indentLine(markdownLines('a **b**')[0] as never, 4);
    expect(indented.text).toBe('    a b');
    expect(indented.runs.map((run) => [run.text, run.attributes])).toEqual([
      ['    ', 0],
      ['a ', 0],
      ['b', BOLD],
    ]);
  });

  it('keeps the heading flag', () => {
    expect(indentLine(one('## Outcome'), 4)).toEqual({
      text: '    Outcome',
      runs: [
        { text: '    ', attributes: 0 },
        { text: 'Outcome', attributes: 0 },
      ],
      heading: true,
    });
  });

  it('indents AFTER rendering, so four spaces can never become a code block', () => {
    // Fact 9: four leading spaces prepended to SOURCE is an indented code block
    // in CommonMark. Applying the indent to the rendered line is what makes that
    // impossible rather than merely unlikely.
    expect(indentLine(one('- [ ] a task'), 4).text).toBe('    ☐ a task');
  });
});
