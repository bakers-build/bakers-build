import { describe, expect, it } from 'vitest';
import {
  lineText,
  styledOf,
} from '../../../../../src/Component/section-list/index.js';
import { relativeCreated } from '../../../../../src/Entity/ticket/Component/comment-item/index.js';
import {
  initialExpandedKeys,
  resolveSelectedKey,
  retainExpandedKeys,
  ticketContentModel,
  ticketContentRowId,
} from '../../../../../src/Entity/ticket/Component/ticket-content/model.js';
import type { AssignmentLabels } from '../../../../../src/Entity/ticket/Component/ticket-detail/index.js';
import {
  descriptionSummary,
  firstLineSummary,
  sectionsForTab,
} from '../../../../../src/Entity/ticket/Component/ticket-detail/index.js';
import type {
  JsonApiResource,
  TicketDetailDocument,
} from '../../../../../src/types.js';

const NOW = Math.floor(Date.parse('2026-07-18T20:03:00Z') / 1000);
const TIED = '2026-07-21T10:00:00+00:00';
const OVERVIEW_TAB = 0;

const labels: AssignmentLabels = {
  users: [{ id: 'user-1', label: 'Pat' }],
  conductors: [{ id: 'cond-1', label: 'runner-1' }],
};

interface CommentFixture {
  id?: string;
  type?: string;
  author?: string;
  created?: string | null;
  internalId?: number;
  body?: string;
}

function comment(fixture: CommentFixture): JsonApiResource {
  const attributes: Record<string, unknown> = {
    bb_comment_type: fixture.type ?? 'comment',
    author_name: fixture.author ?? 'ann',
  };
  if (fixture.created !== undefined) attributes.created = fixture.created;
  if (fixture.internalId !== undefined) {
    attributes.drupal_internal__id = fixture.internalId;
  }
  if (fixture.body !== undefined) attributes.body = { value: fixture.body };
  return {
    type: 'bb_comment--bb_comment',
    ...(fixture.id === undefined ? {} : { id: fixture.id }),
    attributes,
  };
}

function document(
  attributes: Record<string, unknown> = {},
  included: JsonApiResource[] = [],
  relationships: Record<string, unknown> = {},
): TicketDetailDocument {
  return {
    data: {
      id: 'ticket-1',
      type: 'bb_ticket--bb_ticket',
      attributes: {
        title: 'content model',
        description: { value: 'Short description body.' },
        branch_name: 'feat/a_b_c',
        base_branch: 'develop',
        links: [],
        ...attributes,
      },
      relationships: {
        assignee_user_id: { data: { id: 'user-1' } },
        conductor_id: { data: { id: 'cond-1' } },
        labels: { data: [] },
        parent_id: { data: null },
        sub_tickets: { data: [] },
        referenced_tickets: { data: [] },
        runs: { data: [] },
        environments: { data: [] },
        ...relationships,
      },
    },
    included: [
      {
        id: 'user-1',
        type: 'user--user',
        attributes: { display_name: 'Pat', name: 'pat' },
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

const texts = (
  lines: readonly { toString?: unknown }[] | undefined,
): string[] =>
  (lines ?? []).map((line) => lineText(line as Parameters<typeof lineText>[0]));

const keysOf = (
  tab: 'overview' | 'planning' | 'comments',
  doc: TicketDetailDocument,
) =>
  ticketContentModel(doc, tab, labels, NOW).entries.map((entry) => entry.key);

describe('ticketContentModel Overview', () => {
  it('lists latest summary, description, nonempty result links, then Technical details', () => {
    const doc = document(
      {
        links: [{ title: 'MR', uri: 'https://example.test/mr/1' }],
      },
      [
        comment({
          id: 'sum-1',
          type: 'summary',
          body: 'Stand of the work.',
          internalId: 4,
        }),
      ],
    );
    expect(keysOf('overview', doc)).toEqual([
      'section:Latest summary',
      'section:Description',
      'section:Technical details',
    ]);
    expect(
      ticketContentModel(doc, 'overview', labels, NOW).sidebar?.links.map(
        (item) => item.href,
      ),
    ).toContain('https://example.test/mr/1');
  });

  it('omits Latest summary and result links when both are empty', () => {
    expect(keysOf('overview', document({ links: [] }))).toEqual([
      'section:Description',
      'section:Technical details',
    ]);
  });

  it('does not place spec, plan or test documents on Overview', () => {
    const doc = document({}, [
      comment({
        id: 'spec-1',
        type: 'spec',
        body: 'THE-SPEC',
        created: '2026-07-18T10:00:00Z',
        internalId: 1,
      }),
      comment({
        id: 'plan-1',
        type: 'plan',
        body: 'THE-PLAN',
        created: '2026-07-18T10:00:00Z',
        internalId: 2,
      }),
      comment({
        id: 'test-1',
        type: 'test',
        body: 'THE-TEST',
        created: '2026-07-18T10:00:00Z',
        internalId: 3,
      }),
    ]);
    const overview = ticketContentModel(doc, 'overview', labels, NOW);
    expect(overview.entries.map((entry) => entry.title)).not.toEqual(
      expect.arrayContaining(['Latest spec', 'Latest plan', 'Latest test']),
    );
    const blob = overview.entries
      .flatMap((entry) => texts(entry.expanded))
      .join('\n');
    expect(blob).not.toContain('THE-SPEC');
    expect(blob).not.toContain('THE-PLAN');
    expect(blob).not.toContain('THE-TEST');
  });

  it('uses a one-line summary extract so Overview Card chrome still shows Description', () => {
    const body = Array.from(
      { length: 12 },
      (_line, index) => `status line ${index}`,
    ).join('\n');
    const doc = document({}, [
      comment({
        id: 'sum-1',
        type: 'summary',
        author: 'ann',
        created: '2026-07-18T20:00:00Z',
        internalId: 9,
        body,
      }),
    ]);
    const section = sectionsForTab(doc, OVERVIEW_TAB, labels, NOW).find(
      (item) => item.heading === 'Latest summary',
    );
    expect(section).toBeDefined();
    const expected = firstLineSummary((section?.lines ?? []).map(styledOf)).map(
      (line) => line.text,
    );
    const entry = ticketContentModel(doc, 'overview', labels, NOW).entries.find(
      (item) => item.key === 'section:Latest summary',
    );
    expect(entry?.key).toBe('section:Latest summary');
    expect(texts(entry?.collapsed)).toEqual(expected);
    expect(expected.filter((line) => !line.startsWith('…')).length).toBe(1);
    expect(texts(entry?.expanded).join('\n')).toContain('status line 11');
    expect(texts(entry?.collapsed).join('\n')).not.toContain('status line 11');
  });

  it('keeps the full description in expanded data and the extract when collapsed', () => {
    const body = [
      '## Context',
      '',
      'The gist of the ticket, in one prose line.',
      'A second prose line that belongs to the same paragraph.',
      '',
      'TAIL-ONLY-LINE',
    ].join('\n');
    const doc = document({ description: { value: body } });
    const section = sectionsForTab(doc, OVERVIEW_TAB, labels, NOW).find(
      (item) => item.heading === 'Description',
    );
    const entry = ticketContentModel(doc, 'overview', labels, NOW).entries.find(
      (item) => item.key === 'section:Description',
    );
    expect(texts(entry?.expanded)).toEqual(texts(section?.lines));
    expect(texts(entry?.collapsed)).toEqual(
      descriptionSummary((section?.lines ?? []).map(styledOf)).map(
        (line) => line.text,
      ),
    );
    expect(texts(entry?.collapsed).join('\n')).not.toContain('TAIL-ONLY-LINE');
    expect(texts(entry?.expanded).join('\n')).toContain('TAIL-ONLY-LINE');
  });

  it('initializes Summary and Description expanded on Overview', () => {
    const withSummary = ticketContentModel(
      document({}, [
        comment({
          id: 'sum-1',
          type: 'summary',
          body: 'Stand of the work.',
          internalId: 4,
        }),
      ]),
      'overview',
      labels,
      NOW,
    );
    expect([...initialExpandedKeys('overview', withSummary)]).toEqual([
      'section:Latest summary',
      'section:Description',
    ]);
    const model = ticketContentModel(document(), 'overview', labels, NOW);
    expect([...initialExpandedKeys('overview', model)]).toEqual([
      'section:Description',
    ]);
    expect(
      model.entries.find((entry) => entry.key === 'section:Technical details')
        ?.expandable,
    ).toBe(false);
  });

  it('builds Technical details from parent, assigned, created, branch, conductor, time and environments', () => {
    const doc = document({ time_estimate: 14_400, time_spent: 3600 }, [], {
      environments: { data: [{ id: 'env-1' }] },
    });
    const entry = ticketContentModel(doc, 'overview', labels, NOW).entries.find(
      (item) => item.key === 'section:Technical details',
    );
    const expanded = texts(entry?.expanded).join('\n');
    expect(expanded).toContain('parent: none');
    expect(expanded).toContain('assigned: Pat');
    expect(expanded).toContain('created: unknown');
    expect(expanded).toContain('feat/a_b_c');
    expect(expanded).toContain('runner-1');
    expect(expanded).toContain('4h');
    expect(expanded).toMatch(/environments/i);
    expect(expanded).not.toMatch(/Unassigned/);
    expect(texts(entry?.collapsed)).toEqual(texts(entry?.expanded));
  });

  it('writes empty technical properties as none, not prose empty states', () => {
    const entry = ticketContentModel(
      document({ branch_name: null, base_branch: null }, [], {
        conductor_id: { data: null },
        assignee_user_id: { data: null },
      }),
      'overview',
      labels,
      NOW,
    ).entries.find((item) => item.key === 'section:Technical details');
    const expanded = texts(entry?.expanded);
    expect(expanded).toEqual([
      'parent: none',
      'assigned: none',
      'reviewers: none',
      'created: unknown',
      'priority: none',
      'closed: no',
      'branch: none',
      'base: none',
      'conductor: none',
      'estimate: none',
      'spent: none',
      'environments: none',
    ]);
  });

  it('surfaces frozen and stall_reason in technical details', () => {
    const entry = ticketContentModel(
      document({
        frozen: true,
        frozen_at: '2026-04-08T12:00:00+00:00',
        stall_reason: 'no conductor',
      }),
      'overview',
      labels,
      NOW,
    ).entries.find((item) => item.key === 'section:Technical details');
    const expanded = texts(entry?.expanded);
    expect(expanded).toContain('frozen: yes');
    expect(expanded).toContain('frozen at: 2026-04-08T12:00:00+00:00');
    expect(expanded).toContain('stall: no conductor');
  });

  it('keeps branch metadata as a plain unparsed string', () => {
    const entry = ticketContentModel(
      document(),
      'overview',
      labels,
      NOW,
    ).entries.find((item) => item.key === 'section:Technical details');
    const branch = (entry?.expanded ?? []).find(
      (line) => typeof line === 'string' && line.includes('feat/a_b_c'),
    );
    expect(branch).toBe('branch: feat/a_b_c');
  });

  it('uses the existing empty description copy', () => {
    const entry = ticketContentModel(
      document({ description: { value: '' } }),
      'overview',
      labels,
      NOW,
    ).entries.find((item) => item.key === 'section:Description');
    expect(texts(entry?.expanded)).toEqual(['No description.']);
    expect(texts(entry?.collapsed)).toEqual(['No description.']);
  });

  it('treats a whitespace-only description as empty', () => {
    const entry = ticketContentModel(
      document({ description: { value: '   \n  ' } }),
      'overview',
      labels,
      NOW,
    ).entries.find((item) => item.key === 'section:Description');
    expect(texts(entry?.expanded)).toEqual(['No description.']);
  });

  it('omits Latest summary when there is no summary comment', () => {
    const model = ticketContentModel(document(), 'overview', labels, NOW);
    expect(model.entries.map((entry) => entry.key)).not.toContain(
      'section:Latest summary',
    );
    expect(model.entries[0]?.key).toBe('section:Description');
  });

  it('maps owner as created and does not substitute assignee', () => {
    const withOwner = ticketContentModel(
      document(
        {},
        [
          {
            id: 'owner-1',
            type: 'user--user',
            attributes: { display_name: 'Owner', name: 'owner' },
          },
        ],
        { owner_user_id: { data: { id: 'owner-1' } } },
      ),
      'overview',
      labels,
      NOW,
    );
    expect(
      withOwner.sidebar?.details.find((item) => item.key === 'created')?.value,
    ).toBe('Owner');
    expect(
      ticketContentModel(
        document(),
        'overview',
        labels,
        NOW,
      ).sidebar?.details.find((item) => item.key === 'created')?.value,
    ).toBe('unknown');
  });

  it('lists ticket success metrics as a one-row matrix, not Details properties', () => {
    const model = ticketContentModel(
      document({
        state: 'done',
        metrics: [
          { name: 'job_rating.score', value: '4.0000' },
          { name: 'ac_pass_rate', value: '0.8000', unit: 'ratio' },
          { name: 'review_bounces', value: '2.0000' },
          { name: 'time_to_done_h', value: '34.0000', unit: 'h' },
        ],
      }),
      'overview',
      labels,
      NOW,
    );
    expect(model.sidebar?.showMetrics).toBe(true);
    expect(
      model.sidebar?.matrix.ticket.columns.map((column) => column.label),
    ).toEqual(['score', 'AC', 'bounce', 'time']);
    expect(model.sidebar?.matrix.ticket.rows).toEqual([
      {
        id: 'ticket',
        label: '',
        cells: [
          { intensity: 0.8, display: '4' },
          { intensity: 0.8, display: '80%' },
          { intensity: 0.4, display: '2' },
          { intensity: 34 / 48, display: '34h' },
        ],
      },
    ]);
    expect(model.sidebar?.matrix.runs).toEqual({ columns: [], rows: [] });
    expect(model.sidebar?.details.map((item) => item.key)).not.toEqual(
      expect.arrayContaining([
        'ac_pass_rate',
        'review_bounces',
        'time_to_done_h',
        'metrics',
        'score',
        'tokens',
      ]),
    );
  });

  it('builds a runs-by-metrics matrix from included runs', () => {
    const model = ticketContentModel(
      document(
        { metrics: [{ name: 'job_rating.score', value: '5.0000' }] },
        [
          {
            id: 'run-old',
            type: 'bb_run--bb_run',
            attributes: {
              drupal_internal__id: 10,
              started_at: '2026-07-18T10:00:00Z',
              tokens: 1000,
              duration_s: 120,
              agent_turns: 4,
              tool_calls: 8,
            },
          },
          {
            id: 'run-new',
            type: 'bb_run--bb_run',
            attributes: {
              drupal_internal__id: 11,
              started_at: '2026-07-18T12:00:00Z',
              tokens: 4000,
              duration_s: 60,
              agent_turns: 8,
              tool_calls: 2,
            },
          },
        ],
        { runs: { data: [{ id: 'run-old' }, { id: 'run-new' }] } },
      ),
      'overview',
      labels,
      NOW,
    );
    expect(
      model.sidebar?.matrix.ticket.columns.map((column) => column.label),
    ).toEqual(['score']);
    expect(model.sidebar?.matrix.ticket.rows[0]?.cells).toEqual([
      { intensity: 1, display: '5' },
    ]);
    expect(
      model.sidebar?.matrix.runs.columns.map((column) => column.label),
    ).toEqual(['tok', 'dur', 'trn', 'tl']);
    expect(model.sidebar?.matrix.runs.rows).toEqual([
      {
        id: 'run-new',
        label: '#11',
        cells: [
          { intensity: 1, display: '4k', value: 4000 },
          { intensity: 0.5, display: '1m', value: 60 },
          { intensity: 1, display: '8', value: 8 },
          { intensity: 0.25, display: '2', value: 2 },
        ],
      },
      {
        id: 'run-old',
        label: '#10',
        cells: [
          { intensity: 0.25, display: '1k', value: 1000 },
          { intensity: 1, display: '2m', value: 120 },
          { intensity: 0.5, display: '4', value: 4 },
          { intensity: 1, display: '8', value: 8 },
        ],
      },
    ]);
  });

  it('shows the metrics tab on a done ticket and omits it before done', () => {
    const open = ticketContentModel(document(), 'overview', labels, NOW);
    expect(open.sidebar?.showMetrics).toBe(false);
    expect(open.sidebar?.matrix).toEqual({
      ticket: { columns: [], rows: [] },
      runs: { columns: [], rows: [] },
    });
    const done = ticketContentModel(
      document({ state: 'done' }),
      'overview',
      labels,
      NOW,
    );
    expect(done.sidebar?.showMetrics).toBe(true);
    expect(done.sidebar?.matrix).toEqual({
      ticket: { columns: [], rows: [] },
      runs: { columns: [], rows: [] },
    });
  });

  it('keeps a link title holding emphasis markers as a plain string', () => {
    const model = ticketContentModel(
      document({
        links: [{ title: '*not-bold*', uri: 'https://example.test/result' }],
      }),
      'overview',
      labels,
      NOW,
    );
    expect(model.sidebar?.links).toEqual([
      {
        key: '*not-bold*',
        value: 'https://example.test/result',
        href: 'https://example.test/result',
      },
    ]);
  });

  it('exposes related ticket identities as clickable properties', () => {
    const parentId = 'ticket-parent';
    const childId = 'ticket-child';
    const model = ticketContentModel(
      document(
        {},
        [
          {
            id: parentId,
            type: 'bb_ticket--bb_ticket',
            attributes: { identifier: 'BB-1', title: 'Parent epic' },
          },
          {
            id: childId,
            type: 'bb_ticket--bb_ticket',
            attributes: { identifier: 'BB-2', title: 'Child work' },
          },
        ],
        {
          parent_id: { data: { id: parentId } },
          sub_tickets: { data: [{ id: childId }] },
        },
      ),
      'overview',
      labels,
      NOW,
    );
    expect(
      model.sidebar?.details.find((item) => item.key === 'parent'),
    ).toEqual({
      key: 'parent',
      value: 'BB-1 · Parent epic',
      ticketId: parentId,
    });
    expect(model.sidebar?.related).toEqual(
      expect.arrayContaining([
        {
          key: 'parent',
          value: 'BB-1 · Parent epic',
          ticketId: parentId,
        },
        {
          key: 'sub-ticket',
          value: 'BB-2 · Child work',
          ticketId: childId,
        },
      ]),
    );
  });

  // BB-678 AC-1/AC-2/AC-3/AC-6: the `source` row carries the ticket's
  // `origin` URL, first and activatable like the existing link rows.
  it('lists the source ticket as the first Related row when origin is an http URL', () => {
    const model = ticketContentModel(
      document({
        origin: 'https://git.key-tec.de/bakers-build/bakers-build/-/issues/16',
      }),
      'overview',
      labels,
      NOW,
    );
    expect(model.sidebar?.related[0]).toEqual({
      key: 'source',
      value: 'https://git.key-tec.de/bakers-build/bakers-build/-/issues/16',
      href: 'https://git.key-tec.de/bakers-build/bakers-build/-/issues/16',
    });
  });

  it('shows a non-URL origin as plain text without href', () => {
    const model = ticketContentModel(
      document({ origin: 'legacy-tracker#16' }),
      'overview',
      labels,
      NOW,
    );
    expect(model.sidebar?.related[0]).toEqual({
      key: 'source',
      value: 'legacy-tracker#16',
    });
  });

  it('shows none for the source row when the ticket has no origin', () => {
    const model = ticketContentModel(document(), 'overview', labels, NOW);
    expect(model.sidebar?.related[0]).toEqual({
      key: 'source',
      value: 'none',
    });
  });

  it('creates presentation data rather than elements', () => {
    const model = ticketContentModel(document(), 'overview', labels, NOW);
    expect(model.selectableKeys).toEqual(
      model.entries.map((entry) => entry.key),
    );
    for (const entry of model.entries) {
      expect(entry).not.toHaveProperty('$$typeof');
      expect(typeof entry.key).toBe('string');
      expect(typeof entry.title).toBe('string');
    }
  });
});

describe('ticketContentModel Planning', () => {
  it('moves latest spec, plan and test into Planning, initially collapsed', () => {
    const doc = document({}, [
      comment({
        id: 'spec-1',
        type: 'spec',
        author: 'ann',
        created: '2026-07-18T20:00:00Z',
        internalId: 4,
        body: '## Spec\n\nDo the work.',
      }),
      comment({
        id: 'plan-1',
        type: 'plan',
        author: 'ann',
        created: '2026-07-18T20:00:00Z',
        internalId: 5,
        body: 'Step one.',
      }),
      comment({
        id: 'test-1',
        type: 'test',
        author: 'ann',
        created: '2026-07-18T20:00:00Z',
        internalId: 6,
        body: 'Assert the outcome.',
      }),
    ]);
    const model = ticketContentModel(doc, 'planning', labels, NOW);
    expect(model.entries.map((entry) => entry.key)).toEqual([
      'section:Latest spec',
      'section:Latest plan',
      'section:Latest test',
    ]);
    expect(initialExpandedKeys('planning', model).size).toBe(3);
    for (const entry of model.entries) {
      expect(entry.expandable).toBe(true);
      expect(texts(entry.collapsed)).toEqual(
        descriptionSummary(entry.expanded.map(styledOf)).map(
          (line) => line.text,
        ),
      );
    }
    expect(texts(model.entries[0]?.expanded).join('\n')).toContain(
      'Do the work.',
    );
    expect(texts(model.entries[1]?.expanded).join('\n')).toContain('Step one.');
    expect(texts(model.entries[2]?.expanded).join('\n')).toContain(
      'Assert the outcome.',
    );
  });

  it('selects the newest exact-type handoff and ignores other types', () => {
    const doc = document({}, [
      comment({
        id: 'spec-old',
        type: 'spec',
        created: TIED,
        internalId: 10,
        body: 'OLDER-SPEC',
      }),
      comment({
        id: 'spec-new',
        type: 'spec',
        created: TIED,
        internalId: 11,
        body: 'NEWER-SPEC',
      }),
      comment({
        id: 'hand',
        type: 'summary',
        created: '2026-07-22T10:00:00Z',
        internalId: 12,
        body: 'NOT-A-SPEC',
      }),
      comment({
        id: 'specs',
        type: 'specs',
        created: '2026-07-22T11:00:00Z',
        internalId: 13,
        body: 'TYPO-SPEC',
      }),
    ]);
    const spec = ticketContentModel(doc, 'planning', labels, NOW).entries[0];
    const body = texts(spec?.expanded).join('\n');
    expect(body).toContain('NEWER-SPEC');
    expect(body).not.toContain('OLDER-SPEC');
    expect(body).not.toContain('NOT-A-SPEC');
    expect(body).not.toContain('TYPO-SPEC');
  });

  it('preserves author and relative created metadata on planning documents', () => {
    const created = '2026-07-18T20:00:00Z';
    const doc = document({}, [
      comment({
        id: 'spec-1',
        type: 'spec',
        author: 'feat/a_b_c',
        created,
        internalId: 1,
        body: 'Spec body.',
      }),
    ]);
    const spec = ticketContentModel(doc, 'planning', labels, NOW).entries[0];
    expect(spec?.metadata).toBe(
      `feat/a_b_c · ${relativeCreated(created, NOW)}`,
    );
  });

  it('exposes named empty states when optional planning documents are missing', () => {
    const model = ticketContentModel(document(), 'planning', labels, NOW);
    expect(texts(model.entries[0]?.expanded)).toEqual(['No spec comment.']);
    expect(texts(model.entries[1]?.expanded)).toEqual(['No plan comment.']);
    expect(texts(model.entries[2]?.expanded)).toEqual(['No test comment.']);
  });
});

describe('ticketContentModel comments', () => {
  it('lists comments newest first and breaks ties by internal id then resource id', () => {
    const doc = document({}, [
      comment({
        id: 'aaaaaaaa-0000-0000-0000-000000000001',
        type: 'note',
        created: '2026-07-20T10:00:00Z',
        internalId: 1101,
        body: 'body-A',
      }),
      comment({
        id: 'aaaaaaaa-0000-0000-0000-000000000002',
        type: 'note',
        created: TIED,
        internalId: 1102,
        body: 'body-B',
      }),
      comment({
        id: 'aaaaaaaa-0000-0000-0000-000000000003',
        type: 'note',
        created: '2026-07-22T10:00:00Z',
        internalId: 1103,
        body: 'body-C',
      }),
    ]);
    const model = ticketContentModel(doc, 'comments', labels, NOW);
    expect(model.entries.map((entry) => entry.key)).toEqual([
      'comment:aaaaaaaa-0000-0000-0000-000000000003',
      'comment:aaaaaaaa-0000-0000-0000-000000000002',
      'comment:aaaaaaaa-0000-0000-0000-000000000001',
    ]);
    expect(texts(model.entries[0]?.expanded)[0]).toBe('body-C');
  });

  it('breaks a created tie with the resource id when internal ids are absent', () => {
    const doc = document({}, [
      comment({
        id: 'ffffffff-0000-0000-0000-0000000000aa',
        created: TIED,
        body: 'body-aaa',
      }),
      comment({
        id: 'ffffffff-0000-0000-0000-0000000000bb',
        created: TIED,
        body: 'body-bbb',
      }),
    ]);
    expect(keysOf('comments', doc)).toEqual([
      'comment:ffffffff-0000-0000-0000-0000000000bb',
      'comment:ffffffff-0000-0000-0000-0000000000aa',
    ]);
  });

  it('uses the index fallback only when a fixture comment has no resource id', () => {
    const doc = document({}, [
      comment({
        type: 'note',
        created: '2026-07-22T10:00:00Z',
        body: 'newest',
      }),
      comment({
        id: 'has-id',
        type: 'note',
        created: '2026-07-20T10:00:00Z',
        body: 'older',
      }),
    ]);
    expect(keysOf('comments', doc)).toEqual([
      'comment:index-0',
      'comment:has-id',
    ]);
  });

  it('preserves type, author and relative created as plain metadata', () => {
    const created = '2026-07-18T20:00:00Z';
    const doc = document({}, [
      comment({
        id: 'c-1',
        type: 'review',
        author: 'feat/a_b_c',
        created,
        body: 'Looks good.',
      }),
    ]);
    const entry = ticketContentModel(doc, 'comments', labels, NOW).entries[0];
    expect(entry?.title).toBe('review');
    expect(entry?.metadata).toBe(
      `feat/a_b_c · ${relativeCreated(created, NOW)}`,
    );
    expect(entry?.metadata).toContain('3m ago');
  });

  it('exposes No comment content. when the parsed body is blank', () => {
    const doc = document({}, [
      comment({
        id: 'blank',
        type: 'note',
        created: '2026-07-18T20:00:00Z',
        body: '   \n',
      }),
    ]);
    const entry = ticketContentModel(doc, 'comments', labels, NOW).entries[0];
    expect(texts(entry?.expanded)).toEqual(['No comment content.']);
    expect(entry?.expanded).toEqual(['No comment content.']);
  });

  it('uses the empty collection copy and nothing selectable', () => {
    const model = ticketContentModel(document(), 'comments', labels, NOW);
    expect(model.entries).toEqual([]);
    expect(model.selectableKeys).toEqual([]);
  });

  it('expands the newest comment initially', () => {
    const doc = document({}, [
      comment({ id: 'old', created: '2026-07-20T10:00:00Z', body: 'old' }),
      comment({ id: 'new', created: '2026-07-22T10:00:00Z', body: 'new' }),
    ]);
    const model = ticketContentModel(doc, 'comments', labels, NOW);
    expect([...initialExpandedKeys('comments', model)]).toEqual([
      'comment:new',
    ]);
  });
});

describe('ticket content identity', () => {
  const older = comment({
    id: 'id-old',
    created: '2026-01-01T00:00:00Z',
    internalId: 1,
    body: 'older',
  });
  const selected = comment({
    id: 'id-sel',
    created: '2026-01-02T00:00:00Z',
    internalId: 2,
    body: 'selected',
  });
  const inserted = comment({
    id: 'id-new',
    created: '2026-01-03T00:00:00Z',
    internalId: 3,
    body: 'inserted',
  });

  it('keeps the selected key and expanded keys across insertion and does not transfer them', () => {
    const before = ticketContentModel(
      document({}, [selected, older]),
      'comments',
      labels,
      NOW,
    );
    expect(before.selectableKeys).toEqual(['comment:id-sel', 'comment:id-old']);
    const selectedKey = 'comment:id-sel';
    const expanded = new Set(['comment:id-sel']);
    const after = ticketContentModel(
      document({}, [inserted, selected, older]),
      'comments',
      labels,
      NOW,
    );
    expect(after.selectableKeys).toEqual([
      'comment:id-new',
      'comment:id-sel',
      'comment:id-old',
    ]);
    expect(resolveSelectedKey(after.selectableKeys, selectedKey)).toBe(
      'comment:id-sel',
    );
    const kept = retainExpandedKeys(after.selectableKeys, expanded);
    expect([...kept]).toEqual(['comment:id-sel']);
    expect(kept.has('comment:id-new')).toBe(false);
  });

  it('drops removed keys on deletion and selects the first remaining key', () => {
    const expanded = new Set(['comment:id-sel', 'comment:id-old']);
    const after = ticketContentModel(
      document({}, [inserted, older]),
      'comments',
      labels,
      NOW,
    );
    expect(after.selectableKeys).toEqual(['comment:id-new', 'comment:id-old']);
    expect(resolveSelectedKey(after.selectableKeys, 'comment:id-sel')).toBe(
      'comment:id-new',
    );
    expect([...retainExpandedKeys(after.selectableKeys, expanded)]).toEqual([
      'comment:id-old',
    ]);
  });

  it('encodes row ids injectively under a ticket-content prefix', () => {
    const keys = [
      'section:Latest summary',
      'section:Latest-summary',
      'section:Description',
      'comment:id-sel',
      'comment:id-sel-header',
    ];
    const ids = keys.map(ticketContentRowId);
    expect(new Set(ids).size).toBe(keys.length);
    for (const id of ids) {
      expect(id.startsWith('ticket-content-')).toBe(true);
      expect(id.slice('ticket-content-'.length).includes('-')).toBe(false);
    }
  });
});

describe('ticketContentModel Overview reviewers', () => {
  const reviewed = () =>
    document(
      {},
      [
        {
          id: 'user-2',
          type: 'user--user',
          attributes: { display_name: 'Ada', name: 'ada' },
        },
        {
          id: 'rev-1',
          type: 'bb_comment--review',
          attributes: {
            author_name: 'Ada',
            review_state: 'submitted',
            body: { value: 'pending body' },
            created: '2026-07-23T10:00:00+00:00',
          },
        },
      ],
      {
        reviewers: { data: [{ type: 'user--user', id: 'user-2' }] },
        pending_reviews: {
          data: [{ type: 'bb_comment--review', id: 'rev-1' }],
        },
      },
    );

  it('shows the reviewers beside the assignee in Details', () => {
    const details =
      ticketContentModel(reviewed(), 'overview', labels, NOW).sidebar
        ?.details ?? [];
    const keys = details.map((item) => item.key);
    expect(keys.indexOf('reviewers')).toBe(keys.indexOf('assigned') + 1);
    expect(details.find((item) => item.key === 'reviewers')?.value).toBe('Ada');
  });

  it('lists pending reviews with an absolute Web link', () => {
    const model = ticketContentModel(
      reviewed(),
      'overview',
      labels,
      NOW,
      'https://bakers.example.test',
    );
    const entry = model.entries.find(
      (item) => item.key === 'section:Pending reviews',
    );
    expect(entry).toBeDefined();
    expect(texts(entry?.expanded).join('\n')).toContain(
      'https://bakers.example.test/admin/bakers/ticket/ticket-1',
    );
  });
});
