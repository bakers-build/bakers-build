export interface TabReference {
  scope: string;
  id: string;
}

export interface TabMetadata {
  id: string;
  label: string;
  scope: string;
  /** A single screen may occupy the same tab in more than one level. */
  scopes?: readonly string[];
  weight?: number;
  /** Relative tab ids in the same scope; validated when routes are built. */
  before?: string;
  after?: string;
}
export interface RouteMetadata {
  id: string;
  path: string;
  parent?: string | ((context: unknown) => string | null);
  context?: (
    params: Readonly<Record<string, string>>,
    state: unknown,
    base: import('./context.js').ContextBag,
  ) => import('./context.js').ContextBag;
  tab?: TabMetadata;
  /** Print every tab of the active scope, in the registry's order. */
  pipe?: 'scope';
  /** Override the active location for shared routes or non-tab destinations. */
  activeTab?:
    | TabReference
    | ((params: Readonly<Record<string, string>>) => TabReference | null);
  presentation?: 'page' | 'modal';
  /** Empty-history destination; parameters are dropped unless requested. */
  fallback?: { routeId: string; preserveParams?: boolean };
}

export interface RouteLocation {
  readonly routeId: string;
  readonly params: Readonly<Record<string, string>>;
  readonly state?: unknown;
}

export interface NavigationResolver {
  contexts(
    routeId: string,
    params: Readonly<Record<string, string>>,
    state?: unknown,
  ): import('./context.js').ContextBag;
  fallback(
    routeId: string,
    params: Readonly<Record<string, string>>,
  ): RouteLocation | undefined;
  tab(
    scope: string,
    tabId: string,
    params: Readonly<Record<string, string>>,
  ): RouteLocation | undefined;
}

export interface ScreenClass {
  new (environment?: unknown): object;
  readonly route: RouteMetadata;
}
