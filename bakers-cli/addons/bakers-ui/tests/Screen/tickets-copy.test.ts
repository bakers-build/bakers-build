import { describe, expect, it, vi } from 'vitest';
import { TicketsScreen } from '../../src/Entity/ticket/Screen/tickets.js';
import type { ScreenContext } from '../../src/Screen/screen.js';
import type { ClipboardOutcome } from '../../src/types.js';
import { renderTree } from '../render-tree.js';

// BB-326 — copying, from the ticket LIST.
//
// The operator drives the cockpit from a phone over mosh, where the terminal's
// own drag-selection is gone (`@opentui/core@0.5.1` sets `?1002h` from its Zig
// core — see `tests/pty/verify-mouse-modes.mjs`). So the cockpit copies for
// them: `y` the identifier, `Y` the link.
//
// `y`/`Y` were chosen because they are the conventional yank keys AND because
// neither is bound anywhere in `src/` — checked, not assumed. The one place a
// `y` already means something is a TEXT FIELD, and the last case here is what
// keeps that true: with the `/` search box open, `y` is a letter.

const PROJECT = { id: 'project-1', name: 'Bb', slug: 'bakers' };
const BASE = 'https://bakers.example.test';
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

const TICKETS = {
  data: [
    {
      type: 'bb_ticket--bb_ticket',
      id: 'uuid-of-300',
      attributes: { identifier: 'BB-300', title: 'first', state: 'coding' },
    },
    {
      type: 'bb_ticket--bb_ticket',
      id: 'uuid-of-301',
      attributes: { identifier: 'BB-301', title: 'second', state: 'coding' },
    },
  ],
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
    project: PROJECT,
    params: { projectId: PROJECT.id },
    services: {
      client: { get: async () => TICKETS, collection: vi.fn() },
      ...('baseUrl' in options
        ? { baseUrl: options.baseUrl }
        : { baseUrl: BASE }),
    },
    requestDraw: vi.fn(),
    isActive: () => true,
    navigate: vi.fn(),
    copyToClipboard,
  } as unknown as ScreenContext;
  const screen = new TicketsScreen();
  return { screen, context, copied, copyToClipboard };
}

async function ready() {
  const h = harness();
  h.screen.enter(h.context);
  await tick();
  await tick();
  return h;
}

describe('the ticket list copies to the operator’s clipboard', () => {
  it('y copies the identifier of the row the cursor is on', async () => {
    const { screen, context, copied } = await ready();
    expect(screen.handleInput('y', context)).toBe(true);
    expect(copied).toEqual(['BB-300']);
    expect(screen.present(context).status).toContain('copied BB-300');
  });

  it('y follows the cursor rather than the page', async () => {
    const { screen, context, copied } = await ready();
    screen.handleInput('j', context);
    screen.handleInput('y', context);
    expect(copied).toEqual(['BB-301']);
  });

  it('Y copies that ticket’s page on the control plane', async () => {
    const { screen, context, copied } = await ready();
    expect(screen.handleInput('Y', context)).toBe(true);
    expect(copied).toEqual([`${BASE}/admin/bakers/ticket/uuid-of-300`]);
    expect(screen.present(context).status).toContain(
      'copied the link to BB-300',
    );
  });

  it('says so, and copies nothing, when the session has no base URL', async () => {
    const h = harness({ baseUrl: undefined });
    h.screen.enter(h.context);
    await tick();
    await tick();
    expect(h.screen.handleInput('Y', h.context)).toBe(true);
    expect(h.copyToClipboard).not.toHaveBeenCalled();
    expect(h.screen.present(h.context).status).toContain('no link');
  });

  it('never claims a copy the terminal refused', async () => {
    const h = harness({ outcome: 'unsupported' });
    h.screen.enter(h.context);
    await tick();
    await tick();
    h.screen.handleInput('y', h.context);
    const status = h.screen.present(h.context).status ?? '';
    expect(status).toContain('not copied');
    expect(status).not.toMatch(/(^|[^t] )copied bakers.build/);
  });

  it('does not copy while the search field is open — y is a LETTER there', async () => {
    const { screen, context, copyToClipboard } = await ready();
    screen.handleInput('/', context);
    expect(screen.handleInput('y', context)).toBe(true);
    expect(copyToClipboard).not.toHaveBeenCalled();
    expect(renderTree(screen.present(context).body).join('\n')).toContain(
      'search: y',
    );
    expect(screen.present(context).meta).not.toContain('search:');
  });

  it('copies nothing at all on a keystroke that is not a copy', async () => {
    const { screen, context, copyToClipboard } = await ready();
    for (const key of ['j', 'k', 'enter', 'g', 'G', 'x', 's', 'R'])
      screen.handleInput(key, context);
    expect(copyToClipboard).not.toHaveBeenCalled();
  });
});
