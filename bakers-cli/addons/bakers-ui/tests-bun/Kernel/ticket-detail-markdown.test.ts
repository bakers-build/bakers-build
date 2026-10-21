import { describe, expect, it } from 'bun:test';
import { BoxRenderable, RGBA, type VNode } from '@opentui/core';
import { createTestRenderer } from '@opentui/core/testing';
import { TICKET_SECTIONS } from '../../src/Entity/ticket/Component/sections/index.js';
import { tabViewTree } from '../../src/Entity/ticket/Component/ticket-detail/index.js';
import { mountTree } from '../../src/Kernel/mount.js';
import { THEME_SLOTS } from '../../src/lib/theme.js';
import type { TicketDetailDocument } from '../../src/types.js';

// BB-372 V4 — WHAT A REAL RENDERER ACTUALLY PAINTS FOR A RENDERED BODY.
//
// Every other suite in this ticket reads a tree, a row or a string. None of them
// can see an attribute reach a cell, and that is exactly the gap the BB-326
// swap shipped through: 44 screen steps and two green suites over a cockpit
// painted in hardcoded truecolor white. So the claims below are read off
// `captureSpans()` (the attributes and the colours) and `captureCharFrame()` (the
// glyphs), the same observers `tests-bun/Kernel/chrome-cells.test.ts` uses.
//
// The subject is `tabViewTree(...).body` mounted on the real renderer rather than
// a booted screen against a fake client: the tree the screen hands over IS what
// the kernel mounts, and rendering it directly is the narrowest thing that can
// still answer "is this run italic and that one not".

/** The bit values of `@opentui/core@0.5.1`'s `createTextAttributes`. */
const BOLD_BIT = 1;
const DIM_BIT = 2;
const ITALIC_BIT = 4;

/** Code / outline role — BB-375: slot 245 (no cyan), `intent: 'indexed'`. */
const BORDER = RGBA.fromIndex(THEME_SLOTS.border);

const BODY = [
  '## Goal',
  'A **bold** word, an *italic* one and `inline code`.',
  '- [ ] an open task',
  '> a ~~struck~~ quote',
  '```ts',
  'const x = 1;',
  '```',
].join('\n');

const doc: TicketDetailDocument = {
  data: {
    type: 'bb_ticket--bb_ticket',
    id: 'ticket-372',
    attributes: {
      identifier: 'BB-372',
      title: 'markdown on a real renderer',
      description: { value: BODY },
      branch_name: 'feat/a_b_c',
      base_branch: 'develop',
    },
    relationships: {},
  },
  included: [],
};

const OVERVIEW = TICKET_SECTIONS.findIndex((tab) => tab.id === 'overview');

/**
 * WHICH expandable entry on Overview is `Description` — 1, not 0.
 *
 * BB-369 D3/D4 put `Latest summary` in `EXPANDABLE_HEADINGS` ABOVE
 * `Description`, so the tab lists two collapsible entries and `Description` is the
 * second. Named rather than inlined because the number is a fact about the tab's
 * composition, and a bare `0` here was silently reading the SUMMARY entry: three
 * of the assertions below still passed on it, because the collapsed Description
 * extract happens to contain the emphasis runs they look for. Only the ATX
 * heading test failed — `descriptionSummary` skips a leading heading (D8), so
 * `Goal` was the one run that is on screen ONLY when the entry is really open.
 */
const DESCRIPTION_ENTRY = 1;

interface Span {
  text: string;
  attributes: number;
  fg: RGBA;
  bg?: RGBA;
}

const render = async (
  tree: VNode,
  width = 80,
  height = 30,
): Promise<{ rows: string[]; spans: Span[][] }> => {
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
  const spans = setup.captureSpans().lines.map((line) => line.spans as Span[]);
  setup.renderer.destroy();
  return { rows, spans };
};

/** Every painted run of the frame, flattened — the whole styling of a body. */
const allSpans = (spans: Span[][]): Span[] => spans.flat();

/** The painted run whose text is exactly `text`, or the one containing it. */
const runOf = (spans: Span[][], text: string): Span | undefined =>
  allSpans(spans).find((span) => span.text === text) ??
  allSpans(spans).find((span) => span.text.includes(text));

describe('a rendered Markdown body on the real renderer', () => {
  it('paints bold, italic and dim as the ATTRIBUTES they are', async () => {
    const { spans } = await render(
      tabViewTree(doc, OVERVIEW, { expanded: new Set([DESCRIPTION_ENTRY]) })
        .body,
    );
    // The three attribute bits, each on its own run and each on the run the
    // source asked for. A char frame cannot see any of this.
    expect(runOf(spans, 'bold')?.attributes).toBe(BOLD_BIT);
    expect(runOf(spans, 'italic')?.attributes).toBe(ITALIC_BIT);
    expect(runOf(spans, 'struck')?.attributes).toBe(DIM_BIT);
    // And the runs around them carry NONE of it — the styling really is per run
    // and not a row-wide attribute the whole line inherited.
    expect(runOf(spans, 'A ')?.attributes).toBe(0);
  });

  it('paints a code run with indexed BORDER, not a truecolor value', async () => {
    // D7 / BB-375 — code uses BORDER (slot 245), `intent: 'indexed'`. A
    // truecolor triplet here would be the BB-326 regression in a new place.
    const { spans } = await render(
      tabViewTree(doc, OVERVIEW, { expanded: new Set([DESCRIPTION_ENTRY]) })
        .body,
    );
    const code = runOf(spans, 'inline code');
    expect(code, 'the code run is painted').toBeDefined();
    expect(code?.fg.equals(BORDER), `got ${code?.fg.toString()}`).toBe(true);
    expect(code?.fg.intent).toBe('indexed');
    // The fenced block's content takes the same colour.
    expect(runOf(spans, 'const x = 1;')?.fg.equals(BORDER)).toBe(true);
  });

  it('paints an ATX heading row bold as a WHOLE row', async () => {
    const { spans } = await render(
      tabViewTree(doc, OVERVIEW, { expanded: new Set([DESCRIPTION_ENTRY]) })
        .body,
    );
    const ziel = runOf(spans, 'Goal');
    expect(ziel?.text, 'the markers never reach a cell').toBe('Goal');
    expect(ziel?.attributes).toBe(BOLD_BIT);
  });

  it('draws no raw marker anywhere in the frame — AC-1 on real cells', async () => {
    const { rows } = await render(
      tabViewTree(doc, OVERVIEW, { expanded: new Set([DESCRIPTION_ENTRY]) })
        .body,
    );
    for (const row of rows) {
      expect(row, `${JSON.stringify(row)} carries no raw marker`).not.toMatch(
        /\*\*|`|- \[ \]|~~/,
      );
    }
    // What it draws instead, on real cells.
    const frame = rows.join('\n');
    expect(frame).toContain('A bold word, an italic one and inline code.');
    expect(frame).toContain('☐ an open task');
    expect(frame).toContain('│ a struck quote');
    expect(frame).toContain('  const x = 1;');
  });

  it('keeps the selection highlight across a styled row`s runs', async () => {
    // BB-375 — selection is FOREGROUND_ACTIVE fg on the row, not INVERSE on chunks.
    // An entry's caret header is its selectable row, so selecting
    // `DESCRIPTION_ENTRY` paints that header FOREGROUND_ACTIVE.
    const { spans } = await render(
      tabViewTree(doc, OVERVIEW, {
        expanded: new Set([DESCRIPTION_ENTRY]),
        selectedIndex: DESCRIPTION_ENTRY,
      }).body,
    );
    const caret = allSpans(spans).filter((span) => span.text.includes('▾'));
    expect(caret.length, 'the caret header is painted').toBeGreaterThan(0);
    for (const span of caret) {
      expect(span.attributes & 32, `${span.text} is not inverted`).toBe(0);
      expect(
        span.fg?.intent === 'indexed' &&
          span.fg.slot === THEME_SLOTS.foregroundActive,
        `${span.text} carries FOREGROUND_ACTIVE fg`,
      ).toBe(true);
    }
  });

  it('paints a comment body exactly as it paints the description (AC-2)', async () => {
    const comments = TICKET_SECTIONS.findIndex((tab) => tab.id === 'comments');
    const withComment: TicketDetailDocument = {
      ...doc,
      included: [
        {
          type: 'bb_comment--bb_comment',
          id: 'comment-md',
          attributes: {
            bb_comment_type: 'summary',
            author_name: 'cw',
            created: '2026-08-18T09:00:00+00:00',
            body: { value: '## Outcome\nIt **worked**: `pnpm test` is green.' },
          },
        },
      ],
    };
    const { rows, spans } = await render(
      tabViewTree(withComment, comments, {
        expanded: new Set([0]),
        nowSeconds: Math.floor(Date.parse('2026-08-18T09:03:00Z') / 1000),
      }).body,
    );
    // The same three observations as above, on the other producer's output.
    expect(runOf(spans, 'worked')?.attributes).toBe(BOLD_BIT);
    expect(runOf(spans, 'pnpm test')?.fg.equals(BORDER)).toBe(true);
    expect(runOf(spans, 'Outcome')?.attributes).toBe(BOLD_BIT);
    const frame = rows.join('\n');
    // D5 — the four-column indent is on the RENDERED line.
    expect(frame).toContain('    Outcome');
    expect(frame).toContain('    It worked: pnpm test is green.');
    expect(frame, 'and the header preview is rendered too').toContain(
      '· Outcome',
    );
    for (const row of rows) {
      expect(row).not.toMatch(/\*\*|`/);
    }
  });

  it('leaves a NON-Markdown row alone on real cells (AC-5)', async () => {
    // `Branch` hands over plain strings, so `feat/a_b_c` reaches a cell with its
    // underscores and with no attribute of its own.
    const { rows, spans } = await render(
      tabViewTree(doc, OVERVIEW, { expanded: new Set([DESCRIPTION_ENTRY]) })
        .body,
    );
    expect(rows.join('\n')).toContain('branch: feat/a_b_c');
    expect(runOf(spans, 'branch: feat/a_b_c')?.attributes).toBe(0);
  });
});
