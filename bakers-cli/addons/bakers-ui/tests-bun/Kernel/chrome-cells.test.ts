import { describe, expect, it } from 'bun:test';
import { BoxRenderable, type VNode } from '@opentui/core';
import { createTestRenderer } from '@opentui/core/testing';
import {
  type ChromeInput,
  chromeTree,
  footerTree,
} from '../../src/Kernel/chrome.js';
import { mountTree } from '../../src/Kernel/mount.js';
import { splashTree } from '../../src/Kernel/splash.js';
import { INVERSE } from '../../src/lib/vnode.js';

const hasInverse = (
  spans: { text: string; attributes: number }[][] | undefined,
): boolean =>
  (spans ?? []).some((line) =>
    line.some((span) => (span.attributes & INVERSE) !== 0),
  );

// BB-340 Task 12 — THE CHROME IS CELLS, AND THIS IS WHERE THAT IS CHECKED.
//
// The header box, the status footer and the modal's header/status were the last
// composed strings in the package: `'╭─ ╳ bakers.build ' + '─'.repeat(width - 19) + '╮'`,
// `'│ ' + fitLine(line, width - 4) + ' │'`, `ESC[7m + fitLine(hint + status,
// width) + ESC[0m`. All three measured display columns, which is why
// `lib/ansi.ts` and `lib/styled-text.ts` outlived the bridge.
//
// The claim this file makes is the one a text assertion cannot: that the picture
// the RENDERER draws from a border prop, a title prop and an attribute is the
// picture the templates drew from characters. So every expectation below is read
// off `captureCharFrame()` (the columns) or `captureSpans()` (the attributes) —
// spec D8's other half, and the reason it is under Bun rather than beside
// `tests/Kernel/chrome.test.ts`, which can see the tree and nothing else.

const input = (over: Partial<ChromeInput> = {}): ChromeInput => ({
  tab: null,
  busy: false,
  reloadable: false,
  modal: false,
  width: 60,
  ...over,
});

const render = async (
  tree: VNode,
  width: number,
  height = 10,
): Promise<{
  rows: string[];
  spans: { text: string; attributes: number }[][];
}> => {
  const setup = await createTestRenderer({ width, height });
  const shell = new BoxRenderable(setup.renderer, {
    id: 'shell',
    position: 'absolute',
    left: 0,
    top: 0,
    width: '100%',
    height: '100%',
    flexDirection: 'column',
  });
  setup.renderer.root.add(shell);
  mountTree(setup.renderer, shell, tree);
  await setup.renderOnce();
  const rows = setup.captureCharFrame().split('\n');
  const spans = (
    setup.captureSpans().lines as {
      spans: { text: string; attributes: number }[];
    }[]
  ).map((line) => line.spans);
  setup.renderer.destroy();
  return { rows, spans };
};

describe('the header box is a border, not a template', () => {
  it('draws the cockpit`s own top row from the box`s title', async () => {
    // `tests/pty/verify-anchor.mjs` matches the surface on `╭─ ╳ bakers.build`, so the
    // title prop has to reproduce the prefix the template wrote — including the
    // single column `╳` occupies, which is what `displayWidth(prefix)` was for.
    const { rows } = await render(
      chromeTree(input({ title: 'bakers.build projects', meta: 'a meta row' })),
      60,
    );
    expect(rows[0]).toBe(`╭─ ╳ bakers.build ${'─'.repeat(41)}╮`);
    expect(rows[1]).toBe(`│ bakers.build projects${' '.repeat(35)} │`);
    expect(rows[2]).toBe(`│ a meta row${' '.repeat(46)} │`);
    expect(rows[3]).toBe(`╰${'─'.repeat(58)}╯`);
  });

  it('keeps the title row bold and the other header rows plain', async () => {
    // The `ESC[1m` the template opened row 0 with, as an attribute the renderer
    // resolves. Read off the spans because a char frame cannot see weight.
    const { spans } = await render(
      chromeTree(input({ title: 'the title', meta: 'the meta' })),
      60,
    );
    const BOLD_BIT = 1;
    const textSpan = (row: number, needle: string) =>
      spans[row]?.find((span) => span.text.includes(needle));
    expect(textSpan(1, 'the title')?.attributes ?? 0).toBe(BOLD_BIT);
    expect(textSpan(2, 'the meta')?.attributes ?? 0).toBe(0);
  });

  it('clips an over-long header row at the box`s inner width', async () => {
    // The approved picture change: `fitLine` cut at `width - 5` and said so with
    // `…`; the box's own clip cuts at the inner width and says nothing. What
    // must NOT happen is a wrap — a header row that became two rows would push
    // the whole frame down, which is the defect `lib/width.ts` was written for.
    const { rows } = await render(
      chromeTree(
        input({
          title: 'a title far longer than forty columns of terminal will hold',
          meta: 'm',
        }),
      ),
      40,
    );
    expect(rows[1]).toBe('│ a title far longer than forty column │');
    expect(rows[1]).not.toContain('…');
    // The row below it is the meta, not the title's tail: nothing wrapped.
    expect(rows[2]).toBe(`│ m${' '.repeat(35)} │`);
    expect(rows[3]).toBe(`╰${'─'.repeat(38)}╯`);
  });
});

describe('the status footer is styled keys without inverse (BB-375)', () => {
  it('fills the status row width without inverse video', async () => {
    // Padding still spans the terminal so the status glyphs cover every column;
    // the footer is never INVERSE. Kernel owns pipe-separated basics.
    const { rows, spans } = await render(
      footerTree(input({ status: ' q quit ' })),
      60,
      1,
    );
    expect(rows[0]).toMatch(
      /^ bakers \S+ │ ↑↓ │ Enter │ Esc:back │ W:workspace │ q:quit/,
    );
    expect(rows[0]).toHaveLength(60);
    expect(hasInverse(spans)).toBe(false);
  });

  it('leads with version + reload and cuts the tail on a narrow terminal', async () => {
    // Version and reload lead because the cut is from the right.
    const { rows } = await render(
      footerTree(
        input({
          status: ' ↑↓ scroll · e edit · Tab tabs · q quit ',
          reloadable: true,
          width: 24,
        }),
      ),
      24,
      1,
    );
    expect(rows[0]).toMatch(/^ bakers \S+ │ R:reload/);
    expect(rows[0]).toHaveLength(24);
  });

  it('pins loading against the right edge while busy', async () => {
    const { rows } = await render(
      footerTree(
        input({
          busy: true,
          reloadable: true,
          nowMs: 0,
          width: 80,
        }),
      ),
      80,
      1,
    );
    expect(rows[0]).toHaveLength(80);
    expect(rows[0].endsWith('⠋ loading ')).toBe(true);
    expect(rows[0].includes('⠋ loading')).toBe(true);
    expect(rows[0]).toContain('R:reload');
  });
});

it('renders the bread-slice logo intact', async () => {
  const { rows } = await render(splashTree(), 80, 24);
  const top = rows.findIndex((row) => row.includes('▄███████████▀▄'));
  expect(top).toBeGreaterThan(0);
  const left = rows[top]!.indexOf('▄███████████▀▄');
  expect(rows[top + 3]!.slice(left, left + 14)).toBe('█████▀██▀█████');
  expect(rows[top + 6]!.slice(left, left + 14)).toBe('▀████████████▀');
});
