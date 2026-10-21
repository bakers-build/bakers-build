import { expect, it } from 'vitest';
import { renderPipe } from '../../src/Kernel/pipe.js';
import { textNode } from '../../src/lib/vnode.js';
import { defineRoutes } from '../../src/Routing/registry.js';
import type { RouteMetadata } from '../../src/Routing/route.js';
import { Router } from '../../src/Routing/router.js';
import { AsyncScreen } from '../../src/Screen/async-screen.js';
import type { ScreenContext } from '../../src/Screen/screen.js';

const lifecycle: string[] = [];
const screen = (id: string, weight: number, fail = false) =>
  class extends AsyncScreen<string> {
    static readonly route: RouteMetadata = {
      id,
      path: `/${id}`,
      tab: { id, label: id, scope: 'ticket', weight },
      ...(id === 'overview'
        ? {
            pipe: 'scope' as const,
            activeTab: (params: Readonly<Record<string, string>>) =>
              params.view === 'teaser' ? null : { scope: 'ticket', id },
          }
        : {}),
    };
    readonly id = id;
    protected async load(context: ScreenContext) {
      lifecycle.push(`load:${id}:${context.params?.ticketId}`);
      return `${id} body`;
    }
    override leave() {
      lifecycle.push(`leave:${id}`);
      super.leave();
    }
    protected renderLoading() {
      return ['loading'];
    }
    protected renderReady(value: string) {
      return textNode({ id, content: value });
    }
    protected chrome() {
      return { title: 'Ticket title' };
    }
    renderNonInteractive() {
      if (fail) throw new Error('broken');
      return [this.readyValue ?? '', ''];
    }
  };
const execute = async (
  routeId = 'overview',
  params: Record<string, string> = { ticketId: 't1' },
  fail = false,
) => {
  lifecycle.length = 0;
  const routes = defineRoutes([
    screen('runs', 40),
    screen('overview', 10),
    screen('related', 30),
    screen('extra', 25, fail),
    screen('comments', 20),
  ]);
  const session = routes.createSession({});
  const router = new Router(
    session.screens(),
    () => {},
    1,
    {},
    session.navigation(),
  );
  return renderPipe(router, routes, { routeId, params }, async () => [
    'fallback',
  ]);
};
it('prints one title and all screen rows in weight order, including an intermediate addon', async () => {
  const result = await execute();
  expect(result.lines).toEqual([
    'Ticket title',
    'overview body',
    '',
    'comments body',
    '',
    'extra body',
    '',
    'related body',
    '',
    'runs body',
    '',
  ]);
  expect(lifecycle.filter((event) => event.startsWith('load:'))).toEqual([
    'load:overview:t1',
    'load:comments:t1',
    'load:extra:t1',
    'load:related:t1',
    'load:runs:t1',
  ]);
  expect(lifecycle.at(-1)).toBe('leave:runs');
});
it('prints a route without scope composition alone', async () => {
  expect((await execute('related')).lines).toEqual([
    'Ticket title',
    'related body',
  ]);
});
it('keeps compact views single-screen', async () => {
  expect(
    (await execute('overview', { ticketId: 't1', view: 'teaser' })).lines,
  ).toEqual(['Ticket title', 'overview body']);
});
it('reports a throwing contribution and continues with later tabs', async () => {
  const result = await execute('overview', { ticketId: 't1' }, true);
  expect(result.lines).toContain('extra failed to render: broken');
  expect(result.lines).toContain('runs body');
  expect(result.exitCode).toBe(1);
  expect(lifecycle.at(-1)).toBe('leave:runs');
});
