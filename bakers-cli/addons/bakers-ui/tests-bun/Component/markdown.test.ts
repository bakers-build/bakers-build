import { describe, expect, it } from 'bun:test';
import type { VNode } from '@opentui/core';
import {
  Markdown,
  MarkdownLines,
  markdownLines,
} from '../../src/Component/markdown/index.js';
import {
  BORDER,
  FOREGROUND,
  FOREGROUND_HIGHLIGHT,
} from '../../src/lib/theme.js';
import { type PaintedSpan, paintTree } from '../paint-tree.js';

/** The bit values of `@opentui/core@0.5.1`'s `createTextAttributes`. */
const BOLD_BIT = 1;
const ITALIC_BIT = 4;

const DIM_BIT = 2;
const CODE = BORDER;
const HEADING = FOREGROUND_HIGHLIGHT;

const WIDTHS = [60, 140] as const;

type Span = PaintedSpan;

const paint = (build: () => VNode, width: number, height = 24) =>
  paintTree(build, width, height);

const paintBody = (body: string, width: number) =>
  paint(() => Markdown({ id: 'markdown', source: body, width }), width);

const allSpans = (spans: Span[][]): Span[] => spans.flat();

const runOf = (spans: Span[][], text: string): Span | undefined =>
  allSpans(spans).find((span) => span.text === text) ??
  allSpans(spans).find((span) => span.text.includes(text));

const visibleText = (rows: string[]): string =>
  rows
    .map((row) => row.replace(/\s+$/, ''))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

describe('the native Markdown painter', () => {
  it('pins the production parser texts the renderer must show', () => {
    expect(markdownLines('- [x] shipped')[0]?.text).toContain('☑ shipped');
    expect(markdownLines('snake_case __init__')[0]?.text).toBe(
      'snake_case __init__',
    );
    expect(markdownLines('~~~ts\r\n**literal**\r\n~~~')[0]?.text).toContain(
      '**literal**',
    );
    expect(markdownLines('# **Heading**')[0]?.text).toBe('Heading');
  });

  it.each(WIDTHS)('paints those parser texts at %i columns', async (width) => {
    const shipped = await paintBody('- [x] shipped', width);
    expect(shipped.frame).toContain('☑ shipped');
    expect(shipped.frame).not.toContain('[x]');

    const ident = await paintBody('snake_case __init__', width);
    expect(ident.frame).toContain('snake_case __init__');

    const fence = await paintBody('~~~ts\r\n**literal**\r\n~~~', width);
    expect(fence.frame).toContain('**literal**');

    const heading = await paintBody('# **Heading**', width);
    expect(heading.frame).toContain('Heading');
    expect(heading.frame).not.toContain('**');
    expect(runOf(heading.spans, 'Heading')?.attributes).toBe(BOLD_BIT);
    expect(runOf(heading.spans, 'Heading')?.fg.equals(HEADING)).toBe(true);
  });

  it.each(
    WIDTHS,
  )('paints ATX headings 1–6 without markers at %i columns', async (width) => {
    for (let level = 1; level <= 6; level += 1) {
      const body = `${'#'.repeat(level)} Title ${level}`;
      expect(markdownLines(body)[0]?.text).toBe(`Title ${level}`);
      const painted = await paintBody(body, width);
      expect(painted.frame).toContain(`Title ${level}`);
      expect(painted.frame).not.toContain('#'.repeat(level));
      const run = runOf(painted.spans, `Title ${level}`);
      expect(run?.attributes, `level ${level} is bold`).toBe(BOLD_BIT);
      expect(run?.fg.equals(HEADING), `level ${level} uses primary`).toBe(true);
    }
  });

  it.each(
    WIDTHS,
  )('paints combined marks and leaves identifiers literal at %i columns', async (width) => {
    const combined = await paintBody('***both*** and **_also_**', width);
    expect(visibleText(combined.rows)).toContain('both and also');
    expect(combined.frame).not.toContain('***');
    expect(runOf(combined.spans, 'both')?.attributes).toBe(
      BOLD_BIT | ITALIC_BIT,
    );
    expect(runOf(combined.spans, 'also')?.attributes).toBe(
      BOLD_BIT | ITALIC_BIT,
    );

    const ident = await paintBody('snake_case feat/a_b_c __init__', width);
    expect(ident.frame).toContain('snake_case feat/a_b_c __init__');
    expect(runOf(ident.spans, 'snake_case')?.attributes ?? 0).toBe(0);
  });

  it.each(
    WIDTHS,
  )('paints nested lists and task boxes at %i columns', async (width) => {
    const body = [
      '- outer',
      '  - nested',
      '- [ ] open',
      '  - [x] done',
      '1. first',
    ].join('\n');
    const painted = await paintBody(body, width);
    const expected = markdownLines(body).map((line) => line.text);
    expect(expected).toEqual([
      '• outer',
      '  • nested',
      '☐ open',
      '  ☑ done',
      '1. first',
    ]);
    for (const line of expected) {
      expect(painted.frame).toContain(line);
    }
    expect(painted.frame).not.toContain('[ ]');
    expect(painted.frame).not.toContain('[x]');
  });

  it.each(WIDTHS)('paints nested quotes dim at %i columns', async (width) => {
    const body = '> quoted\n>> nested';
    const painted = await paintBody(body, width);
    expect(painted.frame).toContain('│ quoted');
    expect(painted.frame).toContain('│ │ nested');
    expect(runOf(painted.spans, 'quoted')?.fg.equals(FOREGROUND)).toBe(true);
    expect((runOf(painted.spans, 'quoted')?.attributes ?? 0) & DIM_BIT).toBe(
      DIM_BIT,
    );
    expect(runOf(painted.spans, 'nested')?.fg.equals(FOREGROUND)).toBe(true);
    expect((runOf(painted.spans, 'nested')?.attributes ?? 0) & DIM_BIT).toBe(
      DIM_BIT,
    );
  });

  it.each(
    WIDTHS,
  )('paints links, images and autolinks at %i columns', async (width) => {
    const link = await paintBody('[the MR](https://example.test/mr)', width);
    expect(markdownLines('[the MR](https://example.test/mr)')[0]?.text).toBe(
      'the MR (https://example.test/mr)',
    );
    expect(link.frame).toContain('the MR (https://example.test/mr)');

    const image = await paintBody(
      '![diagram](https://example.test/d.png)',
      width,
    );
    expect(image.frame).toContain('diagram (https://example.test/d.png)');
    expect(image.frame).not.toContain('![');

    const auto = await paintBody('<https://example.test/a>', width);
    expect(auto.frame).toContain('https://example.test/a');
    expect(auto.frame).not.toContain('<https://example.test/a>');
  });

  it.each(
    WIDTHS,
  )('paints escaped markers as literal characters at %i columns', async (width) => {
    const body = '\\*not em\\* and \\`not code\\`';
    const painted = await paintBody(body, width);
    expect(markdownLines(body)[0]?.text).toBe('*not em* and `not code`');
    expect(painted.frame).toContain('*not em* and `not code`');
    expect(runOf(painted.spans, '*not em*')?.attributes ?? 0).toBe(0);
  });

  it.each(
    WIDTHS,
  )('paints inline code, strike and emphasis flags at %i columns', async (width) => {
    const body =
      'A **bold** word, an *italic* one, `inline code` and ~~struck~~.';
    const painted = await paintBody(body, width);
    expect(visibleText(painted.rows)).toContain(
      'A bold word, an italic one, inline code and struck.',
    );
    expect(painted.frame).not.toMatch(/\*\*|~~|`/);
    expect(runOf(painted.spans, 'bold')?.attributes).toBe(BOLD_BIT);
    expect(runOf(painted.spans, 'italic')?.attributes).toBe(ITALIC_BIT);
    expect(runOf(painted.spans, 'struck')?.fg.equals(FOREGROUND)).toBe(true);
    expect((runOf(painted.spans, 'struck')?.attributes ?? 0) & DIM_BIT).toBe(
      DIM_BIT,
    );
    expect(runOf(painted.spans, 'inline code')?.fg.equals(CODE)).toBe(true);
  });

  it.each(
    WIDTHS,
  )('paints backtick and tilde fences as literal indented code at %i columns', async (width) => {
    const backtick = await paintBody('```ts\nconst x = 1;\n```', width);
    expect(markdownLines('```ts\nconst x = 1;\n```')[0]?.text).toContain(
      'const x = 1;',
    );
    expect(backtick.frame).toContain('  const x = 1;');
    expect(backtick.frame).not.toContain('```');
    expect(runOf(backtick.spans, 'const x = 1;')?.fg.equals(CODE)).toBe(true);

    const tilde = await paintBody('~~~~ts\n**literal**\n~~~~', width);
    expect(tilde.frame).toContain('  **literal**');
    expect(tilde.frame).not.toContain('~~~~');
  });

  it('parses a closed or unterminated fence only within its own body', async () => {
    const open = '```ts\nconst swallowed = true;\n## not a heading';
    const heading = '## Safe heading';
    expect(markdownLines(open).map((line) => line.text)).toEqual([
      '  const swallowed = true;',
      '  ## not a heading',
    ]);
    expect(markdownLines(heading)[0]?.text).toBe('Safe heading');

    const openPaint = await paintBody(open, 60);
    const headingPaint = await paintBody(heading, 60);
    expect(openPaint.frame).toContain('const swallowed = true;');
    expect(openPaint.frame).toContain('## not a heading');
    expect(openPaint.frame).not.toContain('Safe heading');
    expect(headingPaint.frame).toContain('Safe heading');
    expect(headingPaint.frame).not.toContain('swallowed');
    expect(runOf(headingPaint.spans, 'Safe heading')?.attributes).toBe(
      BOLD_BIT,
    );
  });

  it.each(
    WIDTHS,
  )('keeps a blank source line as a blank painted row at %i columns', async (width) => {
    const painted = await paintBody('before\n\nafter', width);
    expect(markdownLines('before\n\nafter').map((line) => line.text)).toEqual([
      'before',
      '',
      'after',
    ]);
    const trimmed = painted.rows.map((row) => row.replace(/\s+$/, ''));
    const first = trimmed.findIndex((row) => row.includes('before'));
    const second = trimmed.findIndex((row) => row.includes('after'));
    expect(first).toBeGreaterThanOrEqual(0);
    expect(second).toBe(first + 2);
    expect(trimmed[first + 1]).toBe('');
  });

  it.each(
    WIDTHS,
  )('paints already-parsed lines without a source round trip at %i columns', async (width) => {
    const body = [
      '# **Heading**',
      '',
      '- [x] shipped',
      '~~~ts',
      '**literal**',
      '~~~',
    ].join('\n');
    const lines = markdownLines(body);
    const fromSource = await paintBody(body, width);
    const fromLines = await paint(
      () => MarkdownLines({ id: 'markdown', width, lines }),
      width,
    );
    expect(visibleText(fromLines.rows)).toBe(visibleText(fromSource.rows));
    expect(fromLines.frame).toContain('Heading');
    expect(fromLines.frame).toContain('☑ shipped');
    expect(fromLines.frame).toContain('**literal**');
    expect(runOf(fromLines.spans, 'Heading')?.attributes).toBe(BOLD_BIT);
  });

  it('wraps a long paragraph at 60 columns and keeps it one row at 140', async () => {
    const body =
      'A reasonably long paragraph that should wrap at sixty columns while remaining a single painted row at one hundred forty.';
    expect(markdownLines(body)).toHaveLength(1);
    const narrow = await paintBody(body, 60);
    const wide = await paintBody(body, 140);
    const occupied = (rows: string[]): number =>
      rows.filter((row) => row.replace(/\s+$/, '') !== '').length;
    expect(occupied(narrow.rows)).toBeGreaterThan(1);
    expect(occupied(wide.rows)).toBe(1);
    expect(visibleText(narrow.rows)).toContain(
      markdownLines(body)[0]?.text ?? '',
    );
    expect(visibleText(wide.rows)).toContain(
      markdownLines(body)[0]?.text ?? '',
    );
  });
});
