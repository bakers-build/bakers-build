import { expect, it, vi } from 'vitest';
import { createSessionStore } from '../../../../src/Data/session-store.js';
import {
  RunDetailScreen,
  runDetailInputContext,
} from '../../../../src/Entity/run/Screen/run-detail.js';
import { loadTicketView } from '../../../../src/Entity/ticket/Data/store.js';
import { ContextBag } from '../../../../src/Routing/context.js';
import type { ScreenContext } from '../../../../src/Screen/screen.js';
import type { TicketDetailDocument } from '../../../../src/types.js';

const ticketWithRun = (state: string): TicketDetailDocument => ({
  data: {
    id: 't1',
    type: 'bb_ticket--bb_ticket',
    attributes: { identifier: 'TEST-1', title: 'One' },
    relationships: { runs: { data: [{ id: 'r1' }] } },
  },
  included: [
    {
      id: 'r1',
      type: 'bb_run--bb_run',
      attributes: { drupal_internal__id: 7, state },
    },
  ],
});

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

it('shows the run state the server reports now after a reload', async () => {
  const responses = [ticketWithRun('running'), ticketWithRun('done')];
  const context = {
    params: { ticketId: 't1', runId: 'r1' },
    store: createSessionStore(),
    sessionGeneration: 1,
    requestDraw: vi.fn(),
    isActive: () => true,
    services: {
      client: {
        get: async () => {
          const next = responses.shift();
          if (!next) throw Error('unexpected request');
          return next;
        },
      },
    },
  } as unknown as ScreenContext;
  // The Runs tab loaded the ticket and opened the run with that snapshot.
  const snapshot = await loadTicketView(context, ['runs']);
  const opened = {
    ...context,
    contexts: ContextBag.empty().set(runDetailInputContext, {
      document: snapshot,
    }),
  };
  const screen = new RunDetailScreen();
  screen.enter(opened);
  await tick();
  expect(screen.renderNonInteractive(opened)).toContain(
    'state:         running',
  );

  screen.reload(opened);
  await tick();
  expect(screen.renderNonInteractive(opened)).toContain('state:         done');
});
