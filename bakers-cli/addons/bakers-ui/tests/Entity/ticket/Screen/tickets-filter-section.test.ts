import { describe, expect, it, vi } from 'vitest';
import { formatActionLadder } from '../../../../src/Component/footer-actions/index.js';
import { TicketsScreen } from '../../../../src/Entity/ticket/Screen/tickets.js';
import {
  DEFAULT_BACKGROUND,
  FOREGROUND,
  FOREGROUND_ACTIVE,
} from '../../../../src/lib/theme.js';
import type { ScreenContext } from '../../../../src/Screen/screen.js';
import { nodeById, renderTree } from '../../../render-tree.js';

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function harness() {
  const context = {
    sessionGeneration: 1,
    project: { id: 'project-1', name: 'Bb', slug: 'bakers' },
    params: { projectId: 'project-1' },
    services: {
      client: {
        get: vi.fn().mockResolvedValue({ data: [], included: [], links: {} }),
      },
    },
    requestDraw: vi.fn(),
    isActive: () => true,
  } as unknown as ScreenContext;
  return context;
}

describe('Tickets filter section (BB-375 A′)', () => {
  it('keeps filters out of meta; count/page in header meta; arrows in actions', async () => {
    const context = harness();
    const screen = new TicketsScreen();
    screen.enter(context);
    await tick();
    const shown = screen.present(context);
    expect(shown.meta ?? '').toMatch(/ticket\(s\)/);
    expect(shown.meta ?? '').toMatch(/page /);
    expect(shown.meta ?? '').not.toContain('/ search');
    expect(formatActionLadder(shown.actions)).toContain('e edit');
    expect(shown.meta ?? '').not.toContain('closed:');

    const filter = nodeById(shown.body, 'tickets-filter');
    expect(filter).toBeDefined();
    expect(
      (filter?.props as { border?: unknown } | undefined)?.border,
    ).toBeFalsy();
    expect(
      (filter?.props as { backgroundColor?: unknown } | undefined)
        ?.backgroundColor,
    ).toBe(DEFAULT_BACKGROUND);
    const closedChip = nodeById(shown.body, 'tickets-filter-closed-chip');
    expect((closedChip?.props as { border?: unknown })?.border).toBe(true);
    expect((closedChip?.props as { borderStyle?: unknown })?.borderStyle).toBe(
      'rounded',
    );
    // Pill shell stays DEFAULT; FOREGROUND_ACTIVE fg is on the label only.
    expect(
      (closedChip?.props as { backgroundColor?: unknown })?.backgroundColor,
    ).toBe(DEFAULT_BACKGROUND);
    // Frame lives on region-body ScrollBox — present tree has no tickets-frame.
    expect(nodeById(shown.body, 'tickets-frame')).toBeUndefined();
    // No separate paging block — count/page are header meta.
    expect(nodeById(shown.body, 'tickets-paging')).toBeUndefined();

    const body = renderTree(shown.body).join('\n');
    for (const idle of [
      '/ search',
      's state',
      'w who',
      'm mine',
      'p parent',
      'c clear',
    ]) {
      expect(body, `idle badge ${idle}`).toContain(idle);
    }
    // Shipped default hides closed — that badge is active, with the shortcut.
    expect(body).toContain('closed: hidden');
    expect(
      renderTree(nodeById(shown.body, 'tickets-filter-closed-chip')!).join(''),
    ).toBe('x closed: hidden');
    const closedBadge = nodeById(shown.body, 'tickets-filter-closed');
    expect((closedBadge?.props as { fg?: unknown })?.fg).toBe(
      FOREGROUND_ACTIVE,
    );
    const searchBadge = nodeById(shown.body, 'tickets-filter-search');
    expect((searchBadge?.props as { bg?: unknown })?.bg).toBe(
      DEFAULT_BACKGROUND,
    );
    expect((searchBadge?.props as { fg?: unknown })?.fg).toBe(FOREGROUND);
    expect(shown.status ?? '').not.toMatch(/page/);
    expect(body).not.toMatch(/page /);
    // Arrows are footer actions, not the body.
    expect(body).not.toMatch(/→ next|← prev/);
  });

  it('still shows every badge when no criteria are active', async () => {
    const context = harness();
    const screen = new TicketsScreen();
    screen.enter(context);
    await tick();
    screen.previewCriteria({
      query: '',
      state: null,
      closed: null,
      parent: null,
      who: null,
    });
    const shown = screen.present(context);
    const body = renderTree(shown.body).join('\n');
    for (const label of [
      '/ search',
      's state',
      'w who',
      'm mine',
      'p parent',
      'x closed',
      'c clear',
    ]) {
      expect(body, `always-present badge ${label}`).toContain(label);
    }
    expect(body).not.toContain('closed:');
    expect(shown.meta).not.toContain('closed:');
    expect(
      renderTree(nodeById(shown.body, 'tickets-filter-closed-chip')!).join(''),
    ).toBe('x closed');
  });

  it('keeps each filter shortcut on the chip through active values and clear', async () => {
    const context = harness();
    const screen = new TicketsScreen();
    screen.enter(context);
    await tick();
    const chip = (suffix: string) =>
      renderTree(
        nodeById(
          screen.present(context).body,
          `tickets-filter-${suffix}-chip`,
        )!,
      ).join('');

    expect(chip('closed')).toBe('x closed: hidden');
    expect(chip('search')).toBe('/ search');
    expect(chip('state')).toBe('s state');
    expect(chip('who')).toBe('w who');
    expect(chip('owner')).toBe('o owner');
    expect(chip('parent')).toBe('p parent');
    expect(chip('mine')).toBe('m mine');
    expect(chip('clear')).toBe('c clear');

    screen.handleInput('x', context);
    await tick();
    expect(chip('closed')).toBe('x closed: only');
    screen.handleInput('x', context);
    await tick();
    expect(chip('closed')).toBe('x closed');

    screen.previewCriteria({
      query: 'foo',
      state: 'working',
      closed: false,
      parent: { id: 'p1', identifier: 'SHOP-42' },
      who: { id: 'u1', label: 'cw' },
      owner: { id: 'u2', label: 'pm' },
      project: null,
    });
    expect(chip('search')).toBe('/ search: foo');
    expect(chip('state')).toBe('s state: working');
    expect(chip('who')).toBe('w who: cw');
    expect(chip('owner')).toBe('o owner: pm');
    expect(chip('parent')).toBe('p parent: SHOP-42');
    expect(chip('closed')).toBe('x closed: hidden');
    expect(chip('mine')).toBe('m mine');

    screen.handleInput('c', context);
    await tick();
    expect(chip('closed')).toBe('x closed: hidden');
    expect(chip('search')).toBe('/ search');
    expect(chip('state')).toBe('s state');
    expect(chip('who')).toBe('w who');
    expect(chip('owner')).toBe('o owner');
    expect(chip('parent')).toBe('p parent');
    expect(chip('mine')).toBe('m mine');
    expect(chip('clear')).toBe('c clear');
  });
});
