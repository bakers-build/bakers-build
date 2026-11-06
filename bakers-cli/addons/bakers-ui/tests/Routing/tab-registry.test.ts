import { describe, expect, it } from 'vitest';
import {
  drainContributions,
  resetCollector,
} from '../../src/Extension/store.js';
import { defineRoutes } from '../../src/Routing/registry.js';
import type { RouteMetadata, TabMetadata } from '../../src/Routing/route.js';
import { buildRoutes } from '../../src/Routing/routes.js';

const screen = (id: string, tab: TabMetadata) =>
  class {
    static readonly route: RouteMetadata = { id, path: `/${id}`, tab };
    readonly id = id;
  };
const tab = (id: string, scope = 'ticket', placement = {}) =>
  screen(`${scope}.${id}`, { id, label: id, scope, ...placement });

describe('relative tab registration', () => {
  it.each([
    'root',
    'project',
    'ticket',
    'team',
    'user',
  ])('inserts at any position on %s', (scope) => {
    const routes = defineRoutes([
      tab('first', scope, { weight: 10 }),
      tab('last', scope, { weight: 20 }),
      tab('middle', scope, { after: 'first' }),
      tab('start', scope, { before: 'first' }),
      tab('end', scope, { after: 'last' }),
    ]);
    expect(routes.tabs(scope).map((t) => t.id)).toEqual([
      'start',
      'first',
      'middle',
      'last',
      'end',
    ]);
    expect(
      routes.navigation.tab(scope, 'middle', {
        ticketId: 't',
        projectId: 'p',
        teamId: 'g',
        userId: 'u',
      })?.routeId,
    ).toBe(`${scope}.middle`);
  });
  it('resolves addon anchors regardless of registration order and preserves ties', () => {
    const routes = defineRoutes([
      tab('b', 'ticket', { after: 'a' }),
      tab('c', 'ticket', { after: 'a' }),
      tab('last', 'ticket', { weight: 20 }),
      tab('first', 'ticket', { weight: 10 }),
      tab('a', 'ticket', { after: 'first' }),
    ]);
    expect(routes.tabs('ticket').map((t) => t.id)).toEqual([
      'first',
      'a',
      'b',
      'c',
      'last',
    ]);
  });
  it('rejects unknown anchors during construction', () => {
    expect(() =>
      defineRoutes([tab('a', 'ticket', { before: 'missing' })]),
    ).toThrow(/unknown.*missing/);
  });
  it('rejects cyclic placement', () => {
    expect(() =>
      defineRoutes([
        tab('a', 'ticket', { before: 'b' }),
        tab('b', 'ticket', { before: 'a' }),
      ]),
    ).toThrow(/cycl/i);
  });
  it('rejects contradictory placement against the default order', () => {
    expect(() =>
      defineRoutes([
        tab('a', 'ticket', { weight: 10 }),
        tab('b', 'ticket', { weight: 20 }),
        tab('x', 'ticket', { after: 'b', before: 'a' }),
      ]),
    ).toThrow(/cycl|conflict/i);
  });
  it('rejects duplicate tabs in secondary scopes', () => {
    expect(() =>
      defineRoutes([
        screen('shared', {
          id: 'a',
          label: 'A',
          scope: 'project',
          scopes: ['root'],
          weight: 10,
        }),
        tab('a', 'root'),
      ]),
    ).toThrow(/duplicate tab: root\/a/);
  });
  it('includes a multi-scope route once per scope', () => {
    const routes = buildRoutes([], true);
    expect(routes.tabs('root').map((t) => t.id)).toEqual([
      'my-work',
      'projects',
      'teams',
      'members',
      'conductors',
    ]);
    expect(routes.tabs('project').map((t) => t.id)).toEqual([
      'overview',
      'tickets',
      'runs',
      'conductors',
    ]);
    expect(routes.tabs('team').map((t) => t.id)).toEqual([
      'overview',
      'work',
      'members',
    ]);
    expect(routes.ids()).toEqual(
      expect.arrayContaining(['my.work', 'project.overview', 'team.overview']),
    );
  });
  it('derives active bars from routes, including alternate and hidden presentations', () => {
    const routes = buildRoutes();
    expect(routes.tabLocation('my.work', {})?.level).toBe('root');
    expect(
      routes.tabLocation('project.overview', { projectId: 'p' })?.level,
    ).toBe('project');
    expect(routes.tabLocation('project.picker', {})).toMatchObject({
      level: 'root',
      tab: 'projects',
    });
    expect(routes.tabLocation('ticket.detail', { view: 'teaser' })).toBeNull();
    expect(
      routes.tabLocation('ticket.detail', { view: 'board_card' }),
    ).toBeNull();
    expect(routes.tabLocation('ticket.detail', { view: 'full' })).toMatchObject(
      { level: 'ticket', tab: 'overview' },
    );
    expect(routes.tabLocation('run.detail', {})).toBeNull();
  });
});

it('offers no statistics or ticket creation at any scope, react experiment included', async () => {
  resetCollector();
  await import('../../src/react-experiment.js');
  const routes = buildRoutes(drainContributions(), true);
  for (const id of [
    'my.stats',
    'project.stats',
    'team.stats',
    'workspace.member.stats',
    'team.member.stats',
    'ticket.react',
    'ticket.create',
    'project.ticket-agents',
  ]) {
    expect(routes.ids()).not.toContain(id);
  }
  for (const scope of [
    'root',
    'project',
    'team',
    'workspace-member',
    'team-member',
    'ticket',
  ]) {
    expect(routes.tabs(scope).filter((t) => /^stat/i.test(t.label))).toEqual(
      [],
    );
  }
});

it('positions relative to defaults that have no numeric order', () => {
  const routes = defineRoutes([
    tab('a'),
    tab('b'),
    tab('middle', 'ticket', { after: 'a' }),
  ]);
  expect(routes.tabs('ticket').map((t) => t.id)).toEqual(['a', 'middle', 'b']);
});

it('inserts weight 25 between History 20 and Runs 40', () => {
  const routes = buildRoutes([tab('extra', 'ticket', { weight: 25 })]);
  expect(routes.tabs('ticket').map((t) => [t.id, t.weight])).toEqual([
    ['overview', 10],
    ['planning', 15],
    ['comments', 20],
    ['extra', 25],
    ['runs', 40],
  ]);
});
