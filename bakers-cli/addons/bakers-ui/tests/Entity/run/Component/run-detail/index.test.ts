import { createTextAttributes, type VNode } from '@opentui/core';
import { expect, it } from 'vitest';
import {
  runDetailTitle,
  runDetailTree,
  runResource,
} from '../../../../../src/Entity/run/Component/run-detail/index.js';
import type { TicketDetailDocument } from '../../../../../src/types.js';
import { idsOf, nodeById, renderTree } from '../../../../render-tree.js';

// BB-255 D6 — the run detail screen renders the run resource the ticket
// document ALREADY carries (spec fact 5: the `runs` include ships the full
// attribute set), so there is no read, no client call and no new failure path.
// Each section has an explicit empty state, exactly like the ticket's sections.

const RUN_ID = '1a49fe21-c38e-42ef-acaa-70828ba864f1';

const doc: TicketDetailDocument = {
  data: {
    id: 't-255',
    type: 'bb_ticket--bb_ticket',
    attributes: { identifier: 'BB-255', title: 'runs as real entities' },
    relationships: { runs: { data: [{ id: RUN_ID }] } },
  },
  included: [
    {
      id: RUN_ID,
      type: 'bb_run--bb_run',
      attributes: {
        drupal_internal__id: 4599,
        state: 'running',
        state_at_start: 'coding',
        agent: 'claude',
        started_at: '2026-08-01T18:16:07+00:00',
        heartbeat: '2026-08-01T18:17:29+00:00',
        claim_expires_at: '2026-08-01T18:21:07+00:00',
        duration_s: 82,
        active_s: 70,
        tokens: 1234,
        tool_calls: 17,
        agent_turns: 5,
        user_prompts: 2,
        user_prompt_words: 640,
        worktree_path: '/home/cw/projects/bakers/.bakers-worktrees/feat/x',
        log_bytes: 42,
        error_log_bytes: null,
      },
      relationships: {
        ticket_id: { data: { id: 't-255' } },
        conductor_id: { data: { id: 'c-9' } },
      },
    },
    {
      id: 'c-9',
      type: 'bb_conductor--bb_conductor',
      attributes: { label: 'cw-framework' },
    },
  ],
};

// BB-340 D1/D3/D4 — the block is a renderable TREE now, and it is the only
// description of this screen: what used to be a `{ lines, boldRows }` surface
// beside it is gone, so the cases below read the text back out of the nodes.
// "This row is bold" is a prop on the row's own node rather than an index into
// a surface, and every row is reachable by the id that says what it IS.

const BOLD = createTextAttributes({ bold: true });

const attributesOf = (node: VNode | undefined): number | undefined =>
  (node?.props as { attributes?: number } | undefined)?.attributes;

const contentOf = (node: VNode | undefined): string | undefined =>
  (node?.props as { content?: string } | undefined)?.content;

/** The text of every row whose id matches, in tree order. */
const rowsMatching = (tree: VNode, pattern: RegExp): string[] =>
  idsOf(tree)
    .filter((id) => pattern.test(id))
    .map((id) => contentOf(nodeById(tree, id)) ?? '');

const text = (id: string | null, from: TicketDetailDocument = doc): string =>
  renderTree(runDetailTree(from, id)).join('\n');

it('D6: runResource selects the sideloaded run by id, and only a run', () => {
  expect(runResource(doc, RUN_ID)?.id).toBe(RUN_ID);
  expect(runResource(doc, 'c-9'), 'a conductor is not a run').toBeUndefined();
  expect(runResource(doc, null)).toBeUndefined();
});

it('D6: every section is rendered, each with the run’s own fields', () => {
  const tree = runDetailTree(doc, RUN_ID);
  expect(rowsMatching(tree, /^run-detail-section-/)).toEqual([
    'Run',
    'State',
    'Timing',
    'Footprint',
    'Worktree',
    'Log',
    'Error log',
  ]);
  const rendered = text(RUN_ID);
  expect(rendered, 'the internal id and the uuid').toContain('#4599');
  expect(rendered).toContain(RUN_ID);
  expect(rendered, 'the owning ticket').toContain('BB-255');
  expect(rendered).toContain('running');
  expect(rendered, 'the phase the run was dispatched for').toContain('coding');
  expect(rendered).toContain('claude');
  expect(rendered, 'the conductor from the include').toContain('cw-framework');
  expect(rendered).toContain('2026-08-01T18:16:07+00:00');
  expect(rendered).toContain('2026-08-01T18:21:07+00:00');
  expect(rendered, 'the active time beside the duration').toMatch(
    /duration: +82\nactive: +70/,
  );
  expect(rendered, 'the footprint').toContain('1234');
  expect(rendered).toContain('17');
  expect(rendered).toContain('/home/cw/projects/bakers/.bakers-worktrees/feat/x');
});

// BB-556 — the transcript/error payload lives in a private file now; the
// entity only carries the byte count, so the section states size, not text.
it('a captured log states its byte count and a retrieval hint', () => {
  const rendered = text(RUN_ID);
  expect(rendered).toContain(
    'Captured (42 bytes). Retrieve via the run log download route.',
  );
});

it('a known base URL prints the resolved download route, not a bare sentence', () => {
  const rendered = renderTree(
    runDetailTree(doc, RUN_ID, 'https://bakers.example.com'),
  ).join('\n');
  expect(rendered).toContain(
    `Captured (42 bytes). https://bakers.example.com/_bakers-api/run/${RUN_ID}/log/log`,
  );
});

it('a captured, zero-byte log is distinct from an uncaptured one', () => {
  const zero: TicketDetailDocument = {
    data: doc.data,
    included: [
      {
        id: RUN_ID,
        type: 'bb_run--bb_run',
        attributes: { drupal_internal__id: 1, state: 'claimed', log_bytes: 0 },
      },
    ],
  };
  expect(
    contentOf(nodeById(runDetailTree(zero, RUN_ID), 'run-detail-log-empty')),
  ).toBe('Captured (0 bytes). Retrieve via the run log download route.');
});

it('D6 / R5: an unset log and an unset error log get explicit empty states', () => {
  expect(
    contentOf(
      nodeById(runDetailTree(doc, RUN_ID), 'run-detail-error-log-empty'),
    ),
    'never captured is stated, never a blank row',
  ).toBe('No errors logged.');
  const bare: TicketDetailDocument = {
    data: doc.data,
    included: [
      {
        id: RUN_ID,
        type: 'bb_run--bb_run',
        attributes: { drupal_internal__id: 1, state: 'claimed' },
      },
    ],
  };
  const rendered = text(RUN_ID, bare);
  expect(rendered).toContain('Transcript not captured.');
  expect(rendered).toContain('No worktree path.');
  const ids = idsOf(runDetailTree(bare, RUN_ID));
  const tree = runDetailTree(bare, RUN_ID);
  for (const [index, id] of ids.entries()) {
    if (id.startsWith('run-detail-section-')) {
      // A section's heading is followed by a row of its OWN, never straight by
      // the next heading or by its trailing gap: no section renders empty.
      expect(ids[index + 1], `${id} has rows`).not.toMatch(
        /^run-detail-(section-|gap-)/,
      );
      continue;
    }
    // The gap between two sections is the one deliberately empty row; every
    // other row states something.
    if (id.startsWith('run-detail-gap-') || id === 'run-detail') continue;
    expect(
      contentOf(nodeById(tree, id))?.trim(),
      `${id} is never blank`,
    ).not.toBe('');
  }
});

it('D6: an unresolvable run says so instead of rendering an empty screen', () => {
  const missing = runDetailTree(doc, 'nope');
  expect(renderTree(missing)).toEqual(['Run', 'No run selected.', '']);
  expect(attributesOf(nodeById(missing, 'run-detail-section-run'))).toBe(BOLD);
  expect(runDetailTitle(doc, 'nope')).toMatch(/run/i);
});

it('D6: the title carries the run id, the ticket identifier and the state', () => {
  const title = runDetailTitle(doc, RUN_ID);
  expect(title).toContain('#4599');
  expect(title).toContain('BB-255');
  expect(title).toContain('running');
});

it('D6: runDetailTree carries the rows in the order the screen draws them', () => {
  const rows = renderTree(runDetailTree(doc, RUN_ID));
  expect(rows[0]).toBe('Run');
  expect(rows.join('\n')).toContain('#4599');
  expect(rows.join('\n')).toContain('cw-framework');
  expect(rows.join('\n')).toContain('Captured (42 bytes)');
});

// The value row states `attributes: 0` rather than omitting the prop, and that
// is the point rather than an implementation detail: `patchTree` writes only
// what the next tree DECLARES, so a row that has stopped being bold — a log line
// that is no longer an ATX heading, at a key that survives the reload — could
// never lose the weight a previous frame gave it (`lib/vnode.ts`).
it('D3: a section heading carries bold on its own node; a value row does not', () => {
  const tree = runDetailTree(doc, RUN_ID);
  expect(contentOf(nodeById(tree, 'run-detail-section-state'))).toBe('State');
  expect(attributesOf(nodeById(tree, 'run-detail-section-state'))).toBe(BOLD);
  expect(attributesOf(nodeById(tree, 'run-detail-field-state'))).toBe(0);
});

it('R4: every id names what the row IS, and no id is used twice', () => {
  const tree = runDetailTree(doc, RUN_ID);
  expect(contentOf(nodeById(tree, 'run-detail-field-state'))).toContain(
    'running',
  );
  expect(contentOf(nodeById(tree, 'run-detail-field-conductor'))).toContain(
    'cw-framework',
  );
  expect(contentOf(nodeById(tree, 'run-detail-log-empty'))).toContain(
    'Captured (42 bytes)',
  );
  const ids = idsOf(tree);
  expect(new Set(ids).size, ids.join(' ')).toBe(ids.length);
});
