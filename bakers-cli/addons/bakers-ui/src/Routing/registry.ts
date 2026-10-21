import type { TabLocation } from '../Component/top-tabs/index.js';
import { contextsForParams } from './context.js';
import type {
  NavigationResolver,
  RouteMetadata,
  ScreenClass,
  TabMetadata,
} from './route.js';
import { orderTabs } from './tabs.js';

export interface RegisteredRoute {
  metadata: RouteMetadata;
  screen: object;
}

/**
 * The tab levels whose screens are SCOPED to an entity in the route params.
 *
 * Navigating within such a level, and escaping out of one, must carry those
 * params: a project tab needs `projectId`, a user tab `userId`, a team tab
 * `teamId` (BB-391 AC4). Dropping them opens the tab with no scope, which is a
 * screen that cannot load. `root` is deliberately absent — it is the level that
 * carries no entity, and it is the one that must drop stale params.
 *
 * Ticket tabs likewise require ticketId to load.
 *
 * A LIST rather than a rule, so a new level has to be added on purpose: it is
 * read by both `NavigationResolver.tab` and `NavigationResolver.fallback`, which
 * is what keeps Tab and Escape agreeing about what a level's scope is.
 */
const SCOPED_TAB_LEVELS: readonly string[] = [
  'project',
  'team',
  'workspace-member',
  'team-member',
  'user',
  'ticket',
  'conductor',
];

export function defineRoutes<const T extends readonly ScreenClass[]>(
  classes: T,
  defaultRouteId?: string,
) {
  const definitions = new Map<
    string,
    { metadata: RouteMetadata; create: (environment: unknown) => object }
  >();
  const tabs = new Set<string>();
  for (const ScreenType of classes) {
    const metadata = ScreenType.route;
    if (definitions.has(metadata.id))
      throw new Error(`duplicate route: ${metadata.id}`);
    if (metadata.tab) {
      for (const scope of new Set([
        metadata.tab.scope,
        ...(metadata.tab.scopes ?? []),
      ])) {
        const tabKey = `${scope}/${metadata.tab.id}`;
        if (tabs.has(tabKey)) throw new Error(`duplicate tab: ${tabKey}`);
        tabs.add(tabKey);
      }
    }
    definitions.set(metadata.id, {
      metadata,
      create: (environment) => new ScreenType(environment),
    });
  }
  for (const { metadata } of definitions.values()) {
    if (
      typeof metadata.parent === 'string' &&
      !definitions.has(metadata.parent)
    )
      throw new Error(`invalid parent: ${metadata.parent}`);
  }
  const tabsByScope = new Map<string, TabMetadata[]>();
  for (const { metadata } of definitions.values()) {
    if (!metadata.tab) continue;
    for (const scope of new Set([
      metadata.tab.scope,
      ...(metadata.tab.scopes ?? []),
    ])) {
      const entries = tabsByScope.get(scope) ?? [];
      entries.push({ ...metadata.tab, scope });
      tabsByScope.set(scope, entries);
    }
  }
  for (const [scope, entries] of tabsByScope)
    tabsByScope.set(scope, orderTabs(entries));
  const tabLocation = (
    routeId: string,
    params: Readonly<Record<string, string>>,
  ): TabLocation | null => {
    const metadata = definitions.get(routeId)?.metadata;
    const reference =
      typeof metadata?.activeTab === 'function'
        ? metadata.activeTab(params)
        : (metadata?.activeTab ?? metadata?.tab);
    if (!reference) return null;
    const entries = tabsByScope.get(reference.scope) ?? [];
    if (!entries.some((tab) => tab.id === reference.id))
      throw new Error(
        `unknown active tab: ${reference.scope}/${reference.id} (from ${routeId})`,
      );
    return { level: reference.scope, tab: reference.id, tabs: entries };
  };
  const createSession = (environment: unknown) => {
    const entries = new Map<string, RegisteredRoute>(
      [...definitions].map(([id, definition]) => [
        id,
        {
          metadata: definition.metadata,
          screen: definition.create(environment),
        },
      ]),
    );
    return {
      get: (id: string) => entries.get(id),
      screen: (id: string) => entries.get(id)?.screen,
      screens: (): ReadonlyMap<string, import('../Screen/screen.js').Screen> =>
        new Map(
          [...entries].map(([id, entry]) => [
            id,
            entry.screen as import('../Screen/screen.js').Screen,
          ]),
        ),
      navigation: (): NavigationResolver => navigation,
    };
  };
  const routeForTab = (
    scope: string,
    tabId: string,
  ): { metadata: RouteMetadata } | undefined =>
    [...definitions.values()].find(
      ({ metadata }) =>
        (metadata.tab?.scope === scope ||
          metadata.tab?.scopes?.includes(scope)) &&
        metadata.tab.id === tabId,
    );
  const navigation: NavigationResolver = {
    contexts(routeId, params, state) {
      const base = contextsForParams(params);
      return (
        definitions.get(routeId)?.metadata.context?.(params, state, base) ??
        base
      );
    },
    fallback(routeId, params) {
      const metadata = definitions.get(routeId)?.metadata;
      const configured = metadata?.fallback;
      const target =
        configured?.routeId ??
        (typeof metadata?.parent === 'string'
          ? metadata.parent
          : defaultRouteId);
      if (!target) return undefined;
      const preserve = configured
        ? configured.preserveParams === true
        : SCOPED_TAB_LEVELS.includes(metadata?.tab?.scope ?? '');
      return { routeId: target, params: preserve ? params : {} };
    },
    tab(scope, tabId, params) {
      const destination = routeForTab(scope, tabId);
      return destination
        ? {
            routeId: destination.metadata.id,
            // BB-377 D1: user-level tabs need userId the way project tabs
            // need projectId — dropping params opens the tab with no scope.
            // BB-391 AC4: and team-level tabs need teamId, for exactly that
            // reason. Every SCOPED level is listed here; the root level is the
            // one that carries no entity, so it is the one that drops params.
            params: SCOPED_TAB_LEVELS.includes(scope) ? params : {},
          }
        : undefined;
    },
  };
  // Compatibility facade for the migration. Production boot moves to an
  // explicit session in Task 9; until then existing callers share this one.
  const defaultSession = createSession({});
  return {
    createSession,
    get: (id: string) => defaultSession.get(id),
    tabLocation,
    tabs: (scope: string): readonly TabMetadata[] =>
      tabsByScope.get(scope) ?? [],
    routeForTab: (scope: string, tabId: string): RegisteredRoute | undefined =>
      [...definitions.values()]
        .map((definition) => ({
          metadata: definition.metadata,
          screen: defaultSession.screen(definition.metadata.id) as object,
        }))
        .find(
          ({ metadata }) =>
            (metadata.tab?.scope === scope ||
              metadata.tab?.scopes?.includes(scope)) &&
            metadata.tab.id === tabId,
        ),
    ids: () => [...definitions.keys()],
    screens: (): ReadonlyMap<string, import('../Screen/screen.js').Screen> =>
      defaultSession.screens(),
    navigation,
  };
}
