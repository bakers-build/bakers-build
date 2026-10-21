import { describe, expect, it, vi } from 'vitest';
import { TicketFilterBar } from '../../../../src/Entity/ticket/Screen/ticket-filter-bar.js';
import type { TicketCriteria } from '../../../src/Entity/ticket/Data/query.js';
import type { TicketRow } from '../../../src/Entity/ticket/Data/tickets.js';
import type { ScreenContext } from '../../../src/Screen/screen.js';

const DEFAULT_CRITERIA: TicketCriteria = {
  query: '',
  state: null,
  closed: false,
  parent: null,
  who: null,
  owner: null,
  project: null,
};

const row = (overrides: Partial<TicketRow> = {}): TicketRow => ({
  id: 't1',
  identifier: 'BB-1',
  title: 'Test ticket',
  state: 'triage',
  priority: null,
  assigneeInitials: 'CW',
  derivedStatus: 'idle',
  labels: [],
  type: null,
  parent: null,
  conductor: null,
  assigneeId: 'u1',
  closed: false,
  frozen: false,
  stallReason: '',
  ...overrides,
});

const fakeContext = (): ScreenContext =>
  ({
    services: {},
    navigate: vi.fn(),
    requestDraw: vi.fn(),
  }) as unknown as ScreenContext;

describe('TicketFilterBar', () => {
  describe('badges()', () => {
    it('shows eight chips on a default host', () => {
      const host = {
        criteria: { ...DEFAULT_CRITERIA },
        setCriteria: vi.fn(),
        resolveMine: () => undefined,
      };
      const bar = new TicketFilterBar(host);
      const badges = bar.badges();
      expect(badges).toHaveLength(8);
      expect(badges.map((b) => b.id)).toEqual([
        'search',
        'state',
        'who',
        'mine',
        'parent',
        'project',
        'closed',
        'clear',
      ]);
    });

    it('omits chips for disabled filter keys', () => {
      const host = {
        criteria: { ...DEFAULT_CRITERIA },
        setCriteria: vi.fn(),
        resolveMine: () => undefined,
      };
      const bar = new TicketFilterBar(host, new Set(['who', 'mine']));
      const badges = bar.badges();
      expect(badges.map((b) => b.id)).toEqual([
        'search',
        'state',
        'parent',
        'project',
        'closed',
        'clear',
      ]);
    });

    it('shows search badge with query value when query is set', () => {
      const host = {
        criteria: { ...DEFAULT_CRITERIA, query: 'test' },
        setCriteria: vi.fn(),
        resolveMine: () => undefined,
      };
      const bar = new TicketFilterBar(host);
      const badges = bar.badges();
      const searchBadge = badges.find((b) => b.id === 'search');
      expect(searchBadge?.value).toBe('search: test');
    });

    it('shows state badge when state is set', () => {
      const host = {
        criteria: { ...DEFAULT_CRITERIA, state: 'coding' },
        setCriteria: vi.fn(),
        resolveMine: () => undefined,
      };
      const bar = new TicketFilterBar(host);
      const badges = bar.badges();
      const stateBadge = badges.find((b) => b.id === 'state');
      expect(stateBadge?.value).toBe('state: coding');
    });

    it('shows closed badge as "closed: hidden" when closed is false', () => {
      const host = {
        criteria: { ...DEFAULT_CRITERIA, closed: false },
        setCriteria: vi.fn(),
        resolveMine: () => undefined,
      };
      const bar = new TicketFilterBar(host);
      const badges = bar.badges();
      const closedBadge = badges.find((b) => b.id === 'closed');
      expect(closedBadge?.value).toBe('closed: hidden');
    });

    it('shows closed badge as "closed: only" when closed is true', () => {
      const host = {
        criteria: { ...DEFAULT_CRITERIA, closed: true },
        setCriteria: vi.fn(),
        resolveMine: () => undefined,
      };
      const bar = new TicketFilterBar(host);
      const badges = bar.badges();
      const closedBadge = badges.find((b) => b.id === 'closed');
      expect(closedBadge?.value).toBe('closed: only');
    });

    it('shows no closed badge value when closed is null (all)', () => {
      const host = {
        criteria: { ...DEFAULT_CRITERIA, closed: null },
        setCriteria: vi.fn(),
        resolveMine: () => undefined,
      };
      const bar = new TicketFilterBar(host);
      const badges = bar.badges();
      const closedBadge = badges.find((b) => b.id === 'closed');
      expect(closedBadge?.value).toBeUndefined();
    });

    it('shows mine badge when mine is resolved and active', () => {
      const host = {
        criteria: { ...DEFAULT_CRITERIA, who: { id: 'u1', label: 'cw' } },
        setCriteria: vi.fn(),
        resolveMine: () => ({ id: 'u1', label: 'cw' }),
      };
      const bar = new TicketFilterBar(host);
      const badges = bar.badges();
      const mineBadge = badges.find((b) => b.id === 'mine');
      expect(mineBadge?.value).toBe('mine');
    });
  });

  describe('handleKey()', () => {
    it('returns false for unhandled keys', () => {
      const host = {
        criteria: { ...DEFAULT_CRITERIA },
        setCriteria: vi.fn(),
        resolveMine: () => undefined,
      };
      const bar = new TicketFilterBar(host);
      expect(bar.handleKey('z', fakeContext())).toBe(false);
      expect(bar.handleKey('enter', fakeContext())).toBe(false);
    });

    it('returns false for disabled keys', () => {
      const host = {
        criteria: { ...DEFAULT_CRITERIA },
        setCriteria: vi.fn(),
        resolveMine: () => undefined,
      };
      const bar = new TicketFilterBar(host, new Set(['who', 'mine']));
      expect(bar.handleKey('w', fakeContext())).toBe(false);
      expect(bar.handleKey('m', fakeContext())).toBe(false);
      expect(host.setCriteria).not.toHaveBeenCalled();
    });

    it('c key resets to default criteria', () => {
      const host = {
        criteria: { ...DEFAULT_CRITERIA, state: 'coding', query: 'test' },
        setCriteria: vi.fn(),
        resolveMine: () => undefined,
      };
      const bar = new TicketFilterBar(host);
      bar.handleKey('c', fakeContext());
      expect(host.setCriteria).toHaveBeenCalledWith(
        { ...DEFAULT_CRITERIA },
        expect.any(Object),
      );
    });

    it('x key cycles closed through CLOSED_FILTER_VALUES', () => {
      const host = {
        criteria: { ...DEFAULT_CRITERIA, closed: false },
        setCriteria: vi.fn(),
        resolveMine: () => undefined,
      };
      const bar = new TicketFilterBar(host);
      bar.handleKey('x', fakeContext());
      expect(host.setCriteria).toHaveBeenCalledWith(
        expect.objectContaining({ closed: true }),
        expect.any(Object),
      );
    });

    it('x key cycles closed from true to null', () => {
      const host = {
        criteria: { ...DEFAULT_CRITERIA, closed: true },
        setCriteria: vi.fn(),
        resolveMine: () => undefined,
      };
      const bar = new TicketFilterBar(host);
      bar.handleKey('x', fakeContext());
      expect(host.setCriteria).toHaveBeenCalledWith(
        expect.objectContaining({ closed: null }),
        expect.any(Object),
      );
    });

    it('s key cycles state through STATE_FILTER_VALUES', () => {
      const host = {
        criteria: { ...DEFAULT_CRITERIA, state: 'triage' },
        setCriteria: vi.fn(),
        resolveMine: () => undefined,
      };
      const bar = new TicketFilterBar(host);
      bar.handleKey('s', fakeContext());
      expect(host.setCriteria).toHaveBeenCalledWith(
        expect.objectContaining({ state: 'backlog' }),
        expect.any(Object),
      );
    });

    it('m key toggles who to mine when mine is resolved', () => {
      const host = {
        criteria: { ...DEFAULT_CRITERIA, who: null },
        setCriteria: vi.fn(),
        resolveMine: () => ({ id: 'u1', label: 'cw' }),
      };
      const bar = new TicketFilterBar(host);
      bar.handleKey('m', fakeContext());
      expect(host.setCriteria).toHaveBeenCalledWith(
        expect.objectContaining({ who: { id: 'u1', label: 'cw' } }),
        expect.any(Object),
      );
    });

    it('m key clears who when mine is already set', () => {
      const host = {
        criteria: { ...DEFAULT_CRITERIA, who: { id: 'u1', label: 'cw' } },
        setCriteria: vi.fn(),
        resolveMine: () => ({ id: 'u1', label: 'cw' }),
      };
      const bar = new TicketFilterBar(host);
      bar.handleKey('m', fakeContext());
      expect(host.setCriteria).toHaveBeenCalledWith(
        expect.objectContaining({ who: null }),
        expect.any(Object),
      );
    });

    it('w key navigates to who filter', () => {
      const context = fakeContext();
      const host = {
        criteria: { ...DEFAULT_CRITERIA },
        setCriteria: vi.fn(),
        resolveMine: () => undefined,
      };
      const bar = new TicketFilterBar(host);
      bar.handleKey('w', context);
      expect(context.navigate).toHaveBeenCalledWith(
        'project.tickets.who-filter',
        {},
      );
    });

    it('p key navigates to parent filter', () => {
      const context = fakeContext();
      const host = {
        criteria: { ...DEFAULT_CRITERIA },
        setCriteria: vi.fn(),
        resolveMine: () => undefined,
      };
      const bar = new TicketFilterBar(host);
      bar.handleKey('p', context);
      expect(context.navigate).toHaveBeenCalledWith(
        'project.tickets.parent-filter',
        {},
      );
    });

    // `/` belongs to the shared `TicketSearch`; a bar that claimed it would
    // swallow the key before the search field could open.
    it('/ key is left to the search', () => {
      const host = {
        criteria: { ...DEFAULT_CRITERIA },
        setCriteria: vi.fn(),
        resolveMine: () => undefined,
      };
      const bar = new TicketFilterBar(host);
      expect(bar.handleKey('/', fakeContext())).toBe(false);
    });
  });

  describe('applyTo()', () => {
    it('returns true for row matching all empty criteria', () => {
      const host = {
        criteria: { ...DEFAULT_CRITERIA },
        setCriteria: vi.fn(),
        resolveMine: () => undefined,
      };
      const bar = new TicketFilterBar(host);
      expect(bar.applyTo(row())).toBe(true);
    });

    it('does not re-filter by the search line', () => {
      const host = {
        criteria: { ...DEFAULT_CRITERIA, query: 'bakers#19' },
        setCriteria: vi.fn(),
        resolveMine: () => undefined,
      };
      const bar = new TicketFilterBar(host);
      expect(
        bar.applyTo(row({ identifier: 'BB-7', title: 'from origin 19' })),
      ).toBe(true);
    });

    it('filters by state', () => {
      const host = {
        criteria: { ...DEFAULT_CRITERIA, state: 'coding' },
        setCriteria: vi.fn(),
        resolveMine: () => undefined,
      };
      const bar = new TicketFilterBar(host);
      expect(bar.applyTo(row({ state: 'coding' }))).toBe(true);
      expect(bar.applyTo(row({ state: 'triage' }))).toBe(false);
    });

    it('filters by closed', () => {
      const host = {
        criteria: { ...DEFAULT_CRITERIA, closed: true },
        setCriteria: vi.fn(),
        resolveMine: () => undefined,
      };
      const bar = new TicketFilterBar(host);
      expect(bar.applyTo(row({ closed: true }))).toBe(true);
      expect(bar.applyTo(row({ closed: false }))).toBe(false);
    });

    it('filters by parent', () => {
      const host = {
        criteria: {
          ...DEFAULT_CRITERIA,
          parent: { id: 'p1', identifier: 'BB-10' },
        },
        setCriteria: vi.fn(),
        resolveMine: () => undefined,
      };
      const bar = new TicketFilterBar(host);
      expect(bar.applyTo(row({ parent: 'BB-10' }))).toBe(true);
      expect(bar.applyTo(row({ parent: 'BB-5' }))).toBe(false);
    });

    it('filters by who', () => {
      const host = {
        criteria: {
          ...DEFAULT_CRITERIA,
          who: { id: 'u1', label: 'cw' },
        },
        setCriteria: vi.fn(),
        resolveMine: () => undefined,
      };
      const bar = new TicketFilterBar(host);
      expect(bar.applyTo(row({ assigneeId: 'u1' }))).toBe(true);
      expect(bar.applyTo(row({ assigneeId: 'u2' }))).toBe(false);
    });
  });
});
