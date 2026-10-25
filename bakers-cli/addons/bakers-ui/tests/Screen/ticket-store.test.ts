import { expect, it, vi } from 'vitest';
import { ArtifactsTabScreen } from '../../../bakers-ui-artifacts/src/panel.js';
import { createSessionStore } from '../../src/Data/session-store.js';
import { Router } from '../../src/Routing/router.js';
import { buildRoutes } from '../../src/Routing/routes.js';
import type { ScreenContext } from '../../src/Screen/screen.js';
import { renderTree } from '../render-tree.js';

function setup() {
  let title = 'Initial title';
  const includesRead: string[][] = [];
  const services = {
    client: {
      get: async (_path: string, params?: { getQueryString(): string }) => {
        const includes =
          new URLSearchParams(params?.getQueryString() ?? _path.split('?')[1])
            .get('include')
            ?.split(',') ?? [];
        includesRead.push(includes);
        return {
          data: {
            id: 't1',
            type: 'bb_ticket--bb_ticket',
            attributes: { identifier: 'TEST-1', title, state: 'coding' },
            relationships: {
              labels: { data: [{ id: 'l1' }] },
              comments: { data: [{ id: 'c1' }] },
            },
          },
          included: [
            ...(includes.includes('labels')
              ? [
                  {
                    id: 'l1',
                    type: 'bb_term--label',
                    attributes: { name: 'important' },
                  },
                ]
              : []),
            ...(includes.includes('comments')
              ? [
                  {
                    id: 'c1',
                    type: 'bb_comment--bb_comment',
                    attributes: {
                      body: { value: 'Comment text' },
                      bb_comment_type: 'comment',
                    },
                  },
                ]
              : []),
          ],
        };
      },
    },
  };
  const session = buildRoutes([ArtifactsTabScreen]).createSession({});
  const router = new Router(
    session.screens(),
    vi.fn(),
    1,
    { services, store: createSessionStore() } as Pick<
      ScreenContext,
      'services' | 'store'
    >,
    session.navigation(),
  );
  const ready = async () => {
    await vi.waitFor(() =>
      expect((router.active as { state?: string })?.state).toBe('ready'),
    );
  };
  const header = () => {
    const tree = router.active?.present(router.context()).header;
    return tree ? renderTree(tree).join('\n') : '';
  };
  return {
    router,
    ready,
    header,
    includesRead,
    setTitle: (next: string) => {
      title = next;
    },
  };
}

it('shares header data across narrow screen reads and avoids rereading cached comments', async () => {
  const { router, ready, header, includesRead } = setup();
  router.navigate('ticket.detail', { ticketId: 't1' }, false);
  await ready();
  router.navigateTab('ticket', 'comments');
  await ready();
  expect(header()).toContain('important');
  // Overview's own navigate also fires the inline addons card's request.
  expect(includesRead).toHaveLength(2);
  router.navigateTab('ticket', 'runs');
  await ready();
  expect(header()).toContain('important');
  expect(includesRead[2]).toEqual(['runs']);
});

it('reloads active data and shows the updated header on a previously visited sibling', async () => {
  const { router, ready, header, setTitle } = setup();
  router.navigate('ticket.detail', { ticketId: 't1' }, false);
  await ready();
  router.navigateTab('ticket', 'comments');
  await ready();
  setTitle('Reloaded title');
  router.active?.reload?.(router.context());
  await ready();
  expect(header()).toContain('Reloaded title');
  router.navigateTab('ticket', 'overview');
  await ready();
  expect(header()).toContain('Reloaded title');
});

it('local addon screens read the shared header without an API request', async () => {
  const { router, ready, header, includesRead } = setup();
  router.navigate('ticket.detail', { ticketId: 't1' }, false);
  await ready();
  for (const tab of ['artifacts']) {
    router.navigateTab('ticket', tab);
    await ready();
    expect(header()).toContain('Initial title');
    expect(header()).toContain('important');
  }
  // Overview's own navigate also fires the inline addons card's request.
  expect(includesRead).toHaveLength(2);
  router.active?.leave();
});

it.each([
  'ticket.artifacts',
])('returns a history-empty %s deep link to My work', (routeId) => {
  const { router } = setup();
  router.navigate(routeId, { ticketId: 't1' }, false);

  expect(router.historyForTest()).toEqual([]);
  expect(router.back()).toBe(false);
  expect(router.fallback()).toBe(true);
  expect(router.active?.id).toBe('my.work');
});
