import { pipeReport } from '../pipe-report.js';
// Whole-ticket pipe fixtures exercise the kernel composer. Existing literal
// section contents are preserved; complete section blocks were reordered into
// Overview, Comments, Related and Runs after approval of weighted pipe order.
// Compact views and individual addon reports remain single-screen checks.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ticketDetailInputContext as addonTicketInput } from '@bakers-build/addon-bakers-ui/ui';
import { describe, expect, it, vi } from 'vitest';
import { ArtifactsTabScreen } from '../../../bakers-ui-artifacts/src/panel.js';
import {
  TicketDetailScreen,
  ticketDetailInputContext,
} from '../../src/Entity/ticket/Screen/ticket-detail.js';
import { ContextBag } from '../../src/Routing/context.js';
import type { ScreenContext } from '../../src/Screen/screen.js';
import type { TicketDetailDocument } from '../../src/types.js';

/** A document exercising every section, empty state and label rung at once. */
const rich: TicketDetailDocument = {
  data: {
    type: 'bb_ticket--bb_ticket',
    id: 'ticket-1',
    attributes: {
      identifier: 'BB-340',
      title: 'Move the bakers-ui application boundary',
      description: {
        value:
          '## Context\n\nThe first paragraph of the body.\nA second line of it.\n\n### Detail\n\nA tail line.\nAnother tail line.\nA third tail line.\nA fourth tail line.',
      },
      assignee_name: 'cw',
      time_estimate: 7200,
      time_spent: 10800,
      branch_name: 'feat/bb-340',
      base_branch: 'develop',
      links: [
        { title: 'MR', uri: 'https://example.test/mr/1' },
        { title: '', url: 'https://example.test/pipeline/2' },
      ],
    },
    relationships: {
      labels: { data: [{ id: 'term-1' }, { id: 'term-missing' }] },
      parent_id: { data: { id: 'ticket-parent' } },
      assignee_user_id: { data: { id: 'user-1' } },
      conductor_id: { data: { id: 'conductor-1' } },
      sub_tickets: { data: [{ id: 'a' }, { id: 'b' }] },
      referenced_tickets: { data: [] },
      environments: { data: [{ id: 'env-1' }] },
      runs: { data: [{ id: 'run-1' }, { id: 'run-2' }] },
    },
  },
  included: [
    {
      type: 'bb_term--label',
      id: 'term-1',
      attributes: { name: 'boundary' },
    },
    {
      type: 'bb_ticket--bb_ticket',
      id: 'ticket-parent',
      attributes: { identifier: 'BB-322', title: 'Evaluate the renderer' },
    },
    {
      type: 'user--user',
      id: 'user-1',
      attributes: { display_name: 'Christian' },
    },
    {
      type: 'bb_conductor--bb_conductor',
      id: 'conductor-1',
      attributes: { label: 'cw-framework' },
    },
    {
      type: 'bb_run--bb_run',
      id: 'run-1',
      attributes: {
        drupal_internal__id: 4599,
        status: 'running',
        state: 'coding',
        created: '2026-08-10T10:00:00+00:00',
      },
    },
    {
      type: 'bb_run--bb_run',
      id: 'run-2',
      attributes: {
        drupal_internal__id: 4600,
        status: 'done',
        state: 'review',
        created: '2026-08-10T12:00:00+00:00',
      },
    },
    {
      type: 'bb_comment--bb_comment',
      id: 'comment-1',
      attributes: {
        drupal_internal__id: 11,
        bb_comment_type: 'qualification',
        author_name: 'cw',
        created: '2026-08-10T09:00:00+00:00',
        body: { value: 'First comment line A\nFirst comment line B' },
      },
    },
    {
      type: 'bb_comment--bb_comment',
      id: 'comment-2',
      attributes: {
        drupal_internal__id: 12,
        bb_comment_type: 'acceptance',
        author_name: '',
        created: '2026-08-10T11:00:00+00:00',
        body: { value: 'Second comment body' },
      },
    },
    {
      type: 'bb_comment--bb_comment',
      id: 'comment-3',
      attributes: { bb_comment_type: 'comment', body: { value: '' } },
    },
  ],
};

// ─── BB-372 — the pipe carries the RENDERED body (AC-3, V3) ────────────────
//
// `renderNonInteractive` returns `detailLines(...).lines`, i.e. `row.text` for
// every row, and `row.text` IS the rendered text of a `StyledLine` (D4). So the
// pipe and the interactive tree are the same rendering by construction rather
// than by agreement: the tree merely adds the attributes a pipe cannot carry, and
// there is no raw-only pipe path left to disagree.
//
// THE ROWS BELOW ARE WRITTEN FROM D2's TABLE, NOT CAPTURED FROM A RUN. That is
// the same discipline as the pre-conversion captures above, for the same reason:
// a snapshot taken after the change would agree with whatever the change
// produced. Each row states what the spec says the construct renders as.

/** One of every construct D2's subset table names, plus two degradations. */
const MARKDOWN_BODY = [
  '## Goal',
  'A **bold** word and an *em* one.',
  '- [ ] **AC-1** open',
  '- [x] done',
  '- a bullet',
  '1. ordered',
  '`inline code`',
  '> a ~~struck~~ quote',
  '',
  '---',
  '',
  '```ts',
  'const x = 1;',
  '```',
  'See [the MR](https://x.test/mr/1).',
  'snake_case and feat/a_b_c stay put.',
].join('\n');

const MARKDOWN_COMMENT = [
  '## Outcome',
  'It **worked**: `pnpm test` is green.',
  '- [x] shipped',
].join('\n');

const markdown: TicketDetailDocument = {
  data: {
    type: 'bb_ticket--bb_ticket',
    id: 'ticket-372',
    attributes: {
      identifier: 'BB-372',
      title: 'Render every Markdown body as Markdown',
      description: { value: MARKDOWN_BODY },
      // AC-5 — each of these holds a character a Markdown rule would touch, and
      // each must reach the pipe byte-identical.
      branch_name: 'feat/a_b_c',
      base_branch: 'feat/__init__',
      links: [{ title: '*starred*', uri: 'https://example.test/mr/9' }],
    },
    relationships: {
      labels: { data: [{ id: 'term-md' }] },
    },
  },
  included: [
    {
      type: 'bb_term--label',
      id: 'term-md',
      attributes: { name: '__x__' },
    },
    {
      type: 'bb_comment--bb_comment',
      id: 'comment-md',
      attributes: {
        bb_comment_type: 'summary',
        author_name: 'cw',
        created: '2026-08-18T09:00:00+00:00',
        body: { value: MARKDOWN_COMMENT },
      },
    },
  ],
};

/** WRITTEN FROM D2 — what each construct renders as, row for row. */
const MARKDOWN = [
  // BB-369 D7 opens the flat render with `State`, and this fixture's ticket has
  // no `state` attribute, so `headerState` gives its explicit dash. Added when
  // BB-369 landed under this branch; it is 369's row and 372 does not touch it.
  'State',
  '—',
  '',
  'Labels',
  '__x__',
  '',
  'Source',
  'none',
  '',
  'Parent',
  'No parent ticket.',
  '',
  'Links',
  '*starred* https://example.test/mr/9',
  '',
  'Latest summary',
  '— summary · cw · 2026-08-18T09:00:00+00:00',
  'Outcome',
  'It worked: pnpm test is green.',
  '☑ shipped',
  '',
  'Description',
  'Goal',
  'A bold word and an em one.',
  '☐ AC-1 open',
  '☑ done',
  '• a bullet',
  '1. ordered',
  'inline code',
  '│ a struck quote',
  '',
  '────────',
  '',
  '  const x = 1;',
  'See the MR (https://x.test/mr/1).',
  'snake_case and feat/a_b_c stay put.',
  '',
  'Assignment',
  'Unassigned.',
  'Reviewers: —',
  'No conductor.',
  '',
  'Time',
  'No estimate and no accounted time.',
  '',
  'Branch',
  'branch: feat/a_b_c',
  'base:   feat/__init__',
  '',
  'Environments',
  'No environments.',
  '',
  'Latest spec',
  'No spec comment.',
  '',
  'Latest plan',
  'No plan comment.',
  '',
  'Latest test',
  'No test comment.',
  '',
  'Comments',
  '— summary ·',
  'Outcome',
  'It worked: pnpm test is green.',
  '☑ shipped',
  '',
  'Runs',
  'RUN TICKET STATE PHASE AGENT STARTED',
  'No runs for this ticket.',
  '',
];

/** No attributes at all: every section falls to its explicit empty state. */
const bare: TicketDetailDocument = {
  data: { type: 'bb_ticket--bb_ticket', id: 'ticket-2', attributes: {} },
};

/**
 * The label ladder's THIRD rung: neither an include nor the ticket's own computed
 * field names the assignee, so only labels the caller already resolved can.
 */
const ladder: TicketDetailDocument = {
  data: {
    type: 'bb_ticket--bb_ticket',
    id: 'ticket-4',
    attributes: { identifier: 'BB-9', title: 'Label ladder' },
    relationships: {
      assignee_user_id: { data: { id: 'user-9' } },
      conductor_id: { data: { id: 'conductor-9' } },
    },
  },
  included: [],
};

const labels = {
  users: [{ id: 'user-9', label: 'Tom' }],
  conductors: [{ id: 'conductor-9', label: 'tom-box' }],
};

/**
 * BB-369 AC-4 — the three new sections with CONTENT rather than empty states.
 *
 * Its own fixture rather than more attributes on `rich`, so that every row of the
 * documents above stays the pre-conversion capture (see the header). What it
 * exercises, and each is a decision the pipe has to reproduce:
 *
 *  - a workflow `state`, so the flat render carries the value and not the dash;
 *  - TWO `summary` comments with the SAME `created`, so only
 *    `drupal_internal__id` can decide which is "newest" (D3), plus a `handoff`
 *    comment 14 hours NEWER than both, which the exact-match filter must skip;
 *  - TWO blockers, one sideloaded and one deliberately not, so both rungs of D5's
 *    identity ladder are on screen at once.
 */
const filled: TicketDetailDocument = {
  data: {
    type: 'bb_ticket--bb_ticket',
    id: 'ticket-5',
    attributes: {
      identifier: 'BB-369',
      title: 'state, latest summary and blocked_by',
      state: 'coding',
    },
    relationships: {
      blocked_by: {
        data: [{ id: 'ticket-blocker' }, { id: 'blocker-no-include' }],
      },
    },
  },
  included: [
    {
      type: 'bb_ticket--bb_ticket',
      id: 'ticket-blocker',
      attributes: { identifier: 'BB-19', title: 'the blocking spec' },
    },
    {
      type: 'bb_comment--bb_comment',
      id: 'summary-older',
      attributes: {
        drupal_internal__id: 21,
        bb_comment_type: 'summary',
        author_name: 'cw',
        created: '2026-08-18T09:00:00+00:00',
        body: { value: 'OLDER summary body.' },
      },
    },
    {
      type: 'bb_comment--bb_comment',
      id: 'summary-newer',
      attributes: {
        drupal_internal__id: 22,
        bb_comment_type: 'summary',
        author_name: 'cw',
        created: '2026-08-18T09:00:00+00:00',
        body: { value: 'NEWER summary body.\nA second line of it.' },
      },
    },
    {
      type: 'bb_comment--bb_comment',
      id: 'handoff-newest',
      attributes: {
        drupal_internal__id: 23,
        bb_comment_type: 'handoff',
        author_name: 'cw',
        created: '2026-08-18T23:00:00+00:00',
        body: { value: 'A handoff newer than both summaries.' },
      },
    },
  ],
};

const contextFor = (
  document: TicketDetailDocument | undefined,
  params: Record<string, string>,
): ScreenContext => ({
  sessionGeneration: 1,
  requestDraw: vi.fn(),
  isActive: () => true,
  params,
  contexts: document
    ? ContextBag.empty().set(ticketDetailInputContext, { document })
    : ContextBag.empty(),
  // Fixed, so the Runs section's relative START column is deterministic.
  nowSeconds: () => 1_786_000_000,
});

/** The screen, entered on `document`, plus the context the pipe would use. */
const opened = (
  document: TicketDetailDocument | undefined,
  params: Record<string, string> = { ticketId: 'ticket-1' },
): { screen: TicketDetailScreen; context: ScreenContext } => {
  const screen = new TicketDetailScreen();
  const context = contextFor(document, params);
  if (document) screen.enter(context);
  return { screen, context };
};

/** CAPTURED BEFORE THE CONVERSION — full mode, the rich document */
const RICH = [
  // BB-369 D7/D1 — authored, not captured: `rich` declares no `state`, so the
  // section renders the explicit dash rather than a blank row.
  'State',
  '—',
  '',
  'Labels',
  'boundary',
  'term-missing',
  '',
  'Source',
  'none',
  '',
  'Parent',
  'BB-322 · Evaluate the renderer',
  '',
  'Links',
  'MR https://example.test/mr/1',
  'https://example.test/pipeline/2',
  '',
  'Latest summary',
  'No summary comment.',
  '',
  'Description',
  'Context',
  '',
  'The first paragraph of the body.',
  'A second line of it.',
  '',
  'Detail',
  '',
  'A tail line.',
  'Another tail line.',
  'A third tail line.',
  'A fourth tail line.',
  '',
  'Assignment',
  'Assignee:  Christian',
  'Reviewers: —',
  'Conductor: cw-framework',
  '',
  'Time',
  'estimate: 2h',
  'spent:    3h',
  'over:     1h',
  '',
  'Branch',
  'branch: feat/bb-340',
  'base:   develop',
  '',
  'Environments',
  '1 environments',
  '',
  'Latest spec',
  'No spec comment.',
  '',
  'Latest plan',
  'No plan comment.',
  '',
  'Latest test',
  'No test comment.',
  '',
  'Comments',
  '— acceptance ·',
  'Second comment body',
  '— qualification ·',
  'First comment line A',
  'First comment line B',
  '— comment ·',
  '',
  '',
  'Runs',
  'RUN TICKET STATE PHASE AGENT STARTED',
  '#4600 — review — — just now',
  '#4599 — coding — — just now',
  '',
];

/** CAPTURED BEFORE THE CONVERSION — full mode, a bare document */
const BARE = [
  'State',
  '—',
  '',
  'Labels',
  'No labels.',
  '',
  'Source',
  'none',
  '',
  'Parent',
  'No parent ticket.',
  '',
  'Links',
  'No links.',
  '',
  'Latest summary',
  'No summary comment.',
  '',
  'Description',
  'No description.',
  '',
  'Assignment',
  'Unassigned.',
  'Reviewers: —',
  'No conductor.',
  '',
  'Time',
  'No estimate and no accounted time.',
  '',
  'Branch',
  'branch: —',
  'base:   —',
  '',
  'Environments',
  'No environments.',
  '',
  'Latest spec',
  'No spec comment.',
  '',
  'Latest plan',
  'No plan comment.',
  '',
  'Latest test',
  'No test comment.',
  '',
  'Comments',
  'No comments.',
  '',
  'Runs',
  'RUN TICKET STATE PHASE AGENT STARTED',
  'No runs for this ticket.',
  '',
];

/** CAPTURED BEFORE THE CONVERSION — --view teaser */
const TEASER = [
  'BB-340 · Move the bakers-ui application boundary',
  '',
  'state      —',
  'status     —',
  'since      —',
  'assignee   cw',
  'claim      —',
];

/** CAPTURED BEFORE THE CONVERSION — --view board_card */
const BOARD = [
  'BB-340 · Move the bakers-ui application boundary',
  '',
  'state      —',
  'type       —',
  'status     —',
  'priority   —',
  'claim      —',
];

/** CAPTURED BEFORE THE CONVERSION — --view teaser, a bare document */
const TEASER_BARE = [
  '— · —',
  '',
  'state      —',
  'status     —',
  'since      —',
  'assignee   —',
  'claim      —',
];

/** CAPTURED BEFORE THE CONVERSION — the label ladder, labels supplied */
const LADDER_LABELS = [
  'State',
  '—',
  '',
  'Labels',
  'No labels.',
  '',
  'Source',
  'none',
  '',
  'Parent',
  'No parent ticket.',
  '',
  'Links',
  'No links.',
  '',
  'Latest summary',
  'No summary comment.',
  '',
  'Description',
  'No description.',
  '',
  'Assignment',
  'Assignee:  Tom',
  'Reviewers: —',
  'Conductor: tom-box',
  '',
  'Time',
  'No estimate and no accounted time.',
  '',
  'Branch',
  'branch: —',
  'base:   —',
  '',
  'Environments',
  'No environments.',
  '',
  'Latest spec',
  'No spec comment.',
  '',
  'Latest plan',
  'No plan comment.',
  '',
  'Latest test',
  'No test comment.',
  '',
  'Comments',
  'No comments.',
  '',
  'Runs',
  'RUN TICKET STATE PHASE AGENT STARTED',
  'No runs for this ticket.',
  '',
];

/** CAPTURED BEFORE THE CONVERSION — the label ladder, no labels */
const LADDER_RAW = [
  'State',
  '—',
  '',
  'Labels',
  'No labels.',
  '',
  'Source',
  'none',
  '',
  'Parent',
  'No parent ticket.',
  '',
  'Links',
  'No links.',
  '',
  'Latest summary',
  'No summary comment.',
  '',
  'Description',
  'No description.',
  '',
  'Assignment',
  'Assignee:  user-9',
  'Reviewers: —',
  'Conductor: conductor-9',
  '',
  'Time',
  'No estimate and no accounted time.',
  '',
  'Branch',
  'branch: —',
  'base:   —',
  '',
  'Environments',
  'No environments.',
  '',
  'Latest spec',
  'No spec comment.',
  '',
  'Latest plan',
  'No plan comment.',
  '',
  'Latest test',
  'No test comment.',
  '',
  'Comments',
  'No comments.',
  '',
  'Runs',
  'RUN TICKET STATE PHASE AGENT STARTED',
  'No runs for this ticket.',
  '',
];

/**
 * BB-369 AC-4 — AUTHORED FROM THE SPEC, ROW BY ROW, not captured from a run.
 *
 * Derived by hand from D7's section order and each section's own stated rule:
 * `State` first with the attribute's value; `Latest summary` above `Description`
 * carrying the marker `— summary · <author> · <created>` and then the body one row
 * per physical line; `Blocked by` between `Sub-tickets` and `Runs` with one identity
 * row per blocker, degrading to the raw uuid where the include is missing.
 *
 * The two facts worth reading off it directly: the summary block is `summary-newer`
 * (`drupal_internal__id` 22 beat 21 on an identical `created`) and NOT
 * `handoff-newest`, which is the newest comment on the ticket by fourteen hours; and
 * the `Comments` section below still lists all three, newest first, so the new
 * section is a lens on the comment list rather than a second source of it.
 */
const FILLED = [
  'State',
  'coding',
  '',
  'Labels',
  'No labels.',
  '',
  'Source',
  'none',
  '',
  'Parent',
  'No parent ticket.',
  '',
  'Links',
  'No links.',
  '',
  'Latest summary',
  '— summary · cw · 2026-08-18T09:00:00+00:00',
  'NEWER summary body.',
  'A second line of it.',
  '',
  'Description',
  'No description.',
  '',
  'Assignment',
  'Unassigned.',
  'Reviewers: —',
  'No conductor.',
  '',
  'Time',
  'No estimate and no accounted time.',
  '',
  'Branch',
  'branch: —',
  'base:   —',
  '',
  'Environments',
  'No environments.',
  '',
  'Latest spec',
  'No spec comment.',
  '',
  'Latest plan',
  'No plan comment.',
  '',
  'Latest test',
  'No test comment.',
  '',
  'Comments',
  '— handoff ·',
  'A handoff newer than both summaries.',
  '— summary ·',
  'NEWER summary body.',
  'A second line of it.',
  '— summary ·',
  'OLDER summary body.',
  '',
  'Runs',
  'RUN TICKET STATE PHASE AGENT STARTED',
  'No runs for this ticket.',
  '',
];

describe('F5 — the ticket report preserves content in weighted tab order', () => {
  it('full mode prints every section of a rich document', async () => {
    const { screen, context } = opened(rich);
    expect(await pipeReport(screen.document ?? {}, context)).toEqual(RICH);
  });

  it('and the title the kernel prints above them', async () => {
    const { screen, context } = opened(rich);
    expect(screen.present(context).title).toBe(
      'BB-340 · Move the bakers-ui application boundary',
    );
  });

  it('full mode prints every empty state of a bare document', async () => {
    const { screen, context } = opened(bare, { ticketId: 'ticket-2' });
    expect(await pipeReport(screen.document ?? {}, context)).toEqual(BARE);
  });

  it('the pipe reads the DOCUMENT, so the active tab never reaches it', async () => {
    // The interactive surface renders one tab at a time; this output renders the
    // whole document. Four screen states, one set of rows — which is why the
    // conversion of the tab views cannot move these bytes.
    const rows: string[][] = [];
    for (const drive of [
      () => {},
      (screen: TicketDetailScreen) => screen.setLabels(labels),
      (screen: TicketDetailScreen, ctx: ScreenContext) =>
        screen.handleInput('tab', ctx),
      (screen: TicketDetailScreen, ctx: ScreenContext) =>
        screen.activate(0, ctx),
    ] as ((screen: TicketDetailScreen, ctx: ScreenContext) => void)[]) {
      const { screen, context } = opened(rich);
      drive(screen, context);
      rows.push(await pipeReport(screen.document ?? {}, context));
    }
    for (const set of rows) expect(set).toEqual(RICH);
  });

  it('teaser mode prints the teaser field set', async () => {
    const { screen, context } = opened(rich, {
      ticketId: 'ticket-1',
      view: 'teaser',
    });
    expect(screen.renderNonInteractive(context)).toEqual(TEASER);
  });

  it('board_card mode prints the board_card field set', async () => {
    const { screen, context } = opened(rich, {
      ticketId: 'ticket-1',
      view: 'board_card',
    });
    expect(screen.renderNonInteractive(context)).toEqual(BOARD);
  });

  it('teaser mode degrades to the em-dash placeholder, column-aligned', async () => {
    const { screen, context } = opened(bare, {
      ticketId: 'ticket-2',
      view: 'teaser',
    });
    expect(screen.renderNonInteractive(context)).toEqual(TEASER_BARE);
  });

  it('the label ladder resolves through the caller`s labels', async () => {
    const { screen, context } = opened(ladder, { ticketId: 'ticket-4' });
    screen.setLabels(labels);
    expect(
      await pipeReport(screen.document ?? {}, context, [], labels),
    ).toEqual(LADDER_LABELS);
  });

  it('and falls back to the raw uuid when it has none', async () => {
    const { screen, context } = opened(ladder, { ticketId: 'ticket-4' });
    expect(await pipeReport(screen.document ?? {}, context)).toEqual(
      LADDER_RAW,
    );
  });

  // BB-369 AC-4 — the three new sections, with content rather than empty states.
  it('full mode prints the state, the newest summary and the blockers', async () => {
    const { screen, context } = opened(filled, { ticketId: 'ticket-5' });
    expect(await pipeReport(screen.document ?? {}, context)).toEqual(FILLED);
  });

  it('a screen with nothing loaded prints its loading row, not an empty pipe', async () => {
    const { screen, context } = opened(undefined, { ticketId: 'ticket-3' });
    expect(screen.renderNonInteractive(context)).toEqual(['Loading ticket…']);
  });

  // BB-372 R2 — THE ASSERTION THAT MAKES THE NEW FIXTURE THE ONLY THING THAT
  // MOVED.
  //
  // `RICH` above is an ATX-ONLY capture, taken from the build before the BB-340
  // conversion. Every construct in its description is an ATX heading, and this
  // ticket's rules render an ATX heading exactly as `markdownRow` did — so the
  // array is unchanged, byte for byte, and the case that compares against it is
  // untouched. If it had moved, the rendering would have changed something it was
  // not asked to. The new Markdown is added as a SEPARATE fixture rather than by
  // re-capturing that array.
  it('R2: an ATX-only body renders exactly as it did before BB-372', async () => {
    const { screen, context } = opened(rich);
    const rows = await pipeReport(screen.document ?? {}, context);
    // Named rather than indexed: the point is that these specific rows are the
    // pre-change capture's, and `RICH` itself is asserted whole above.
    expect(rows[RICH.indexOf('Context')], 'the `## Context` row').toBe(
      'Context',
    );
    expect(rows[RICH.indexOf('Detail')], 'the `### Detail` row').toBe('Detail');
    expect(rows).toEqual(RICH);
  });

  it('AC-3: the pipe carries the RENDERED body, row for row', async () => {
    const { screen, context } = opened(markdown, { ticketId: 'ticket-372' });
    expect(await pipeReport(screen.document ?? {}, context)).toEqual(MARKDOWN);
  });

  it('AC-3: no row of the piped render carries a raw Markdown marker', async () => {
    // The whole of the defect, stated as a property over the actual output rather
    // than over the fixture: `bakers ui <id> | cat` was full of `**`, backticks and
    // `- [ ]`, and there is no rendering path left that can produce one.
    const { screen, context } = opened(markdown, { ticketId: 'ticket-372' });
    for (const row of await pipeReport(screen.document ?? {}, context)) {
      expect(row, `${JSON.stringify(row)} carries no raw marker`).not.toMatch(
        /\*\*|`|- \[[ xX]\]|~~|^#{1,6} /,
      );
    }
  });

  it('AC-3: the pipe and the interactive tab render the SAME text', async () => {
    // D4 as a test: `lineText` returns the rendered text, `SectionRow.text`
    // carries it, and both surfaces read the same rows. So every body row the
    // Overview tab shows expanded appears verbatim in the pipe.
    const { screen, context } = opened(markdown, { ticketId: 'ticket-372' });
    const piped = await pipeReport(screen.document ?? {}, context);
    for (const row of ['☐ AC-1 open', '│ a struck quote', '  const x = 1;']) {
      expect(piped, `${row} reaches the pipe`).toContain(row);
    }
  });

  // BB-381 AC-3/AC-4 — Spec/Plan appear in the pipe ONLY when comments exist.
  it('BB-381: bare and summary-only fixtures name missing Planning documents', async () => {
    for (const [label, document, ticketId] of [
      ['bare', bare, 'ticket-2'],
      ['filled summaries', filled, 'ticket-5'],
      ['rich', rich, 'ticket-1'],
    ] as const) {
      const { screen, context } = opened(document, { ticketId });
      const rows = await pipeReport(screen.document ?? {}, context);
      expect(rows, label).toContain('No spec comment.');
      expect(rows, label).toContain('No plan comment.');
      expect(rows, label).toContain('No test comment.');
    }
  });

  it('BB-381 AC-4: a fixture with spec+plan comments prints them in D3 order', async () => {
    const { screen, context } = opened(typedSpecPlan, {
      ticketId: 'ticket-381',
    });
    expect(await pipeReport(screen.document ?? {}, context)).toEqual(
      TYPED_SPEC_PLAN,
    );
  });
});

/**
 * BB-381 AC-4 — Spec + Plan present. Hand-authored like FILLED: newest of each
 * type, marker rows, and D3 order between Latest summary and Description.
 */
const typedSpecPlan: TicketDetailDocument = {
  data: {
    type: 'bb_ticket--bb_ticket',
    id: 'ticket-381',
    attributes: {
      identifier: 'BB-381',
      title: 'latest spec and plan on the pipe',
      state: 'coding',
    },
    relationships: {},
  },
  included: [
    {
      type: 'bb_comment--bb_comment',
      id: 'summary-381',
      attributes: {
        drupal_internal__id: 50,
        bb_comment_type: 'summary',
        author_name: 'cw',
        created: '2026-08-18T09:00:00+00:00',
        body: { value: 'Phase handoff.' },
      },
    },
    {
      type: 'bb_comment--bb_comment',
      id: 'spec-old',
      attributes: {
        drupal_internal__id: 51,
        bb_comment_type: 'spec',
        author_name: 'cw',
        created: '2026-08-18T09:00:00+00:00',
        body: { value: 'OLDER SPEC' },
      },
    },
    {
      type: 'bb_comment--bb_comment',
      id: 'spec-new',
      attributes: {
        drupal_internal__id: 52,
        bb_comment_type: 'spec',
        author_name: 'cw',
        created: '2026-08-18T09:00:00+00:00',
        body: { value: 'NEWER SPEC body.' },
      },
    },
    {
      type: 'bb_comment--bb_comment',
      id: 'plan-new',
      attributes: {
        drupal_internal__id: 53,
        bb_comment_type: 'plan',
        author_name: 'cw',
        created: '2026-08-18T10:00:00+00:00',
        body: { value: 'NEWER PLAN body.' },
      },
    },
  ],
};

const TYPED_SPEC_PLAN = [
  'State',
  'coding',
  '',
  'Labels',
  'No labels.',
  '',
  'Source',
  'none',
  '',
  'Parent',
  'No parent ticket.',
  '',
  'Links',
  'No links.',
  '',
  'Latest summary',
  '— summary · cw · 2026-08-18T09:00:00+00:00',
  'Phase handoff.',
  '',
  'Latest spec',
  '— spec · cw · 2026-08-18T09:00:00+00:00',
  'NEWER SPEC body.',
  '',
  'Latest plan',
  '— plan · cw · 2026-08-18T10:00:00+00:00',
  'NEWER PLAN body.',
  '',
  'Description',
  'No description.',
  '',
  'Assignment',
  'Unassigned.',
  'Reviewers: —',
  'No conductor.',
  '',
  'Time',
  'No estimate and no accounted time.',
  '',
  'Branch',
  'branch: —',
  'base:   —',
  '',
  'Environments',
  'No environments.',
  '',
  'Latest spec',
  'NEWER SPEC body.',
  '',
  'Latest plan',
  'NEWER PLAN body.',
  '',
  'Latest test',
  'No test comment.',
  '',
  'Comments',
  '— plan ·',
  'NEWER PLAN body.',
  '— spec ·',
  'NEWER SPEC body.',
  '— spec ·',
  'OLDER SPEC',
  '— summary ·',
  'Phase handoff.',
  '',
  'Runs',
  'RUN TICKET STATE PHASE AGENT STARTED',
  'No runs for this ticket.',
  '',
];

// Scope composition belongs to the kernel. These assertions cover the addon
// screens' own serialization; the whole-ticket baselines above stay unchanged.
describe('contributed screens serialize their own pipe sections', () => {
  it('prints the artifact listing and collapsed summary, never the captured body', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'bakers-artifacts-pipe-'));
    try {
      mkdirSync(join(cwd, 'assets-ai', 'BB-340', 'vitest'), {
        recursive: true,
      });
      writeFileSync(
        join(cwd, 'assets-ai', 'BB-340', 'vitest', 'store-green.txt'),
        'pnpm vitest run\n\n12 passed\nsecret detail',
      );
      const screen = new ArtifactsTabScreen();
      const { context } = opened(rich);
      const ctx = {
        ...context,
        contexts: ContextBag.empty().set(addonTicketInput, { document: rich }),
        options: { ...context.options, cwd },
      };
      screen.enter(ctx);
      await Promise.resolve();
      const lines = screen.renderNonInteractive(ctx);
      expect(lines).toContain('vitest/store-green.txt');
      expect(lines).toContain('pnpm vitest run');
      expect(lines).toContain('… +3 more lines');
      expect(lines).not.toContain('12 passed');
      expect(lines).not.toContain('secret detail');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
