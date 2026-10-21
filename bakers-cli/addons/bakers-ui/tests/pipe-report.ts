import { createSessionStore } from '../src/Data/session-store.js';
import type { AssignmentLabels } from '../src/Entity/ticket/Component/ticket-detail/index.js';
import { TicketCommentsScreen } from '../src/Entity/ticket/Screen/ticket-comments.js';
import { TicketDetailScreen } from '../src/Entity/ticket/Screen/ticket-detail.js';
import { TicketPlanningScreen } from '../src/Entity/ticket/Screen/ticket-planning.js';
import { renderPipe } from '../src/Kernel/pipe.js';
import type { ScreenClass } from '../src/Routing/route.js';
import { Router } from '../src/Routing/router.js';
import { buildRoutes } from '../src/Routing/routes.js';
import type { ScreenContext } from '../src/Screen/screen.js';
import type { TicketDetailDocument } from '../src/types.js';

/** Exercise the production report composer with preloaded fixture data. */
export async function pipeReport(
  document: TicketDetailDocument,
  context: ScreenContext,
  contributed: readonly ScreenClass[] = [],
  labels?: AssignmentLabels,
): Promise<string[]> {
  const routes = buildRoutes(contributed);
  const session = routes.createSession({});
  const store = createSessionStore();
  const applyLabels = () => {
    for (const screen of session.screens().values()) {
      if (
        screen instanceof TicketDetailScreen ||
        screen instanceof TicketPlanningScreen ||
        screen instanceof TicketCommentsScreen
      )
        screen.setLabels(labels);
    }
  };
  const router = new Router(
    session.screens(),
    applyLabels,
    1,
    { ...context, store },
    session.navigation(),
  );
  try {
    const result = await renderPipe(
      router,
      routes,
      {
        routeId: 'ticket.detail',
        params: context.params ?? {},
        state: { document },
      },
      async () => {
        throw new Error('Fixture screen must supply pipe rows');
      },
    );
    return [...result.lines].slice(1);
  } finally {
    store.clear();
  }
}
