import { describe, expect, it, vi } from 'vitest';
import { TicketsScreen } from '../../src/Entity/ticket/Screen/tickets.js';
import type { ScreenContext } from '../../src/Screen/screen.js';
import type { ClipboardOutcome } from '../../src/types.js';
import { renderTree } from '../render-tree.js';

// BAKERS-338 — the ticket LIST copies nothing: a list only opens a row's
// detail, and `y`/`Y` copy there (`ticket-detail-copy.test.ts`). The one place
// a `y` still means something on the list is the `/` search field, where it
// is a letter.

const PROJECT = { id: 'project-1', name: 'Bb', slug: 'bakers' };
const BASE = 'https://bakers.example.test';
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

const TICKETS = {
  data: [
    {
      type: 'bb_ticket--bb_ticket',
      id: 'uuid-of-300',
      attributes: {
        identifier: 'BB-300',
        title: 'first',
        state: 'coding',
        url: `${BASE}/bakers/ticket/bb-300`,
      },
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

describe('the ticket list copies nothing', () => {
  it('y and Y on a row copy nothing and are not advertised', async () => {
    const { screen, context, copyToClipboard } = await ready();
    screen.handleInput('y', context);
    screen.handleInput('Y', context);
    expect(copyToClipboard).not.toHaveBeenCalled();
    const keys = (screen.present(context).actions ?? []).map((a) => a.key);
    expect(keys).not.toContain('y');
    expect(keys).not.toContain('Y');
    expect(keys).not.toContain('e');
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
});
