import type { defineRoutes } from '../Routing/registry.js';
import type { RouteLocation } from '../Routing/route.js';
import type { Router } from '../Routing/router.js';
import type {
  NonInteractivePresentation,
  Screen,
  ScreenPresentation,
} from '../Screen/screen.js';

/** Loaders may redirect (for example, a run deep link after loading its ticket). */
const settledActive = async (router: Router): Promise<Screen | null> => {
  while (router.active) {
    const screen = router.active;
    while (screen.busy) await new Promise((resolve) => setTimeout(resolve, 0));
    if (router.active === screen) return screen;
  }
  return null;
};

/** Compose reports at the routing boundary; screens never render siblings. */
export async function renderPipe(
  router: Router,
  routes: ReturnType<typeof defineRoutes>,
  location: RouteLocation,
  renderBody: (shown: ScreenPresentation) => Promise<string[]>,
): Promise<NonInteractivePresentation> {
  try {
    router.navigate(location.routeId, location.params, false, location.state);
    const initial = await settledActive(router);
    if (!initial) return { lines: [] };
    const scope =
      routes.get(initial.id)?.metadata.pipe === 'scope'
        ? routes.tabLocation(initial.id, router.context().params ?? {})?.level
        : undefined;
    if (!scope) {
      const context = router.context();
      const explicit = initial.nonInteractive?.(context);
      if (explicit) return explicit;
      const shown = initial.present(context);
      return {
        lines: [
          shown.title,
          ...(initial.renderNonInteractive?.(context) ??
            (await renderBody(shown))),
        ].filter(Boolean) as string[],
      };
    }
    const title = initial.present(router.context()).title;
    const lines: string[] = title ? [title] : [];
    let exitCode: number | undefined;
    let stream: 'stdout' | 'stderr' = 'stdout';
    for (const tab of routes.tabs(scope)) {
      const destination = routes.navigation.tab(scope, tab.id, location.params);
      if (!destination) continue;
      try {
        if (router.active?.id !== destination.routeId)
          router.navigate(
            destination.routeId,
            destination.params,
            false,
            location.state,
          );
        const screen = await settledActive(router);
        if (!screen) continue;
        const context = router.context();
        const explicit = screen.nonInteractive?.(context);
        lines.push(
          ...(explicit?.lines ??
            screen.renderNonInteractive?.(context) ??
            (await renderBody(screen.present(context)))),
        );
        if (explicit?.exitCode) exitCode = explicit.exitCode;
        if (explicit?.stream === 'stderr') stream = 'stderr';
      } catch (error) {
        lines.push(
          `${destination.routeId} failed to render: ${error instanceof Error ? error.message : String(error)}`,
        );
        exitCode = 1;
      }
    }
    return { lines, stream, ...(exitCode === undefined ? {} : { exitCode }) };
  } finally {
    router.active?.leave();
  }
}
