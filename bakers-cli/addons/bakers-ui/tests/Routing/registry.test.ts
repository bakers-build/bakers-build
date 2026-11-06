import { describe, expect, it } from 'vitest';
import { defineRoutes } from '../../src/Routing/registry.js';

class A {
  static readonly route = {
    id: 'a',
    path: '/a',
    tab: { id: 'a', label: 'A', scope: 'root', weight: 20 },
  };
}
class B {
  static readonly route = {
    id: 'b',
    path: '/b',
    parent: 'a',
    tab: { id: 'b', label: 'B', scope: 'root', weight: 10 },
  };
}

describe('defineRoutes', () => {
  it('creates exactly one screen per route and UI session', () => {
    const registry = defineRoutes([A]);
    const first = registry.createSession({});
    const second = registry.createSession({});

    expect(first.screen('a')).toBe(first.screen('a'));
    expect(second.screen('a')).not.toBe(first.screen('a'));
  });
  it('registers explicitly, validates parents and orders tabs', () => {
    const registry = defineRoutes([A, B]);
    expect(registry.get('a')?.screen).toBeInstanceOf(A);
    expect(registry.tabs('root').map((tab) => tab.id)).toEqual(['b', 'a']);
  });
  it('rejects duplicate routes and invalid parents', () => {
    expect(() => defineRoutes([A, A])).toThrow(/duplicate route/);
    class Orphan {
      static readonly route = { id: 'orphan', path: '/', parent: 'missing' };
    }
    expect(() => defineRoutes([Orphan])).toThrow(/parent/);
  });
  it('rejects duplicate tab ids in the same scope', () => {
    class DuplicateTab {
      static readonly route = {
        id: 'duplicate-tab',
        path: '/duplicate-tab',
        tab: { id: 'a', label: 'Again', scope: 'root', weight: 30 },
      };
    }
    expect(() => defineRoutes([A, DuplicateTab])).toThrow(
      /duplicate tab: root\/a/,
    );
  });

  it('permits the same tab id in a different scope', () => {
    class ScopedTab {
      static readonly route = {
        id: 'scoped-tab',
        path: '/scoped-tab',
        tab: { id: 'a', label: 'Scoped', scope: 'project', weight: 10 },
      };
    }
    expect(defineRoutes([A, ScopedTab]).tabs('project')).toHaveLength(1);
  });

  it('resolves fallback and tab locations outside the terminal kernel', () => {
    const registry = defineRoutes([A, B], 'a');
    const params = { projectId: 'p1' };
    expect(registry.navigation.tab('root', 'b', params)).toEqual({
      routeId: 'b',
      params: {},
    });
    expect(registry.navigation.fallback('b', params)).toEqual({
      routeId: 'a',
      params: {},
    });
  });

  // BB-377 D1 — scope `user` must preserve params the way `project` does,
  // or Tab between Overview/Tickets/Runs opens with no userId.
  it('preserves params when navigating tabs and falling back under user scope', () => {
    class Users {
      static readonly route = {
        id: 'users',
        path: '/users',
        tab: { id: 'users', label: 'Users', scope: 'root', weight: 40 },
      };
    }
    class Overview {
      static readonly route = {
        id: 'user.overview',
        path: '/users/:userId',
        fallback: { routeId: 'users' },
        tab: { id: 'overview', label: 'Overview', scope: 'user', weight: 10 },
      };
    }
    class Tickets {
      static readonly route = {
        id: 'user.tickets',
        path: '/users/:userId/tickets',
        fallback: { routeId: 'users' },
        tab: { id: 'tickets', label: 'Tickets', scope: 'user', weight: 20 },
      };
    }
    const registry = defineRoutes([Users, Overview, Tickets], 'users');
    const params = { userId: 'u-1', userName: 'cw' };

    expect(registry.navigation.tab('user', 'tickets', params)).toEqual({
      routeId: 'user.tickets',
      params,
    });
    expect(registry.navigation.fallback('user.overview', params)).toEqual({
      routeId: 'users',
      params: {},
    });
  });

  it('preserves params for project-scope tab navigation (regression)', () => {
    class Dash {
      static readonly route = {
        id: 'project.dashboard',
        path: '/projects/:projectId',
        tab: {
          id: 'dashboard',
          label: 'Dashboard',
          scope: 'project',
          weight: 10,
        },
      };
    }
    class Tickets {
      static readonly route = {
        id: 'project.tickets',
        path: '/projects/:projectId/tickets',
        parent: 'project.dashboard',
        tab: { id: 'tickets', label: 'Tickets', scope: 'project', weight: 20 },
      };
    }
    const registry = defineRoutes([Dash, Tickets], 'project.dashboard');
    const params = { projectId: 'p1', projectName: 'bakers' };
    expect(registry.navigation.tab('project', 'tickets', params)).toEqual({
      routeId: 'project.tickets',
      params,
    });
  });

  it.each([
    'workspace-member',
  ])('preserves params throughout the %s tab scope', (scope) => {
    class Overview {
      static readonly route = {
        id: `${scope}.overview`,
        path: '/members/:userId',
        tab: { id: 'overview', label: 'Overview', scope, weight: 10 },
      };
    }
    class Stats {
      static readonly route = {
        id: `${scope}.stats`,
        path: '/members/:userId/stats',
        tab: { id: 'stats', label: 'Stats', scope, weight: 20 },
      };
    }
    const registry = defineRoutes([Overview, Stats], `${scope}.overview`);
    const params = {
      workspaceId: 'workspace-1',
      userId: 'user-1',
      userName: 'Ada',
    };

    expect(registry.navigation.tab(scope, 'stats', params)).toEqual({
      routeId: `${scope}.stats`,
      params,
    });
  });
});
