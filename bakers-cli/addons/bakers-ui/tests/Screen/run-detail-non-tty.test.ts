// BB-340 spec F5 — the run detail's OWN non-TTY output, pinned line for line.
//
// WHY THIS SCREEN GREW ONE. Task 10 rendered the non-TTY path from the tree, and
// on A4's gate subject (`run:69407ed7-…`, run #4928) that produced the right 447
// rows with a byte-identical head and tail — and CLIPPED the 420 transcript rows
// at 80 columns: 1 378 206 bytes of captured agent transcript became 31 072,
// 97.7 % of the content lost. `captureCharFrame` is a cell grid of a fixed width
// and a pipe has no width (`stdout.columns` is undefined, so the kernel falls
// back to 80). Every other fallback surface survives that grid because it was
// composed to a terminal width in the first place; a log line was not.
//
// The operator's ruling dissolves the trade-off rather than tuning it: "the run
// should be handled exactly like all other entities." `TicketDetailScreen`,
// `DashboardScreen` and `ProjectPickerScreen` each carry their own
// `renderNonInteractive()` — a deliberately different, plain-text output for a
// pipe (F5). `RunDetailScreen` was the only entity detail without one, which is
// the only reason it reached the grid at all.
//
// The rows below are CAPTURED FROM THE BASELINE taken before any screen
// converted (subject 5's structured head), not filled in from a run afterwards — a snapshot taken after the change
// would agree with whatever the change produced. The blank row after each
// section is part of the return here exactly as it was part of
// `runDetailLines().lines`: the kernel's non-interactive branch drops empties
// with `.filter(Boolean)`, which is why the recorded capture shows no gaps.

import { isVNode } from '@opentui/core';
import { describe, expect, it, vi } from 'vitest';
import { runDetailTree } from '../../src/Entity/run/Component/run-detail/index.js';
import {
  RunDetailScreen,
  runDetailInputContext,
} from '../../src/Entity/run/Screen/run-detail.js';
import { ContextBag } from '../../src/Routing/context.js';
import type { ScreenContext } from '../../src/Screen/screen.js';
import type { TicketDetailDocument } from '../../src/types.js';
import { renderTree } from '../render-tree.js';

const RUN_ID = '69407ed7-07c2-4dc3-92fa-c1e1a1e77c0f';

/**
 * One transcript line far wider than the 80-column grid that clipped it — the
 * defect this screen's own output exists to remove, stated as a length rather
 * than as a look.
 */
const WIDE_LOG_LINE = `{"type":"assistant","message":{"content":"${'x'.repeat(400)}"}}`;

/** The A4 gate subject's own shape: run #4928 of BB-340, done. */
const doc: TicketDetailDocument = {
  data: {
    id: 'ticket-340',
    type: 'bb_ticket--bb_ticket',
    attributes: { identifier: 'BB-340', title: 'Move the bakers-ui' },
    relationships: { runs: { data: [{ id: RUN_ID }] } },
  },
  included: [
    {
      id: RUN_ID,
      type: 'bb_run--bb_run',
      attributes: {
        drupal_internal__id: 4928,
        state: 'done',
        state_at_start: 'spec',
        agent: 'claude',
        started_at: '2026-08-11T10:25:36+00:00',
        heartbeat: '2026-08-11T10:27:38+00:00',
        claim_expires_at: '2026-08-11T10:30:36+00:00',
        duration_s: 6077,
        active_s: 5400,
        tokens: 32796983,
        tool_calls: 92,
        agent_turns: 169,
        user_prompts: 6,
        user_prompt_words: 79,
        worktree_path:
          '/home/cw/projects/bakers/.bakers-worktrees/feat/bb-340-move-the-bakers-ui',
        log_bytes: WIDE_LOG_LINE.length + 1 + 'second transcript line'.length,
        error_log_bytes: null,
      },
      relationships: { conductor_id: { data: { id: 'c-9' } } },
    },
    {
      id: 'c-9',
      type: 'bb_conductor--bb_conductor',
      attributes: { label: 'cw-framework' },
    },
  ],
};

/** CAPTURED FROM THE PRE-CONVERSION BASELINE — subject 5's structured rows. */
const ROWS = [
  'Run',
  '#4928 · 69407ed7-07c2-4dc3-92fa-c1e1a1e77c0f',
  'ticket:        BB-340',
  '',
  'State',
  'state:         done',
  'phase:         spec',
  'agent:         claude',
  'conductor:     cw-framework',
  '',
  'Timing',
  'started:       2026-08-11T10:25:36+00:00',
  'heartbeat:     2026-08-11T10:27:38+00:00',
  'claim expires: 2026-08-11T10:30:36+00:00',
  'duration:      6077',
  'active:        5400',
  '',
  'Footprint',
  'tokens:        32796983',
  'tool calls:    92',
  'agent turns:   169',
  'user prompts:  6',
  'prompt words:  79',
  '',
  'Worktree',
  '/home/cw/projects/bakers/.bakers-worktrees/feat/bb-340-move-the-bakers-ui',
  '',
  'Log',
  `Captured (${WIDE_LOG_LINE.length + 1 + 'second transcript line'.length} bytes). Retrieve via the run log download route.`,
  '',
  'Error log',
  'No errors logged.',
  '',
];

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

const opened = async (
  document: TicketDetailDocument | undefined,
  runId: string,
): Promise<{ screen: RunDetailScreen; context: ScreenContext }> => {
  const screen = new RunDetailScreen();
  const context: ScreenContext = {
    sessionGeneration: 1,
    requestDraw: vi.fn(),
    isActive: () => true,
    params: { ticketId: 'ticket-340', runId },
    contexts: document
      ? ContextBag.empty().set(runDetailInputContext, { document })
      : ContextBag.empty(),
  };
  screen.enter(context);
  await tick();
  return { screen, context };
};

describe('F5 — the run detail prints its own text into a pipe', () => {
  it('reproduces the pre-conversion rows of the A4 gate subject', async () => {
    const { screen, context } = await opened(doc, RUN_ID);
    expect(screen.renderNonInteractive(context)).toEqual(ROWS);
  });

  it('and the title the kernel prints above them', async () => {
    const { screen, context } = await opened(doc, RUN_ID);
    expect(screen.present(context).title).toBe('#4928 · BB-340 · done');
  });

  it('the log section states the byte count, not the transcript text', async () => {
    // The clipping defect this file used to guard is moot: the transcript no
    // longer reaches the pipe at all (it lives in a private file), so there is
    // no wide line left to clip.
    const { screen, context } = await opened(doc, RUN_ID);
    const rows = screen.renderNonInteractive(context);
    expect(rows.join('\n')).not.toContain(WIDE_LOG_LINE);
    expect(rows.join('\n')).toContain('Captured (');
  });

  it('an unresolvable run says so rather than piping nothing', async () => {
    const { screen, context } = await opened(doc, 'nope');
    expect(screen.renderNonInteractive(context)).toEqual([
      'Run',
      'No run selected.',
      '',
    ]);
  });

  it('the pipe`s text and the tree are ONE source, row for row', async () => {
    // The anti-drift guard, and the reason the rows are not a second
    // description of this screen: both are projections of the same keyed
    // sections, so a section added to one appears in the other or this fails.
    for (const runId of [RUN_ID, 'nope']) {
      const { screen, context } = await opened(doc, runId);
      expect(screen.renderNonInteractive(context)).toEqual(
        renderTree(runDetailTree(doc, runId)),
      );
    }
  });

  it('R3 — `present()` still hands over a tree and no `lines` surface', async () => {
    const { screen, context } = await opened(doc, RUN_ID);
    const shown = screen.present(context);
    expect(
      shown.lines,
      'F5 is not a way back to ScreenPresentation.lines',
    ).toBeUndefined();
    expect(isVNode(shown.body)).toBe(true);
  });
});
