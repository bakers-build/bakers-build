import { expect, it } from 'vitest';
import {
  markdownLines,
  plainLine,
} from '../../../src/Component/markdown/index.js';
import {
  expandableRows,
  flattenSections,
  panelSectionKey,
  sectionKey,
  sectionRows,
} from '../../../src/Component/section-list/index.js';
import { BOLD, BORDER } from '../../../src/lib/vnode.js';

it('flattenSections marks a SECTION heading bold', () => {
  const { lines, boldRows } = flattenSections([
    { heading: 'Description', lines: ['body'] },
  ]);
  expect(lines[0]).toBe('Description');
  expect(boldRows.has(0)).toBeTruthy();
});

// BB-372 D3 — A PLAIN `string` LINE IS NEVER PARSED, and this assertion is the
// exact reverse of the one that stood here before ("flattenSections … strips
// markdown headings"). It is reversed deliberately and it is the change that
// makes AC-5 STRUCTURAL rather than careful: `Assignment`, `Time`, `Branch`,
// `Links`, `Labels` and the run table hand over plain strings, so no Markdown
// rule can reach them — a branch called `feat/a_b_c` or a link title holding `*`
// cannot be restyled by a parser that never sees it. It is also strictly LESS
// parsing than before, where `markdownRow` ran over every one of those rows.
//
// A body that IS Markdown declares itself by handing over `StyledLine`s (the case
// below), which is the only way a Markdown rule reaches a row now.
it('D3: a plain string line is rendered verbatim and never read as markdown', () => {
  const { lines, boldRows } = flattenSections([
    { heading: 'Branch', lines: ['## Goal', 'feat/a_b_c', '**not bold**'] },
  ]);
  expect(lines).toContain('## Goal');
  expect(lines).toContain('feat/a_b_c');
  expect(lines).toContain('**not bold**');
  const ziel = lines.indexOf('## Goal');
  expect(boldRows.has(ziel), 'a plain string is not bolded by a `#`').toBe(
    false,
  );
});

// BB-372 D3/D5 — a `StyledLine` is an ALREADY RENDERED body row. The row carries
// the rendered text (which is what the pipe prints, D4), takes its weight from the
// line's own `heading` flag, and carries the styled runs through so the tree can
// paint per-run styling.
//
// D11 — the variant is NEUTRAL: this primitive no longer names `MarkdownLine`, and
// the runs it carries hold resolved attributes rather than span flags. The rows it
// produces are byte-for-byte the same rows.
it('D3: a StyledLine line carries its rendered text, its heading weight and its runs', () => {
  const [, heading, prose] = sectionRows([
    {
      heading: 'Description',
      lines: markdownLines('## Goal\na **bold** word'),
    },
  ]);
  expect(heading?.text).toBe('Goal');
  expect(heading?.bold, 'an ATX heading is the row`s weight').toBe(true);
  expect(prose?.text, 'the pipe gets the RENDERED text').toBe('a bold word');
  expect(prose?.bold).toBe(false);
  expect(prose?.runs).toEqual([
    { text: 'a ', attributes: 0 },
    { text: 'bold', attributes: BOLD },
    { text: ' word', attributes: 0 },
  ]);
});

it('D5: a row with no runs declares none, so nothing changes for a plain section', () => {
  const [, plain] = sectionRows([{ heading: 'Branch', lines: ['branch: x'] }]);
  expect(plain?.runs).toBeUndefined();
});

// BB-340 Task 13 — a section line may be COLUMNS instead of prose.
//
// The cells carry their Yoga budgets and nothing pads them, so the alignment is
// the renderer's. The row's `text` is what a surface with no layout — the pipe —
// prints: the same values, joined by the one column `rowNode`'s `gap` puts
// between two cells.
it('a cells line keeps its cells and joins them for a surface with no layout', () => {
  const [, row] = sectionRows([
    {
      heading: 'Runs',
      lines: [{ cells: [{ text: '#844', width: 8 }, { text: 'running' }] }],
    },
  ]);

  expect(row?.cells).toEqual([{ text: '#844', width: 8 }, { text: 'running' }]);
  expect(row?.text).toBe('#844 running');
  expect(row?.bold).toBe(false);
});

it('a cells line is keyed by its section exactly as a prose line is', () => {
  const rows = sectionRows([
    { heading: 'Per user', lines: [{ cells: [{ text: 'cw' }] }, 'plain'] },
  ]);
  expect(rows.map((r) => r.key)).toEqual([
    'per-user-heading',
    'per-user-0',
    'per-user-1',
    'per-user-gap',
  ]);
});

// A cells line is NOT markdown: `#` is a run number, not an ATX heading, and
// reading it as one would both bold the row and eat the number.
it('a cells line is never read as markdown', () => {
  const [, row] = sectionRows([
    { heading: 'Runs', lines: [{ cells: [{ text: '# 844' }] }] },
  ]);
  expect(row?.text).toBe('# 844');
  expect(row?.bold).toBe(false);
});

// BB-372 D3/D5 — the SAME rule on the collapsible surface. `expandableRows`
// renders the Overview tab's Description entry and every comment, so a body row
// that carried runs through `sectionRows` and lost them here would make the same
// body look different depending on which renderer reached it.
it('D3: expandableRows carries runs through both the collapsed and the expanded body', () => {
  const body = markdownLines('## Outcome\na `code` word');
  const entry = {
    key: 'e',
    header: 'Description',
    collapsed: [body[1] as (typeof body)[number]],
    expanded: body,
  };
  const collapsed = expandableRows([entry], {
    emptyMessage: 'none',
    emptyKey: 'none',
  });
  expect(collapsed.rows[1]?.text).toBe('a code word');
  expect(collapsed.rows[1]?.runs).toEqual([
    { text: 'a ', attributes: 0 },
    { text: 'code', attributes: 0, fg: BORDER },
    { text: ' word', attributes: 0 },
  ]);

  const expanded = expandableRows([entry], {
    expanded: new Set([0]),
    emptyMessage: 'none',
    emptyKey: 'none',
  });
  expect(expanded.rows[1]?.text, 'the heading row of the body').toBe('Outcome');
  expect(expanded.rows[1]?.bold).toBe(true);
  expect(expanded.rows[2]?.runs?.[1]).toEqual({
    text: 'code',
    attributes: 0,
    fg: BORDER,
  });
});

// The other half of D3 on this surface: a plain string in an expandable body is
// still a plain string. `comment-item` appends one as the entry's trailing blank,
// and the `— type ·` marker rows of the flat Comments section are plain too.
it('D3: expandableRows does not parse a plain string body line either', () => {
  const view = expandableRows(
    [
      {
        key: 'e',
        header: 'h',
        collapsed: [],
        expanded: ['## still raw', plainLine('## also raw'), ''],
      },
    ],
    { expanded: new Set([0]), emptyMessage: 'none', emptyKey: 'none' },
  );
  expect(view.rows.map((row) => row.text)).toEqual([
    '▾ h',
    '## still raw',
    '## also raw',
    '',
  ]);
  for (const row of view.rows.slice(1)) {
    expect(row.bold, `${row.text} is not bold`).toBe(false);
  }
});

// BB-373 AC-10 — A PANEL'S HEADINGS ARE DATA, and `sectionKey` was never
// injective over data. It lowercases and collapses every RUN of non-alphanumeric
// characters to one `-`, which is exactly right for the closed built-in heading
// set (`Per user` → `per-user`) and wrong the moment a contribution heads its
// sections with file paths: the shipped artifacts viewer does, so `/`, `.` and
// `-` all land on the same character and two ordinary filenames produce one id.
//
// The first expectation is the DEFECT, pinned rather than described: it is what
// makes the second one a repair instead of a preference.
it('AC-10: panelSectionKey separates two headings sectionKey collapses into one', () => {
  expect(
    sectionKey('playwright/logs/walk.txt'),
    'the built-in derivation collapses both separators to `-`',
  ).toBe(sectionKey('playwright/logs-walk.txt'));

  expect(panelSectionKey('playwright/logs/walk.txt')).not.toBe(
    panelSectionKey('playwright/logs-walk.txt'),
  );
});

// The other half of injectivity, and the half a "differ by a separator" case
// cannot see: the escape has to survive CASE (two files may differ only by it on
// a case-sensitive filesystem) and it has to be reversible where the source
// already looks like an escape.
it('AC-10: panelSectionKey is injective over headings that differ only in case or escape', () => {
  const headings = [
    'README.txt',
    'readme.txt',
    'a b',
    'a-b',
    'a_b',
    'a_2db',
    'vitest/red.txt',
    'vitest-red.txt',
  ];
  expect(new Set(headings.map(panelSectionKey)).size).toBe(headings.length);
});

// WHY THE OUTPUT CARRIES NO `-`, stated as a test rather than only as a comment.
// A key is embedded into an id with a suffix (`-heading`, `-gap`, `-empty`,
// `-header`, `-<index>`), so injectivity of the key alone is not enough: with a
// `-` allowed inside keys, section `a` at body index 12 and section `a-1` at body
// index 2 would both be `a-12`. No `-` inside a key means the FIRST `-` after the
// screen's prefix always ends the key, so a key and its suffix are recovered
// unambiguously and two suffixed ids can only be equal when both halves are.
it('AC-10: a panel key contains no `-`, so a suffixed key cannot reach another key', () => {
  for (const heading of ['a b', 'a-1', 'a', 'x/y-z.txt', '···']) {
    expect(panelSectionKey(heading), heading).not.toContain('-');
  }
});
