import { describe, expect, it } from 'bun:test';
import type { ConductorProcessHost } from '../../src/Entity/conductor/Data/process.js';
import type {
  Collection,
  DropshClient,
  RendererServices,
  Resource,
} from '../../src/types.js';
import { bootTui, settle } from '../tui-harness.js';

/**
 * The conductor detail scope — Overview, Held work, Assigned, Log — reached
 * with Enter from the Conductors list, driven through the kernel's real key
 * handling and the real bun renderer.
 */
describe('the conductor detail scope', () => {
  const WORKSPACE = '/tmp/bakers-conductor-detail-test';
  const MACHINE_UUID = 'machine-uuid-1';
  const NOW = Math.floor(Date.now() / 1000);
  const STALE_HEARTBEAT = NOW - 4000; // well past the 600s liveness window

  const conductorDoc = (attrs: Record<string, unknown> = {}) => ({
    id: 'c1',
    type: 'bb_conductor--bb_conductor',
    attributes: {
      label: 'cw-framework',
      machine_id: 'cw-framework',
      status: 'online',
      workspace_root: WORKSPACE,
      last_seen: NOW,
      lease_expires_at: NOW + 300,
      last_pid: 4242,
      conductor_name: 'conductor',
      current_load: 1,
      max_parallel: 5,
      ...attrs,
    },
    relationships: {
      machine: { data: { id: MACHINE_UUID, type: 'bb_machine' } },
    },
  });

  const machineDoc = (attrs: Record<string, unknown> = {}) => ({
    id: MACHINE_UUID,
    type: 'bb_machine--bb_machine',
    attributes: {
      host_key: 'cw-framework',
      current_load: 1,
      max_parallel: 5,
      ...attrs,
    },
  });

  const runDoc = (attrs: Record<string, unknown> = {}) => ({
    id: attrs.id ?? 'r1',
    type: 'bb_run--bb_run',
    attributes: {
      drupal_internal__id: 538,
      state: 'running',
      state_at_start: 'coding',
      agent: 'claude',
      started_at: new Date(NOW * 1000).toISOString(),
      heartbeat: new Date(NOW * 1000).toISOString(),
      claim_expires_at: new Date((NOW + 300) * 1000).toISOString(),
      created: new Date(NOW * 1000).toISOString(),
      ...attrs,
    },
    relationships: { ticket_id: { data: { id: 't-538' } } },
  });

  const staleRunDoc = () =>
    runDoc({
      id: 'r2',
      drupal_internal__id: 539,
      state: 'running',
      heartbeat: new Date(STALE_HEARTBEAT * 1000).toISOString(),
    });

  const ticketIncludeDoc = (id: string, identifier: string, title: string) => ({
    id,
    type: 'bb_ticket--bb_ticket',
    attributes: { identifier, title },
  });

  const assignedTicketDoc = () => ({
    id: 't-536',
    type: 'bb_ticket--bb_ticket',
    attributes: {
      identifier: 'BB-536',
      title: 'assigned ticket',
      state: 'coding',
      closed: false,
    },
    relationships: {},
  });

  function fakeHost(thisHostKey = 'cw-framework'): ConductorProcessHost {
    return {
      start: async () => ({ ok: true, message: 'not exercised here' }),
      stop: async () => ({ ok: true, message: 'not exercised here' }),
      thisHostKey: async () => thisHostKey,
    };
  }

  function fakeServices(opts: {
    rows?: ReturnType<typeof conductorDoc>[];
    runs?: ReturnType<typeof runDoc>[];
    tickets?: ReturnType<typeof assignedTicketDoc>[];
  }): RendererServices {
    const docs = opts.rows ?? [conductorDoc()];
    const runs = opts.runs ?? [runDoc(), staleRunDoc()];
    const tickets = opts.tickets ?? [assignedTicketDoc()];
    const collection = (): Collection => {
      const c: Collection = {
        where: () => c,
        sort: () => c,
        page: () => c,
        first: async () => null,
        list: async (): Promise<Resource[]> => [],
      };
      return c;
    };
    const client = {
      collection,
      get: async (path: string) => {
        if (path.startsWith('bb_conductor/bb_conductor/')) {
          const id = path
            .slice('bb_conductor/bb_conductor/'.length)
            .split('?')[0];
          const doc = docs.find((d) => d.id === id) ?? docs[0];
          return { data: doc, included: [machineDoc()] };
        }
        if (path === 'bb_conductor/bb_conductor') {
          return { data: docs, included: [machineDoc()] };
        }
        if (path === 'bb_run/bb_run') {
          return {
            data: runs,
            included: [
              ticketIncludeDoc('t-538', 'BB-538', 'Conductor claims a ticket'),
            ],
          };
        }
        if (path === 'bb_ticket/bb_ticket') {
          return { data: tickets, included: [] };
        }
        return { data: [] };
      },
      patch: async () => ({}),
      post: async () => ({}),
    } as unknown as DropshClient;
    return { client, baseUrl: 'http://web' };
  }

  async function bootConductors(
    opts: {
      rows?: ReturnType<typeof conductorDoc>[];
      runs?: ReturnType<typeof runDoc>[];
      tickets?: ReturnType<typeof assignedTicketDoc>[];
    } = {},
  ) {
    const { mkdirSync } = await import('node:fs');
    mkdirSync(WORKSPACE, { recursive: true });
    const services = fakeServices(opts);
    const host = fakeHost();
    const tui = await bootTui({
      services,
      columns: 140,
      rows: 44,
      tui: { conductorProcess: host },
    });
    // Same product order as `conductors.test.ts`: Dashboard → Projects → Teams → Conductors.
    await tui.press('\t');
    await tui.press('\t');
    await tui.press('\t');
    return tui;
  }

  async function quit(tui: Awaited<ReturnType<typeof bootTui>>): Promise<void> {
    tui.mockInput.pressKey('q');
    await tui.running;
    await tui.stop();
  }

  function text(tui: { frame(): string }): string {
    return tui.frame().replace(/\s+/g, ' ');
  }

  it('Enter on a conductor row opens the conductor overview', async () => {
    const tui = await bootConductors();
    await tui.press('\r');
    await settle();
    expect(text(tui)).toContain('bakers.build conductor — cw-framework');
    expect(text(tui)).toContain('Held work');
    expect(text(tui)).toContain('Assigned');
    await quit(tui);
  });

  it('opens for a conductor on another machine too', async () => {
    const tui = await bootConductors({
      rows: [conductorDoc({ label: 'elsewhere' })],
    });
    await tui.press('\r');
    await settle();
    expect(text(tui)).toContain('bakers.build conductor —');
    await quit(tui);
  });

  it('names held work by ticket identifier and title, with state, phase and age', async () => {
    const tui = await bootConductors();
    await tui.press('\r');
    await settle();
    await tui.press('\t');
    await settle();
    const frame = text(tui);
    expect(frame).toContain('BB-538');
    expect(frame).toContain('Conductor claims a ticket');
    expect(frame).toContain('coding');
    await quit(tui);
  });

  it('marks a run whose heartbeat went quiet as stale, and counts them', async () => {
    const tui = await bootConductors();
    await tui.press('\r');
    await settle();
    await tui.press('\t');
    await settle();
    expect(text(tui)).toContain('stale');
    expect(text(tui)).toContain('1 stale');
    await quit(tui);
  });

  it('says so in words when the conductor holds no run', async () => {
    const tui = await bootConductors({ runs: [] });
    await tui.press('\r');
    await settle();
    await tui.press('\t');
    await settle();
    expect(text(tui)).toContain('This conductor holds no run.');
    await quit(tui);
  });

  it('lists the open tickets assigned to the conductor', async () => {
    const tui = await bootConductors();
    await tui.press('\r');
    await settle();
    await tui.press('\t');
    await tui.press('\t');
    await settle();
    expect(text(tui)).toContain('BB-536');
    await quit(tui);
  });

  it('says so in words when no ticket is assigned', async () => {
    const tui = await bootConductors({ tickets: [] });
    await tui.press('\r');
    await settle();
    await tui.press('\t');
    await tui.press('\t');
    await settle();
    expect(text(tui)).toContain('No ticket is assigned to this conductor.');
    await quit(tui);
  });

  it('tails the log on the Log tab when the conductor is ours', async () => {
    const tui = await bootConductors();
    await tui.press('\r');
    await settle();
    for (let i = 0; i < 3; i++) await tui.press('\t');
    await settle();
    expect(text(tui)).toContain('log — ');
    expect(text(tui)).toContain('/.bakers/log.txt');
    await quit(tui);
  });
});
