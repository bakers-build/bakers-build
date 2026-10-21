import { expect, it } from 'vitest';
import {
  tabBarFor,
  tabPartsFor,
} from '../../../src/Component/top-tabs/index.js';
import { buildRoutes } from '../../../src/Routing/routes.js';

const routes = buildRoutes();
it.each([
  ['root', 'projects', ' My work    Stats   [Projects]   Teams    Conductors '],
  [
    'project',
    'tickets',
    ' Overview    Stats   [Tickets]   Ticket-Agents    Runs    Conductors ',
  ],
  ['ticket', 'comments', ' Overview    Planning   [History]   Runs '],
  ['team', 'members', ' Overview    Work    Stats   [Members]'],
  ['team-member', 'runs', ' Overview    Stats    Tickets   [Runs]'],
])('renders the registered %s bar and its clickable parts', (level, tab, expected) => {
  const location = { level, tab, tabs: routes.tabs(level) };
  expect(tabBarFor(location)).toBe(expected);
  expect(
    tabPartsFor(location)
      .map((part) => part.text)
      .join(''),
  ).toBe(expected);
  expect(
    tabPartsFor(location)
      .filter((part) => part.tab)
      .map((part) => part.tab),
  ).toEqual(routes.tabs(level).map((entry) => entry.id));
});
it('renders contributed ids and labels without a fixed list', () => {
  const location = {
    level: 'project',
    tab: 'custom',
    tabs: [{ id: 'custom', label: 'Custom' }],
  };
  expect(tabBarFor(location)).toBe('[Custom]');
  expect(tabPartsFor(location)).toEqual([{ tab: 'custom', text: '[Custom]' }]);
});

it('renders the lead-only workspace-member bar from the admin registry', () => {
  const adminRoutes = buildRoutes([], true);
  const tabs = adminRoutes.tabs('workspace-member');
  expect(tabs.map(({ id }) => id)).toEqual([
    'overview',
    'stats',
    'tickets',
    'runs',
  ]);
  expect(tabBarFor({ level: 'workspace-member', tab: 'overview', tabs })).toBe(
    '[Overview]   Stats    Tickets    Runs ',
  );
});
