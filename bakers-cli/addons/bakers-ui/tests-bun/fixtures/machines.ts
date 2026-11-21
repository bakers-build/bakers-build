import type { ConductorProcessHost } from '../../src/Entity/conductor/Data/process.js';
import type { DropshClient, RendererServices } from '../../src/types.js';
import { bootTui, settle } from '../tui-harness.js';

/** The Machines root tab's fixture: two owned machines, one conductor each. */
export const OWNER = 'user-cw';
const now = () => Math.floor(Date.now() / 1000);

const conductor = (id: string, label: string, machine: string) => ({
  id,
  type: 'bb_conductor--bb_conductor',
  attributes: {
    label,
    status: 'online',
    workspace_root: '/tmp/bakers-machines-test/.bakers',
    last_seen: now(),
    lease_expires_at: now() + 300,
  },
  relationships: {
    machine: { data: { id: machine, type: 'bb_machine--bb_machine' } },
    owner_user_id: { data: { id: OWNER, type: 'user--user' } },
  },
});

const machine = (id: string, name: string, owner: string) => ({
  id,
  type: 'bb_machine--bb_machine',
  attributes: { name, host_key: name, current_load: 2, max_parallel: 5 },
  relationships: { owner_user_id: { data: { id: owner, type: 'user--user' } } },
});

const host: ConductorProcessHost = {
  start: async () => ({ ok: true, message: 'done' }),
  stop: async () => ({ ok: true, message: 'done' }),
  thisHostKey: async () => 'workstation',
};

export async function openMachines(owner = OWNER) {
  const conductors = [
    conductor('c-1', 'north conductor', 'm-1'),
    conductor('c-2', 'south conductor', 'm-2'),
  ];
  const machines = [
    machine('m-1', 'workstation', owner),
    machine('m-2', 'laptop', owner),
  ];
  const writes: unknown[] = [];
  const client = {
    collection: () => {
      const c = {
        where: () => c,
        sort: () => c,
        page: () => c,
        first: async () => null,
        list: async () => [],
      };
      return c;
    },
    get: async (path: string, params?: { getQueryString?: () => string }) => {
      const query = decodeURIComponent(params?.getQueryString?.() ?? '');
      if (path === 'user/user')
        return {
          data: [
            {
              id: OWNER,
              type: 'user--user',
              attributes: {
                name: 'cw',
                display_name: 'cw',
                drupal_internal__uid: 5,
              },
            },
          ],
        };
      if (path.startsWith('bb_conductor/bb_conductor/')) {
        const id = path
          .slice('bb_conductor/bb_conductor/'.length)
          .split('?')[0];
        return {
          data: conductors.find((c) => c.id === id),
          included: machines,
        };
      }
      if (path === 'bb_conductor/bb_conductor') {
        const only = /filter\[machine\.id\]=([^&]+)/.exec(query)?.[1];
        return {
          data: conductors.filter(
            (c) => !only || c.relationships.machine.data.id === only,
          ),
          included: machines,
        };
      }
      if (path === 'bb_run/bb_run') return { data: [], included: [] };
      return { data: [] };
    },
    update: async (...args: unknown[]) => {
      writes.push(args);
      return {};
    },
    patch: async () => ({}),
    post: async () => ({}),
    // bakers_run_list restartable: nothing on this machine to restart.
    callTool: async () => ({ runs: [] }),
  } as unknown as DropshClient;
  const services: RendererServices = {
    client,
    baseUrl: 'http://web',
    currentUser: 'cw',
  };
  const tui = await bootTui({
    services,
    columns: 140,
    rows: 44,
    tui: { conductorProcess: host },
  });
  // Boot lands on My work; the product order is Projects → Machines.
  await tui.press('\t');
  await tui.press('\t');
  await settle();
  await tui.renderOnce();
  return { ...tui, writes };
}

export const text = (tui: { frame(): string }) =>
  tui.frame().replace(/\s+/g, ' ');
