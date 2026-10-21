import { tabBarFor } from '../src/Component/top-tabs/index.js';
import { buildRoutes } from '../src/Routing/routes.js';
export const routes = buildRoutes();
export const ROOT_TABS = routes.tabs('root');
export const PROJECT_TABS = routes.tabs('project');
export const topTabBar = (level: string, tab: string): string =>
  tabBarFor({ level, tab, tabs: routes.tabs(level) });
