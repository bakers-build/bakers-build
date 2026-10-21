import { expect, it } from 'vitest';
import {
  markdownLines,
  plainLine,
} from '../../../../../src/Component/markdown/index.js';
import {
  lineText,
  sectionRows,
} from '../../../../../src/Component/section-list/index.js';
import { TICKET_SECTIONS } from '../../../../../src/Entity/ticket/Component/sections/index.js';
import {
  commentItems,
  descriptionSummary,
  detailLines,
  detailSections,
  headerLabels,
  headerState,
  initialExpandedComments,
  SUMMARY_MAX_LINES,
  sectionsForTab,
  tabViewTree,
} from '../../../../../src/Entity/ticket/Component/ticket-detail/index.js';
import {
  BOLD,
  BORDER,
  DEFAULT_BACKGROUND,
  FOREGROUND,
  FOREGROUND_ACTIVE,
  ITALIC,
} from '../../../../../src/lib/vnode.js';
import { idsOf, nodeById, renderTree } from '../../../../render-tree.js';

const COMMENTS_TAB = TICKET_SECTIONS.findIndex((tab) => tab.id === 'comments');
const RELATED_TAB = TICKET_SECTIONS.findIndex((tab) => tab.id === 'related');
const OVERVIEW_TAB = TICKET_SECTIONS.findIndex((tab) => tab.id === 'overview');
const RUNS_TAB = TICKET_SECTIONS.findIndex((tab) => tab.id === 'runs');

/**
 * A section's rows as the text a surface with no styling prints.
 *
 * BB-372 D3 — `Section.lines` is no longer `string[]`: the `Description` and
 * `Comments` sections hand over RENDERED `StyledLine`s, while every other
 * section hands over the plain strings it always did. `lineText` is the one
 * function that reads all three variants, and it is what the pipe prints (D4),
 * so every assertion that used to join `section.lines` joins this instead.
 */
const sectionText = (section: { lines: unknown[] } | undefined): string[] =>
  (section?.lines ?? []).map((line) =>
    lineText(line as Parameters<typeof lineText>[0]),
  );

/**
 * A tab's rows as text (BB-340 D8).
 *
 * The tab view hands over a renderable TREE now, so every assertion that used to
 * read `view.lines` reads the text the tree carries instead. `renderTree` walks
 * it in tree order and measures nothing — the columns are asserted against real
 * Yoga in the Bun suite.
 */
const textOf = (view: ReturnType<typeof tabViewTree>): string[] =>
  renderTree(view.body);

it('detailSections renders all sections with empty states for absent relationships', () => {
  const doc = {
    data: {
      attributes: {
        description: { value: 'Body line 1\nBody line 2' },
        branch_name: 'feat/x',
        base_branch: 'develop',
        links: [],
      },
      relationships: {
        comments: { data: [] },
        sub_tickets: { data: [] },
        runs: { data: [] },
        referenced_tickets: { data: [] },
        environments: { data: [] },
      },
    },
    included: [],
  };
  const sections = detailSections(doc);
  const headings = sections.map((s) => s.heading);
  for (const h of [
    'Description',
    'Comments',
    'Sub-tickets',
    'Runs',
    'Referenced tickets',
    'Links',
    'Branch',
    'Environments',
  ]) {
    expect(headings.includes(h), `missing section ${h}`).toBeTruthy();
  }
  expect(
    sectionText(sections.find((s) => s.heading === 'Description')).join('\n'),
  ).toMatch(/Body line 1/);
  expect(
    sectionText(sections.find((s) => s.heading === 'Comments')).join('\n'),
  ).toMatch(/No comments/i);
  expect(
    sectionText(sections.find((s) => s.heading === 'Links')).join('\n'),
  ).toMatch(/No links/i);
  expect(
    sectionText(sections.find((s) => s.heading === 'Branch')).join('\n'),
  ).toMatch(/feat\/x/);
});

it('Comments section splits a multi-line comment body into one entry per physical line', () => {
  // AC-4 P0: a multi-line comment body must expand into one array entry per
  // physical line (like the Description section), so no single logical entry
  // ever renders as N physical terminal rows.
  const doc = {
    data: { attributes: { description: 'x' }, relationships: {} },
    included: [
      {
        type: 'bb_comment--bb_comment',
        attributes: {
          bb_comment_type: 'summary',
          body: { value: 'line A\nline B\nline C' },
        },
      },
    ],
  };
  const comments = sectionText(
    detailSections(doc).find((s) => s.heading === 'Comments'),
  );
  for (const line of comments) {
    expect(
      !line.includes('\n'),
      `comment entry must be a single physical line, got ${JSON.stringify(line)}`,
    ).toBeTruthy();
  }
  expect(
    comments.some((l) => /summary/.test(l)),
    'a marker line names the comment type',
  ).toBeTruthy();
  expect(comments.includes('line A')).toBeTruthy();
  expect(comments.includes('line B')).toBeTruthy();
  expect(comments.includes('line C')).toBeTruthy();
});

it('detailSections summarises present relationships and comments', () => {
  const doc = {
    data: {
      attributes: { description: 'plain string desc' },
      relationships: {
        comments: { data: [{ type: 'bb_comment--bb_comment', id: 'c1' }] },
        sub_tickets: { data: [{ id: 's1' }, { id: 's2' }] },
        runs: { data: [] },
        referenced_tickets: { data: [] },
        environments: { data: [] },
      },
    },
    included: [
      {
        type: 'bb_comment--bb_comment',
        id: 'c1',
        attributes: {
          bb_comment_type: 'spec',
          body: { value: 'the spec body' },
        },
      },
    ],
  };
  const sections = detailSections(doc);
  expect(
    sectionText(sections.find((s) => s.heading === 'Description')).join('\n'),
  ).toMatch(/plain string desc/);
  expect(
    sectionText(sections.find((s) => s.heading === 'Comments')).join('\n'),
  ).toMatch(/spec/);
  expect(
    sectionText(sections.find((s) => s.heading === 'Comments')).join('\n'),
  ).toMatch(/the spec body/);
  expect(
    sectionText(sections.find((s) => s.heading === 'Sub-tickets')).join('\n'),
  ).toMatch(/2/);
});

it('sectionsForTab returns only the sections that belong to that tab', () => {
  const doc = {
    data: {
      attributes: {
        description: 'hi',
        branch_name: 'feat/x',
        base_branch: 'develop',
        links: [],
      },
      relationships: {
        sub_tickets: { data: [{ id: 's1' }] },
        referenced_tickets: { data: [] },
        runs: { data: [] },
        environments: { data: [] },
      },
    },
    included: [],
  };
  // BB-255 AC-3/AC-5: Parent and Links moved above Description on Overview, and
  // Parent joined Related. Membership + ORDER, because the headings array is what
  // decides both. BB-369 D3 inserted `Latest summary` between Links and
  // Description.
  const overview = sectionsForTab(doc, 0).map((s) => s.heading);
  expect(overview).toEqual([
    'Source',
    'Parent',
    'Links',
    'Latest summary',
    'Description',
    'Assignment',
    'Time',
    'Branch',
    'Environments',
  ]);
  expect(
    !overview.includes('Comments'),
    'Comments is its own tab, not in Overview',
  ).toBeTruthy();
  const related = sectionsForTab(doc, RELATED_TAB).map((s) => s.heading);
  // BB-369 D5 inserted `Blocked by` between the two ticket-reference sections.
  expect(related).toEqual([
    'Source',
    'Parent',
    'Sub-tickets',
    'Blocked by',
    'Referenced tickets',
  ]);
});

it('commentItems captures type/author/created and splits the body into lines', () => {
  const doc = {
    included: [
      {
        type: 'bb_comment--bb_comment',
        attributes: {
          bb_comment_type: 'spec',
          author_name: 'cw',
          created: '2026-07-18T20:00:00+00:00',
          body: { value: 'first line\nsecond line' },
        },
      },
    ],
  };
  const [item] = commentItems(doc);
  expect(item.type).toBe('spec');
  expect(item.author).toBe('cw');
  expect(item.created).toBe('2026-07-18T20:00:00+00:00');
  expect(item.bodyLines.map((line) => line.text)).toEqual([
    'first line',
    'second line',
  ]);
  expect(item.preview).toBe('first line');
});

// AC-4 P2 — a `## heading` line renders as bold with the `#` markers stripped,
// mirroring the section-heading bold rule.
//
// BB-372 corrected two claims this comment used to make. It said "MINIMAL
// markdown", which was true while an ATX heading was the whole of the rule and is
// not now — the body goes through `Component/markdown/`'s subset. And it said the bold
// is "applied after fit()", which BB-340 had already falsified: the row surface
// is gone and weight is a prop on the row's own node. The behaviour asserted below
// is unchanged either way, which is the point of keeping the case.
it('detailLines renders a markdown heading line as a stripped bold row', () => {
  const doc = {
    data: {
      attributes: { description: '## Goal\nbody text' },
      relationships: {},
    },
    included: [],
  };
  const { lines, boldRows } = detailLines(doc);
  const zielIndex = lines.indexOf('Goal');
  expect(
    zielIndex >= 0,
    `markdown heading text is stripped of #, got ${JSON.stringify(lines)}`,
  ).toBeTruthy();
  expect(
    boldRows.has(zielIndex),
    'the stripped markdown heading is marked bold',
  ).toBeTruthy();
  expect(
    !lines.includes('## Goal'),
    'the raw "## Goal" marker is not rendered',
  ).toBeTruthy();
});

// BB-340 D4: the two comments carry real resource ids, because a converted tab
// keys each comment's nodes on its own uuid. `drupal_internal__id` pins the order
// the ids would otherwise decide (both share a `created`), so the order this
// fixture has always rendered in — spec, then summary — is stated rather than
// left to the tiebreak.
const commentDoc = {
  data: { attributes: { identifier: 'BB-1', title: 't' }, relationships: {} },
  included: [
    {
      type: 'bb_comment--bb_comment',
      id: 'uuid-spec',
      attributes: {
        bb_comment_type: 'spec',
        author_name: 'cw',
        created: '2026-07-18T20:00:00+00:00',
        drupal_internal__id: 2,
        body: { value: 'line one\nline two\nline three' },
      },
    },
    {
      type: 'bb_comment--bb_comment',
      id: 'uuid-summary',
      attributes: {
        bb_comment_type: 'summary',
        author_name: 'cw',
        created: '2026-07-18T20:00:00+00:00',
        drupal_internal__id: 1,
        body: { value: 'sum a\nsum b' },
      },
    },
  ],
};
// 3 minutes after the fixture's created timestamp — deterministic "3m ago".
const fixtureNow = Math.floor(Date.parse('2026-07-18T20:03:00Z') / 1000);

it('tabViewTree(comments) keeps the physical-row invariant when a comment is expanded', () => {
  // AC-4 P0/P1 — "one logical entry, one physical row". It used to be checked
  // through `styleVisibleLines`, which both windowed the rows and joined them;
  // the windowing belongs to the body ScrollBox now (asserted against real Yoga
  // in `tests-bun/Kernel/row-reconciliation.test.ts`), so what is checked HERE is
  // the half this component actually owns: no node carries a newline, and every
  // row it declares is exactly one row tall.
  const view = tabViewTree(commentDoc, COMMENTS_TAB, {
    expanded: new Set([0, 1]),
    nowSeconds: fixtureNow,
  });
  const rows = textOf(view);
  expect(
    rows.length,
    'an expanded comment renders its body rows',
  ).toBeGreaterThan(2);
  for (const row of rows) {
    expect(
      row.includes('\n'),
      `entry must be a single physical line, got ${JSON.stringify(row)}`,
    ).toBe(false);
  }
  for (const id of idsOf(view.body)) {
    const node = nodeById(view.body, id);
    const props = node?.props as { content?: unknown; height?: unknown };
    // The root box declares no content; every row that does is height 1.
    if (props?.content === undefined) continue;
    expect(props.height, `${id} is one physical row`).toBe(1);
  }
});

it('tabViewTree(overview) renders Description but never the Comments section', () => {
  const view = tabViewTree(commentDoc, 0, { nowSeconds: fixtureNow });
  const joined = textOf(view).join('\n');
  expect(joined).toMatch(/Description/);
  expect(
    !/^Comments$/m.test(joined),
    'Comments is its own tab, not in Overview',
  ).toBeTruthy();
  // BB-255 AC-1/AC-2: the Overview tab is no longer scroll-only — its
  // Description is ONE collapsible entry. BB-369 D4 added `Latest summary`
  // above it. BB-381: this fixture also carries a `spec` comment, so Latest
  // spec joins and Overview selectable is 3 (summary + spec + Description).
  // (Related, which lists no expandable section, still reports 0 — see 'AC-5'.)
  expect(view.selectable, 'summary + spec + Description').toBe(3);
  expect(
    tabViewTree(commentDoc, RELATED_TAB, { nowSeconds: fixtureNow }).selectable,
    'a tab with no expandable section is still scroll-only',
  ).toBe(0);
});

// BB-340 D4/R4 — the ids the patch follows. Section-scoped and entity-derived,
// never the row's position: a comment list re-sorts on every reload, and a
// positional key would move one comment's body onto another comment's node with
// nothing on screen to say so. `Kernel/mount.ts` throws on a repeated id, so
// uniqueness is asserted here rather than discovered at the first draw.
it('D4: every node id is unique, and a comment`s rows carry its own uuid', () => {
  const view = tabViewTree(
    {
      data: { attributes: {}, relationships: {} },
      included: [
        {
          type: 'bb_comment--bb_comment',
          id: 'uuid-newer',
          attributes: {
            bb_comment_type: 'spec',
            created: '2026-07-19T20:00:00+00:00',
            body: { value: 'newer body' },
          },
        },
        {
          type: 'bb_comment--bb_comment',
          id: 'uuid-older',
          attributes: {
            bb_comment_type: 'spec',
            created: '2026-07-18T20:00:00+00:00',
            body: { value: 'older body' },
          },
        },
      ],
    },
    COMMENTS_TAB,
    { expanded: new Set([0]), nowSeconds: fixtureNow },
  );
  const ids = idsOf(view.body);
  expect(new Set(ids).size, 'no id is declared twice').toBe(ids.length);
  expect(ids).toContain('ticket-detail-ticket-comment-uuid-newer-header');
  expect(ids).toContain('ticket-detail-ticket-comment-uuid-older-header');
  // The expanded entry's body rows hang off the SAME uuid, so the content and
  // the identity move together when the list re-sorts.
  expect(ids).toContain('ticket-detail-ticket-comment-uuid-newer-0');
});

// BB-340 D3 — "this row is selected" and "this row is a heading" are PROPS on
// the node now, not indices into a surface the kernel styles. Stated on every
// frame whether on or off: `patchTree` writes only what the next tree declares
// and cannot clear an omitted prop, which is how a highlight got stuck on every
// row the cursor passed in plan Task 7.
it('D3: the selected entry`s header carries FOREGROUND_ACTIVE fg, every other row states default', () => {
  const selected = tabViewTree(commentDoc, COMMENTS_TAB, {
    expanded: new Set(),
    nowSeconds: fixtureNow,
    selectedIndex: 1,
  });
  const rows = idsOf(selected.body)
    .map((id) => nodeById(selected.body, id))
    .filter(
      (node): node is NonNullable<typeof node> =>
        (node?.props as { content?: unknown } | undefined)?.content !==
        undefined,
    )
    .map(
      (node) =>
        node.props as {
          id: string;
          attributes: number;
          fg?: unknown;
          bg?: unknown;
        },
    );
  // BB-375 — selection is FOREGROUND_ACTIVE fg; bold is still the heading weight.
  const active = rows.filter((props) => props.fg === FOREGROUND_ACTIVE);
  expect(
    active.map((props) => props.id),
    'exactly the second comment`s header row is highlighted',
  ).toEqual(['ticket-detail-ticket-comment-uuid-summary-header']);
  for (const props of rows) {
    expect(
      typeof props.attributes,
      `${props.id} states its attributes either way`,
    ).toBe('number');
    expect(props.fg, `${props.id} states its fg either way`).toBeDefined();
    expect(props.bg, `${props.id} states its bg either way`).toBeDefined();
  }
  // And nothing is highlighted when nothing is selected — fg is STATED as
  // default rather than omitted, which is what `patchTree` needs to clear it.
  const none = tabViewTree(commentDoc, COMMENTS_TAB, {
    expanded: new Set(),
    nowSeconds: fixtureNow,
  });
  for (const id of idsOf(none.body)) {
    const props = nodeById(none.body, id)?.props as {
      content?: unknown;
      attributes?: number;
      fg?: unknown;
      bg?: unknown;
    };
    if (props?.content === undefined) continue;
    expect(props.fg, `${id} carries default fg`).toBe(FOREGROUND);
    expect(props.bg, `${id} carries default bg`).toBe(DEFAULT_BACKGROUND);
  }
});

const headingFixture = {
  data: {
    attributes: {
      identifier: 'BB-1',
      title: 'a ticket',
      description: 'hello\nworld',
      branch_name: 'feat/x',
      base_branch: 'develop',
    },
    relationships: {},
  },
  included: [],
};

it('detailLines yields plain heading text and marks each heading bold', () => {
  const { lines, boldRows } = detailLines(headingFixture);
  // Found by NAME, not by index: this test is about how a heading is styled, and
  // BB-255 changed which section comes first (`Labels` carries the header box's
  // labels into the flat render). An index here made the claim depend on an
  // ordering it does not care about.
  const descriptionRow = lines.indexOf('Description');
  expect(descriptionRow, 'the Description heading is a row').toBeGreaterThan(
    -1,
  );
  expect(
    boldRows.has(descriptionRow),
    'the heading row is marked bold',
  ).toBeTruthy();
  expect(boldRows.has(0), 'the first section heading is bold too').toBeTruthy();
  // Headings carry no ANSI of their own — styling is applied after fit().
  for (const row of boldRows) {
    expect(
      !lines[row].includes('escape'),
      `heading row ${row} must be plain text, got ${JSON.stringify(lines[row])}`,
    ).toBeTruthy();
  }
});

it('a detail section heading is BOLD as a prop, and its text carries no escape', () => {
  // BB-340 Task 12 — the successor of the AC-4 defect this used to reproduce
  // through `styleVisibleLines`: a heading pre-wrapped in ANSI was later run
  // through fit()/sanitizeDisplay(), which stripped the ESC byte and left the
  // CSI text (`[1mDescription[0m`) visible on the detail screen. The row surface
  // is gone, so the escape can no longer be written at all — weight is a PROP on
  // the heading's own node. Both halves of the original claim are kept: the row
  // really is bold, and its content really is plain text.
  // Found by NAME, not by index — the same reason the test above it says so:
  // this is about how a heading is STYLED, and which section comes first has
  // changed before (BB-255). `Description` is the Overview tab's one
  // COLLAPSIBLE entry and carries a `▸` marker, so the plain heading asserted
  // here is `Branch`, which the fixture's `branch_name` puts on screen.
  const view = tabViewTree(headingFixture, 0, {});
  const heading = idsOf(view.body)
    .map((id) => nodeById(view.body, id))
    .find(
      (node) =>
        (node?.props as { content?: unknown } | undefined)?.content ===
        'Branch',
    );
  expect(heading, 'the Branch heading is a node of its own').toBeDefined();
  const props = heading?.props as { content: string; attributes: number };
  expect(props.attributes & BOLD, 'the heading node declares bold').toBe(BOLD);
  // biome-ignore lint/suspicious/noControlCharactersInRegex: asserting the ESC byte is absent is exactly this check.
  expect(props.content).not.toMatch(/\x1b/);
  expect(props.content).not.toContain('[1m');
});

// ─── BB-240 — comments newest first, newest expanded ───────────────────────
// The control plane returns comments OLDEST-first, by a two-key total order
// (`CommentsItemList.php`: `created ASC, id ASC`), and `loadTicketDetail` passes
// that order straight through. So every fixture below is built ASCENDING —
// exactly the wire order — and the assertions are about what the component makes
// of it. `commentResources` is the single function both renderings read, which is
// what makes AC-1 (Comments tab) and AC-8 (`detailLines`) one line of code.

interface CommentFixture {
  /** Names the comment; becomes its first body line, i.e. its preview. */
  body: string;
  created?: string | null;
  internalId?: number;
  id?: string;
}

/** One `bb_comment` include, shaped like the wire resource. */
function comment({ body, created, internalId, id }: CommentFixture) {
  const attributes: Record<string, unknown> = {
    bb_comment_type: 'summary',
    author_name: 'cw',
    // A second body line so an expanded body is distinguishable from the
    // collapsed header's preview (which is body line 1).
    body: { value: `${body}\ntail of ${body}` },
  };
  if (created !== undefined) attributes.created = created;
  if (internalId !== undefined) attributes.drupal_internal__id = internalId;
  return {
    type: 'bb_comment--bb_comment',
    id: id ?? `uuid-${body}`,
    attributes,
  };
}

/** A ticket document carrying the given comments in `included`, verbatim. */
const docWith = (...comments: ReturnType<typeof comment>[]) => ({
  data: {
    attributes: { identifier: 'BB-240', title: 'newest first' },
    relationships: {},
  },
  included: comments,
});

const TIED = '2026-07-21T10:00:00+00:00';

// Three comments, ascending `created` — the server's order.
const ascending = [
  comment({
    body: 'body-A',
    created: '2026-07-20T10:00:00+00:00',
    internalId: 1101,
    id: 'aaaaaaaa-0000-0000-0000-000000000001',
  }),
  comment({
    body: 'body-B',
    created: TIED,
    internalId: 1102,
    id: 'aaaaaaaa-0000-0000-0000-000000000002',
  }),
  comment({
    body: 'body-C',
    created: '2026-07-22T10:00:00+00:00',
    internalId: 1103,
    id: 'aaaaaaaa-0000-0000-0000-000000000003',
  }),
];

it('commentItems lists comments newest first', () => {
  const items = commentItems(docWith(...ascending));
  expect(items.map((i) => i.preview)).toEqual(['body-C', 'body-B', 'body-A']);
  const created = items.map((i) => Date.parse(i.created ?? ''));
  for (let i = 1; i < created.length; i++) {
    expect(
      created[i - 1],
      `entry ${i - 1} must be strictly newer than entry ${i}`,
    ).toBeGreaterThan(created[i]);
  }
});

it('commentResources does not mutate document.included', () => {
  // `included` is a MIXED array (comments plus sub-tickets, runs, referenced
  // tickets) shared with those consumers, and `commentResources` is called twice
  // per render — so it must sort the copy `filter` allocated, never the document.
  const doc = docWith(...ascending);
  const before = doc.included.map((r) => r.id);
  commentItems(doc);
  detailSections(doc);
  expect(doc.included.map((r) => r.id)).toEqual(before);
});

function reviewComment(opts: {
  id: string;
  body: string;
  state: string;
  author?: string;
  created?: string;
}) {
  return {
    type: 'bb_comment--review',
    id: opts.id,
    attributes: {
      bb_comment_type: 'comment',
      author_name: opts.author ?? 'Ada',
      review_state: opts.state,
      body: { value: opts.body },
      created: opts.created ?? '2026-07-23T10:00:00+00:00',
    },
  };
}

it('timeline membership follows comments linkage, not every included comment', () => {
  const published = comment({
    body: 'public',
    id: 'pub-1',
    created: '2026-07-22T10:00:00+00:00',
  });
  const submitted = reviewComment({
    id: 'rev-submitted',
    body: 'secret pending',
    state: 'submitted',
    created: '2026-07-23T10:00:00+00:00',
  });
  const accepted = reviewComment({
    id: 'rev-accepted',
    body: 'accepted body',
    state: 'accepted',
    created: '2026-07-21T10:00:00+00:00',
  });
  const doc = {
    data: {
      id: 'ticket-uuid',
      attributes: { identifier: 'BB-1', title: 't' },
      relationships: {
        comments: {
          data: [
            { type: 'bb_comment--bb_comment', id: 'pub-1' },
            { type: 'bb_comment--review', id: 'rev-accepted' },
          ],
        },
        pending_reviews: {
          data: [{ type: 'bb_comment--review', id: 'rev-submitted' }],
        },
      },
    },
    included: [published, submitted, accepted],
  };
  expect(commentItems(doc).map((i) => i.preview)).toEqual([
    'public',
    'accepted body',
  ]);
  const comments = sectionText(
    detailSections(doc).find((s) => s.heading === 'Comments'),
  ).join('\n');
  expect(comments).toContain('public');
  expect(comments).toContain('accepted body');
  expect(comments).not.toContain('secret pending');
  const pending = sectionText(
    detailSections(doc).find((s) => s.heading === 'Pending reviews'),
  );
  expect(pending[0]).toBe('1 review awaiting acceptance');
  expect(pending).toContain('— Ada · submitted');
  expect(pending.at(-1)).toBe('Open this ticket in Web to accept or reject.');
  const linked = sectionText(
    detailSections(doc, undefined, 0, 'https://bakers.example.test/').find(
      (s) => s.heading === 'Pending reviews',
    ),
  );
  expect(linked.at(-1)).toBe(
    'Open in Web to accept or reject: https://bakers.example.test/admin/bakers/ticket/ticket-uuid',
  );
  const headings = detailSections(doc).map((s) => s.heading);
  expect(headings.indexOf('Pending reviews')).toBe(
    headings.indexOf('Assignment') + 1,
  );
  expect(headings.indexOf('Time')).toBe(
    headings.indexOf('Pending reviews') + 1,
  );
});

it('empty comments linkage hides included comments from the timeline', () => {
  const doc = {
    data: {
      attributes: { identifier: 'BB-240', title: 'newest first' },
      relationships: { comments: { data: [] } },
    },
    included: ascending,
  };
  expect(commentItems(doc)).toEqual([]);
  expect(
    sectionText(detailSections(doc).find((s) => s.heading === 'Comments')),
  ).toEqual(['No comments.']);
});

it('omits Pending reviews when the pending_reviews linkage is empty', () => {
  const doc = {
    data: {
      id: 'ticket-uuid',
      attributes: { identifier: 'BB-1', title: 't' },
      relationships: {
        comments: { data: [] },
        pending_reviews: { data: [] },
      },
    },
    included: [
      reviewComment({
        id: 'rev-submitted',
        body: 'secret pending',
        state: 'submitted',
      }),
    ],
  };
  expect(detailSections(doc).map((s) => s.heading)).not.toContain(
    'Pending reviews',
  );
  expect(
    sectionText(detailSections(doc).find((s) => s.heading === 'Comments')),
  ).toEqual(['No comments.']);
});

it('missing comments relationship still reads included comments (legacy fixtures)', () => {
  expect(commentItems(docWith(...ascending)).map((i) => i.preview)).toEqual([
    'body-C',
    'body-B',
    'body-A',
  ]);
});

it('ties on created are broken by drupal_internal__id, descending', () => {
  const items = commentItems(
    docWith(
      comment({
        body: 'body-10',
        created: TIED,
        internalId: 10,
        id: 'uuid-10',
      }),
      comment({
        body: 'body-11',
        created: TIED,
        internalId: 11,
        id: 'uuid-11',
      }),
    ),
  );
  expect(items.map((i) => i.preview)).toEqual(['body-11', 'body-10']);
});

it('ties on created fall back to the resource id when drupal_internal__id is absent', () => {
  const items = commentItems(
    docWith(
      comment({
        body: 'body-aaa',
        created: TIED,
        id: 'ffffffff-0000-0000-0000-0000000000aa',
      }),
      comment({
        body: 'body-bbb',
        created: TIED,
        id: 'ffffffff-0000-0000-0000-0000000000bb',
      }),
    ),
  );
  expect(items.map((i) => i.preview)).toEqual(['body-bbb', 'body-aaa']);
});

it('the order is independent of the input order', () => {
  // AC-7 asks for a DETERMINISTIC order, not merely a stable sort: the same
  // comments in any input order must come out identically.
  const expected = commentItems(docWith(...ascending)).map((i) => i.preview);
  expect(expected).toEqual(['body-C', 'body-B', 'body-A']);
  const shuffled = [ascending[1], ascending[2], ascending[0]];
  expect(commentItems(docWith(...shuffled)).map((i) => i.preview)).toEqual(
    expected,
  );
});

it('a comment with an unparseable created sorts last and never takes the top slot', () => {
  // The malformed rows carry the HIGHEST drupal_internal__id on purpose: if the
  // comparator let the tiebreak outrank `created`, they would take the top slot
  // and steal the default expansion.
  const items = commentItems(
    docWith(
      comment({
        body: 'body-null',
        created: null,
        internalId: 9001,
        id: 'uuid-null',
      }),
      comment({
        body: 'body-A',
        created: '2026-07-20T10:00:00+00:00',
        internalId: 1,
        id: 'uuid-a',
      }),
      comment({
        body: 'body-junk',
        created: 'not-a-date',
        internalId: 9002,
        id: 'uuid-junk',
      }),
      comment({
        body: 'body-C',
        created: '2026-07-22T10:00:00+00:00',
        internalId: 2,
        id: 'uuid-c',
      }),
    ),
  );
  expect(items[0].preview).toBe('body-C');
  expect(items[1].preview).toBe('body-A');
  expect(
    items
      .slice(2)
      .map((i) => i.preview)
      .sort(),
  ).toEqual(['body-junk', 'body-null']);
});

it('detailLines lists the Comments section newest first', () => {
  // The non-TTY ticket render (`tui-kernel.ts:147`) — the same order the
  // Comments tab shows, because both read one sorted `commentResources`.
  const { lines } = detailLines(docWith(...ascending));
  const newest = lines.indexOf('body-C');
  const oldest = lines.indexOf('body-A');
  expect(newest, 'the newest body line is rendered').toBeGreaterThan(-1);
  expect(oldest, 'the oldest body line is rendered').toBeGreaterThan(-1);
  expect(newest).toBeLessThan(oldest);
});

it('initialExpandedComments seeds only the newest index', () => {
  const doc = docWith(...ascending);
  expect(initialExpandedComments(doc)).toEqual(new Set([0]));
  // The seed is only meaningful because index 0 IS the newest — the invariant
  // this helper shares with the sort, and the reason the kernel never has to
  // know which index that is.
  expect(commentItems(doc)[0].preview).toBe('body-C');
});

it('initialExpandedComments is empty for a document with no comments', () => {
  for (const doc of [
    {},
    { data: { attributes: {}, relationships: {} }, included: [] },
  ]) {
    const expanded = initialExpandedComments(doc);
    expect(expanded).toEqual(new Set());
    const view = tabViewTree(doc, COMMENTS_TAB, { expanded });
    expect(textOf(view)).toContain('No comments.');
    expect(view.selectable, 'nothing is selectable').toBe(0);
    expect(view.headerRows, 'no header rows').toEqual([]);
  }
});

// ---- BB-233 AC-12: the Assignment section --------------------------------
//
// AC-2/AC-3 say "the detail view reflects it" — before this ticket the detail
// screen rendered Description, Comments, Sub-tickets, Runs, Referenced tickets,
// Links, Branch and Environments, and named NEITHER assignee nor conductor, so
// there was nothing to reflect into. The labels come from the sideloaded
// includes the extended `?include=` already fetches (measured under `session`).

const assignmentDoc = (
  rel: {
    assignee?: string | null;
    conductor?: string | null;
    reviewers?: string[];
  } = {},
  included: unknown[] = [],
  attributes: Record<string, unknown> = {},
) => ({
  data: {
    id: 't1',
    type: 'bb_ticket--bb_ticket',
    attributes: { description: 'x', ...attributes },
    relationships: {
      assignee_user_id: { data: rel.assignee ? { id: rel.assignee } : null },
      conductor_id: { data: rel.conductor ? { id: rel.conductor } : null },
      reviewers: {
        data: (rel.reviewers ?? []).map((id) => ({
          type: 'user--user',
          id,
        })),
      },
    },
  },
  included,
});

it('AC-12: renders assignee + conductor from the sideloaded includes', () => {
  const doc = assignmentDoc({ assignee: 'u1', conductor: 'c1' }, [
    {
      id: 'u1',
      type: 'user--user',
      attributes: { display_name: 'cw', name: 'cw' },
    },
    {
      id: 'c1',
      type: 'bb_conductor--bb_conductor',
      attributes: { label: 'cw-framework' },
    },
  ]);
  const section = detailSections(doc).find((s) => s.heading === 'Assignment');
  expect(section).toBeTruthy();
  expect(sectionText(section).join('\n')).toMatch(/Assignee:\s+cw/);
  expect(sectionText(section).join('\n')).toMatch(/Reviewers:\s+—/);
  expect(sectionText(section).join('\n')).toMatch(/Conductor:\s+cw-framework/);
});

it('AC-12: an unassigned ticket gets explicit empty states', () => {
  const section = detailSections(assignmentDoc()).find(
    (s) => s.heading === 'Assignment',
  );
  expect(sectionText(section).join('\n')).toMatch(/Unassigned\./);
  expect(sectionText(section).join('\n')).toMatch(/Reviewers:\s+—/);
  expect(sectionText(section).join('\n')).toMatch(/No conductor\./);
});

it('renders every reviewer identity after Assignee, comma-joined', () => {
  const doc = assignmentDoc({ assignee: 'u1', reviewers: ['u2', 'u3'] }, [
    {
      id: 'u1',
      type: 'user--user',
      attributes: { display_name: 'cw', name: 'cw' },
    },
    {
      id: 'u2',
      type: 'user--user',
      attributes: { display_name: 'Ada Lovelace', name: 'ada' },
    },
    {
      id: 'u3',
      type: 'user--user',
      attributes: { display_name: 'Alan Turing', name: 'alan' },
    },
  ]);
  const lines = sectionText(
    detailSections(doc).find((s) => s.heading === 'Assignment'),
  );
  expect(lines[0]).toMatch(/Assignee:\s+cw/);
  expect(lines[1]).toBe('Reviewers: Ada Lovelace, Alan Turing');
});

it('AC-12: one set, one empty', () => {
  const doc = assignmentDoc({ assignee: 'u1' }, [
    { id: 'u1', type: 'user--user', attributes: { display_name: 'tm' } },
  ]);
  const lines = sectionText(
    detailSections(doc).find((s) => s.heading === 'Assignment'),
  ).join('\n');
  expect(lines).toMatch(/Assignee:\s+tm/);
  expect(lines).toMatch(/No conductor\./);
});

it('AC-12: falls back to the ticket’s own assignee_name when the include is absent', () => {
  // Robustness, not a second source of truth: the include is always requested,
  // but a document assembled without it must not put a raw uuid on screen.
  const doc = assignmentDoc({ assignee: 'u1' }, [], {
    assignee_name: 'Christian Wiedemann',
  });
  expect(
    sectionText(
      detailSections(doc).find((s) => s.heading === 'Assignment'),
    ).join('\n'),
  ).toMatch(/Christian Wiedemann/);
});

it('AC-12: the section sits on the Overview tab, right after Description', () => {
  const doc = assignmentDoc({ assignee: 'u1', conductor: 'c1' });
  const headings = detailSections(doc).map((s) => s.heading);
  expect(headings.indexOf('Assignment')).toBe(
    headings.indexOf('Description') + 1,
  );
  expect(sectionsForTab(doc, 0).map((s) => s.heading)).toContain('Assignment');
});

it('AC-12: detailLines (the piped, non-TTY output) carries the section too', () => {
  const doc = assignmentDoc({ conductor: 'c1' }, [
    {
      id: 'c1',
      type: 'bb_conductor--bb_conductor',
      attributes: { label: 'cw-framework' },
    },
  ]);
  const text = detailLines(doc).lines.join('\n');
  expect(text).toContain('Assignment');
  expect(text).toContain('cw-framework');
});

// BB-233, found in the LIVE run: spec Finding 10 measured the include on a
// ticket whose conductor was `cw-framework` — the SESSION's own. That does not
// generalise. `bb_conductor` is owner-gated for `session`, so assigning any
// other conductor (offered by the popup, whose list comes from the `pm` client
// that sees all four) leaves the include access-filtered away and the section
// rendered a raw uuid. The labels the popup already loaded are the fix; they
// cost no request.
it('AC-2/AC-3: a known label is used when the include is access-filtered away', () => {
  const doc = assignmentDoc({ assignee: 'u9', conductor: 'c9' }, []);
  const labels = {
    users: [{ id: 'u9', label: 'ms' }],
    conductors: [{ id: 'c9', label: 'Tom (offline)' }],
  };
  const lines = sectionText(
    detailSections(doc, labels).find((s) => s.heading === 'Assignment'),
  ).join('\n');
  expect(lines).toMatch(/Conductor:\s+Tom \(offline\)/);
  expect(lines).not.toContain('c9');
});

it('the sideloaded include still WINS over a known label', () => {
  const doc = assignmentDoc({ conductor: 'c9' }, [
    {
      id: 'c9',
      type: 'bb_conductor--bb_conductor',
      attributes: { label: 'from-the-include' },
    },
  ]);
  const labels = { users: [], conductors: [{ id: 'c9', label: 'stale' }] };
  expect(
    sectionText(
      detailSections(doc, labels).find((s) => s.heading === 'Assignment'),
    ).join('\n'),
  ).toContain('from-the-include');
});

it('with no include and no known label it degrades to the uuid, not to nothing', () => {
  const lines = sectionText(
    detailSections(assignmentDoc({ conductor: 'c9' })).find(
      (s) => s.heading === 'Assignment',
    ),
  ).join('\n');
  expect(lines).toContain('c9');
});

it('the labels reach sectionsForTab, tabViewTree and detailLines alike', () => {
  const doc = assignmentDoc({ conductor: 'c9' }, []);
  const labels = { users: [], conductors: [{ id: 'c9', label: 'Tom' }] };
  expect(
    sectionText(
      sectionsForTab(doc, 0, labels).find((s) => s.heading === 'Assignment'),
    ).join('\n'),
  ).toContain('Tom');
  expect(textOf(tabViewTree(doc, 0, { labels })).join('\n')).toContain('Tom');
  expect(detailLines(doc, labels).lines.join('\n')).toContain('Tom');
});

// ---- BB-255: summary-first Overview, parent + links above it, labels ------
//
// The Overview tab used to open with EVERY line of the ticket body, with the
// links fourth and the parent nowhere. These assertions pin the five requested
// changes at the render layer; the Kernel file pins the interaction.

/** A real bakers.build ticket body: opens with `## Context`, prose after it, long tail. */
const LONG_BODY = [
  '## Context',
  '',
  'The gist of the ticket, in one prose line.',
  'A second prose line that belongs to the same paragraph.',
  '',
  '## Requested changes',
  '',
  'TAIL-ONLY-LINE',
].join('\n');

const overviewDoc = {
  data: {
    id: 't-255',
    type: 'bb_ticket--bb_ticket',
    attributes: {
      identifier: 'BB-255',
      title: 'summary-first overview',
      description: { value: LONG_BODY },
      branch_name: 'feat/x',
      base_branch: 'develop',
      links: [{ title: 'MR', uri: 'https://git.example/mr/1' }],
    },
    relationships: {
      parent_id: { data: { id: 'p-1' } },
      labels: { data: [{ id: 'l-1' }, { id: 'l-2' }] },
      sub_tickets: { data: [] },
      referenced_tickets: { data: [] },
      runs: { data: [] },
      environments: { data: [] },
    },
  },
  included: [
    {
      id: 'p-1',
      type: 'bb_ticket--bb_ticket',
      attributes: { identifier: 'BB-200', title: 'the parent epic' },
    },
    {
      id: 'l-1',
      type: 'bb_term--bb_labels',
      attributes: { name: 'work:code' },
    },
    {
      id: 'l-2',
      type: 'bb_term--bb_labels',
      attributes: { name: 'priority:high' },
    },
  ],
};

/** No parent, no links, no labels — the AC-4 / AC-8 empty-state document. */
const bareDoc = {
  data: {
    id: 't-bare',
    type: 'bb_ticket--bb_ticket',
    attributes: {
      identifier: 'BB-1',
      title: 'bare',
      description: 'x',
      links: [],
    },
    relationships: {
      parent_id: { data: null },
      labels: { data: [] },
      sub_tickets: { data: [] },
      referenced_tickets: { data: [] },
      runs: { data: [] },
      environments: { data: [] },
    },
  },
  included: [],
};

// AC-1 / D1 — the summary rule, stated once and tested on its own.
/**
 * The extract, as the text it renders — BB-372 D8.
 *
 * `descriptionSummary` works on RENDERED lines now and returns rendered lines:
 * its "skip leading ATX headings" step reads `line.heading` instead of
 * re-matching `/^#{1,6}\s/`, and its `… +N more lines` counts the rendered lines
 * the expand actually reveals — a dropped fence row is not a line the expand
 * produces. Every documented property is otherwise unchanged.
 */
const extractOf = (body: string): string[] =>
  descriptionSummary(markdownLines(body)).map((line) => line.text);

it('AC-1: descriptionSummary skips leading blank lines and ATX headings', () => {
  const summary = extractOf(LONG_BODY);
  expect(
    summary[0],
    'the first summary line is the first PROSE line, not "## Context"',
  ).toBe('The gist of the ticket, in one prose line.');
  expect(summary.join('\n')).not.toContain('## Context');
  expect(
    summary.join('\n'),
    'a line that exists only in the body tail is not in the summary',
  ).not.toContain('TAIL-ONLY-LINE');
});

it('AC-1: descriptionSummary takes the run of consecutive non-empty lines', () => {
  const summary = extractOf(LONG_BODY);
  expect(summary.slice(0, 2)).toEqual([
    'The gist of the ticket, in one prose line.',
    'A second prose line that belongs to the same paragraph.',
  ]);
  expect(
    summary[2],
    'the blank line ends the paragraph; the marker follows',
  ).toMatch(/^… \+\d+ more lines$/);
});

it('AC-1: descriptionSummary caps the summary at SUMMARY_MAX_LINES', () => {
  const body = Array.from({ length: 40 }, (_l, i) => `line ${i}`).join('\n');
  const summary = extractOf(body);
  expect(SUMMARY_MAX_LINES).toBe(5);
  expect(
    summary.filter((l) => l.startsWith('line ')).length,
    'never more than the cap, however long the paragraph',
  ).toBe(SUMMARY_MAX_LINES);
  expect(summary.at(-1)).toBe('… +35 more lines');
});

// BB-255 review finding — WHICH of the two candidate counts the marker states.
// It is "how many more lines EXPANDING REVEALS" (`all.length - shown`), which
// includes the leading heading and blank line the summary skipped ABOVE it. The
// alternative — only the lines BELOW the summary — under-reports what the expand
// actually produces, and S1 asks for "how many further lines the full body has".
// Pinned here on a body where the two numbers differ, so the question cannot be
// silently re-answered.
it('AC-1: the marker counts every line expanding reveals, skipped headings included', () => {
  const body = ['## Context', '', 'the only prose line', '', 'a later line'];
  const summary = extractOf(body.join('\n'));
  expect(summary[0], 'the heading is skipped, not shown').toBe(
    'the only prose line',
  );
  expect(
    summary.at(-1),
    'body 5 lines − 1 shown = 4 revealed by expanding (not the 2 lines below it)',
  ).toBe('… +4 more lines');
});

it('AC-1: the marker appears only when the body has more lines than the summary shows', () => {
  const summary = extractOf('one line only');
  expect(summary).toEqual(['one line only']);
  expect(
    summary.some((l) => l.includes('more lines')),
    'a body that fits gets no marker',
  ).toBe(false);
});

// R7 — the unusual bodies.
it('R7: a heading-only body still shows something, and an empty body says so', () => {
  expect(
    extractOf('## Only\n## Headings').join('\n'),
    'nothing skippable is left, so the headings themselves are the summary',
  ).toContain('Only');
  expect(extractOf('')).toEqual(['No description.']);
  expect(extractOf('\n\n')).toEqual(['No description.']);
});

it('AC-1: the collapsed Overview shows the summary and not the body tail', () => {
  const view = tabViewTree(overviewDoc, OVERVIEW_TAB, {
    expanded: new Set(),
  });
  const text = textOf(view).join('\n');
  expect(text).toContain('The gist of the ticket, in one prose line.');
  expect(
    text,
    'the collapsed state must not print the whole body',
  ).not.toContain('TAIL-ONLY-LINE');
  expect(text, 'and it says how much is hidden').toMatch(/… \+\d+ more lines/);
  // BB-369 D4 — Description is entry ONE now; `Latest summary` is entry 0.
  expect(
    view.selectable,
    'the Overview tab’s two selectable entries, summary then description',
  ).toBe(2);
  expect(view.headerRows, 'each with a header row to click').toHaveLength(2);
  expect(
    textOf(view)[view.headerRows[1] ?? 0],
    'and the Description entry is the second of them',
  ).toContain('Description');
});

it('AC-2: expanding the Description entry reveals the full body; collapsing restores it byte-identically', () => {
  // BB-369 D4 — the INDEX moved from 0 to 1 because `Latest summary` took entry
  // 0. AC-2's claim is about the Description entry, not about a number, so the
  // index is the only thing that changed here.
  const DESCRIPTION_ENTRY = 1;
  const collapsed = tabViewTree(overviewDoc, OVERVIEW_TAB, {
    expanded: new Set(),
  });
  const expanded = tabViewTree(overviewDoc, OVERVIEW_TAB, {
    expanded: new Set([DESCRIPTION_ENTRY]),
  });
  expect(textOf(expanded).join('\n')).toContain('TAIL-ONLY-LINE');
  expect(
    textOf(expanded)[collapsed.headerRows[DESCRIPTION_ENTRY] ?? 0],
    'the caret flips on the same row',
  ).toMatch(/▾/);
  expect(
    textOf(collapsed)[collapsed.headerRows[DESCRIPTION_ENTRY] ?? 0],
  ).toMatch(/▸/);
  const again = tabViewTree(overviewDoc, OVERVIEW_TAB, {
    expanded: new Set(),
  });
  expect(
    textOf(again),
    'collapsing returns exactly the rows from before',
  ).toEqual(textOf(collapsed));
  // And the same NODE carries them: the caret row keeps its id through both
  // toggles, so `patchTree` writes the flipped glyph onto the standing
  // renderable instead of rebuilding the entry (D4).
  expect(idsOf(again.body)).toEqual(idsOf(collapsed.body));
  const caret = 'ticket-detail-description-header';
  for (const view of [collapsed, expanded, again]) {
    expect(idsOf(view.body), 'the caret row is one node throughout').toContain(
      caret,
    );
  }
});

it('AC-3 / D3: Overview orders Parent and Links ABOVE Description', () => {
  // BB-369 D3 put `Latest summary` between Links and Description. AC-3's own
  // claim — Parent and Links are visible in the freshly opened frame, above
  // Description — is unchanged by that: the summary went in BELOW them.
  expect(
    sectionsForTab(overviewDoc, OVERVIEW_TAB).map((s) => s.heading),
  ).toEqual([
    'Source',
    'Parent',
    'Links',
    'Latest summary',
    'Description',
    'Assignment',
    'Time',
    'Branch',
    'Environments',
  ]);
  const lines = textOf(tabViewTree(overviewDoc, OVERVIEW_TAB));
  const rowOf = (needle: string): number =>
    lines.findIndex((l) => l.includes(needle));
  expect(rowOf('BB-200'), 'the parent row is rendered').toBeGreaterThan(-1);
  expect(rowOf('https://git.example/mr/1'), 'the link row is').toBeGreaterThan(
    -1,
  );
  expect(rowOf('BB-200')).toBeLessThan(rowOf('Description'));
  expect(rowOf('https://git.example/mr/1')).toBeLessThan(rowOf('Description'));
});

it('AC-4: a ticket with no parent and no links gets explicit empty states', () => {
  const sections = detailSections(bareDoc);
  expect(sections.find((s) => s.heading === 'Parent')?.lines).toEqual([
    'No parent ticket.',
  ]);
  expect(sections.find((s) => s.heading === 'Links')?.lines).toEqual([
    'No links.',
  ]);
  for (const heading of ['Parent', 'Links', 'Labels']) {
    const section = sections.find((s) => s.heading === heading);
    expect(section?.lines.length, `${heading} renders a row`).toBeGreaterThan(
      0,
    );
    for (const line of sectionText(section)) {
      expect(line.trim(), `${heading} row is never blank`).not.toBe('');
    }
  }
});

it('AC-4 / D4: a parent whose include is absent degrades to the uuid, never to nothing', () => {
  const doc = {
    ...overviewDoc,
    included: overviewDoc.included.filter((r) => r.id !== 'p-1'),
  };
  const lines = sectionText(
    detailSections(doc).find((s) => s.heading === 'Parent'),
  );
  expect(lines.join('\n')).toContain('p-1');
  expect(lines.length).toBe(1);
});

it('AC-5: the Related tab lists the parent beside sub- and referenced tickets', () => {
  // BB-369 D5 added `Blocked by`. AC-5's claim — the parent belongs on Related as
  // much as on Overview — is untouched by where the new section went.
  expect(
    sectionsForTab(overviewDoc, RELATED_TAB).map((s) => s.heading),
  ).toEqual([
    'Source',
    'Parent',
    'Sub-tickets',
    'Blocked by',
    'Referenced tickets',
  ]);
});

it('AC-8 / D8: headerLabels renders the label names, the uuid, or an explicit dash', () => {
  expect(headerLabels(overviewDoc)).toBe('work:code, priority:high');
  expect(headerLabels(bareDoc), 'no labels is stated, never blank').toBe('—');
  const noInclude = { ...overviewDoc, included: [] };
  expect(headerLabels(noInclude), 'the uuid is ugly but true').toContain('l-1');
});

it('D11: detailLines (the piped render) carries Labels and Parent', () => {
  const text = detailLines(overviewDoc).lines.join('\n');
  expect(text).toContain('Labels');
  expect(text).toContain('work:code');
  expect(text).toContain('Parent');
  expect(text).toContain('BB-200');
});

// AC-6 / D5 — the Runs tab is the EXISTING run table over the sideloaded runs, so
// a run looks the same here as on the project-wide Runs screen. Ordered
// newest-started first by a TOTAL comparator (see runs.test.ts for the order
// itself); this file pins what the tab renders.

const RUN_A = {
  id: 'run-a',
  type: 'bb_run--bb_run',
  attributes: {
    drupal_internal__id: 4592,
    state: 'done',
    state_at_start: 'spec',
    agent: 'claude',
    started_at: '2026-08-01T10:00:00+00:00',
  },
  relationships: { ticket_id: { data: { id: 't-255' } } },
};
const RUN_B = {
  id: 'run-b',
  type: 'bb_run--bb_run',
  attributes: {
    drupal_internal__id: 4599,
    state: 'running',
    state_at_start: 'coding',
    agent: 'claude',
    started_at: '2026-08-01T18:00:00+00:00',
    heartbeat: '2026-08-01T18:00:30+00:00',
  },
  relationships: { ticket_id: { data: { id: 't-255' } } },
};
const runsNow = Math.floor(Date.parse('2026-08-01T18:01:00Z') / 1000);

const runsDoc = {
  data: {
    ...overviewDoc.data,
    relationships: {
      ...overviewDoc.data.relationships,
      runs: { data: [{ id: 'run-a' }, { id: 'run-b' }] },
    },
  },
  included: [...overviewDoc.included, RUN_A, RUN_B],
};

it('AC-6: the Runs tab renders one selectable row per run, not a count', () => {
  const view = tabViewTree(runsDoc, RUNS_TAB, { nowSeconds: runsNow });
  expect(view.selectable, 'one entry per bb_run').toBe(2);
  expect(view.headerRows, 'row 0 is the table header (D5)').toEqual([1, 2]);
  // The cells are their own nodes now, so the row's text is the row's cells in
  // order — which is what `renderTree` returns for a row box.
  const rowText = (index: number): string =>
    renderTree(
      nodeById(
        view.body,
        index === 0 ? 'run-header' : `run-row-${['run-b', 'run-a'][index - 1]}`,
      ) as NonNullable<ReturnType<typeof nodeById>>,
    ).join(' ');
  const text = textOf(view).join('\n');
  expect(text, 'the bare count is gone').not.toMatch(/^\s*2 runs\s*$/m);
  expect(rowText(0), 'the shared run table header').toContain('RUN');
  expect(rowText(1), 'newest started first').toContain('#4599');
  expect(rowText(2)).toContain('#4592');
  expect(text, 'the derived STATE column').toContain('running');
});

it('AC-6: a ticket with no runs shows an explicit empty state', () => {
  const view = tabViewTree(overviewDoc, RUNS_TAB, { nowSeconds: runsNow });
  expect(view.selectable).toBe(0);
  expect(view.headerRows).toEqual([]);
  expect(textOf(view).join('\n')).toMatch(/No runs for this ticket\./);
});

it('D11: the piped render carries the run rows too', () => {
  const text = detailLines(runsDoc, undefined, runsNow).lines.join('\n');
  expect(text).toContain('#4599');
  expect(text).toContain('#4592');
});

// ─── BB-372 — the ticket detail hands over RENDERED bodies ─────────────────
//
// AC-1/AC-2: the description and every comment render as Markdown, and it is the
// SAME rendering because both producers call the same function on the same seam
// (D3). AC-5: every non-Markdown section hands over plain strings, so no Markdown
// rule can reach it.

/** A body with one of every construct the D2 subset names. */
const RICH_BODY = [
  '## Goal',
  '',
  'A **bold** word, an *em* one and some `code`.',
  '',
  '- [ ] **AC-1** the first one',
  '- a plain bullet',
  '',
  '> a ~~struck~~ quote',
  '',
  '```ts',
  'const x = 1;',
  '```',
  '',
  'See [the MR](https://x.test/mr/1).',
].join('\n');

const richDoc = {
  data: {
    id: 't-372',
    type: 'bb_ticket--bb_ticket',
    attributes: {
      identifier: 'BB-372',
      title: 'markdown',
      description: { value: RICH_BODY },
      // AC-5 — every value below holds a character a Markdown rule would touch.
      branch_name: 'feat/a_b_c',
      base_branch: 'feat/__init__',
      links: [{ title: '*starred*', uri: 'https://x.test/a' }],
      time_estimate: 3600,
      time_spent: 3600,
      assignee_name: '**cw**',
    },
    relationships: {
      labels: { data: [{ id: 'l-x' }] },
      sub_tickets: { data: [] },
      referenced_tickets: { data: [] },
      runs: { data: [] },
      environments: { data: [] },
    },
  },
  included: [
    {
      id: 'l-x',
      type: 'bb_term--bb_labels',
      attributes: { name: '__x__' },
    },
    {
      id: 'uuid-md',
      type: 'bb_comment--bb_comment',
      attributes: {
        bb_comment_type: 'summary',
        author_name: 'cw',
        created: '2026-08-18T10:00:00+00:00',
        body: { value: '## Outcome\nIt **worked**.\n- [x] shipped' },
      },
    },
  ],
};

/** The `Description` section's rows, as `[text, runs]` pairs. */
const descriptionRows = (
  doc: Parameters<typeof detailSections>[0],
): { text: string; runs: unknown }[] =>
  sectionRows([
    detailSections(doc).find((s) => s.heading === 'Description') as Parameters<
      typeof sectionRows
    >[0][number],
  ])
    .slice(1, -1)
    .map((row) => ({ text: row.text, runs: row.runs }));

it('AC-1: the Description section hands over rendered lines with runs', () => {
  const rows = descriptionRows(richDoc);
  const texts = rows.map((row) => row.text);
  expect(texts).toEqual([
    'Goal',
    '',
    'A bold word, an em one and some code.',
    '',
    '☐ AC-1 the first one',
    '• a plain bullet',
    '',
    '│ a struck quote',
    '',
    '  const x = 1;',
    '',
    'See the MR (https://x.test/mr/1).',
  ]);
  // No row carries a raw marker any more — the AC-1 defect, gone.
  for (const text of texts) {
    expect(text, `${text} carries no raw marker`).not.toMatch(
      /\*\*|`|- \[ \]|~~/,
    );
  }
  const bold = rows.find((row) => row.text.startsWith('A bold'));
  expect(bold?.runs).toEqual([
    { text: 'A ', attributes: 0 },
    { text: 'bold', attributes: BOLD },
    { text: ' word, an ', attributes: 0 },
    { text: 'em', attributes: ITALIC },
    { text: ' one and some ', attributes: 0 },
    { text: 'code', attributes: 0, fg: BORDER },
    { text: '.', attributes: 0 },
  ]);
});

it('AC-2: a comment body is rendered by the SAME function as the description', () => {
  // Structural, not "they agree": both producers call `markdownLines` on the seam
  // where a body string becomes rows (D3), so the flat Comments section, the
  // Comments tab and the Description cannot drift.
  const comments = sectionText(
    detailSections(richDoc).find((s) => s.heading === 'Comments'),
  );
  expect(comments).toEqual([
    '— summary ·',
    'Outcome',
    'It worked.',
    '☑ shipped',
  ]);
  const [item] = commentItems(richDoc);
  expect(item.bodyLines.map((line) => line.text)).toEqual([
    'Outcome',
    'It worked.',
    '☑ shipped',
  ]);
  // D8 — the collapsed header's preview is the RENDERED first line. `## Outcome`
  // in a collapsed header is the raw-source defect one row further out.
  expect(item.preview).toBe('Outcome');
});

it('AC-2: the `— type ·` marker rows stay PLAIN strings (D3)', () => {
  const section = detailSections(richDoc).find((s) => s.heading === 'Comments');
  expect(
    section?.lines[0],
    'the marker is the producer`s own text, not a body line',
  ).toBe('— summary ·');
});

// AC-5 — the sections that are NOT Markdown, asserted byte-identical to their
// inputs. This is structural (D3): they hand over plain strings and the plain path
// no longer parses at all, so there is no rule left that could reach them.
it('AC-5: Assignment, Time, Branch, Links and Labels rows are byte-identical', () => {
  const sections = detailSections(richDoc);
  const rowsOf = (heading: string): unknown[] =>
    sections.find((s) => s.heading === heading)?.lines ?? [];
  expect(rowsOf('Branch')).toEqual([
    'branch: feat/a_b_c',
    'base:   feat/__init__',
  ]);
  expect(rowsOf('Links')).toEqual(['*starred* https://x.test/a']);
  expect(rowsOf('Labels')).toEqual(['__x__']);
  expect(rowsOf('Assignment')).toEqual([
    'Assignee:  **cw**',
    'Reviewers: —',
    'No conductor.',
  ]);
  expect(rowsOf('Time')).toEqual([
    'estimate: 1h',
    'spent:    1h',
    'left:     0m',
  ]);
  // And every one of them is a `string`, which is what makes it unreachable.
  for (const heading of ['Branch', 'Links', 'Labels', 'Assignment', 'Time']) {
    for (const line of rowsOf(heading)) {
      expect(typeof line, `${heading} hands over plain text`).toBe('string');
    }
  }
  // Nothing is bolded and nothing carries runs, however many markers it holds.
  for (const heading of ['Branch', 'Links', 'Labels', 'Assignment', 'Time']) {
    for (const row of sectionRows([
      sections.find((s) => s.heading === heading) as Parameters<
        typeof sectionRows
      >[0][number],
    ]).slice(1, -1)) {
      expect(row.bold, `${heading}: ${row.text}`).toBe(false);
      expect(row.runs, `${heading}: ${row.text}`).toBeUndefined();
    }
  }
});

it('AC-5: the Runs table`s columned rows are still never read as markdown', () => {
  // The pre-existing invariant AC-4 names, kept by construction: a `cells` row is
  // its own `SectionLine` variant and `bodyRow` returns it before any other rule.
  const rows = sectionRows([
    detailSections(runsDoc, undefined, runsNow).find(
      (s) => s.heading === 'Runs',
    ) as Parameters<typeof sectionRows>[0][number],
  ]);
  const run = rows.find((row) => row.text.includes('#4599'));
  expect(run?.bold).toBe(false);
  expect(run?.runs).toBeUndefined();
  expect(run?.text).toContain('#4599');
});

// D8 — the extract over RENDERED lines keeps every documented property, and the
// marker counts the rendered lines the expand reveals.
it('D8: the marker counts RENDERED lines, so a dropped fence row is not counted', () => {
  // R8 — the row count a fenced body renders IS what expanding produces: the two
  // fence rows are gone, so the marker must not promise them.
  const body = ['## Goal', '', 'the gist', '', '```', 'code', '```'].join('\n');
  const lines = markdownLines(body);
  expect(lines, 'seven source lines render five rows').toHaveLength(5);
  const summary = descriptionSummary(lines).map((line) => line.text);
  expect(summary).toEqual(['the gist', '… +4 more lines']);
  // And the count agrees with what the expand really shows.
  expect(lines).toHaveLength(summary.length - 1 + 4);
});

it('D8: the extract skips a heading by its `heading` FLAG, not by a re-match', () => {
  // A body line that merely LOOKS like a heading after rendering — a fenced
  // `## comment` — must not be skipped, because it is not a heading.
  const lines = markdownLines(['```', '## not a heading', '```'].join('\n'));
  expect(descriptionSummary(lines).map((line) => line.text)).toEqual([
    '  ## not a heading',
  ]);
});

it('D8: an empty description still says so', () => {
  const empty = detailSections({
    data: { attributes: {}, relationships: {} },
    included: [],
  }).find((s) => s.heading === 'Description');
  expect(empty?.lines).toEqual(['No description.']);
  expect(
    sectionText(empty),
    'and the collapsible entry renders it unchanged',
  ).toEqual(['No description.']);
});

it('AC-1: the collapsed Overview extract is rendered, not raw', () => {
  const view = tabViewTree(richDoc, OVERVIEW_TAB, { expanded: new Set() });
  const text = textOf(view).join('\n');
  expect(text).toContain('A bold word, an em one and some code.');
  expect(text, 'no raw marker survives the collapsed state').not.toMatch(
    /\*\*bold\*\*/,
  );
  // ENTRY 1, NOT 0 — BB-369 D3/D4 put `Latest summary` in
  // `EXPANDABLE_HEADINGS` ABOVE `Description`, so Overview's `selectable` is 2
  // and `Description` is the SECOND entry. This index moved for that reason and
  // for no other: the assertion below is unchanged, and it is still
  // `Description`'s task list it reads.
  const expanded = textOf(
    tabViewTree(richDoc, OVERVIEW_TAB, { expanded: new Set([1]) }),
  ).join('\n');
  expect(expanded).toContain('☐ AC-1 the first one');
  expect(expanded).not.toMatch(/- \[ \]/);
});

it('AC-2: the Comments tab renders the body and indents the RENDERED line (D5)', () => {
  const view = tabViewTree(richDoc, COMMENTS_TAB, {
    expanded: new Set([0]),
    nowSeconds: Math.floor(Date.parse('2026-08-18T10:03:00Z') / 1000),
  });
  const rows = textOf(view);
  expect(rows[0], 'the header carries the rendered preview').toContain(
    'Outcome',
  );
  expect(rows.slice(1, 4)).toEqual([
    '    Outcome',
    '    It worked.',
    '    ☑ shipped',
  ]);
});

it('D5: four leading spaces in the SOURCE are not turned into a code block', () => {
  // Fact 9 — four spaces prepended to source would be an indented code block in
  // CommonMark. The indent is applied to the ALREADY RENDERED line, so a body
  // whose own first line is indented four columns renders as prose, indented
  // eight in the Comments tab and four in the source.
  const doc = {
    included: [
      {
        id: 'uuid-indented',
        type: 'bb_comment--bb_comment',
        attributes: {
          bb_comment_type: 'comment',
          body: { value: '    four spaces of **prose**' },
        },
      },
    ],
  };
  const [item] = commentItems(doc);
  expect(item.bodyLines[0]?.text).toBe('    four spaces of prose');
  expect(item.bodyLines[0]?.runs).toEqual([
    { text: '    four spaces of ', attributes: 0 },
    { text: 'prose', attributes: BOLD },
  ]);
  const rows = textOf(
    tabViewTree(doc, COMMENTS_TAB, { expanded: new Set([0]) }),
  );
  expect(rows[1]).toBe('        four spaces of prose');
});

it('D3: a body row`s runs reach the NODE the screen hands over', () => {
  const view = tabViewTree(richDoc, OVERVIEW_TAB, { expanded: new Set([0]) });
  const node = idsOf(view.body)
    .map((id) => nodeById(view.body, id))
    .find(
      (candidate) =>
        typeof (candidate?.props as { content?: unknown } | undefined)
          ?.content === 'object',
    );
  expect(
    node,
    'a styled body row hands over StyledText, not a string',
  ).toBeDefined();
  const props = node?.props as
    | { content: { chunks: { text: string }[] } }
    | undefined;
  const chunks = props?.content.chunks ?? [];
  expect(chunks.length, 'a styled row is split into runs').toBeGreaterThan(1);
});

it('D3: plainLine is what lifts a non-Markdown line onto the expandable surface', () => {
  // The `No description.` empty state and a columned line reach the collapsible
  // Description entry as plain rendered lines, so nothing there is ever parsed.
  // D11 — the lift is `Component/markdown`'s `plainLine`; it was `lib/markdown`'s
  // `plainMarkdown` and neither its behaviour nor this assertion changed.
  expect(plainLine('## No description.').heading).toBe(false);
});

// BB-369 — the three facts the full detail used to omit: the current workflow
// state, the newest `summary` comment, and `blocked_by`.

/** The overview document with a state, two summaries and two blockers. */
const stateDoc = {
  data: {
    ...overviewDoc.data,
    attributes: { ...overviewDoc.data.attributes, state: 'coding' },
  },
  included: overviewDoc.included,
};

it('AC-1 / D1: headerState renders the state attribute, or an explicit dash', () => {
  expect(headerState(stateDoc)).toBe('coding');
  expect(
    headerState(bareDoc),
    'a document without the attribute states so, never a blank row',
  ).toBe('—');
});

it('AC-9a / D1: an EMPTY state string is a dash too, never a bare `State: `', () => {
  // `asString('')` is `''`, and `'' ?? '—'` is `''` — so the nullish coalescing
  // this used covered the ABSENT attribute and not the empty one. A ticket whose
  // `state` is an empty string is not hypothetical (a partial fixture, a read
  // profile that stripped the value to `""` rather than dropping the key), and it
  // rendered a bare `State: ` in a fixed-height header box, which is
  // indistinguishable from a rendering bug — exactly what the docblock above
  // `headerState` promises never happens.
  const emptyState = {
    data: {
      ...stateDoc.data,
      attributes: { ...stateDoc.data.attributes, state: '' },
    },
    included: stateDoc.included,
  };
  expect(headerState(emptyState)).toBe('—');
  expect(
    detailSections(emptyState).find((s) => s.heading === 'State')?.lines,
    'and the flat render says the same thing the header does',
  ).toEqual(['—']);
});

it('AC-1 / D1: detailSections carries a State section with that same value', () => {
  const sections = detailSections(stateDoc);
  expect(sections.find((s) => s.heading === 'State')?.lines).toEqual([
    'coding',
  ]);
  expect(
    sections[0]?.heading,
    'State leads the flat render — it is the fact the operator scans for (D7)',
  ).toBe('State');
  expect(
    detailSections(bareDoc).find((s) => s.heading === 'State')?.lines, //
  ).toEqual(['—']);
});

it('AC-1 / D1: the header and the State section cannot disagree', () => {
  // Both read the same function, the way `headerLabels` is shared today — so the
  // TTY header box and `bakers ui <id> | cat` render one value, not two.
  const section = detailSections(stateDoc).find((s) => s.heading === 'State');
  expect(section?.lines).toEqual([headerState(stateDoc)]);
});

it('AC-1 / D1: NO tab lists State — it is the Labels/D11 precedent', () => {
  for (let tab = 0; tab < TICKET_SECTIONS.length; tab += 1) {
    expect(
      sectionsForTab(stateDoc, tab).map((s) => s.heading),
      `tab ${TICKET_SECTIONS[tab]?.id} must not list State`,
    ).not.toContain('State');
  }
});

it('AC-4 / D1: the piped render carries the state', () => {
  const text = detailLines(stateDoc).lines.join('\n');
  expect(text).toContain('State');
  expect(text).toContain('coding');
});

// BB-369 AC-2 / D3 — the LATEST SUMMARY. `latestSummary` filters
// `commentResources()` (the document's comments in their TOTAL newest-first
// order) down to `bb_comment_type === 'summary'` and takes the first, so
// "newest" here is the same order the Comments tab uses rather than the include's
// arrival order.

const summaryComment = (
  id: string,
  type: string,
  drupalId: number,
  created: string,
  body: string,
  author = 'cw',
) => ({
  id,
  type: 'bb_comment--bb_comment',
  attributes: {
    drupal_internal__id: drupalId,
    bb_comment_type: type,
    author_name: author,
    created,
    body: { value: body },
  },
});

/** Two summaries with the SAME `created`, plus a NEWER non-summary comment. */
const summaryDoc = {
  data: stateDoc.data,
  included: [
    ...overviewDoc.included,
    summaryComment(
      'c-old',
      'summary',
      11,
      '2026-08-10T09:00:00+00:00',
      'OLDER-SUMMARY',
    ),
    summaryComment(
      'c-new',
      'summary',
      12,
      '2026-08-10T09:00:00+00:00',
      'NEWER-SUMMARY',
    ),
    summaryComment(
      'c-hand',
      'handoff',
      13,
      '2026-08-10T23:00:00+00:00',
      'NOT-A-SUMMARY',
    ),
  ],
};

/**
 * The `Latest summary` section's rows as TEXT.
 *
 * BB-372 D3/D4 — this read `?.lines ?? []` directly and returned `string[]`,
 * which held while the section's rows were `body.split('\n')`. The body is
 * `markdownLines(...)` now, so the rows are `StyledLine`s; `sectionText` reads
 * the text of whichever variant a row is (D4 — that text IS what the pipe
 * prints). Every assertion below is unchanged by the switch: they all compare the
 * rendered TEXT, and for BB-369's own ATX-free fixture bodies the rendered text
 * is the source text.
 */
const summaryOf = (doc: unknown): string[] =>
  sectionText(detailSections(doc).find((s) => s.heading === 'Latest summary'));

it('AC-2 / D3: the NEWEST summary wins, decided by the drupal_internal__id tie-break', () => {
  const lines = summaryOf(summaryDoc);
  expect(
    lines.join('\n'),
    'equal `created`, so only the monotonic server key can decide',
  ).toContain('NEWER-SUMMARY');
  expect(lines.join('\n')).not.toContain('OLDER-SUMMARY');
});

it('AC-2 / D3: a non-summary comment is never chosen, however new it is', () => {
  // The `handoff` comment is 14 hours newer than either summary. The exact-match
  // filter on `bb_comment_type` is what keeps it out.
  expect(summaryOf(summaryDoc).join('\n')).not.toContain('NOT-A-SUMMARY');
});

it('AC-2 / D3: the marker row names the type, the author and the created stamp', () => {
  expect(summaryOf(summaryDoc)[0]).toBe(
    '— summary · cw · 2026-08-10T09:00:00+00:00',
  );
  expect(summaryOf(summaryDoc)[1], 'then the body, one row per line').toBe(
    'NEWER-SUMMARY',
  );
});

it('AC-2 / D3: a multi-line summary body is one row per physical line', () => {
  const doc = {
    data: stateDoc.data,
    included: [
      summaryComment(
        'c-1',
        'summary',
        5,
        '2026-08-10T09:00:00+00:00',
        'A\nB\nC',
      ),
    ],
  };
  expect(summaryOf(doc)).toEqual([
    '— summary · cw · 2026-08-10T09:00:00+00:00',
    'A',
    'B',
    'C',
  ]);
});

it('AC-2 / D3: with no summary comment the section says so — never a blank gap', () => {
  expect(summaryOf(bareDoc)).toEqual(['No summary comment.']);
  // A document WITH comments but none of type `summary` gets the same copy: R5's
  // free-text field means a typo (`summarys`) falls back to exactly this, which is
  // stated so the behaviour is not a surprise.
  const typo = {
    data: stateDoc.data,
    included: [
      summaryComment(
        'c-1',
        'summarys',
        5,
        '2026-08-10T09:00:00+00:00',
        'TYPO-BODY',
      ),
    ],
  };
  expect(summaryOf(typo)).toEqual(['No summary comment.']);
});

it('AC-9b / D3: an EMPTY-BODIED summary emits the marker alone — no blank row, no marker that counts nothing', () => {
  // A `summary` comment whose body is empty is a real shape: an agent that wrote
  // the comment type and stamped it but left the body out. The section fell back
  // to `['']`, which cost two lies at once — a blank row in the flat render, and
  // a collapsed extract of one line against a two-line body, so
  // `descriptionSummary` appended `… +1 more lines` for a line that is empty.
  const emptyBody = {
    data: stateDoc.data,
    included: [
      summaryComment('c-empty', 'summary', 7, '2026-08-10T09:00:00+00:00', ''),
    ],
  };
  expect(summaryOf(emptyBody)).toEqual([
    '— summary · cw · 2026-08-10T09:00:00+00:00',
  ]);
  // And in the piped render: the marker, the ONE blank `flattenSections` puts
  // between every pair of sections, then the next heading. Two blanks is what the
  // dropped `['']` produced — which is what the `Comments` section still shows for
  // the same comment, deliberately, since a blank there separates two bodies.
  expect(detailLines(emptyBody).lines.join('\n')).toContain(
    '— summary · cw · 2026-08-10T09:00:00+00:00\n\nDescription',
  );
  // The collapsed Overview entry: `descriptionSummary` counts the body's lines
  // against what it shows, so the dropped `['']` is also what stops the entry
  // advertising a line nobody can reveal.
  const view = tabViewTree(emptyBody, OVERVIEW_TAB, { expanded: new Set() });
  const summaryRow = view.headerRows[0] ?? 0;
  const rows = textOf(view);
  expect(
    rows.slice(summaryRow, view.headerRows[1] ?? rows.length).join('\n'),
    'nothing in the entry claims there is more to expand',
  ).not.toMatch(/… \+\d+ more lines/);
});

it('AC-4 / D3: the piped render carries the latest summary', () => {
  const text = detailLines(summaryDoc).lines.join('\n');
  expect(text).toContain('Latest summary');
  expect(text).toContain('NEWER-SUMMARY');
});

// BB-369 D3/D4 — `Latest summary` is a COLLAPSIBLE Overview entry, and adding
// it moves Description from entry 0 to entry 1.

/** A summary whose body is longer than the collapsed extract can show. */
const longSummaryDoc = {
  data: stateDoc.data,
  included: [
    ...overviewDoc.included,
    summaryComment(
      'c-long',
      'summary',
      20,
      '2026-08-10T09:00:00+00:00',
      [
        'Summary line 1',
        'Summary line 2',
        'Summary line 3',
        'Summary line 4',
        'Summary line 5',
        'SUMMARY-TAIL-ONLY',
      ].join('\n'),
    ),
  ],
};

it('D3: overview lists Latest summary BEFORE Description', () => {
  expect(
    sectionsForTab(longSummaryDoc, OVERVIEW_TAB).map((s) => s.heading),
  ).toEqual([
    'Source',
    'Parent',
    'Links',
    'Latest summary',
    'Description',
    'Assignment',
    'Time',
    'Branch',
    'Environments',
  ]);
});

it('D4: Overview has TWO selectable entries — the summary is entry 0', () => {
  const view = tabViewTree(longSummaryDoc, OVERVIEW_TAB, {
    expanded: new Set(),
  });
  expect(view.selectable, 'was 1 before the summary joined the set').toBe(2);
  expect(view.headerRows).toHaveLength(2);
  const rows = textOf(view);
  expect(rows[view.headerRows[0] ?? 0], 'entry 0 is the summary').toContain(
    'Latest summary',
  );
  expect(rows[view.headerRows[1] ?? 0], 'entry 1 is the description').toContain(
    'Description',
  );
  // The node ids the screen publishes as `rowIds`, so a click resolves to the
  // entry it is — the summary's own key leads.
  expect(view.rowIds).toEqual([
    'ticket-detail-latest-summary-header',
    'ticket-detail-description-header',
  ]);
});

it('D3: collapsed shows the extract; expanding entry 0 reveals the summary tail', () => {
  const collapsed = tabViewTree(longSummaryDoc, OVERVIEW_TAB, {
    expanded: new Set(),
  });
  expect(textOf(collapsed).join('\n')).toContain('Summary line 1');
  expect(
    textOf(collapsed).join('\n'),
    'the collapsed extract stops at SUMMARY_MAX_LINES',
  ).not.toContain('SUMMARY-TAIL-ONLY');
  expect(textOf(collapsed).join('\n')).toMatch(/… \+\d+ more lines/);

  const expanded = tabViewTree(longSummaryDoc, OVERVIEW_TAB, {
    expanded: new Set([0]),
  });
  expect(textOf(expanded).join('\n')).toContain('SUMMARY-TAIL-ONLY');
  expect(
    textOf(expanded)[collapsed.headerRows[0] ?? 0],
    'the caret flips on the summary`s own row',
  ).toMatch(/▾/);
  expect(textOf(collapsed)[collapsed.headerRows[0] ?? 0]).toMatch(/▸/);
});

it('D4: entry 1 is Description, and expanding it leaves the summary collapsed', () => {
  const view = tabViewTree(longSummaryDoc, OVERVIEW_TAB, {
    expanded: new Set([1]),
  });
  const text = textOf(view).join('\n');
  expect(text, 'the description body is out').toContain('TAIL-ONLY-LINE');
  expect(text, 'and the summary tail is still hidden').not.toContain(
    'SUMMARY-TAIL-ONLY',
  );
});

it('R6/D3: an EMPTY summary still draws a caret and is still selectable', () => {
  // The caret is unconditional on purpose. A caret that appeared only when a
  // summary exists would make Overview's `selectable` 1 or 2 depending on the
  // ticket, so `Enter` on a freshly opened detail would mean different things on
  // different tickets — and the click map would shift with it.
  const view = tabViewTree(bareDoc, OVERVIEW_TAB, { expanded: new Set() });
  expect(view.selectable).toBe(2);
  const rows = textOf(view);
  expect(rows[view.headerRows[0] ?? 0]).toMatch(/▸/);
  expect(rows[view.headerRows[0] ?? 0]).toContain('Latest summary');
  // Expanding it shows the same one line, which is honest and costs nothing.
  const expanded = tabViewTree(bareDoc, OVERVIEW_TAB, {
    expanded: new Set([0]),
  });
  expect(textOf(expanded).join('\n')).toContain('No summary comment.');
});

it('D7: the flat render orders Latest summary above Description', () => {
  const headings = detailSections(summaryDoc).map((s) => s.heading);
  expect(headings.indexOf('Latest summary')).toBeLessThan(
    headings.indexOf('Description'),
  );
  expect(
    headings.indexOf('Parent'),
    'and below Parent, which keeps its D7 slot',
  ).toBeLessThan(headings.indexOf('Latest summary'));
});

// BB-369 AC-3 / D5 — `Blocked by` on the Related tab: IDENTITY rows, not a
// count. A count of blockers does not answer the question the operator has
// ("which ticket is holding this up?"), and the live include measurement (spec
// fact 10) removed the only obstacle the qualification named.

const blocker = (id: string, identifier: string, title: string) => ({
  id,
  type: 'bb_ticket--bb_ticket',
  attributes: { identifier, title },
});

/** Two blockers, one of them sideloaded and one deliberately not. */
const blockedDoc = {
  data: {
    ...stateDoc.data,
    relationships: {
      ...overviewDoc.data.relationships,
      blocked_by: { data: [{ id: 'b-1' }, { id: 'b-missing' }] },
    },
  },
  included: [
    ...overviewDoc.included,
    blocker('b-1', 'BB-19', 'the blocking spec'),
  ],
};

const blockedByOf = (doc: unknown): string[] =>
  detailSections(doc).find((s) => s.heading === 'Blocked by')?.lines ?? [];

it('AC-3 / D5: each blocker is one identity row, `<identifier> · <title>`', () => {
  const doc = {
    data: blockedDoc.data,
    included: [
      ...overviewDoc.included,
      blocker('b-1', 'BB-19', 'the blocking spec'),
      blocker('b-missing', 'BB-97', 'the other blocker'),
    ],
  };
  expect(blockedByOf(doc)).toEqual([
    'BB-19 · the blocking spec',
    'BB-97 · the other blocker',
  ]);
});

it('AC-3 / D5: a blocker whose include is absent degrades to its raw uuid', () => {
  // The same ladder `parentLines` uses: sideload → raw uuid, and never an empty
  // row. Ugly, but still the truth.
  expect(blockedByOf(blockedDoc)).toEqual([
    'BB-19 · the blocking spec',
    'b-missing',
  ]);
});

it('AC-3 / D5: an unblocked ticket says `Not blocked.`', () => {
  expect(blockedByOf(bareDoc)).toEqual(['Not blocked.']);
  // Measured live: the linkage arrives as `{"data": []}` even with no include, so
  // this is the shape a real unblocked ticket produces.
  const empty = {
    data: {
      ...stateDoc.data,
      relationships: {
        ...overviewDoc.data.relationships,
        blocked_by: { data: [] },
      },
    },
    included: [],
  };
  expect(blockedByOf(empty)).toEqual(['Not blocked.']);
});

it('D6: a blocker row carries NO state — the row format Parent established', () => {
  // Considered and rejected: `BB-19 · done · the blocking spec` would answer "is
  // the blocker still open" in one glance, but it breaks the row format the Parent
  // section uses on the SAME tab, and AC-3 asks for rows consistent with it. The
  // blocker's identifier is a jump target; its state is one keystroke away.
  const doc = {
    data: blockedDoc.data,
    included: [
      ...overviewDoc.included,
      {
        id: 'b-1',
        type: 'bb_ticket--bb_ticket',
        attributes: {
          identifier: 'BB-19',
          title: 'the blocking spec',
          state: 'done',
        },
      },
    ],
  };
  expect(blockedByOf(doc)[0]).toBe('BB-19 · the blocking spec');
  expect(blockedByOf(doc)[0]).not.toContain('done');
});

it('AC-3 / D5: Related lists Blocked by between Sub-tickets and Referenced tickets', () => {
  expect(sectionsForTab(blockedDoc, RELATED_TAB).map((s) => s.heading)).toEqual(
    ['Source', 'Parent', 'Sub-tickets', 'Blocked by', 'Referenced tickets'],
  );
  // Related lists no expandable section, so it is still scroll-only — the blockers
  // are rows, not entries.
  expect(tabViewTree(blockedDoc, RELATED_TAB).selectable).toBe(0);
  expect(textOf(tabViewTree(blockedDoc, RELATED_TAB)).join('\n')).toContain(
    'BB-19 · the blocking spec',
  );
});

it('AC-4 / D5: the piped render carries the blockers', () => {
  const text = detailLines(blockedDoc).lines.join('\n');
  expect(text).toContain('Blocked by');
  expect(text).toContain('BB-19 · the blocking spec');
});

it('D7: the flat render puts Blocked by between Sub-tickets and Runs', () => {
  const headings = detailSections(blockedDoc).map((s) => s.heading);
  expect(headings.indexOf('Sub-tickets')).toBeLessThan(
    headings.indexOf('Blocked by'),
  );
  expect(headings.indexOf('Blocked by')).toBeLessThan(headings.indexOf('Runs'));
});

// ─── BB-372 Task 4b — `Latest summary` is a THIRD `bb_rich` body ──────────
//
// BB-369 landed `Latest summary` while this ticket was being built, and its
// rows are a `bb_comment` body: the same `bb_rich` source the description and
// every comment carry. Left on `body.split('\n')` it would render RAW right beside
// a `Description` that renders — one screen contradicting itself — so AC-1/AC-2
// reach it through the same `markdownLines` seam (D3), and only the `— <marker>`
// row stays a plain string, because it is this component's text and not the
// author's.

/** A summary body with a heading, emphasis, a bullet and inline code. */
const RICH_SUMMARY = [
  '## Outcome',
  '',
  'The **bold** part is *done*, see `markdownLines`.',
  '',
  '- [x] shipped',
].join('\n');

const richSummaryDoc = {
  data: stateDoc.data,
  included: [
    summaryComment(
      'c-rich',
      'summary',
      21,
      '2026-08-10T09:00:00+00:00',
      RICH_SUMMARY,
    ),
  ],
};

/** The `Latest summary` section's rows as the objects the producer hands over. */
const summaryLinesOf = (doc: unknown) =>
  detailSections(doc).find((s) => s.heading === 'Latest summary')?.lines ?? [];

it('AC-1/AC-2 / D3: the Latest summary body is RENDERED, and its marker row is not', () => {
  const lines = summaryLinesOf(richSummaryDoc);
  // The marker row: a PLAIN string, so no Markdown rule can ever reach it (D3).
  expect(lines[0]).toBe('— summary · cw · 2026-08-10T09:00:00+00:00');
  expect(summaryOf(richSummaryDoc)).toEqual([
    '— summary · cw · 2026-08-10T09:00:00+00:00',
    'Outcome',
    '',
    'The bold part is done, see markdownLines.',
    '',
    '☑ shipped',
  ]);
});

it('AC-1/AC-2 / D3: the Latest summary rows carry the RUNS the description`s do', () => {
  const lines = summaryLinesOf(richSummaryDoc);
  // The heading row is the rendered line, flagged as a heading so the extract
  // skips it exactly as it skips `Description`'s (D8).
  // ONE UNSTYLED RUN plus `heading: true` — D2 draws the WHOLE ROW bold off the
  // flag rather than marking the run, which is also what lets the extract skip
  // a heading it can no longer recognise from the text (D8).
  expect(lines[1]).toEqual({
    text: 'Outcome',
    runs: [{ text: 'Outcome', attributes: 0 }],
    heading: true,
  });
  expect(lines[3]).toEqual({
    text: 'The bold part is done, see markdownLines.',
    runs: [
      { text: 'The ', attributes: 0 },
      { text: 'bold', attributes: BOLD },
      { text: ' part is ', attributes: 0 },
      { text: 'done', attributes: ITALIC },
      { text: ', see ', attributes: 0 },
      { text: 'markdownLines', attributes: 0, fg: BORDER },
      { text: '.', attributes: 0 },
    ],
    heading: false,
  });
});

it('AC-1 / D8: the collapsed Latest summary extract is RENDERED, and its geometry is BB-369`s unchanged', () => {
  // Entry 0 is `Latest summary` (BB-369 D3/D4 lists it above `Description`).
  //
  // MEASURED RATHER THAN ASSUMED, and the answer is worth stating: the extract
  // does NOT skip this section's leading `## Outcome`, because the row `Latest
  // summary` LEADS WITH is BB-369's `— <marker>` — a plain, non-blank,
  // non-heading line — so `descriptionSummary`'s "skip leading blanks and
  // headings" step stops at row 0 and the paragraph run is [marker, heading].
  // That is BB-369's shape, not something this ticket introduced or may change:
  // `Description` has no marker row, which is the whole of why its extract skips
  // its heading and this one does not.
  //
  // What BB-372 changes here is the TEXT and nothing else. The selection is
  // still two rows and the marker still counts the same four hidden rows it
  // counted with a raw body — the fence-free body renders one row per source
  // line — so `… +4 more lines` is byte-identical to what develop prints. Only
  // `## Outcome` became `Outcome`.
  const collapsed = textOf(
    tabViewTree(richSummaryDoc, OVERVIEW_TAB, { expanded: new Set() }),
  ).join('\n');
  expect(collapsed).toContain(
    '— summary · cw · 2026-08-10T09:00:00+00:00\nOutcome\n… +4 more lines',
  );
  expect(
    collapsed,
    'the heading rendered: no raw marker survives the collapsed state',
  ).not.toContain('## Outcome');
  // Expanded, the whole RENDERED body — the task item as a glyph, not `- [x]`.
  const expanded = textOf(
    tabViewTree(richSummaryDoc, OVERVIEW_TAB, { expanded: new Set([0]) }),
  ).join('\n');
  expect(expanded).toContain('☑ shipped');
  expect(expanded).not.toMatch(/- \[x\]/);
  expect(expanded).toContain('The bold part is done, see markdownLines.');
});

it('AC-3 / D4: the piped Latest summary carries the rendered text', () => {
  const text = detailLines(richSummaryDoc).lines.join('\n');
  expect(text).toContain('☑ shipped');
  expect(text).toContain('The bold part is done, see markdownLines.');
  expect(
    text,
    'the pipe is the same rendering, so it has no raw marker either',
  ).not.toContain('## Outcome');
});

// BB-373 AC-10 — A CONTRIBUTED PANEL'S NODE IDS ARE AN INJECTIVE DERIVATION OF
// ITS HEADINGS.
//
// The shipped artifacts viewer heads each section with the artifact's path under
// the ticket's tree, so the heading set is the FILESYSTEM rather than the closed
// built-in list `sectionKey` was written for. Two ordinary captures —
// `playwright/logs/walk.txt` beside `playwright/logs-walk.txt` — collapsed onto
// one key, and the tree that came out of here declared the same id twice; the
// throw then happened inside `Kernel/mount.ts` while MOUNTING, past the host's
// guard around `panel.sections()`, and named neither the addon nor the file.
//
// Asserted over the ids rather than over the key, because the id is what
// `patchTree` follows and what `mount` refuses. The mount itself is driven in
// `tests-bun/Kernel/panel-section-ids.test.ts` — this case is the derivation, that
// one is the refusal.
const PANEL_TAB = TICKET_SECTIONS.length;

it('AC-10: two panel headings differing only in a separator produce different ids', () => {
  const view = tabViewTree({}, PANEL_TAB, {
    panelSections: [
      {
        heading: 'playwright/logs/walk.txt',
        expandable: true,
        lines: ['pnpm playwright test', 'ok'],
      },
      {
        heading: 'playwright/logs-walk.txt',
        expandable: true,
        lines: ['pnpm playwright test --headed', 'ok'],
      },
    ],
  });
  const ids = idsOf(view.body);
  expect(new Set(ids).size, `duplicate id in ${ids.join(', ')}`).toBe(
    ids.length,
  );
  expect(view.rowIds, 'both entries are separately clickable').toHaveLength(2);
  expect(new Set(view.rowIds).size).toBe(2);
});

// The same claim for the FLAT panel branch: a section a panel does not mark
// expandable goes through `sectionRows`, which keys its own heading row, body
// rows and gap. Both branches have to use the panel derivation or the tab is
// only half repaired — a binary artifact is listed non-expandable (it has no
// body a terminal could show), so a directory of `.png`s is exactly this case.
it('AC-10: a non-expandable panel section is keyed injectively too', () => {
  const ids = idsOf(
    tabViewTree({}, PANEL_TAB, {
      panelSections: [
        { heading: 'shots/step-1.png', lines: ['1024 bytes'] },
        { heading: 'shots/step.1.png', lines: ['2048 bytes'] },
      ],
    }).body,
  );
  expect(new Set(ids).size, `duplicate id in ${ids.join(', ')}`).toBe(
    ids.length,
  );
});

// AC-2 — THE BUILT-IN IDS DO NOT MOVE. The panel derivation is reached only
// through the panel branch, so Overview's nodes are keyed exactly as they were:
// no escape sequence appears anywhere in them, and the two caret ids the screen
// publishes as `rowIds` are byte-identical to what the assertions above this one
// already pin.
it('AC-2: the built-in tabs keep their ids — the panel encoding is not on that path', () => {
  const ids = idsOf(tabViewTree(longSummaryDoc, OVERVIEW_TAB, {}).body);
  for (const id of ids) {
    expect(id, `${id} is keyed as it always was`).toMatch(
      /^ticket-detail(-[a-z0-9]+)*$/,
    );
  }
  expect(ids).toContain('ticket-detail-latest-summary-header');
  expect(ids).toContain('ticket-detail-description-header');
});

// ─── BB-381 — Latest spec / Latest plan (hide when absent) ─────────────────
//
// Same newest-wins order as Latest summary (BB-369), but Spec/Plan are OMITTED
// entirely when no matching comment exists (AC-3) — deliberate contrast with
// summary's always-visible empty state.

const typedOf = (doc: unknown, heading: string): string[] =>
  sectionText(detailSections(doc).find((s) => s.heading === heading));

const headingsOf = (doc: unknown): string[] =>
  detailSections(doc).map((s) => s.heading);

/** Two `spec` comments with equal `created`, plus a newer non-spec. */
const specDoc = {
  data: stateDoc.data,
  included: [
    ...overviewDoc.included,
    summaryComment(
      's-old',
      'spec',
      21,
      '2026-08-10T09:00:00+00:00',
      'OLDER-SPEC',
    ),
    summaryComment(
      's-new',
      'spec',
      22,
      '2026-08-10T09:00:00+00:00',
      'NEWER-SPEC',
    ),
    summaryComment(
      's-hand',
      'summary',
      23,
      '2026-08-10T23:00:00+00:00',
      'NOT-A-SPEC',
    ),
  ],
};

it('BB-381 AC-1: the NEWEST spec wins (created equal → drupal_internal__id)', () => {
  const lines = typedOf(specDoc, 'Latest spec');
  expect(lines.join('\n')).toContain('NEWER-SPEC');
  expect(lines.join('\n')).not.toContain('OLDER-SPEC');
});

it('BB-381 AC-1: a non-spec comment is never chosen for Latest spec', () => {
  expect(typedOf(specDoc, 'Latest spec').join('\n')).not.toContain(
    'NOT-A-SPEC',
  );
});

it('BB-381 AC-1: the marker names type, author and created, then the body', () => {
  expect(typedOf(specDoc, 'Latest spec')).toEqual([
    '— spec · cw · 2026-08-10T09:00:00+00:00',
    'NEWER-SPEC',
  ]);
});

it('BB-381 AC-3: no spec comment → Latest spec section is omitted entirely', () => {
  expect(headingsOf(bareDoc)).not.toContain('Latest spec');
  expect(
    sectionsForTab(bareDoc, OVERVIEW_TAB).map((s) => s.heading),
  ).not.toContain('Latest spec');
  // Exact-match R5: a typo is invisible — same omission, never fuzzy match.
  const typo = {
    data: stateDoc.data,
    included: [
      summaryComment(
        's-typo',
        'specs',
        5,
        '2026-08-10T09:00:00+00:00',
        'TYPO-SPEC',
      ),
    ],
  };
  expect(headingsOf(typo)).not.toContain('Latest spec');
  expect(typedOf(typo, 'Latest spec')).toEqual([]);
});

it('BB-381 AC-1: Latest summary still always shows its empty state beside an absent Spec', () => {
  expect(typedOf(bareDoc, 'Latest summary')).toEqual(['No summary comment.']);
  expect(headingsOf(bareDoc)).toContain('Latest summary');
});

it('BB-381 D3: when present, Latest spec sits between Latest summary and Description', () => {
  const headings = headingsOf(specDoc);
  expect(headings.indexOf('Latest summary')).toBeLessThan(
    headings.indexOf('Latest spec'),
  );
  expect(headings.indexOf('Latest spec')).toBeLessThan(
    headings.indexOf('Description'),
  );
  expect(sectionsForTab(specDoc, OVERVIEW_TAB).map((s) => s.heading)).toEqual([
    'Source',
    'Parent',
    'Links',
    'Latest summary',
    'Latest spec',
    'Description',
    'Assignment',
    'Time',
    'Branch',
    'Environments',
  ]);
});

/** Two `plan` comments with equal `created`, plus a newer non-plan. */
const planDoc = {
  data: stateDoc.data,
  included: [
    ...overviewDoc.included,
    summaryComment(
      'p-old',
      'plan',
      31,
      '2026-08-10T09:00:00+00:00',
      'OLDER-PLAN',
    ),
    summaryComment(
      'p-new',
      'plan',
      32,
      '2026-08-10T09:00:00+00:00',
      'NEWER-PLAN',
    ),
    summaryComment(
      'p-hand',
      'debug_diagnose',
      33,
      '2026-08-10T23:00:00+00:00',
      'NOT-A-PLAN',
    ),
  ],
};

it('BB-381 AC-2: the NEWEST plan wins (created equal → drupal_internal__id)', () => {
  const lines = typedOf(planDoc, 'Latest plan');
  expect(lines.join('\n')).toContain('NEWER-PLAN');
  expect(lines.join('\n')).not.toContain('OLDER-PLAN');
});

it('BB-381 AC-2: a non-plan comment is never chosen for Latest plan', () => {
  expect(typedOf(planDoc, 'Latest plan').join('\n')).not.toContain(
    'NOT-A-PLAN',
  );
});

it('BB-381 AC-2: the plan marker names type, author and created, then the body', () => {
  expect(typedOf(planDoc, 'Latest plan')).toEqual([
    '— plan · cw · 2026-08-10T09:00:00+00:00',
    'NEWER-PLAN',
  ]);
});

it('BB-381 AC-3: no plan comment → Latest plan section is omitted entirely', () => {
  expect(headingsOf(bareDoc)).not.toContain('Latest plan');
  expect(headingsOf(specDoc)).not.toContain('Latest plan');
  expect(
    sectionsForTab(bareDoc, OVERVIEW_TAB).map((s) => s.heading),
  ).not.toContain('Latest plan');
});

it('BB-381 D3: Latest plan sits after Latest spec (when both present) and before Description', () => {
  const bothDoc = {
    data: stateDoc.data,
    included: [
      ...overviewDoc.included,
      summaryComment(
        's-1',
        'spec',
        41,
        '2026-08-10T09:00:00+00:00',
        'THE-SPEC',
      ),
      summaryComment(
        'p-1',
        'plan',
        42,
        '2026-08-10T09:00:00+00:00',
        'THE-PLAN',
      ),
    ],
  };
  expect(sectionsForTab(bothDoc, OVERVIEW_TAB).map((s) => s.heading)).toEqual([
    'Source',
    'Parent',
    'Links',
    'Latest summary',
    'Latest spec',
    'Latest plan',
    'Description',
    'Assignment',
    'Time',
    'Branch',
    'Environments',
  ]);
  const headings = headingsOf(bothDoc);
  expect(headings.indexOf('Latest spec')).toBeLessThan(
    headings.indexOf('Latest plan'),
  );
  expect(headings.indexOf('Latest plan')).toBeLessThan(
    headings.indexOf('Description'),
  );
});

it('BB-381 D2: Overview selectable is 2 / 3 / 4; entry 0 stays Latest summary', () => {
  // Neither spec nor plan → 2 (summary + Description).
  const neither = tabViewTree(bareDoc, OVERVIEW_TAB, { expanded: new Set() });
  expect(neither.selectable).toBe(2);
  expect(textOf(neither)[neither.headerRows[0] ?? 0]).toContain(
    'Latest summary',
  );
  expect(textOf(neither)[neither.headerRows[1] ?? 0]).toContain('Description');

  // Spec only → 3.
  const specOnly = tabViewTree(specDoc, OVERVIEW_TAB, { expanded: new Set() });
  expect(specOnly.selectable).toBe(3);
  expect(textOf(specOnly)[specOnly.headerRows[0] ?? 0]).toContain(
    'Latest summary',
  );
  expect(textOf(specOnly)[specOnly.headerRows[1] ?? 0]).toContain(
    'Latest spec',
  );
  expect(textOf(specOnly)[specOnly.headerRows[2] ?? 0]).toContain(
    'Description',
  );
  expect(specOnly.rowIds).toEqual([
    'ticket-detail-latest-summary-header',
    'ticket-detail-latest-spec-header',
    'ticket-detail-description-header',
  ]);

  // Plan only → 3.
  const planOnly = tabViewTree(planDoc, OVERVIEW_TAB, { expanded: new Set() });
  expect(planOnly.selectable).toBe(3);
  expect(textOf(planOnly)[planOnly.headerRows[1] ?? 0]).toContain(
    'Latest plan',
  );

  // Both → 4.
  const bothDoc = {
    data: stateDoc.data,
    included: [
      ...overviewDoc.included,
      summaryComment(
        's-1',
        'spec',
        41,
        '2026-08-10T09:00:00+00:00',
        'THE-SPEC',
      ),
      summaryComment(
        'p-1',
        'plan',
        42,
        '2026-08-10T09:00:00+00:00',
        'THE-PLAN',
      ),
    ],
  };
  const both = tabViewTree(bothDoc, OVERVIEW_TAB, { expanded: new Set() });
  expect(both.selectable).toBe(4);
  expect(textOf(both)[both.headerRows[0] ?? 0]).toContain('Latest summary');
  expect(textOf(both)[both.headerRows[1] ?? 0]).toContain('Latest spec');
  expect(textOf(both)[both.headerRows[2] ?? 0]).toContain('Latest plan');
  expect(textOf(both)[both.headerRows[3] ?? 0]).toContain('Description');
  expect(both.rowIds).toEqual([
    'ticket-detail-latest-summary-header',
    'ticket-detail-latest-spec-header',
    'ticket-detail-latest-plan-header',
    'ticket-detail-description-header',
  ]);
});
