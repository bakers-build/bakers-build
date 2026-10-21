import { describe, expect, it, vi } from 'vitest';
import { createSessionStore } from '../../src/Data/session-store.js';
import type { TicketContentProps } from '../../src/Entity/ticket/Component/ticket-content/index.js';
import { saveTicket } from '../../src/Entity/ticket/Data/store.js';
import { TicketCommentsScreen } from '../../src/Entity/ticket/Screen/ticket-comments.js';
import { TicketDetailScreen } from '../../src/Entity/ticket/Screen/ticket-detail.js';
import { TicketPlanningScreen } from '../../src/Entity/ticket/Screen/ticket-planning.js';
import { buildRoutes } from '../../src/Routing/routes.js';
import { AsyncScreen } from '../../src/Screen/async-screen.js';
import type { ScreenContext } from '../../src/Screen/screen.js';
import type { TicketDetailDocument } from '../../src/types.js';
import { idsOf, renderTree } from '../render-tree.js';

const record = (
  id: string,
  identifier: string,
  title: string,
): TicketDetailDocument => ({
  data: {
    type: 'bb_ticket--bb_ticket',
    id,
    attributes: { identifier, title, state: 'coding' },
  },
  included: [],
});

const ALPHA = record('alpha', 'ONE', 'First record');
const BETA = record('beta', 'TWO', 'Second record');
const GAMMA = record('alpha', 'ONE', 'Edited record');

const ticketIdOf = (path: string): string =>
  path.match(/bb_ticket\/bb_ticket\/([^/?]+)/)?.[1] ?? path;

function deferredClient() {
  const pending = new Map<string, PromiseWithResolvers<TicketDetailDocument>>();
  const slot = (id: string) => {
    const existing = pending.get(id);
    if (existing) return existing;
    const created = Promise.withResolvers<TicketDetailDocument>();
    pending.set(id, created);
    return created;
  };
  return {
    get: async (path: string) => slot(ticketIdOf(path)).promise,
    collection: vi.fn(),
    resolve(id: string, document: TicketDetailDocument) {
      slot(id).resolve(document);
      return slot(id).promise;
    },
    reject(id: string, error: Error) {
      slot(id).reject(error);
      return slot(id).promise.catch(() => undefined);
    },
  };
}

const contextFor = (
  ticketId: string,
  extras: Partial<ScreenContext> = {},
): ScreenContext => ({
  sessionGeneration: 1,
  requestDraw: vi.fn(),
  isActive: () => true,
  params: { ticketId },
  nowSeconds: () => 0,
  copyToClipboard: vi.fn(() => 'copied'),
  ...extras,
  services: {
    client: extras.services?.client ?? deferredClient(),
    ...extras.services,
  },
});

const clipboard = (context: ScreenContext): string[] =>
  vi
    .mocked(context.copyToClipboard ?? vi.fn())
    .mock.calls.map(([text]) => text);

const headerText = (
  screen: TicketDetailScreen | TicketCommentsScreen,
  context: ScreenContext,
): string => {
  const header = screen.present(context).header;
  return header ? renderTree(header).join('\n') : '';
};

const contentProps = (
  screen: TicketDetailScreen | TicketCommentsScreen,
  context: ScreenContext,
): TicketContentProps => {
  // The body the kernel mounts IS the content tree built from these props.
  expect(idsOf(screen.present(context).body)).toContain(
    'ticket-content-overview',
  );
  return screen.contentProps(context);
};

const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

describe('production ticket screens are native async screens', () => {
  it('exports Overview, Planning and History as AsyncScreen instances', () => {
    expect(new TicketDetailScreen()).toBeInstanceOf(AsyncScreen);
    expect(new TicketPlanningScreen()).toBeInstanceOf(AsyncScreen);
    expect(new TicketCommentsScreen()).toBeInstanceOf(AsyncScreen);
  });

  it('keeps showcase screens off the default route table', () => {
    const routes = buildRoutes();
    expect(routes.ids()).not.toContain('ticket.react');
    expect(routes.ids()).not.toContain('ticket.react-markdown');
    expect(routes.get('ticket.detail')?.screen).toBeInstanceOf(AsyncScreen);
    expect(routes.get('ticket.planning')?.screen).toBeInstanceOf(AsyncScreen);
    expect(routes.get('ticket.comments')?.screen).toBeInstanceOf(AsyncScreen);
  });
});

describe('deferred loads keep the visible ticket', () => {
  it('keeps B when A is entered first and finishes last', async () => {
    const client = deferredClient();
    const screen = new TicketDetailScreen();
    const first = contextFor('alpha', { services: { client } });
    const second = contextFor('beta', { services: { client } });
    screen.enter(first);
    screen.enter(second);
    await client.resolve('beta', BETA);
    await vi.waitFor(() => expect(screen.state).toBe('ready'));
    expect(screen.document?.data?.id).toBe('beta');
    expect(screen.present(second).title).toContain('TWO');
    expect(headerText(screen, second)).toContain('Second record');
    await client.resolve('alpha', ALPHA);
    await flush();
    expect(screen.document?.data?.id).toBe('beta');
    expect(screen.present(second).title).toContain('TWO');
    expect(headerText(screen, second)).toContain('Second record');
    expect(screen.handleInput('y', second)).toBe(true);
    expect(clipboard(second)).toEqual(['TWO']);
    expect(
      contentProps(screen, second).model.selectableKeys.length,
    ).toBeGreaterThan(0);
  });

  it('ignores a load that settles after reset and after a session change', async () => {
    const client = deferredClient();
    const screen = new TicketDetailScreen();
    const first = contextFor('alpha', { services: { client } });
    screen.enter(first);
    expect(screen.state).toBe('loading');
    screen.reset();
    await client.resolve('alpha', ALPHA);
    await flush();
    expect(screen.state).toBe('idle');
    expect(screen.document).toBeUndefined();

    const nextClient = deferredClient();
    const sessionOne = contextFor('alpha', {
      sessionGeneration: 1,
      services: { client: nextClient },
    });
    const sessionTwo = contextFor('alpha', {
      sessionGeneration: 2,
      services: { client: nextClient },
    });
    screen.enter(sessionOne);
    screen.enter(sessionTwo);
    await nextClient.resolve('alpha', GAMMA);
    await flush();
    expect(screen.state).toBe('ready');
    expect(screen.document?.data?.attributes?.title).toBe('Edited record');
    expect(headerText(screen, sessionTwo)).toContain('Edited record');
  });

  it('drops a load that finishes after leave', async () => {
    const client = deferredClient();
    const screen = new TicketCommentsScreen();
    const context = contextFor('alpha', { services: { client } });
    screen.enter(context);
    expect(screen.busy).toBe(true);
    screen.leave();
    await client.resolve('alpha', ALPHA);
    await flush();
    expect(screen.state).toBe('idle');
    expect(screen.document).toBeUndefined();
    expect(screen.present(context).title).toBe('alpha');
  });

  it('retries after error and then shows the loaded ticket', async () => {
    const pending = Promise.withResolvers<TicketDetailDocument>();
    let calls = 0;
    const client = {
      get: async () => {
        calls += 1;
        if (calls === 1) throw new Error('control plane unavailable');
        return pending.promise;
      },
      collection: vi.fn(),
    };
    const screen = new TicketDetailScreen();
    const context = contextFor('alpha', { services: { client } });
    screen.enter(context);
    await flush();
    expect(screen.state).toBe('error');
    expect(screen.document).toBeUndefined();
    expect(screen.renderNonInteractive(context).join('\n')).toContain(
      'control plane unavailable',
    );
    expect(screen.handleInput('enter', context)).toBe(true);
    expect(screen.state).toBe('loading');
    pending.resolve(ALPHA);
    await flush();
    expect(screen.state).toBe('ready');
    expect(screen.document?.data?.id).toBe('alpha');
    expect(headerText(screen, context)).toContain('First record');
    expect(screen.handleInput('y', context)).toBe(true);
    expect(clipboard(context)).toEqual(['ONE']);
  });

  it('applies a store update during a pending request instead of the stale payload', async () => {
    const client = deferredClient();
    const store = createSessionStore();
    const screen = new TicketDetailScreen();
    const context = contextFor('alpha', { services: { client }, store });
    screen.enter(context);
    expect(screen.state).toBe('loading');
    saveTicket(context, GAMMA);
    await client.resolve('alpha', ALPHA);
    await vi.waitFor(() => expect(screen.state).toBe('ready'));
    expect(screen.document?.data?.attributes?.title).toBe('Edited record');
    expect(headerText(screen, context)).toContain('Edited record');
    expect(screen.handleInput('y', context)).toBe(true);
    expect(clipboard(context)).toEqual(['ONE']);
  });

  it('keeps a modal result when the original load settles afterwards', async () => {
    const client = deferredClient();
    const store = createSessionStore();
    const screen = new TicketDetailScreen();
    const context = contextFor('alpha', { services: { client }, store });
    screen.enter(context);
    expect(screen.state).toBe('loading');
    screen.receiveResult(
      { type: 'ticket-assignment-updated', document: GAMMA },
      context,
    );
    expect(screen.state).toBe('ready');
    expect(screen.document?.data?.attributes?.title).toBe('Edited record');
    await client.resolve('alpha', ALPHA);
    await flush();
    expect(screen.document?.data?.id).toBe('alpha');
    expect(screen.document?.data?.attributes?.title).toBe('Edited record');
    expect(headerText(screen, context)).toContain('Edited record');
    expect(screen.handleInput('y', context)).toBe(true);
    expect(clipboard(context)).toEqual(['ONE']);
  });
});

describe('selection survives a document that drops its entry', () => {
  const withComments = (ids: readonly string[]): TicketDetailDocument => ({
    data: {
      type: 'bb_ticket--bb_ticket',
      id: 'alpha',
      attributes: { identifier: 'ONE', title: 'First record', state: 'coding' },
    },
    included: ids.map((id, index) => ({
      type: 'bb_comment--bb_comment',
      id,
      attributes: {
        bb_comment_type: 'comment',
        author_name: id,
        created: `2026-07-0${index + 1}T10:00:00Z`,
        drupal_internal__id: index + 1,
        body: { value: `body of ${id}` },
      },
    })),
  });

  it('clamps the selection to a remaining comment and keeps it usable', async () => {
    const client = deferredClient();
    const screen = new TicketCommentsScreen();
    const context = contextFor('alpha', { services: { client } });
    screen.enter(context);
    await client.resolve('alpha', withComments(['c1', 'c2', 'c3']));
    await vi.waitFor(() => expect(screen.state).toBe('ready'));
    const keys = screen.contentProps(context).model.selectableKeys;
    expect(screen.select(keys.length - 1, context)).toBe(true);
    const removed = screen.contentProps(context).selectedKey;
    expect(removed).toBe(keys.at(-1));

    screen.receiveResult(
      {
        type: 'ticket-assignment-updated',
        document: withComments(
          ['c1', 'c2', 'c3'].filter((id) => `comment:${id}` !== removed),
        ),
      },
      context,
    );
    const after = screen.contentProps(context);
    expect(after.model.selectableKeys).not.toContain(removed);
    expect(after.model.selectableKeys).toContain(after.selectedKey);
    const shown = screen.present(context);
    expect(shown.rowIds?.[shown.selectedIndex]).toBeDefined();
    expect(screen.handleInput('enter', context)).toBe(true);
  });
});

describe('the content model is built once per document and second', () => {
  it('reuses the projection until the document or the clock moves', async () => {
    const client = deferredClient();
    let now = 100;
    const screen = new TicketDetailScreen();
    const context = contextFor('alpha', {
      services: { client },
      nowSeconds: () => now,
    });
    screen.enter(context);
    await client.resolve('alpha', ALPHA);
    await vi.waitFor(() => expect(screen.state).toBe('ready'));
    const first = screen.contentProps(context).model;
    screen.present(context);
    screen.handleInput('j', context);
    expect(screen.contentProps(context).model).toBe(first);

    now = 101;
    const later = screen.contentProps(context).model;
    expect(later).not.toBe(first);

    screen.receiveResult(
      { type: 'ticket-assignment-updated', document: GAMMA },
      context,
    );
    const edited = screen.contentProps(context).model;
    expect(edited).not.toBe(later);
    expect(headerText(screen, context)).toContain('Edited record');
  });
});
