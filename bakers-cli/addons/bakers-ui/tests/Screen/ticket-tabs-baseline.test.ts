import { ticketDetailInputContext as addonTicketInput } from '@bakers-build/addon-bakers-ui/ui';
import { describe, expect, it, vi } from 'vitest';
import { ArtifactsTabScreen } from '../../../bakers-ui-artifacts/src/panel.js';
import { formatActionLadder } from '../../src/Component/footer-actions/index.js';
import {
  flattenSections,
  type Section,
} from '../../src/Component/section-list/index.js';
import { type ListTable, listTableRows } from '../../src/Entity/collection.js';
import { TicketAddonsScreen } from '../../src/Entity/ticket/Screen/ticket-addons.js';
import { TicketCommentsScreen } from '../../src/Entity/ticket/Screen/ticket-comments.js';
import {
  TicketDetailScreen,
  ticketDetailInputContext,
} from '../../src/Entity/ticket/Screen/ticket-detail.js';
import { TicketPlanningScreen } from '../../src/Entity/ticket/Screen/ticket-planning.js';
import { TicketRunsScreen } from '../../src/Entity/ticket/Screen/ticket-runs.js';
import { messageTree } from '../../src/lib/vnode.js';
import { ContextBag } from '../../src/Routing/context.js';
import type { RouteMetadata } from '../../src/Routing/route.js';
import { AsyncScreen } from '../../src/Screen/async-screen.js';
import type { ScreenContext } from '../../src/Screen/screen.js';
import type { TicketDetailDocument } from '../../src/types.js';
import { pipeReport } from '../pipe-report.js';

const TABS = [
  'overview',
  'planning',
  'comments',
  'runs',
  'bakers/artifacts',
  'addons',
] as const;

const KEYS = [
  'y',
  'Y',
  's',
  'x',
  'l',
  't',
  'f',
  'enter',
  ' ',
  'j',
  'k',
  'up',
  'down',
  'g',
  'G',
  'e',
  'tab',
] as const;

const document: TicketDetailDocument = {
  data: {
    type: 'bb_ticket--bb_ticket',
    id: 'ticket-502',
    attributes: {
      identifier: 'BB-502',
      title: 'Make contributed ticket tabs first-class screens',
      state: 'coding',
      description: { value: 'Keep the current surface stable.' },
      branch_name: 'feat/bb-502',
      base_branch: 'develop',
    },
    relationships: {
      comments: { data: [{ id: 'comment-1' }, { id: 'comment-2' }] },
      sub_tickets: { data: [{ id: 'sub-1' }, { id: 'sub-2' }] },
      referenced_tickets: { data: [{ id: 'reference-1' }] },
      runs: { data: [{ id: 'run-1' }, { id: 'run-2' }] },
    },
  },
  included: [
    {
      type: 'bb_comment--bb_comment',
      id: 'comment-1',
      attributes: {
        drupal_internal__id: 1,
        bb_comment_type: 'comment',
        author_name: 'Ada',
        created: '2026-09-18T10:00:00+00:00',
        body: { value: 'First comment.' },
      },
    },
    {
      type: 'bb_comment--bb_comment',
      id: 'comment-2',
      attributes: {
        drupal_internal__id: 2,
        bb_comment_type: 'acceptance',
        author_name: 'Grace',
        created: '2026-09-19T10:00:00+00:00',
        body: { value: 'Second comment.\nWith another line.' },
      },
    },
    {
      type: 'bb_run--bb_run',
      id: 'run-1',
      attributes: {
        drupal_internal__id: 501,
        status: 'running',
        state: 'coding',
        created: '2026-09-19T09:00:00+00:00',
      },
    },
    {
      type: 'bb_run--bb_run',
      id: 'run-2',
      attributes: {
        drupal_internal__id: 502,
        status: 'done',
        state: 'review',
        created: '2026-09-19T08:00:00+00:00',
      },
    },
  ],
};

interface FixturePort {
  id: string;
  service: string;
  local: string;
  tunnel: string;
}
const fixtureTable: ListTable<FixturePort> = {
  noun: 'ports-fixture',
  emptyMessage: 'No services.',
  columns: [
    {
      key: 'service',
      label: 'SERVICE',
      width: 12,
      fields: [],
      get: (row) => row.service,
    },
    {
      key: 'local',
      label: 'LOCAL',
      width: 24,
      fields: [],
      get: (row) => row.local,
    },
    {
      key: 'tunnel',
      label: 'TUNNEL',
      width: 0,
      fields: [],
      get: (row) => row.tunnel,
    },
  ],
};
const fixturePorts: FixturePort[] = [
  {
    id: 'storybook',
    service: 'Storybook',
    local: 'http://127.0.0.1:6006',
    tunnel: 'https://storybook.example.test',
  },
  {
    id: 'web',
    service: 'Web',
    local: 'https://bakers.ddev.site',
    tunnel: 'https://web.example.test',
  },
];
const reportFixture = (id: string, weight: number, sections: Section[]) =>
  class extends AsyncScreen<Section[]> {
    static readonly route: RouteMetadata = {
      id,
      path: `/${id}`,
      tab: { id, label: id, scope: 'ticket', weight },
    };
    readonly id = id;
    protected load() {
      return Promise.resolve(sections);
    }
    protected renderLoading() {
      return ['loading'];
    }
    protected renderReady(value: Section[]) {
      return messageTree(id, flattenSections(value).lines);
    }
    protected chrome() {
      return {};
    }
    renderNonInteractive() {
      return flattenSections(this.readyValue ?? []).lines;
    }
  };
const FixtureArtifacts = reportFixture('fixture.artifacts', 50, [
  { heading: 'Checks', lines: ['vitest: passed'] },
  { heading: 'Build', lines: ['packages: built'] },
]);
const FixturePorts = reportFixture('fixture.ports', 60, [
  {
    heading: 'Ports',
    lines: listTableRows(fixtureTable, fixturePorts, undefined),
  },
]);

const context = (): ScreenContext => ({
  sessionGeneration: 1,
  requestDraw: vi.fn(),
  isActive: () => true,
  params: { ticketId: 'ticket-502' },
  contexts: ContextBag.empty()
    .set(ticketDetailInputContext, { document })
    .set(addonTicketInput, { document }),
  navigate: vi.fn(),
  copyToClipboard: vi.fn(() => true),
  nowSeconds: () => 1_789_812_000,
  options: {
    cwd: '/nope',
    debounce: () => vi.fn(),
  } as ScreenContext['options'],
});

const opened = async (tab = 'overview') => {
  const ScreenType =
    tab === 'bakers/artifacts'
      ? ArtifactsTabScreen
      : tab === 'addons'
        ? TicketAddonsScreen
        : tab === 'planning'
          ? TicketPlanningScreen
          : tab === 'comments'
            ? TicketCommentsScreen
            : tab === 'runs'
              ? TicketRunsScreen
              : TicketDetailScreen;
  const screen = new ScreenType();
  const ctx = context();
  screen.enter(ctx);
  await Promise.resolve();
  return { screen, context: ctx };
};

describe('ticket tab behaviour before the screen-per-tab migration', () => {
  it('prints the whole ticket document and contributed sections to a pipe', async () => {
    const { context: ctx } = await opened();

    expect(
      (
        await pipeReport(document, { ...ctx, nowSeconds: () => 0 }, [
          FixtureArtifacts,
          FixturePorts,
        ])
      ).join('\n'),
    ).toMatchInlineSnapshot(`
      "State
      coding

      Labels
      No labels.

      Source
      none

      Parent
      No parent ticket.

      Links
      No links.

      Latest summary
      No summary comment.

      Description
      Keep the current surface stable.

      Assignment
      Unassigned.
      Reviewers: —
      No conductor.

      Time
      No estimate and no accounted time.

      Branch
      branch: feat/bb-502
      base:   develop

      Environments
      No environments.

      Latest spec
      No spec comment.

      Latest plan
      No plan comment.

      Latest test
      No test comment.

      Comments
      — acceptance ·
      Second comment.
      With another line.
      — comment ·
      First comment.

      Runs
      RUN TICKET STATE PHASE AGENT STARTED
      #501 — coding — — just now
      #502 — review — — just now

      Checks
      vitest: passed

      Build
      packages: built

      Ports
      SERVICE LOCAL TUNNEL
      Storybook http://127.0.0.1:6006 https://storybook.example.test
      Web https://bakers.ddev.site https://web.example.test
      "
    `);
  });

  it('pins every footer action ladder', async () => {
    const ladders: Record<string, string> = {};
    for (const tab of TABS) {
      const { screen, context: ctx } = await opened(tab);
      ladders[tab] = formatActionLadder(screen.present(ctx).actions);
      screen.leave();
    }

    expect(ladders).toMatchInlineSnapshot(`
      {
        "addons": "Tab section · e edit · ↑↓ select · Enter run · l copy link",
        "bakers/artifacts": "Tab section · e edit · y copy id · Y copy link · ↑↓ scroll",
        "comments": "Tab section · e edit · f freeze · ↑↓ select · PgUp/PgDn page · y copy id · Y copy link · Enter/Space expand",
        "overview": "Tab section · e edit · f freeze · ↑↓ select · PgUp/PgDn page · y copy id · Y copy link · Enter/Space expand",
        "planning": "Tab section · e edit · f freeze · ↑↓ select · PgUp/PgDn page · y copy id · Y copy link · Enter/Space expand",
        "runs": "Tab section · y copy id · Y copy link · ↑↓ select · Enter open run",
      }
    `);
  });

  it('pins every handled key set', async () => {
    const handled: Record<string, string[]> = {};
    for (const tab of TABS) {
      const { screen, context: ctx } = await opened(tab);
      handled[tab] = KEYS.filter((key) => screen.handleInput(key, ctx));
      screen.leave();
    }

    expect(handled).toMatchInlineSnapshot(`
      {
        "addons": [
          "l",
        ],
        "bakers/artifacts": [
          "y",
          "Y",
        ],
        "comments": [
          "y",
          "Y",
          "f",
          "enter",
          " ",
          "j",
          "k",
          "down",
          "g",
          "G",
        ],
        "overview": [
          "y",
          "Y",
          "f",
          "enter",
          " ",
          "j",
          "k",
          "down",
          "g",
          "G",
        ],
        "planning": [
          "y",
          "Y",
          "f",
          "enter",
          " ",
          "j",
          "k",
          "down",
          "g",
          "G",
        ],
        "runs": [
          "y",
          "Y",
          "enter",
          " ",
          "j",
          "k",
          "down",
          "g",
          "G",
        ],
      }
    `);
  });
});

// Literal ladders and key sets captured before the route migration.
describe('built-in ticket screen parity', () => {
  it.each([
    [
      'overview',
      'Tab section · e edit · f freeze · ↑↓ select · PgUp/PgDn page · y copy id · Y copy link · Enter/Space expand',
      ['y', 'Y', 'f', 'enter', ' ', 'j', 'k', 'down', 'g', 'G'],
    ],
    [
      'comments',
      'Tab section · e edit · f freeze · ↑↓ select · PgUp/PgDn page · y copy id · Y copy link · Enter/Space expand',
      ['y', 'Y', 'f', 'enter', ' ', 'j', 'k', 'down', 'g', 'G'],
    ],
    [
      'runs',
      'Tab section · y copy id · Y copy link · ↑↓ select · Enter open run',
      ['y', 'Y', 'enter', ' ', 'j', 'k', 'down', 'g', 'G'],
    ],
  ] as const)('%s preserves its footer and handled keys', async (tab, ladder, keys) => {
    const { screen, context: ctx } = await opened(tab);
    expect(formatActionLadder(screen.present(ctx).actions)).toBe(ladder);
    expect(KEYS.filter((key) => screen.handleInput(key, ctx))).toEqual(keys);
  });
});
