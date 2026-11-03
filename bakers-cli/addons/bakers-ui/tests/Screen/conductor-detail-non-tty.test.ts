// The conductor detail scope's pipe path — `conductor.overview` carries
// `pipe: 'scope'`, so `| cat` prints all four tabs of the scope. Pinned
// against the drawn tree the same anti-drift way `run-detail-non-tty.test.ts`
// pins the run detail's own report.
import { expect, it } from 'vitest';
import { createSessionStore } from '../../src/Data/session-store.js';
import { ConductorLogScreen } from '../../src/Entity/conductor/Screen/conductor-log.js';
import { ConductorOverviewScreen } from '../../src/Entity/conductor/Screen/conductor-overview.js';
import { ConductorRunsScreen } from '../../src/Entity/conductor/Screen/conductor-runs.js';
import { ConductorsScreen } from '../../src/Entity/conductor/Screen/conductors.js';
import { ConductorTicketsScreen } from '../../src/Entity/ticket/Screen/conductor-tickets.js';
import { renderPipe } from '../../src/Kernel/pipe.js';
import { defineRoutes } from '../../src/Routing/registry.js';
import { Router } from '../../src/Routing/router.js';
import type { ScreenContext } from '../../src/Screen/screen.js';
import type { DropshClient, RendererServices } from '../../src/types.js';

const CONDUCTOR_ID = 'c1';
const MACHINE_ID = 'machine-1';

const conductorResource = {
  id: CONDUCTOR_ID,
  type: 'bb_conductor--bb_conductor',
  attributes: {
    label: 'cw-framework',
    workspace_root: '/tmp/bakers-detail-non-tty',
    status: 'online',
    last_seen: Math.floor(Date.now() / 1000),
    current_load: 1,
    max_parallel: 5,
  },
  relationships: {
    machine: { data: { id: MACHINE_ID, type: 'bb_machine' } },
  },
};
const machineResource = {
  id: MACHINE_ID,
  type: 'bb_machine--bb_machine',
  attributes: {
    name: 'cw-laptop',
    host_key: '0b6f3c1e-9a2d-4e57-8c41-2f7d9e5a1b30',
    current_load: 1,
    max_parallel: 5,
  },
};
const ticketResource = {
  id: 't-538',
  type: 'bb_ticket--bb_ticket',
  attributes: { identifier: 'BB-538', title: 'Conductor claims a ticket' },
};
const runResource = {
  id: 'r1',
  type: 'bb_run--bb_run',
  attributes: {
    drupal_internal__id: 538,
    state: 'running',
    state_at_start: 'coding',
    agent: 'claude',
    started_at: new Date().toISOString(),
  },
  relationships: { ticket_id: { data: { id: 't-538' } } },
};
const assignedTicket = {
  id: 't-536',
  type: 'bb_ticket--bb_ticket',
  attributes: {
    identifier: 'BB-536',
    title: 'assigned ticket',
    state: 'coding',
    closed: false,
  },
  relationships: {},
};

function fakeContext(): ScreenContext {
  const client: DropshClient = {
    collection: () =>
      ({
        where: () => client.collection(''),
        sort: () => client.collection(''),
        page: () => client.collection(''),
        first: async () => null,
        list: async () => [],
      }) as never,
    get: async (path: string) => {
      if (path.startsWith('bb_conductor/bb_conductor/')) {
        return { data: conductorResource, included: [machineResource] };
      }
      if (path === 'bb_run/bb_run') {
        return { data: [runResource], included: [ticketResource] };
      }
      if (path === 'bb_ticket/bb_ticket') {
        return { data: [assignedTicket], included: [] };
      }
      return { data: [] };
    },
    patch: async () => ({}),
    post: async () => ({}),
  } as unknown as DropshClient;
  const services: RendererServices = {
    client,
    baseUrl: 'http://web',
    conductorProcess: {
      start: async () => ({ ok: true, message: '' }),
      stop: async () => ({ ok: true, message: '' }),
      thisHostKey: async () => 'test-host',
    },
  } as never;
  return {
    sessionGeneration: 1,
    requestDraw: () => {},
    isActive: () => true,
    services,
    nowSeconds: () => Math.floor(Date.now() / 1000),
  };
}

async function pipeConductor(): Promise<string[]> {
  const routes = defineRoutes([
    ConductorsScreen,
    ConductorOverviewScreen,
    ConductorRunsScreen,
    ConductorTicketsScreen,
    ConductorLogScreen,
  ]);
  const session = routes.createSession({});
  const store = createSessionStore();
  const router = new Router(
    session.screens(),
    () => {},
    1,
    { ...fakeContext(), store },
    session.navigation(),
  );
  try {
    const result = await renderPipe(
      router,
      routes,
      { routeId: 'conductor.overview', params: { conductorId: CONDUCTOR_ID } },
      async () => {
        throw new Error('Fixture screen must supply pipe rows');
      },
    );
    return result.lines;
  } finally {
    store.clear();
  }
}

it('prints every tab of the conductor scope when piped', async () => {
  const lines = await pipeConductor();
  const text = lines.join('\n');
  expect(text).toContain('bakers.build conductor — cw-framework');
  // AC-5: the machine shows its label, never its UUID.
  expect(text).toContain('Machine: cw-laptop');
  expect(text).not.toContain('0b6f3c1e');
  expect(text).toContain('Held work');
  expect(text).toContain('BB-538');
  expect(text).toContain('Assigned');
  expect(text).toContain('BB-536');
  expect(text).toContain('log — ');
});

it("the overview tab's piped rows are the drawn rows, line for line", async () => {
  const screen = new ConductorOverviewScreen();
  const context = fakeContext();
  screen.enter({ ...context, params: { conductorId: CONDUCTOR_ID } });
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));

  const ctx = { ...context, params: { conductorId: CONDUCTOR_ID } };
  const piped = screen.renderNonInteractive(ctx);
  const { renderTree } = await import('../render-tree.js');
  const drawn = renderTree(
    // @ts-expect-error — protected in production, reached for the anti-drift proof.
    screen.renderReady(screen.readyValue, ctx),
  );
  expect(piped).toEqual(drawn);
});
