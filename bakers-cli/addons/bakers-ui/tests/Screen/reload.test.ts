import { describe, expect, it, vi } from 'vitest';
import { lineText } from '../../src/Component/section-list/index.js';
import { ProjectsScreen } from '../../src/Entity/project/Screen/projects-screen.js';
import { RunsScreen } from '../../src/Entity/run/Screen/runs.js';
import type { TicketContentProps } from '../../src/Entity/ticket/Component/ticket-content/index.js';
import { TicketCommentsScreen } from '../../src/Entity/ticket/Screen/ticket-comments.js';
import {
  TicketDetailScreen,
  ticketDetailInputContext,
} from '../../src/Entity/ticket/Screen/ticket-detail.js';
import { TicketsScreen } from '../../src/Entity/ticket/Screen/tickets.js';
import { ContextBag } from '../../src/Routing/context.js';
import type { ScreenContext } from '../../src/Screen/screen.js';
import type { TicketDetailDocument } from '../../src/types.js';
import { renderTree } from '../render-tree.js';
import { routes } from '../tab-bars.js';
import { type FakeClient, fakeClient } from '../test-support.js';

/**
 * WHICH SECTION IS OPEN — BB-346, and no longer a rendered bar.
 *
 * This read the detail bar's text out of the header tree by its node id until the
 * sections became entries of the top-tab registry and the CHROME took over
 * drawing them. What the screen publishes now is a tab LOCATION, which is the
 * same question one indirection closer to the source: it is the value the chrome
 * reads to draw the bar, so these cases cannot disagree with what is on screen.
 */
const openSection = (
  screen: TicketDetailScreen | TicketCommentsScreen,
): string | undefined => routes.tabLocation(screen.id, {})?.tab;

const contentOf = (
  screen: TicketCommentsScreen,
  context: ScreenContext,
): TicketContentProps => screen.contentProps(context);

const expandedBody = (props: TicketContentProps, key: string): string =>
  (props.model.entries.find((entry) => entry.key === key)?.expanded ?? [])
    .map(lineText)
    .join('\n');

// BB-285 — every data screen DECLARES `reload` (spec D2): the one-liner that
// re-triggers AsyncScreen's retry, so the kernel's shared `R` has something to
// call. Each test drives the screen directly with a hand-built context and a
// counting data source: the initial enter() reads ONCE, reload() reads AGAIN,
// and `busy` is true for exactly the in-flight window (AC-1, AC-2).

const PROJECT = { id: 'p1', name: 'bakers', slug: 'bakers' };

const contextFor = (
  services: ScreenContext['services'],
  extras: Partial<ScreenContext> = {},
): ScreenContext => ({
  sessionGeneration: 1,
  requestDraw: vi.fn(),
  isActive: () => true,
  services,
  ...extras,
});

const gets = (client: ReturnType<typeof fakeClient>, prefix: string): number =>
  client.gets.filter((path) => path.startsWith(prefix)).length;

/** Kept as the seam these cases read through. Since BB-292 D6e a list screen
 *  makes exactly ONE read per page, so there is nothing left to filter out and
 *  this is the client itself. */
const listReadsOnly = (client: FakeClient): FakeClient => client;

describe('BB-285 — every data screen declares reload (AC-1)', () => {
  it('ProjectsScreen.reload re-reads and states loading', async () => {
    const client = fakeClient();
    const context = contextFor({ client });
    const screen = new ProjectsScreen();
    screen.enter(context);
    await vi.waitFor(() => expect(screen.busy).toBe(false));
    expect(gets(client, 'bb_conductor/bb_conductor')).toBe(1);

    screen.reload(context);
    expect(screen.busy).toBe(true); // AC-2 — states loading, synchronously
    await vi.waitFor(() => expect(screen.busy).toBe(false));
    expect(gets(client, 'bb_conductor/bb_conductor')).toBe(2);
  });

  it('TicketsScreen.reload re-reads and states loading', async () => {
    const client = fakeClient();
    const context = contextFor(
      { client: listReadsOnly(client) },
      { project: PROJECT },
    );
    const screen = new TicketsScreen();
    screen.enter(context);
    await vi.waitFor(() => expect(screen.busy).toBe(false));
    expect(gets(client, 'bb_ticket/bb_ticket')).toBe(1);

    screen.reload(context);
    expect(screen.busy).toBe(true);
    await vi.waitFor(() => expect(screen.busy).toBe(false));
    expect(gets(client, 'bb_ticket/bb_ticket')).toBe(2);
  });

  it('RunsScreen.reload re-reads and states loading', async () => {
    const client = fakeClient();
    const context = contextFor(
      { client: listReadsOnly(client) },
      { project: PROJECT },
    );
    const screen = new RunsScreen();
    screen.enter(context);
    await vi.waitFor(() => expect(screen.busy).toBe(false));
    expect(gets(client, 'bb_run/bb_run')).toBe(1);

    screen.reload(context);
    expect(screen.busy).toBe(true);
    await vi.waitFor(() => expect(screen.busy).toBe(false));
    expect(gets(client, 'bb_run/bb_run')).toBe(2);
  });

  it('TicketDetailScreen.reload re-reads and states loading', async () => {
    const client = fakeClient();
    const context = contextFor(
      { client },
      { project: PROJECT, params: { ticketId: 't1' } },
    );
    const screen = new TicketDetailScreen();
    screen.enter(context);
    await vi.waitFor(() => expect(screen.busy).toBe(false));
    expect(gets(client, 'bb_ticket/bb_ticket/t1')).toBe(1);

    screen.reload(context);
    expect(screen.busy).toBe(true);
    await vi.waitFor(() => expect(screen.busy).toBe(false));
    expect(gets(client, 'bb_ticket/bb_ticket/t1')).toBe(2);
  });
});

describe('BB-285 — the key stays text where text is typed (AC-5)', () => {
  it('R in the Tickets search is query text, not a reload', async () => {
    // In search mode the screen CONSUMES the printable key, so the kernel's
    // `!handled` binding (spec D3) never fires. The guard pins the consumption
    // itself. The debounce is stubbed out: the debounced server re-query is a
    // search, not a reload, and is not what this test measures.
    const client = fakeClient();
    const context = contextFor(
      { client },
      { project: PROJECT, options: { debounce: () => () => {} } },
    );
    const screen = new TicketsScreen();
    screen.enter(context);
    await vi.waitFor(() => expect(screen.busy).toBe(false));
    const readsBefore = gets(client, 'bb_ticket/bb_ticket');

    expect(screen.handleInput('/', context)).toBe(true);
    expect(screen.handleInput('R', context)).toBe(true);

    // The search echo renders the query — the `R` landed as TEXT, and no
    // re-read was triggered by it.
    expect(renderTree(screen.present(context).body).join('\n')).toContain(
      'search: R',
    );
    expect(screen.present(context).meta).not.toContain('search:');
    expect(gets(client, 'bb_ticket/bb_ticket')).toBe(readsBefore);
  });
});

// BB-285 review defect: `R` on the ticket detail re-read the data and then
// threw the operator back to the Overview tab — tab, selection and expansion
// were lost. The screen's initialization guard keyed on the document OBJECT,
// and every re-read parses a fresh one, so each reload re-initialized. The
// pins below key the expectation to the TICKET (`data.id`): a same-ticket
// re-read keeps the view state, a different ticket still re-initializes.
describe('BB-285 — reload keeps the ticket-detail view state (review defect)', () => {
  // A ticket with two comments: the newest (index 0) is the one a freshly
  // initialized detail expands by default, so expanding the SECOND one is a
  // state the default can never produce on its own.
  const detailDocument = (id: string): TicketDetailDocument => ({
    data: {
      type: 'bb_ticket--bb_ticket',
      id,
      attributes: { identifier: 'BB-1', title: 'Reload keeps the view' },
    },
    included: [
      {
        type: 'bb_comment--bb_comment',
        id: `${id}-c2`,
        attributes: {
          bb_comment_type: 'note',
          author_name: 'ana',
          created: '2026-08-02T00:00:00+00:00',
          drupal_internal__id: 2,
          body: { value: 'newest body' },
        },
      },
      {
        type: 'bb_comment--bb_comment',
        id: `${id}-c1`,
        attributes: {
          bb_comment_type: 'note',
          author_name: 'bob',
          created: '2026-08-01T00:00:00+00:00',
          drupal_internal__id: 1,
          body: { value: 'oldest body' },
        },
      },
    ],
  });

  // Every ticket-detail read returns a FRESH document object — the real
  // client re-parses each response, so object identity changes on every read
  // even when the ticket is the same one.
  const freshDocumentClient = (ticketId: string): FakeClient => {
    const client = fakeClient();
    const passthrough = client.get.bind(client);
    client.get = (path: string, params?: unknown) => {
      if (path.startsWith(`bb_ticket/bb_ticket/${ticketId}`)) {
        client.gets.push(path);
        client.requests.push({ path, params });
        return Promise.resolve(detailDocument(ticketId));
      }
      return passthrough(path, params);
    };
    return client;
  };

  const prefetchContext = (document: TicketDetailDocument): ScreenContext =>
    contextFor(
      { client: fakeClient() },
      {
        project: PROJECT,
        params: { ticketId: 't1' },
        contexts: ContextBag.empty().set(ticketDetailInputContext, {
          document,
        }),
      },
    );

  it('keeps tab, selection and expansion across a same-ticket reload', async () => {
    const client = freshDocumentClient('t1');
    const context = contextFor(
      { client },
      { project: PROJECT, params: { ticketId: 't1' } },
    );
    const screen = new TicketCommentsScreen();
    screen.enter(context);
    await vi.waitFor(() => expect(screen.busy).toBe(false));
    screen.present(context); // the kernel's draw right after the load

    // The state the review reproduced: Comments tab, second entry selected
    // AND expanded.
    // BB-346 — the kernel owns Tab; the screen switches through the seam.
    expect(screen.handleInput('j', context)).toBe(true);
    expect(screen.handleInput(' ', context)).toBe(true);
    const before = screen.present(context);
    const beforeContent = contentOf(screen, context);
    const selectedKey = beforeContent.selectedKey;
    expect(openSection(screen)).toBe('comments');
    expect(before.selectedIndex).toBe(1);
    expect(selectedKey).toBeDefined();
    expect(beforeContent.expandedKeys.has(selectedKey ?? '')).toBe(true);
    expect(expandedBody(beforeContent, selectedKey ?? '')).toContain(
      'oldest body',
    );

    screen.reload(context);
    expect(screen.busy).toBe(true);
    await vi.waitFor(() => expect(screen.busy).toBe(false));

    const after = screen.present(context);
    const afterContent = contentOf(screen, context);
    expect(openSection(screen)).toBe('comments');
    expect(after.selectedIndex).toBe(1);
    expect(afterContent.selectedKey).toBe(selectedKey);
    expect(afterContent.expandedKeys.has(selectedKey ?? '')).toBe(true);
    expect(expandedBody(afterContent, selectedKey ?? '')).toContain(
      'oldest body',
    );
  });

  it('keeps the tab when the edit-return delivers a fresh document of the same ticket', () => {
    const screen = new TicketCommentsScreen();
    const context = prefetchContext(detailDocument('t1'));
    screen.enter(context);
    screen.select(1, context);
    expect(openSection(screen)).toBe('comments');

    // The assignment edit returns a RE-PARSED document of the same ticket.
    screen.receiveResult(
      { type: 'ticket-assignment-updated', document: detailDocument('t1') },
      context,
    );
    // The kernel's draw after the return, and the reason this case can fail at
    // all: `present` is what calls `initialize`, and `initialize` is where the
    // BB-285 defect lived — keyed on the document OBJECT it re-initialized on
    // every fresh parse of the same ticket and reset tab, selection and
    // expansion with it. Reading the route location calls no loader, so
    // without this line the case stays green against the defect it guards.
    screen.present(context);
    expect(openSection(screen)).toBe('comments');
  });

  it('still re-initializes when the document is a different ticket', () => {
    const screen = new TicketCommentsScreen();
    const context = prefetchContext(detailDocument('t1'));
    screen.enter(context);
    screen.select(1, context);
    expect(openSection(screen)).toBe('comments');

    const other = prefetchContext(detailDocument('t2'));
    screen.enter(other);
    const view = screen.present(other);
    expect(openSection(screen)).toBe('comments');
    expect(view.selectedIndex).toBe(0);
  });
});
