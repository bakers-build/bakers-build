// BB-372 D5 — THE ROW VOCABULARY GROWS ONE OPTIONAL PROP, `runs`.
//
// `lib/vnode.ts` owned exactly one attribute set for a WHOLE row before this
// ticket: `attributes = bold ? BOLD : 0`, handed to `linked()`, which split the
// content into `TextChunk`s only to attach OSC 8 links and gave every chunk that
// same value. (BB-375 selection is FOREGROUND_ACTIVE fg on the node, not INVERSE on
// chunks.) A rendered body needs per-run styling, and `@opentui/core@0.5.1`'s
// chunk struct already carries it — so the whole change is that `linked()`
// splits on the UNION of the run boundaries and the URL runs.
//
// BB-372 D11 — AND THE PROP IS NEUTRAL. It was `spans?: MarkdownSpan[]`, so this
// module decided for itself that `italic: true` means `ESC[3m` and `code: true`
// means BORDER — Markdown domain knowledge inside the package's
// most-shared render primitive. The prop is `runs?: StyledRun[]` now: text,
// already-resolved attributes, an optional colour. WHICH run asks for which is
// `Component/markdown/`'s, and `tests/Component/markdown/index.test.ts` is where
// that mapping is asserted. Everything asserted BELOW is unchanged behaviour —
// the same painted attributes, stated in the neutral vocabulary.
//
// Both halves of the existing guarantee are asserted here as well as the new
// behaviour: the chunks still concatenate to the row character for character, and
// a row with no runs and no address is still returned as the plain string it
// already was, allocating nothing.

import { StyledText, type TextChunk } from '@opentui/core';
import { describe, expect, it } from 'vitest';
import {
  BOLD,
  BORDER,
  DIM,
  FOREGROUND_ACTIVE,
  INVERSE,
  ITALIC,
  type StyledRun,
  textNode,
} from '../../src/lib/vnode.js';

const rowNode = (
  content: string,
  over: {
    runs?: readonly StyledRun[];
    bold?: boolean;
    selected?: boolean;
  } = {},
) => textNode({ id: 'r', content, ...over });

const row = (
  content: string,
  over: {
    runs?: readonly StyledRun[];
    bold?: boolean;
    selected?: boolean;
  } = {},
): string | StyledText =>
  (rowNode(content, over).props as { content: string | StyledText }).content;

const chunksOf = (content: string | StyledText): TextChunk[] => {
  if (!(content instanceof StyledText)) {
    throw new Error(`expected styled chunks, got ${JSON.stringify(content)}`);
  }
  return content.chunks;
};

describe('a row with no runs is exactly what it was', () => {
  it('returns the plain string when nothing is styled and nothing is an address', () => {
    expect(row('branch: feat/a_b_c')).toBe('branch: feat/a_b_c');
  });

  it('still splits on a URL run alone, with the row`s own attributes', () => {
    const chunks = chunksOf(row('see https://x.test/a now', { bold: true }));
    expect(chunks.map((chunk) => chunk.text).join('')).toBe(
      'see https://x.test/a now',
    );
    for (const chunk of chunks) expect(chunk.attributes).toBe(BOLD);
    expect(chunks.find((chunk) => chunk.link !== undefined)?.text).toBe(
      'https://x.test/a',
    );
  });
});

describe('a row WITH runs', () => {
  it('splits on the run boundaries and OR-s each run onto the row`s attributes', () => {
    const chunks = chunksOf(
      row('a bold word', {
        runs: [
          { text: 'a ', attributes: 0 },
          { text: 'bold', attributes: BOLD },
          { text: ' word', attributes: 0 },
        ],
      }),
    );
    expect(chunks.map((chunk) => [chunk.text, chunk.attributes])).toEqual([
      ['a ', 0],
      ['bold', BOLD],
      [' word', 0],
    ]);
  });

  it('paints whatever attributes and colour a run declares', () => {
    // D7 — styling vocabulary: bold, italic, dim and indexed BORDER for code.
    // `underline` and `strikethrough` are deliberately unused (underline is what
    // a terminal hyperlink looks like and would collide with D6). D11 — WHICH
    // construct earns which of these is not this module's question any more; it
    // paints what the run states.
    const chunks = chunksOf(
      row('emdimcode', {
        runs: [
          { text: 'em', attributes: ITALIC },
          { text: 'dim', attributes: DIM },
          { text: 'code', attributes: 0, fg: BORDER },
        ],
      }),
    );
    expect(chunks[0]?.attributes).toBe(ITALIC);
    expect(chunks[1]?.attributes).toBe(DIM);
    expect(chunks[2]?.fg, 'the code run takes BORDER').toBe(BORDER);
    expect(
      chunks[0]?.fg,
      'an unstyled run states no colour of its own',
    ).toBeUndefined();
  });

  it('carries a combined attribute value through as ONE value', () => {
    const chunks = chunksOf(
      row('both', { runs: [{ text: 'both', attributes: BOLD | ITALIC }] }),
    );
    expect(chunks[0]?.attributes).toBe(BOLD | ITALIC);
  });

  it('uses FOREGROUND_ACTIVE fg on the node and keeps run attributes without INVERSE', () => {
    // BB-375 — selection is FOREGROUND_ACTIVE fg on the text node, not INVERSE on every
    // chunk. Chunks keep their run attributes (BOLD etc.).
    const node = rowNode('a bold word', {
      selected: true,
      runs: [
        { text: 'a ', attributes: 0 },
        { text: 'bold', attributes: BOLD },
        { text: ' word', attributes: 0 },
      ],
    });
    expect((node.props as { fg?: unknown }).fg).toBe(FOREGROUND_ACTIVE);
    expect(
      ((node.props as { attributes?: number }).attributes ?? 0) & INVERSE,
    ).toBe(0);
    const chunks = chunksOf(
      (node.props as { content: string | StyledText }).content,
    );
    expect(chunks.map((chunk) => [chunk.text, chunk.attributes])).toEqual([
      ['a ', 0],
      ['bold', BOLD],
      [' word', 0],
    ]);
    for (const chunk of chunks) {
      expect(chunk.attributes & INVERSE, chunk.text).toBe(0);
    }
  });

  it('splits on the UNION of the run boundaries and the URL runs', () => {
    // A rendered inline link is `text (url)` (D6), so a bare address really does
    // land inside a body row that also carries runs. The address keeps its OSC 8
    // link AND the run it sits in keeps its styling.
    const chunks = chunksOf(
      row('the MR (https://x.test/mr/1) is open', {
        runs: [
          { text: 'the MR', attributes: BOLD },
          { text: ' (https://x.test/mr/1)', attributes: 0 },
          { text: ' is open', attributes: 0 },
        ],
      }),
    );
    expect(chunks.map((chunk) => chunk.text).join('')).toBe(
      'the MR (https://x.test/mr/1) is open',
    );
    const linked = chunks.filter((chunk) => chunk.link !== undefined);
    expect(linked.map((chunk) => chunk.text)).toEqual(['https://x.test/mr/1']);
  });

  it('keeps a link INSIDE a styled run styled as well as linked', () => {
    const chunks = chunksOf(
      row('code https://x.test/a', {
        runs: [{ text: 'code https://x.test/a', attributes: 0, fg: BORDER }],
      }),
    );
    const address = chunks.find((chunk) => chunk.link !== undefined);
    expect(address?.text).toBe('https://x.test/a');
    expect(address?.fg, 'the address is still inside the code run').toBe(
      BORDER,
    );
  });

  it('never changes a glyph: the chunks concatenate to the row, always', () => {
    for (const [content, runs] of [
      ['', []],
      ['x', [{ text: 'x', attributes: 0 }]],
      [
        '  code',
        [
          { text: '  ', attributes: 0 },
          { text: 'code', attributes: 0, fg: BORDER },
        ],
      ],
      [
        '│ a dim quote',
        [
          { text: '│ ', attributes: DIM },
          { text: 'a dim quote', attributes: DIM },
        ],
      ],
    ] as [string, StyledRun[]][]) {
      const content_ = row(content, { runs });
      const joined =
        content_ instanceof StyledText
          ? content_.chunks.map((chunk) => chunk.text).join('')
          : content_;
      expect(joined, JSON.stringify(content)).toBe(content);
    }
  });
});
