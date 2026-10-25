import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { ticketInputContext } from '../../src/Entity/ticket/Data/input.js';
import { register, resetCollector } from '../../src/Extension/store.js';
import { runTicketTui } from '../../src/Kernel/tui-kernel.js';
import { textNode } from '../../src/lib/vnode.js';
import type { RouteMetadata } from '../../src/Routing/route.js';
import { AsyncScreen } from '../../src/Screen/async-screen.js';
import type {
  Collection,
  DropshClient,
  RendererServices,
  ResolvedRoute,
  ResourceWriteBody,
} from '../../src/types.js';
import {
  COMMENT_SOURCE_LINES,
  commentFinal,
  commentFirst,
  commentId,
  commentMiddle,
  DESCRIPTION_FINAL,
  DESCRIPTION_FIRST,
  DESCRIPTION_LINE_COUNT,
  DESCRIPTION_MIDDLE,
  fixtureSize,
  COMMENT_COUNT as LONG_COMMENT_COUNT,
  LONG_TICKET_ID,
  longComments,
  longDescription,
  longTicketDocument,
} from '../fixtures/long-ticket.js';
import { type BootedTui, bootTui, settle } from '../tui-harness.js';

const TICKET = 'ticket-react-content';
const IDENTIFIER = 'DOC-1';
const TITLE = 'Ordinary ticket content';
const DESCRIPTION_START = 'DESCRIPTION-START-MARKER';
const DESCRIPTION_END = 'DESCRIPTION-END-MARKER';
const COMMENT_COUNT = 16;
const LAST_AUTHOR = `COMMENT-AUTHOR-${String(COMMENT_COUNT - 1).padStart(2, '0')}`;
const PAGE_DOWN = '\x1b[6~';
const PAGE_UP = '\x1b[5~';
const USER = 'user-pat';
const CONDUCTOR = 'cond-runner';
const PROJECT = 'project-1';

const emptyCollection = (): Collection => {
  const collection: Collection = {
    where: () => collection,
    sort: () => collection,
    page: () => collection,
    first: async () => null,
    list: async () => [],
  };
  return collection;
};

const description = [
  DESCRIPTION_START,
  ...Array.from({ length: 498 }, (_line, index) => `description line ${index}`),
  DESCRIPTION_END,
].join('\n');

const summaryBody = [
  ...Array.from({ length: 7 }, (_line, index) => `summary line ${index}`),
  'SUMMARY-TAIL-MARKER',
].join('\n');

const comments = Array.from({ length: COMMENT_COUNT }, (_item, index) => ({
  type: 'bb_comment--bb_comment',
  id: `comment-${String(index).padStart(2, '0')}`,
  attributes: {
    drupal_internal__id: 200 - index,
    bb_comment_type: 'comment',
    author_name: `COMMENT-AUTHOR-${String(index).padStart(2, '0')}`,
    created: `2026-08-20T${String(23 - index).padStart(2, '0')}:00:00Z`,
    body: { value: `COMMENT-BODY-${String(index).padStart(2, '0')}` },
  },
}));

const document = {
  data: {
    id: TICKET,
    type: 'bb_ticket--bb_ticket',
    attributes: {
      identifier: IDENTIFIER,
      title: TITLE,
      state: 'coding',
      description: { value: description },
    },
    relationships: {
      project_id: { data: { id: PROJECT } },
      assignee_user_id: { data: { id: USER } },
      conductor_id: { data: { id: CONDUCTOR } },
      labels: { data: [] },
    },
  },
  included: [
    {
      type: 'bb_comment--bb_comment',
      id: 'summary-1',
      attributes: {
        drupal_internal__id: 1,
        bb_comment_type: 'summary',
        author_name: 'pat',
        created: '2026-07-01T10:00:00Z',
        body: { value: summaryBody },
      },
    },
    ...comments,
    {
      id: USER,
      type: 'user--user',
      attributes: { display_name: 'pat' },
    },
    {
      id: CONDUCTOR,
      type: 'bb_conductor--bb_conductor',
      attributes: { label: 'runner-1' },
    },
  ],
};

function optionResource(
  id: string,
  attributes: Record<string, unknown>,
  projectId?: string,
) {
  return {
    id,
    type: 't',
    attr: (key: string) => attributes[key],
    rel: () => projectId ?? null,
    rels: () => [],
  };
}

function services(): { services: RendererServices; write: DropshClient } {
  const client: DropshClient = {
    collection: emptyCollection,
    get: async (path: string) => {
      if (path.startsWith(`bb_ticket/bb_ticket/${TICKET}`)) return document;
      return { data: [] };
    },
    update: async () => ({}),
  };
  const write: DropshClient = {
    collection: (type: string) => {
      const rows =
        type === 'user'
          ? [optionResource(USER, { display_name: 'pat' })]
          : type === 'bb_conductor'
            ? [optionResource(CONDUCTOR, { label: 'runner-1' }, PROJECT)]
            : [];
      const collection: Collection = {
        where: () => collection,
        sort: () => collection,
        page: () => collection,
        first: async () => rows[0] ?? null,
        list: async () => rows as never,
      };
      return collection;
    },
    get: async () => ({ data: [] }),
    update: async (_type: string, _id: string, _body: ResourceWriteBody) => ({
      data: { type: _type, id: _id },
    }),
  };
  return {
    services: { client, baseUrl: 'https://example.test' },
    write,
  };
}

const boot = (columns = 80, rows = 24): Promise<BootedTui> => {
  const { services: bag, write } = services();
  return bootTui({
    services: bag,
    columns,
    rows,
    tui: {
      route: { screen: 'ticket', ticketId: TICKET, view: 'full' },
      writeClient: write,
    },
  });
};

const quit = async (tui: BootedTui): Promise<void> => {
  tui.mockInput.pressKey('q');
  await tui.running;
  await tui.stop();
};

const clickText = async (tui: BootedTui, needle: string): Promise<boolean> => {
  const row = tui.rows().findIndex((line) => line.includes(needle));
  if (row < 0) return false;
  const column = Math.max(0, (tui.rows()[row] ?? '').indexOf(needle));
  await tui.mockMouse.click(column + 1, row);
  await settle();
  await tui.renderOnce();
  return true;
};

const shutdown = async (tui: BootedTui): Promise<void> => {
  tui.mockInput.pressKey('\x1b');
  await settle();
  tui.mockInput.pressKey('q');
  await tui.running.catch(() => undefined);
  await tui.stop();
};

const page = async (
  tui: BootedTui,
  key: string,
  times: number,
): Promise<void> => {
  for (let step = 0; step < times; step += 1) tui.mockInput.pressKey(key);
  await settle();
  await tui.renderOnce();
};

beforeEach(() => resetCollector());
afterEach(() => resetCollector());

describe('production ticket content', () => {
  it('paints Overview natively without a showcase contribution', async () => {
    const tui = await boot();
    try {
      const frame = tui.frame();
      expect(frame).toContain(IDENTIFIER);
      expect(frame).toContain(TITLE);
      expect(frame).toContain('[Overview]');
      expect(frame).toContain('* Summary');
      expect(frame).toContain('PgUp/PgDn');
      expect(frame).not.toContain('Example document');
      expect(frame).not.toContain('Click to count');
      expect(frame).not.toContain('Native screen experiment');
      await tui.press('\t');
      expect(tui.frame()).toContain('[Planning]');
      expect(tui.frame()).toContain('PgUp/PgDn');
      expect(tui.frame()).toContain(IDENTIFIER);
      await tui.press('\t');
      expect(tui.frame()).toContain('[History]');
      expect(tui.frame()).toContain('PgUp/PgDn');
      await tui.press('q');
      await tui.running;
    } finally {
      await tui.stop();
    }
  });

  it('keeps the freeze hint on screen at 80 columns', async () => {
    const tui = await boot(80, 24);
    try {
      expect(tui.frame()).toContain('f:Freeze');
      await tui.press('q');
      await tui.running;
    } finally {
      await tui.stop();
    }
  });

  it('pages a long expanded description to its end and keeps header identity', async () => {
    const tui = await boot(80, 24);
    try {
      await tui.press('j');
      expect(tui.frame()).toContain('* Description');
      expect(tui.frame()).not.toContain(DESCRIPTION_END);
      expect(tui.frame()).toContain('[Overview]');
      for (
        let step = 0;
        step < 80 && !tui.frame().includes(DESCRIPTION_START);
        step += 1
      ) {
        tui.mockInput.pressKey(PAGE_DOWN);
        await settle();
        await tui.renderOnce();
      }
      expect(tui.frame()).toContain(DESCRIPTION_START);
      expect(tui.frame()).not.toContain(DESCRIPTION_END);
      for (
        let step = 0;
        step < 80 && !tui.frame().includes(DESCRIPTION_END);
        step += 1
      ) {
        tui.mockInput.pressKey(PAGE_DOWN);
        await settle();
        await tui.renderOnce();
      }
      expect(tui.frame()).toContain(DESCRIPTION_END);
      expect(tui.frame()).toContain(IDENTIFIER);
      expect(tui.frame()).toContain('[Overview]');
      tui.resize(80, 40);
      await settle();
      await tui.renderOnce();
      expect(tui.frame()).toContain(IDENTIFIER);
      expect(tui.frame()).toContain('[Overview]');
      await page(tui, PAGE_UP, 80);
      expect(tui.frame()).toContain('* Summary');
      expect(tui.frame()).toContain(IDENTIFIER);
      expect(tui.frame()).toContain('[Overview]');
      await quit(tui);
    } finally {
      await tui.stop();
    }
    // Two page loops of up to 80 settle/render cycles each sit right at the
    // 5s default and flake under CI load; give this paging walk real headroom.
  }, 20_000);

  it('scrolls an offscreen History comment header into view when it is selected', async () => {
    const tui = await boot(80, 24);
    try {
      await tui.press('\t');
      await tui.press('\t');
      expect(tui.frame()).toContain('[History]');
      expect(tui.frame()).toContain('COMMENT-AUTHOR-00');
      expect(tui.frame()).not.toContain(LAST_AUTHOR);
      await tui.press('G');
      expect(tui.frame()).toContain(LAST_AUTHOR);
      expect(tui.frame()).toContain('[History]');
      expect(tui.frame()).toContain(IDENTIFIER);
      await quit(tui);
    } finally {
      await tui.stop();
    }
  });

  it('collapses an open Summary exactly once from the keyboard', async () => {
    const tui = await boot(80, 24);
    try {
      expect(tui.frame()).toContain('summary line 0');
      await tui.press('\r');
      expect(tui.frame()).not.toContain('summary line 0');
      await tui.press('\r');
      expect(tui.frame()).toContain('summary line 0');
      await quit(tui);
    } finally {
      await tui.stop();
    }
  });

  it('collapses an open Summary exactly once per header click', async () => {
    const tui = await boot(80, 24);
    try {
      expect(tui.frame()).toContain('summary line 0');
      expect(await clickText(tui, '* Summary')).toBe(true);
      expect(tui.frame()).not.toContain('summary line 0');
      expect(await clickText(tui, '* Summary')).toBe(true);
      expect(tui.frame()).toContain('summary line 0');
      await quit(tui);
    } finally {
      await tui.stop();
    }
  });

  it('lets the assignment modal consume keys and returns to a single content binding', async () => {
    const tui = await boot(80, 24);
    try {
      expect(tui.frame()).toContain('* Summary');
      expect(tui.frame()).not.toContain(DESCRIPTION_END);
      await tui.press('e');
      expect(tui.frame()).toContain('Edit ticket');
      await page(tui, PAGE_DOWN, 20);
      await tui.press('j');
      await tui.press(' ');
      expect(tui.frame()).toContain('Edit ticket');
      expect(tui.frame()).not.toContain(DESCRIPTION_END);
      await tui.press('\x1b');
      expect(tui.frame()).not.toContain('Edit ticket');
      expect(tui.frame()).toContain('[Overview]');
      expect(tui.frame()).toContain('* Summary');
      expect(tui.frame()).not.toContain(DESCRIPTION_END);
      expect(tui.frame()).toContain('summary line 0');
      expect(await clickText(tui, '* Summary')).toBe(true);
      expect(tui.frame()).not.toContain('summary line 0');
      await quit(tui);
    } finally {
      await tui.stop();
    }
  });
});

class ExtraTabScreen extends AsyncScreen<string> {
  static readonly route = {
    id: 'ticket.extra',
    path: '/tickets/:ticketId/extra',
    parent: 'project.tickets',
    tab: { id: 'extra', label: 'Extra', scope: 'ticket', weight: 80 },
    fallback: { routeId: 'project.dashboard' },
    context: ticketInputContext,
  } satisfies RouteMetadata;
  readonly id = ExtraTabScreen.route.id;
  readonly frameId = 'ticket';
  protected load() {
    return Promise.resolve('Contributed extra tab body');
  }
  protected renderLoading() {
    return ['Loading extra'];
  }
  protected renderReady(data: string) {
    return textNode({ id: 'extra-content', content: data });
  }
  protected chrome() {
    return { title: 'Extra tab' };
  }
}

const SHOWCASE = [
  'Example document',
  'Click to count',
  'Native screen experiment',
];

const hasControlBytes = (text: string): boolean => {
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code === 0x1b || code === 0x9b || code === 0x9d) return true;
  }
  return false;
};

type WalkNode = {
  id?: string;
  getChildren?: () => WalkNode[];
  eventNames?: () => unknown[];
  listenerCount?: (event: unknown) => number;
};

const walkTree = (
  node: WalkNode | undefined,
): { renderables: number; listeners: number; ids: string[] } => {
  if (!node) return { renderables: 0, listeners: 0, ids: [] };
  let listeners = 0;
  if (
    typeof node.eventNames === 'function' &&
    typeof node.listenerCount === 'function'
  ) {
    for (const event of node.eventNames())
      listeners += node.listenerCount(event);
  }
  const ids = typeof node.id === 'string' && node.id !== '' ? [node.id] : [];
  let renderables = 1;
  for (const child of node.getChildren?.() ?? []) {
    const next = walkTree(child);
    renderables += next.renderables;
    listeners += next.listeners;
    ids.push(...next.ids);
  }
  return { renderables, listeners, ids };
};

const liveCounts = (tui: BootedTui) => {
  const tree = walkTree(tui.renderer.root as unknown as WalkNode);
  return {
    renderables: tree.renderables,
    listeners: tree.listeners,
    ticketRows: tree.ids.filter((id) => id.startsWith('ticket-content-'))
      .length,
  };
};

const piped = async (
  route: ResolvedRoute,
  bag: RendererServices,
): Promise<string> => {
  const chunks: string[] = [];
  const realStdin = process.stdin;
  const realStdout = process.stdout;
  const swap = (name: 'stdin' | 'stdout', value: unknown): void => {
    Object.defineProperty(process, name, { value, configurable: true });
  };
  swap('stdin', { isTTY: false });
  swap('stdout', {
    isTTY: false,
    columns: 120,
    rows: 40,
    write: (chunk: string): boolean => {
      chunks.push(String(chunk));
      return true;
    },
  });
  try {
    await runTicketTui({}, {}, bag, { route });
  } finally {
    swap('stdin', realStdin);
    swap('stdout', realStdout);
  }
  return chunks.join('');
};

const ticketDocument = (
  attributes: Record<string, unknown>,
  included: unknown[] = [],
  id = 'ticket-empty',
) => ({
  data: {
    id,
    type: 'bb_ticket--bb_ticket',
    attributes: {
      identifier: 'DOC-EMPTY',
      title: 'Empty fields',
      state: 'coding',
      ...attributes,
    },
    relationships: { labels: { data: [] } },
  },
  included,
});

const bootDocument = (
  document: { data: { id: string } },
  columns = 80,
  rows = 24,
): Promise<BootedTui> => {
  const client: DropshClient = {
    collection: emptyCollection,
    get: async (path: string) =>
      path.includes(document.data.id) ? document : { data: [] },
    update: async () => ({}),
  };
  return bootTui({
    services: { client, baseUrl: 'https://example.test' },
    columns,
    rows,
    tui: {
      route: { screen: 'ticket', ticketId: document.data.id, view: 'full' },
    },
  });
};

describe('long ticket fixture', () => {
  it('is deterministic and sized', () => {
    const first = longTicketDocument();
    const second = longTicketDocument();
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(longDescription().split('\n')).toHaveLength(DESCRIPTION_LINE_COUNT);
    expect(longComments()).toHaveLength(LONG_COMMENT_COUNT);
    expect(longComments()[0]?.id).toBe(commentId(0));
    expect(
      String(longComments()[0]?.attributes.body.value).split('\n'),
    ).toHaveLength(COMMENT_SOURCE_LINES);
    expect(fixtureSize.commentSourceTotal).toBe(2000);
    expect(longDescription()).toContain(DESCRIPTION_FIRST);
    expect(longDescription()).toContain(DESCRIPTION_MIDDLE);
    expect(longDescription()).toContain(DESCRIPTION_FINAL);
    expect(longComments()[0]?.attributes.body.value).toContain(commentFirst(0));
    expect(longComments()[25]?.attributes.body.value).toContain(
      commentMiddle(25),
    );
    expect(longComments()[49]?.attributes.body.value).toContain(
      commentFinal(49),
    );
  });
});

describe('resize while scrolled', () => {
  it(
    'keeps identity across 60x20 → 140x45 → 80x24 and still reaches markers',
    async () => {
      const document = longTicketDocument();
      const tui = await bootDocument(document, 60, 20);
      const reveal = async (key: string, needle: string): Promise<void> => {
        for (let step = 0; step < 200; step += 1) {
          if (tui.frame().includes(needle)) return;
          tui.mockInput.pressKey(key);
          await tui.renderOnce();
        }
        expect(tui.frame()).toContain(needle);
      };
      try {
        expect(tui.frame()).toContain('BB-518');
        expect(tui.frame()).toContain('[Overview]');
        expect(tui.frame()).toContain('description source line 1');
        await reveal(PAGE_DOWN, 'DESCRIPTION-MIDDLE');
        expect(tui.frame()).toContain('BB-518');
        expect(tui.frame()).toContain('[Overview]');
        tui.resize(140, 45);
        await settle();
        await tui.renderOnce();
        expect(tui.frame()).toContain('BB-518');
        expect(tui.frame()).toContain('[Overview]');
        // Assigned/Created by are now on the meta line without prefixes.
        expect(tui.frame()).toContain('coding');
        await reveal(PAGE_DOWN, 'DESCRIPTION-FINAL');
        await reveal(PAGE_UP, 'DESCRIPTION-FIRST');
        await reveal(PAGE_DOWN, 'DESCRIPTION-MIDDLE');
        tui.resize(80, 24);
        await settle();
        await tui.renderOnce();
        expect(tui.frame()).toContain('BB-518');
        expect(tui.frame()).toContain('[Overview]');
        expect(tui.frame()).toMatch(/q:quit/i);
        expect(tui.rows()[0] ?? '').not.toMatch(/q:quit/i);
        await quit(tui);
      } finally {
        await tui.stop();
      }
    },
    { timeout: 20_000 },
  );
});

describe('empty and missing ticket bodies', () => {
  it('shows No description. for absent, empty and whitespace-only bodies', async () => {
    for (const description of [
      undefined,
      '',
      { value: '' },
      { value: '  \n\t' },
    ]) {
      const document = ticketDocument(
        description === undefined ? {} : { description },
      );
      const tui = await bootDocument(document);
      try {
        expect(tui.frame()).toContain('No description.');
        expect(tui.frame()).not.toContain('Example document');
        await quit(tui);
      } finally {
        await tui.stop();
      }
    }
  });

  it('shows No comments. when History has none', async () => {
    const tui = await bootDocument(ticketDocument({ description: 'body' }));
    try {
      await tui.press('\t');
      await tui.press('\t');
      expect(tui.frame()).toContain('[History]');
      expect(tui.frame()).toContain('No comments.');
      await quit(tui);
    } finally {
      await tui.stop();
    }
  });

  it('shows No comment content. for a blank comment body', async () => {
    const document = ticketDocument({ description: 'body' }, [
      {
        type: 'bb_comment--bb_comment',
        id: 'blank-comment',
        attributes: {
          drupal_internal__id: 1,
          bb_comment_type: 'comment',
          author_name: 'pat',
          created: '2026-08-20T12:00:00Z',
          body: { value: '  \n' },
        },
      },
    ]);
    const tui = await bootDocument(document);
    try {
      await tui.press('\t');
      await tui.press('\t');
      expect(tui.frame()).toContain('[History]');
      expect(tui.frame()).toContain('No comment content.');
      await quit(tui);
    } finally {
      await tui.stop();
    }
  });

  it('shows named empty Planning documents when spec and plan are missing', async () => {
    const tui = await bootDocument(
      ticketDocument({ description: 'body' }),
      80,
      40,
    );
    try {
      await tui.press('\t');
      expect(tui.frame()).toContain('[Planning]');
      expect(tui.frame()).toContain('No spec comment.');
      expect(tui.frame()).not.toContain('No plan comment.');
      expect(tui.frame()).not.toContain('No test comment.');
      await quit(tui);
    } finally {
      await tui.stop();
    }
  });
});

describe('noninteractive ticket output', () => {
  const bag: RendererServices = {
    client: {
      collection: emptyCollection,
      get: async () => longTicketDocument(),
      update: async () => ({}),
    },
    baseUrl: 'https://example.test',
  };

  it.each([
    'full',
    'teaser',
    'board_card',
  ] as const)('prints %s without control bytes or showcase copy', async (view) => {
    const text = await piped(
      { screen: 'ticket', ticketId: LONG_TICKET_ID, view },
      bag,
    );
    expect(text).toContain('BB-518');
    expect(text).toContain('Long ticket content fixture');
    expect(hasControlBytes(text)).toBe(false);
    for (const banned of SHOWCASE) expect(text).not.toContain(banned);
    if (view === 'full') {
      expect(text).toContain(DESCRIPTION_FIRST);
      expect(text).toContain(DESCRIPTION_FINAL);
      expect(text).toContain(commentFirst(0));
    } else {
      expect(text).not.toContain(DESCRIPTION_FINAL);
    }
  });
});

describe('native edit save and cancel keep expansion', () => {
  const optionResource = (
    id: string,
    attributes: Record<string, unknown>,
    projectId?: string,
  ) => ({
    id,
    type: 't',
    attr: (key: string) => attributes[key],
    rel: () => projectId ?? null,
    rels: () => [],
  });

  const writeClient = (): DropshClient => ({
    collection: (type: string) => {
      const rows =
        type === 'user'
          ? [optionResource(USER, { display_name: 'pat' })]
          : type === 'bb_conductor'
            ? [optionResource(CONDUCTOR, { label: 'runner-1' }, PROJECT)]
            : [];
      const collection: Collection = {
        where: () => collection,
        sort: () => collection,
        page: () => collection,
        first: async () => rows[0] ?? null,
        list: async () => rows as never,
      };
      return collection;
    },
    get: async () => ({ data: [] }),
    update: async (type: string, id: string) => ({ data: { type, id } }),
  });

  it('keeps Description expanded after keyboard cancel, keyboard save and a native tab click', async () => {
    const { services: bag } = services();
    const tui = await bootTui({
      services: bag,
      columns: 80,
      rows: 24,
      tui: {
        route: { screen: 'ticket', ticketId: TICKET, view: 'full' },
        writeClient: writeClient(),
      },
    });
    try {
      expect(tui.frame()).toContain('* Summary');
      await tui.press('e');
      expect(tui.frame()).toContain('Edit ticket');
      await tui.press('\x1b');
      expect(tui.frame()).not.toContain('Edit ticket');
      expect(tui.frame()).toContain('* Summary');
      expect(tui.frame()).toContain('[Overview]');
      await tui.press('e');
      await tui.press('\x13');
      expect(tui.frame()).not.toContain('[ Save ]');
      expect(tui.frame()).toContain('* Summary');
      const tabRow = tui
        .rows()
        .findIndex((line) => line.includes('[Overview]'));
      const planningCol = (tui.rows()[tabRow] ?? '').indexOf('Planning');
      expect(tabRow).toBeGreaterThan(-1);
      expect(planningCol).toBeGreaterThan(-1);
      await tui.mockMouse.click(planningCol + 1, tabRow);
      await settle();
      await tui.renderOnce();
      expect(tui.frame()).toContain('[Planning]');
      await tui.press('\x1b[Z');
      expect(tui.frame()).toContain('[Overview]');
      expect(tui.frame()).toContain('* Summary');
    } finally {
      await shutdown(tui);
    }
  });
});

describe('built-in tabs, contributed tab, reload and exit', () => {
  it('cycles built-in tabs plus one contributed tab, reloads, and exits', async () => {
    resetCollector();
    register('test/extra', (api) => api.add(ExtraTabScreen));
    const tui = await boot(140, 24);
    try {
      const tabs = [
        '[Overview]',
        '[Planning]',
        '[History]',
        '[Runs]',
        '[Extra]',
      ];
      for (const label of tabs) {
        expect(tui.frame()).toContain(label.replace('[', '').replace(']', ''));
      }
      expect(tui.frame()).toContain('[Overview]');
      await tui.press('\t');
      expect(tui.frame()).toContain('[Planning]');
      await tui.press('\t');
      expect(tui.frame()).toContain('[History]');
      await tui.press('\t');
      expect(tui.frame()).toContain('[Runs]');
      await tui.press('\t');
      expect(tui.frame()).toContain('[Extra]');
      expect(tui.frame()).toContain('Contributed extra tab body');
      await tui.press('\t');
      expect(tui.frame()).toContain('[Overview]');
      expect(tui.frame()).toContain(IDENTIFIER);
      await tui.press('R');
      expect(tui.frame()).toContain('[Overview]');
      expect(tui.frame()).toContain(IDENTIFIER);
      await tui.press('q');
      await tui.running;
      expect(tui.renderer.root.getChildren()).toHaveLength(0);
      await tui.renderOnce();
    } finally {
      tui.mockInput.pressKey('q');
      await tui.running.catch(() => undefined);
      await tui.stop();
      resetCollector();
    }
  });

  it.each([
    'q',
    '\x03',
  ])('leaves the caller-owned renderer usable after %j', async (key) => {
    const tui = await boot();
    try {
      expect(tui.frame()).toContain(IDENTIFIER);
      tui.mockInput.pressKey(key);
      await tui.running;
      expect(tui.renderer.root.getChildren()).toHaveLength(0);
      await tui.renderOnce();
    } finally {
      await tui.stop();
    }
  });
});

describe('100-visit cleanup', () => {
  const listRow = {
    id: TICKET,
    type: 'bb_ticket--bb_ticket',
    attributes: {
      identifier: IDENTIFIER,
      title: TITLE,
      state: 'coding',
      derived_status: 'idle',
      workflow: 'bb_work',
    },
    relationships: { labels: { data: [] } },
  };
  const statsDoc = {
    data: {
      type: 'bakers-statistics',
      id: PROJECT,
      attributes: {
        generated: '2026-08-02T10:05:57+00:00',
        windows: { day: 86400, week: 604800, month: 2592000 },
        tickets: { total: { day: 0, week: 0, month: 0 }, by_user: [] },
        runs: { total: { day: 0, week: 0, month: 0 }, by_user: [] },
      },
    },
  };

  const listServices = (
    ticketGet: () => Promise<unknown>,
  ): RendererServices => {
    const client: DropshClient = {
      collection: emptyCollection,
      get: async (path: string) => {
        if (path === 'bakers/statistics') return statsDoc;
        if (path === 'bb_ticket/bb_ticket')
          return { data: [listRow], included: [] };
        if (path.startsWith(`bb_ticket/bb_ticket/${TICKET}`))
          return ticketGet();
        return { data: [] };
      },
      update: async () => ({}),
    };
    return { client, writeClient: client, baseUrl: 'https://example.test' };
  };

  const openList = async (): Promise<BootedTui> => {
    const tui = await bootTui({
      services: listServices(async () => document),
      columns: 120,
      rows: 40,
      tui: {
        route: {
          screen: 'project',
          projectId: PROJECT,
          projectName: 'bakers',
        },
      },
    });
    await tui.press('\t');
    return tui;
  };

  it(
    'returns subscription, effect and renderable counts to the list baseline',
    async () => {
      const tui = await openList();
      try {
        expect(tui.frame()).toContain(IDENTIFIER);
        const baseline = liveCounts(tui);
        expect(baseline.ticketRows).toBe(0);
        const snapshots: Record<number, ReturnType<typeof liveCounts>> = {};
        let warm: ReturnType<typeof liveCounts> | undefined;
        for (let visit = 1; visit <= 100; visit += 1) {
          await tui.press('\r');
          expect(tui.frame()).toContain(TITLE);
          expect(tui.frame()).toContain('[Overview]');
          await tui.press('\x1b');
          expect(tui.frame()).toContain(IDENTIFIER);
          expect(tui.frame()).not.toContain('[Overview]');
          const after = liveCounts(tui);
          expect(after.ticketRows, 'ticket rows must not survive leave').toBe(
            0,
          );
          if (visit === 1) warm = after;
          if (visit === 10 || visit === 50 || visit === 100) {
            snapshots[visit] = after;
            expect(after.renderables).toBe(warm?.renderables);
            expect(after.listeners).toBe(warm?.listeners);
          }
        }
        expect(snapshots[10]?.renderables).toBe(snapshots[50]?.renderables);
        expect(snapshots[50]?.renderables).toBe(snapshots[100]?.renderables);
        expect(snapshots[50]?.listeners).toBe(snapshots[100]?.listeners);
        await quit(tui);
      } finally {
        await tui.stop();
      }
    },
    { timeout: 120_000 },
  );

  it('does not paint retired ticket content when a delayed load finishes', async () => {
    const pending = Promise.withResolvers<unknown>();
    const tui = await bootTui({
      services: listServices(() => pending.promise),
      columns: 120,
      rows: 40,
      tui: {
        route: {
          screen: 'project',
          projectId: PROJECT,
          projectName: 'bakers',
        },
      },
    });
    try {
      await tui.press('\t');
      expect(tui.frame()).toContain(IDENTIFIER);
      await tui.press('\r');
      expect(tui.frame()).toContain('Loading ticket');
      await tui.press('\x1b');
      expect(tui.frame()).toContain(IDENTIFIER);
      expect(tui.frame()).not.toContain('[Overview]');
      pending.resolve(document);
      await settle();
      await tui.renderOnce();
      expect(tui.frame()).toContain(IDENTIFIER);
      expect(tui.frame()).not.toContain('[Overview]');
      expect(tui.frame()).not.toContain(DESCRIPTION_START);
      await quit(tui);
    } finally {
      pending.resolve(document);
      await tui.stop();
    }
  });
});

describe('visit-local layout and refresh', () => {
  const rowOf = (tui: BootedTui, needle: string): number =>
    tui.rows().findIndex((line) => line.includes(needle));

  it('switches the sidebar beside or below the documents at 100 columns and keeps its nodes', async () => {
    const tui = await boot(100, 40);
    try {
      const sidebar = () =>
        tui.renderer.root.findDescendantById('ticket-content-overview-sidebar');
      const before = sidebar();
      expect(before).toBeDefined();
      // Side by side the sidebar takes the right 30%; stacked it starts at
      // the left edge of the body.
      const column = () => {
        const row = tui.rows()[rowOf(tui, '[Details]')] ?? '';
        return row.indexOf('[Details]');
      };
      expect(column()).toBeGreaterThan(60);
      for (const columns of [99, 100, 99]) {
        tui.resize(columns, 40);
        await settle();
        await tui.renderOnce();
        if (columns >= 100) expect(column()).toBeGreaterThan(60);
        else expect(column()).toBeLessThan(12);
        // One tree for both widths: the same renderable, re-laid out.
        expect(sidebar() === before).toBe(true);
      }
      await quit(tui);
    } finally {
      await tui.stop();
    }
  });

  it('keeps the chosen sidebar pane through a resize and resets it on re-entry', async () => {
    const tui = await boot(120, 40);
    try {
      expect(tui.frame()).toContain('[Details]');
      expect(await clickText(tui, ' Related ')).toBe(true);
      expect(tui.frame()).toContain('[Related]');
      tui.resize(140, 40);
      await settle();
      await tui.renderOnce();
      expect(tui.frame()).toContain('[Related]');
      await tui.press('\t');
      expect(tui.frame()).toContain('[Planning]');
      await tui.press('\x1b[Z');
      expect(tui.frame()).toContain('[Overview]');
      expect(tui.frame()).toContain('[Details]');
      expect(tui.frame()).not.toContain('[Related]');
      await quit(tui);
    } finally {
      await tui.stop();
    }
  });
});
