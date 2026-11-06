import { describe, expect, it } from 'bun:test';
import { BoxRenderable, h, type VNode } from '@opentui/core';
import {
  MarkdownLines,
  markdownLines,
} from '../../src/Component/markdown/index.js';
import {
  TicketContent,
  type TicketContentProps,
} from '../../src/Entity/ticket/Component/ticket-content/index.js';
import {
  initialExpandedKeys,
  type TicketContentTab,
  ticketContentModel,
} from '../../src/Entity/ticket/Component/ticket-content/model.js';
import type { AssignmentLabels } from '../../src/Entity/ticket/Component/ticket-detail/index.js';
import type { TicketAddons } from '../../src/Entity/ticket/Data/addons.js';
import type { JsonApiResource, TicketDetailDocument } from '../../src/types.js';
import { type PaintedSpan, paintTree } from '../paint-tree.js';

const BOLD_BIT = 1;
const ITALIC_BIT = 4;
const NOW = Math.floor(Date.parse('2026-07-18T20:03:00Z') / 1000);

const labels: AssignmentLabels = {
  users: [{ id: 'user-1', label: 'Pat' }],
  conductors: [{ id: 'cond-1', label: 'runner-1' }],
};

type Span = PaintedSpan;

const paint = (build: () => VNode, width: number, height = 32) =>
  paintTree(build, width, height);

function comment(fixture: {
  id: string;
  type?: string;
  author?: string;
  created?: string;
  internalId?: number;
  body?: string;
}): JsonApiResource {
  return {
    type: 'bb_comment--bb_comment',
    id: fixture.id,
    attributes: {
      bb_comment_type: fixture.type ?? 'comment',
      author_name: fixture.author ?? 'ann',
      created: fixture.created ?? '2026-07-18T20:00:00Z',
      drupal_internal__id: fixture.internalId ?? 1,
      body: { value: fixture.body ?? '' },
    },
  };
}

function document(
  attributes: Record<string, unknown> = {},
  included: JsonApiResource[] = [],
): TicketDetailDocument {
  return {
    data: {
      id: 'ticket-1',
      attributes: {
        title: 'content render',
        description: { value: 'Short description body.' },
        branch_name: 'feat/a_b_c',
        base_branch: 'develop',
        links: [{ title: 'Result', uri: 'https://example.test/result' }],
        time_estimate: 14_400,
        ...attributes,
      },
      relationships: {
        assignee_user_id: { data: { id: 'user-1' } },
        conductor_id: { data: { id: 'cond-1' } },
        environments: { data: [] },
      },
    },
    included: [
      {
        id: 'user-1',
        type: 'user--user',
        attributes: { display_name: 'Pat' },
      },
      {
        id: 'cond-1',
        type: 'bb_conductor--bb_conductor',
        attributes: { label: 'runner-1' },
      },
      ...included,
    ],
  };
}

const noop = () => {
  // Selection and toggle are supplied by the screen; these cases inspect paint.
};

/** The content tree with the screen-owned inputs these cases do not vary. */
const content = (
  props: Omit<
    TicketContentProps,
    'id' | 'terminalColumns' | 'onSidebarTab' | 'onDocumentTab'
  >,
  terminalColumns = 80,
): VNode =>
  TicketContent({
    id: 'ticket-content',
    terminalColumns,
    onSidebarTab: noop,
    onDocumentTab: noop,
    ...props,
  });

const paintTab = (
  tab: TicketContentTab,
  doc: TicketDetailDocument,
  expandedKeys: ReadonlySet<string>,
  width = 80,
  height = 32,
  selectedKey?: string,
) => {
  const model = ticketContentModel(doc, tab, labels, NOW);
  return paint(
    () =>
      content(
        {
          tab: tab,
          model: model,
          expandedKeys: expandedKeys,
          select: noop,
          toggle: noop,
          ...(selectedKey === undefined ? {} : { selectedKey }),
        },
        width,
      ),
    width,
    height,
  );
};

const allSpans = (spans: Span[][]): Span[] => spans.flat();

const runOf = (spans: Span[][], text: string): Span | undefined =>
  allSpans(spans).find((span) => span.text === text) ??
  allSpans(spans).find((span) => span.text.includes(text));

describe('TicketContent', () => {
  it('shows the summary extract while collapsed and the description body while expanded', async () => {
    const summaryBody = Array.from(
      { length: 8 },
      (_line, index) => `status line ${index}`,
    ).join('\n');
    const doc = document(
      {
        description: {
          value:
            '## Context\n\nVisible description paragraph.\n\nDESCRIPTION-TAIL',
        },
      },
      [
        comment({
          id: 'sum-1',
          type: 'summary',
          body: summaryBody,
          internalId: 4,
        }),
      ],
    );
    const collapsed = await paintTab(
      'overview',
      doc,
      new Set(['section:Latest summary']),
    );
    expect(collapsed.frame).toContain('* Description');
    expect(collapsed.frame).toContain('* Summary');
    expect(collapsed.frame).not.toContain('[Description]');
    expect(collapsed.frame.indexOf('* Summary')).toBeLessThan(
      collapsed.frame.indexOf('* Description'),
    );
    expect(collapsed.frame).toContain('status line 7');
    expect(collapsed.frame).toContain('Visible description paragraph.');
    expect(collapsed.frame).not.toContain('DESCRIPTION-TAIL');

    const summaryKey = 'section:Latest summary';
    const expanded = await paintTab(
      'overview',
      doc,
      new Set([summaryKey, 'section:Description']),
      80,
      32,
      summaryKey,
    );
    expect(expanded.frame).toContain('status line 7');
  });

  it('paints the addons card empty state and an empty answer like the web card', async () => {
    const doc = document();
    const model = ticketContentModel(doc, 'overview', labels, NOW);
    const message = {
      key: 'tunnel',
      label: 'Share tunnels',
      input: null,
      access: 'view',
      access_ok: true,
    };
    const addon = (latest: TicketAddons['addons'][number]['latest']) => ({
      id: 'a1',
      name: 'ports',
      version: '0.1.0',
      contract: 2,
      label: 'Ports',
      messages: [message],
      latest,
    });
    const paintWith = (preview: TicketAddons) =>
      paint(
        () =>
          content({
            tab: 'overview',
            model,
            expandedKeys: initialExpandedKeys('overview', model),
            select: noop,
            toggle: noop,
            addonsPreview: preview,
          }),
        80,
        48,
      );
    const empty = await paintWith({
      conductor: { status: 'online' },
      addons: [addon(null)],
    });
    expect(empty.frame).toContain('Share tunnels');
    expect(empty.frame).toContain('You have not sent a message to this addon.');
    const blank = await paintWith({
      conductor: { status: 'online' },
      addons: [
        addon({
          action: 'ports.tunnel',
          label: 'Share tunnels',
          status: 'done',
          result: { markdown: '' },
          changed: 0,
        }),
      ],
    });
    expect(blank.frame).toContain('Completed without a response.');
    expect(blank.frame).not.toContain('You have not sent a message');
  });

  it('paints every Technical details property without collapsing', async () => {
    const doc = document();
    const model = ticketContentModel(doc, 'overview', labels, NOW);
    const painted = await paintTab(
      'overview',
      doc,
      initialExpandedKeys('overview', model),
    );
    expect(painted.frame).toContain('[Details]');
    expect(painted.frame).toContain('feat/a_b_c');
    expect(painted.frame).toContain('runner-1');
    expect(painted.frame).toContain('4h');
    expect(painted.frame).toMatch(/environments\s+:\s+none/);
    expect(painted.frame).not.toContain('No environments.');
    expect(painted.frame).not.toContain('No conductor.');
    expect(painted.frame).toContain('Pat');
    expect(painted.frame).toContain('unknown');
    expect(painted.frame).not.toMatch(/… \+\d+ more lines/);
  });

  it('shows a done ticket sidebar with exactly Details and Related, no Stats', async () => {
    const painted = await paintTab(
      'overview',
      document({
        state: 'done',
        metrics: [
          { name: 'job_rating.score', value: '4.0000' },
          { name: 'ac_pass_rate', value: '0.8000', unit: 'ratio' },
        ],
      }),
      new Set(['section:Description']),
      80,
      40,
    );
    expect(painted.frame).toMatch(/\[Details\] +Related/);
    expect(painted.frame).not.toContain('Stats');
    expect(painted.frame).not.toMatch(/score\s+:\s+4/);
    expect(painted.frame).not.toContain('ac_pass_rate');
  });

  it('paints Technical details as KeyValue properties, on the right when wide', async () => {
    const doc = document();
    const model = ticketContentModel(doc, 'overview', labels, NOW);
    const expanded = new Set([
      'section:Description',
      'section:Technical details',
    ]);
    // 26 rows: Details gained the reviewers row, which pushed conductor below 24.
    const stacked = await paintTab('overview', doc, expanded, 80, 26);
    const stackedDescription = stacked.rows.find(
      (row) =>
        row.includes('Description') && !row.includes('Short description'),
    );
    expect(stackedDescription).not.toContain('Technical details');
    expect(stacked.frame).toContain('runner-1');
    expect(stacked.frame).toMatch(/╭/);
    expect(stacked.frame).not.toContain('Latest summary');

    const wide = await paintTab(
      'overview',
      doc,
      initialExpandedKeys('overview', model),
      120,
      24,
    );
    const descriptionCol = wide.rows
      .find(
        (row) =>
          row.includes('Description') && !row.includes('Short description'),
      )
      ?.indexOf('Description');
    const detailsCol = wide.rows
      .find((row) => row.includes('[Details]'))
      ?.indexOf('[Details]');
    expect(descriptionCol, 'Description headline is painted').toBeDefined();
    expect(detailsCol, 'Details tab sits in the right column').toBeDefined();
    expect(
      detailsCol,
      'the Card sits to the right of Description',
    ).toBeGreaterThan(descriptionCol ?? 0);
    expect(wide.frame).toMatch(/╭/);
    // Links render full-width in the LEFT column now, not the narrow sidebar:
    // the headline sits at the left edge, the URL itself is painted, and the
    // sidebar carries no Links tab.
    const linksCol = wide.rows
      .find((row) => row.includes('* links'))
      ?.indexOf('* links');
    expect(
      linksCol,
      'links headline is painted in the left column',
    ).toBeDefined();
    expect(linksCol).toBeLessThan(detailsCol ?? Number.POSITIVE_INFINITY);
    expect(wide.frame).not.toContain('[Links]');
    expect(wide.frame).toContain('[Details]');
    expect(wide.frame).toContain('Related');
    expect(wide.frame).toContain('feat/a_b_c');
    expect(wide.frame).toContain('https://example.test/result');
    expect(wide.frame).toContain('runner-1');
    expect(wide.frame).not.toMatch(/… \+\d+ more lines/);
  });

  it('keeps feat/a_b_c literal in technical details and comment metadata', async () => {
    const doc = document({}, [
      comment({
        id: 'c-1',
        type: 'review',
        author: 'feat/a_b_c',
        body: 'Looks good.',
      }),
    ]);
    const overview = await paintTab(
      'overview',
      doc,
      new Set(['section:Technical details']),
    );
    expect(overview.frame).toContain('feat/a_b_c');
    expect(overview.frame).not.toContain('feat/a c');
    const branch = runOf(overview.spans, 'feat/a_b_c');
    expect(branch, 'branch is painted').toBeDefined();
    expect((branch?.attributes ?? 0) & ITALIC_BIT).toBe(0);

    const comments = ticketContentModel(doc, 'comments', labels, NOW);
    const history = await paint(
      () =>
        content({
          tab: 'comments',
          model: comments,
          expandedKeys: initialExpandedKeys('comments', comments),
          select: noop,
          toggle: noop,
        }),
      80,
    );
    expect(history.frame).toContain('feat/a_b_c');
    expect(history.frame).toContain('Looks good.');
    const author = runOf(history.spans, 'feat/a_b_c');
    expect((author?.attributes ?? 0) & ITALIC_BIT).toBe(0);
  });

  it('paints existing emphasis runs without demo copy', async () => {
    const doc = document({
      description: { value: 'The change is **shipped** today.' },
    });
    const painted = await paintTab(
      'overview',
      doc,
      new Set(['section:Description']),
    );
    expect(painted.frame).toContain('shipped');
    expect(painted.frame).not.toContain('**');
    expect(runOf(painted.spans, 'shipped')?.attributes).toBe(BOLD_BIT);
    expect(painted.frame).not.toContain('Example document');
    expect(painted.frame).not.toContain('Example data');
    expect(painted.frame).not.toContain('Local interaction');
    expect(painted.frame).not.toContain('Click to count');
    expect(painted.frame).not.toContain('Tickets by state');
  });

  it('paints styled description runs through MarkdownLines', async () => {
    const source = await Bun.file(
      new URL(
        '../../src/Entity/ticket/Component/ticket-content/index.ts',
        import.meta.url,
      ),
    ).text();
    expect(source).toContain('MarkdownLines');
    expect(source).not.toContain('run.attributes');

    const body = [
      'The change is **shipped** and *also* uses `code` and ~~gone~~.',
      '',
      '## Outcome',
    ].join('\n');
    const content = await paintTab(
      'overview',
      document({ description: { value: body } }),
      new Set(['section:Description']),
    );
    const painter = await paint(
      () =>
        MarkdownLines({
          id: 'painter',
          lines: markdownLines(body),
          emphasis: true,
        }),
      80,
    );
    for (const token of ['shipped', 'also', 'code', 'gone', 'Outcome']) {
      const fromContent = runOf(content.spans, token);
      const fromPainter = runOf(painter.spans, token);
      expect(fromContent, token).toBeDefined();
      expect(fromPainter, token).toBeDefined();
      expect(fromContent?.attributes, token).toBe(fromPainter?.attributes);
      expect(fromContent?.fg.equals(fromPainter?.fg) ?? false, token).toBe(
        true,
      );
    }
  });

  it('shows the empty description, comments and comment-body copy', async () => {
    const emptyDescription = await paintTab(
      'overview',
      document({ description: { value: '' } }),
      new Set(['section:Description']),
    );
    expect(emptyDescription.frame).toContain('No description.');

    const emptyComments = ticketContentModel(
      document(),
      'comments',
      labels,
      NOW,
    );
    const comments = await paint(
      () =>
        content({
          tab: 'comments',
          model: emptyComments,
          expandedKeys: new Set(),
          select: noop,
          toggle: noop,
        }),
      80,
    );
    expect(comments.frame).toContain('No comments.');

    const blank = document({}, [
      comment({ id: 'blank', type: 'note', body: '   \n' }),
    ]);
    const blankModel = ticketContentModel(blank, 'comments', labels, NOW);
    const blankBody = await paint(
      () =>
        content({
          tab: 'comments',
          model: blankModel,
          expandedKeys: new Set(blankModel.selectableKeys),
          select: noop,
          toggle: noop,
        }),
      80,
    );
    expect(blankBody.frame).toContain('No comment content.');
  });

  it('shows named empty states for missing planning documents', async () => {
    const model = ticketContentModel(document(), 'planning', labels, NOW);
    const painted = await paint(
      () =>
        content({
          tab: 'planning',
          model: model,
          expandedKeys: new Set(model.selectableKeys),
          select: noop,
          toggle: noop,
        }),
      80,
      40,
    );
    expect(painted.frame).toContain('[Spec]');
    expect(painted.frame).toContain('Plan');
    expect(painted.frame).toContain('Test');
    expect(painted.frame).toContain('No spec comment.');
  });

  it('paints Overview headlines plus a Technical details Card, and Planning as document tabs', async () => {
    const source = await Bun.file(
      new URL(
        '../../src/Entity/ticket/Component/ticket-content/index.ts',
        import.meta.url,
      ),
    ).text();
    expect(source).toContain('headlineContent(');
    expect(source).toContain('HeadlineMarkdown(');
    expect(source).not.toContain('HeatMap(');
    expect(source).toContain('sidebarCard(');
    expect(source).toContain('entry.title');
    expect(source).toContain('Card(');
    expect(source).not.toContain('Badge');

    const overview = await paintTab(
      'overview',
      document(),
      new Set(['section:Description']),
    );
    expect(overview.frame).not.toContain('Latest summary');
    expect(overview.frame).toContain('* Description');
    expect(overview.frame).not.toContain('[Description]');
    expect(overview.frame).toContain('[Details]');
    expect(overview.frame).not.toContain('Stats');
    expect(overview.frame).toContain('Short description body.');

    const planning = ticketContentModel(document(), 'planning', labels, NOW);
    const planned = await paint(
      () =>
        content({
          tab: 'planning',
          model: planning,
          expandedKeys: new Set(planning.selectableKeys),
          select: noop,
          toggle: noop,
        }),
      80,
      40,
    );
    expect(planned.frame).toContain('[Spec]');
    expect(planned.frame).toContain('Plan');
    expect(planned.frame).toContain('Test');
    expect(planned.frame).toContain('No spec comment.');
  });

  it('wraps to the parent width rather than the terminal', async () => {
    const token = 'W'.repeat(48);
    const doc = document({ description: { value: token } });
    const model = ticketContentModel(doc, 'overview', labels, NOW);
    const expanded = initialExpandedKeys('overview', model);
    const tree = () =>
      content({
        tab: 'overview',
        model,
        expandedKeys: expanded,
        select: noop,
        toggle: noop,
      });
    const nested = await paint(
      () =>
        h(
          BoxRenderable,
          { id: 'wrapper', width: 40, flexDirection: 'column' },
          tree(),
        ),
      80,
      24,
    );
    const wide = await paint(
      () =>
        h(
          BoxRenderable,
          { id: 'wrapper', width: 80, flexDirection: 'column' },
          tree(),
        ),
      80,
      24,
    );
    const nestedHits = nested.rows.filter((row) => row.includes('W')).length;
    const wideHits = wide.rows.filter((row) => row.includes('W')).length;
    expect(nestedHits).toBeGreaterThan(1);
    expect(wideHits).toBe(1);
    const nestedWs = nested.frame.split('').filter((ch) => ch === 'W').length;
    expect(nestedWs).toBe(token.length);
  });
});
