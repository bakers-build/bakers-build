import type { Screen, ScreenContext } from '../Screen/screen.js';
import { ContextBag, projectContext, userContext } from './context.js';
import type { NavigationResolver } from './route.js';

interface Location {
  id: string;
  params: Readonly<Record<string, string>>;
  state?: unknown;
  contexts: ContextBag;
}
export interface HistoryEntry {
  readonly routeId: string;
  readonly params: Readonly<Record<string, string>>;
  readonly restore: unknown;
  readonly state?: unknown;
}

export class Router {
  private location: Location | null = null;
  private readonly history: HistoryEntry[] = [];
  private visits = 0;
  constructor(
    private readonly screens: ReadonlyMap<string, Screen>,
    private readonly requestDraw: () => void,
    private readonly sessionGeneration: number,
    private readonly runtime: Omit<
      ScreenContext,
      'sessionGeneration' | 'requestDraw' | 'isActive' | 'params'
    > = {},
    private readonly navigation?: NavigationResolver,
  ) {
    // Route registries are module-level composition objects. A Router is one
    // terminal session, so it must never inherit cached documents or criteria
    // from a previous Router built from that registry.
    for (const screen of screens.values()) screen.reset();
  }

  get active(): Screen | null {
    return this.location ? (this.screens.get(this.location.id) ?? null) : null;
  }

  /**
   * How many navigations this router has performed — BB-340 spec F2.
   *
   * The seam the kernel needs to keep its promise that `leave()` destroys the
   * departed screen's subtree: `navigate` is the one method that calls
   * `leave()`/`enter()` (`back`, `fallback` and `navigateTab` all route through
   * it), so a change in this number is exactly "a screen has been left".
   *
   * A COUNTER rather than the active screen's identity, because the screens are
   * module-level singletons this router only borrows: re-entering the same route
   * with different params — a second ticket, a second project — is a `leave()`
   * and an `enter()` on the very same instance, and an identity check would miss
   * it and keep the first entity's nodes standing.
   */
  get visitCount(): number {
    return this.visits;
  }

  navigate(
    id: string,
    params: Readonly<Record<string, string>> = {},
    push = true,
    state?: unknown,
  ): void {
    const destination = this.screens.get(id);
    if (!destination) throw new Error(`unknown route: ${id}`);
    // Counted where the leave actually happens, and only once the destination
    // resolved: a rejected route id leaves the frame exactly as it was.
    this.visits += 1;
    this.active?.leave();
    if (push && this.location) {
      const active = this.active as Screen & { saveState?: () => unknown };
      this.history.push({
        routeId: this.location.id,
        params: this.location.params,
        restore: active?.saveState?.(),
        ...(this.location.state === undefined
          ? {}
          : { state: this.location.state }),
      });
    }
    const contexts =
      this.navigation?.contexts(id, params, state) ?? ContextBag.empty();
    this.location = {
      id,
      params,
      contexts,
      ...(state === undefined ? {} : { state }),
    };
    destination.enter(this.context(this.location));
  }

  back(result?: unknown): boolean {
    const previous = this.history.pop();
    if (!previous) return false;
    this.navigate(previous.routeId, previous.params, false, previous.state);
    const active = this.active as Screen & {
      restoreState?: (token: unknown) => void;
    };
    active?.restoreState?.(previous.restore);
    (
      active as Screen & {
        receiveResult?: (result: unknown, context: ScreenContext) => void;
      }
    )?.receiveResult?.(result, this.context());
    this.requestDraw();
    return true;
  }

  fallback(): boolean {
    if (!this.location) return false;
    const destination = this.navigation?.fallback(
      this.location.id,
      this.location.params,
    );
    if (!destination) return false;
    this.navigate(
      destination.routeId,
      destination.params,
      false,
      destination.state,
    );
    return true;
  }

  navigateTab(scope: string, tabId: string): boolean {
    if (!this.location) return false;
    const destination = this.navigation?.tab(
      scope,
      tabId,
      this.location.params,
    );
    if (!destination) return false;
    this.navigate(
      destination.routeId,
      destination.params,
      false,
      destination.state,
    );
    return true;
  }

  historyForTest(): readonly HistoryEntry[] {
    return this.history.map((entry) => ({ ...entry }));
  }

  context(location: Location | null = this.location): ScreenContext {
    const contexts = location?.contexts ?? ContextBag.empty();
    const project = contexts.has(projectContext)
      ? contexts.get(projectContext)
      : undefined;
    const user = contexts.has(userContext)
      ? contexts.get(userContext)
      : undefined;
    return {
      ...this.runtime,
      sessionGeneration: this.sessionGeneration,
      requestDraw: this.requestDraw,
      isActive: () => this.location === location,
      contexts,
      navigate: (id, params, state) => this.navigate(id, params, true, state),
      back: (result) => this.back(result),
      ...(project ? { project } : {}),
      ...(user ? { user } : {}),
      ...(location ? { params: location.params } : {}),
      ...(location?.state === undefined
        ? {}
        : { navigationState: location.state }),
    };
  }
}
