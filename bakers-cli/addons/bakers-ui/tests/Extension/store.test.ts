import { beforeEach, expect, it } from 'vitest';
import {
  drainContributions,
  register,
  resetCollector,
} from '../../src/Extension/store.js';
import { messageTree } from '../../src/lib/vnode.js';
import { buildRoutes } from '../../src/Routing/routes.js';
import { BaseScreen, presentation } from '../../src/Screen/screen.js';

class Demo extends BaseScreen {
  static readonly route = {
    id: 'ticket.demo',
    path: '/tickets/:ticketId/demo',
    tab: { id: 'demo', label: 'Demo', scope: 'ticket', weight: 9 },
  };
  readonly id = 'ticket.demo';
  present() {
    return presentation(messageTree(this.id, ['demo']));
  }
  handleInput(input: string) {
    return input === 'z';
  }
}
beforeEach(resetCollector);
it('drains screen classes once and registers a callable screen in its scope', () => {
  register('demo', (api) => api.add(Demo));
  const built = buildRoutes(drainContributions());
  expect(built.routeForTab('ticket', 'demo')?.metadata.id).toBe('ticket.demo');
  expect(
    built
      .screens()
      .get('ticket.demo')
      ?.handleInput('z', {} as never),
  ).toBe(true);
  expect(drainContributions()).toEqual([]);
});
it('refuses duplicate route ids', () => {
  register('demo', (api) => api.add(Demo));
  expect(() => register('demo', (api) => api.add(Demo))).toThrow(
    /already registered/,
  );
});
it('refuses conflicting tab ids at registry construction', () => {
  class Other extends Demo {
    static readonly route = { ...Demo.route, id: 'ticket.other' };
  }
  expect(() => buildRoutes([Demo, Other])).toThrow(
    'duplicate tab: ticket/demo',
  );
});
it('requires route tab metadata', () => {
  class NoTab extends Demo {
    static readonly route = { id: 'missing' } as typeof Demo.route;
  }
  expect(() => register('missing', (api) => api.add(NoTab))).toThrow(
    /route.tab/,
  );
});
it('propagates setup errors', () => {
  expect(() =>
    register('bad', () => {
      throw new Error('setup failed');
    }),
  ).toThrow('setup failed');
});
