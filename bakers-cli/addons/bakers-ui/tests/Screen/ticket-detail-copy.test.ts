import { describe, expect, it, vi } from 'vitest';
import { formatActionLadder } from '../../src/Component/footer-actions/index.js';
import {
  TicketDetailScreen,
  ticketDetailInputContext,
} from '../../src/Entity/ticket/Screen/ticket-detail.js';
import { ContextBag } from '../../src/Routing/context.js';
import type { ScreenContext } from '../../src/Screen/screen.js';
import type {
  ClipboardOutcome,
  TicketDetailDocument,
} from '../../src/types.js';

// BB-326 — copying, from the ticket DETAIL. Same ladder as the list (`y` the
// identifier, `Y` the link), acting on the ticket that is OPEN rather than on a
// row cursor.

const BASE = 'https://bakers.example.test';

const document: TicketDetailDocument = {
  data: {
    type: 'bb_ticket--bb_ticket',
    id: 'uuid-of-1',
    attributes: { identifier: 'BB-1', title: 'a ticket' },
  },
  included: [],
};

function harness(
  options: { outcome?: ClipboardOutcome; baseUrl?: string | undefined } = {},
) {
  const copied: string[] = [];
  const copyToClipboard = vi.fn((text: string): ClipboardOutcome => {
    copied.push(text);
    return options.outcome ?? 'copied';
  });
  const context: ScreenContext = {
    sessionGeneration: 1,
    requestDraw: vi.fn(),
    isActive: () => true,
    params: { ticketId: 'uuid-of-1' },
    contexts: ContextBag.empty().set(ticketDetailInputContext, { document }),
    navigate: vi.fn(),
    nowSeconds: () => 0,
    services: {
      client: { get: vi.fn(), collection: vi.fn() },
      ...('baseUrl' in options
        ? { baseUrl: options.baseUrl }
        : { baseUrl: BASE }),
    },
    copyToClipboard,
  } as unknown as ScreenContext;
  const screen = new TicketDetailScreen();
  screen.enter(context);
  return { screen, context, copied, copyToClipboard };
}

describe('the ticket detail copies to the operator’s clipboard', () => {
  it('y copies the open ticket’s identifier', () => {
    const { screen, context, copied } = harness();
    expect(screen.handleInput('y', context)).toBe(true);
    expect(copied).toEqual(['BB-1']);
    expect(screen.present(context).status).toContain('copied BB-1');
  });

  it('Y copies the open ticket’s page on the control plane', () => {
    const { screen, context, copied } = harness();
    expect(screen.handleInput('Y', context)).toBe(true);
    expect(copied).toEqual([`${BASE}/admin/bakers/ticket/uuid-of-1`]);
    expect(screen.present(context).status).toContain('copied the link to BB-1');
  });

  it('keeps the standing key hints beside the copy notice', () => {
    const { screen, context } = harness();
    screen.handleInput('y', context);
    // Notice is a short status prefix; screen ladder lives in footer actions.
    expect(screen.present(context).status).toContain('copied BB-1');
    expect(formatActionLadder(screen.present(context).actions)).toContain(
      'Tab section',
    );
  });

  it('never claims a copy the terminal refused', () => {
    const { screen, context } = harness({ outcome: 'unsupported' });
    screen.handleInput('y', context);
    expect(screen.present(context).status).toContain('not copied');
  });

  it('copies nothing on the keys that are not copies', () => {
    const { screen, context, copyToClipboard } = harness();
    for (const key of ['tab', 'shift+tab', 'enter', ' ', 'j', 'k', 'g', 'G'])
      screen.handleInput(key, context);
    expect(copyToClipboard).not.toHaveBeenCalled();
  });
});
