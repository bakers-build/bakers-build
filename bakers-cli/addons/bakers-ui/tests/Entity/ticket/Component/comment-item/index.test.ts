import { expect, it } from 'vitest';
import {
  markdownLines,
  plainLine,
} from '../../../../../src/Component/markdown/index.js';
import { commentRows } from '../../../../../src/Entity/ticket/Component/comment-item/index.js';
import { BOLD } from '../../../../../src/lib/vnode.js';

// 3 minutes after the fixture's created timestamp — deterministic "3m ago".
const fixtureNow = Math.floor(Date.parse('2026-07-18T20:03:00Z') / 1000);

/** The rows' text, which is what the caller turns into nodes (BB-340 D1). */
const textOf = (view: ReturnType<typeof commentRows>): string[] =>
  view.rows.map((row) => row.text);

it('commentRows collapsed shows one caret header row per comment and no body', () => {
  const items = [
    {
      id: 'uuid-1',
      type: 'spec',
      author: 'cw',
      created: '2026-07-18T20:00:00+00:00',
      bodyLines: [plainLine('a'), plainLine('b')],
      preview: 'a',
    },
  ];
  const view = commentRows(items, {
    expanded: new Set(),
    nowSeconds: fixtureNow,
  });
  const lines = textOf(view);
  expect(view.selectable).toBe(1);
  expect(view.headerRows.length).toBe(1);
  expect(lines.length, 'collapsed comment is a single row').toBe(1);
  expect(lines[0], 'collapsed caret').toMatch(/▸/);
  expect(lines[0]).toMatch(/spec/);
  expect(lines[0], 'relative created time').toMatch(/3m ago/);
  expect(lines[0], 'first-line preview').toMatch(/a/);
  expect(
    !lines.join('\n').includes('b'),
    'body is hidden when collapsed',
  ).toBeTruthy();
});

it('commentRows keys every row on the comment`s own uuid (BB-340 D4/R4)', () => {
  // The identity `Kernel/mount.ts` patches by. A comment list re-sorts on every
  // reload, so a positional key would move one comment's body onto another
  // comment's node with nothing on screen to say so.
  const view = commentRows(
    [
      {
        id: 'uuid-1',
        type: 'spec',
        author: 'cw',
        created: '2026-07-18T20:00:00+00:00',
        bodyLines: [plainLine('a'), plainLine('b')],
        preview: 'a',
      },
    ],
    { expanded: new Set([0]), nowSeconds: fixtureNow },
  );
  expect(view.rows.map((row) => row.key)).toEqual([
    'ticket-comment-uuid-1-header',
    'ticket-comment-uuid-1-0',
    'ticket-comment-uuid-1-1',
    'ticket-comment-uuid-1-2',
  ]);
});

it('commentRows expanded reveals the full body, one physical row per line', () => {
  const items = [
    {
      id: 'uuid-1',
      type: 'spec',
      author: 'cw',
      created: '2026-07-18T20:00:00+00:00',
      bodyLines: [plainLine('a'), plainLine('b'), plainLine('c')],
      preview: 'a',
    },
  ];
  const view = commentRows(items, {
    expanded: new Set([0]),
    nowSeconds: fixtureNow,
  });
  const lines = textOf(view);
  expect(lines[0], 'expanded caret').toMatch(/▾/);
  const joined = lines.join('\n');
  expect(joined).toMatch(/\ba\b/);
  expect(joined).toMatch(/\bb\b/);
  expect(joined).toMatch(/\bc\b/);
  for (const line of lines) {
    expect(
      !line.includes('\n'),
      `entry must be single physical line, got ${JSON.stringify(line)}`,
    ).toBeTruthy();
  }
});

it('commentRows with no comments shows an explicit empty state', () => {
  const view = commentRows([], { nowSeconds: fixtureNow });
  expect(view.selectable).toBe(0);
  expect(textOf(view)).toEqual(['No comments.']);
  expect(view.rows.map((row) => row.key)).toEqual(['ticket-comment-empty']);
});

// BB-372 D5 — `CommentItem.bodyLines` is a list of ALREADY RENDERED lines, and
// the four-space indent this component owns is applied with `Component/markdown`'s
// `indentLine`: an unstyled run of blanks prepended to the rendered line, never
// four spaces prepended to the source (which would be an indented code block in
// CommonMark).
it('D5: the four-space indent lands on the rendered line, runs and all', () => {
  const view = commentRows(
    [
      {
        id: 'uuid-md',
        type: 'summary',
        author: 'cw',
        created: '2026-07-18T20:00:00+00:00',
        bodyLines: markdownLines('## Outcome\nIt **worked**.'),
        preview: 'Outcome',
      },
    ],
    { expanded: new Set([0]), nowSeconds: fixtureNow },
  );
  expect(textOf(view)).toEqual([
    '▾ summary · cw · 3m ago · Outcome',
    '    Outcome',
    '    It worked.',
    '',
  ]);
  // The heading keeps its weight through the indent, and the emphasis keeps its
  // run — offset by the four columns the indent inserted.
  expect(view.rows[1]?.bold, 'an indented ATX heading is still bold').toBe(
    true,
  );
  expect(view.rows[2]?.runs).toEqual([
    { text: '    ', attributes: 0 },
    { text: 'It ', attributes: 0 },
    { text: 'worked', attributes: BOLD },
    { text: '.', attributes: 0 },
  ]);
});

it('D3: the trailing blank that closes an entry is a plain string', () => {
  const view = commentRows(
    [
      {
        id: 'uuid-1',
        type: 'spec',
        author: 'cw',
        created: '2026-07-18T20:00:00+00:00',
        bodyLines: [plainLine('a')],
        preview: 'a',
      },
    ],
    { expanded: new Set([0]), nowSeconds: fixtureNow },
  );
  expect(view.rows.at(-1)?.text).toBe('');
  expect(view.rows.at(-1)?.runs).toBeUndefined();
});
