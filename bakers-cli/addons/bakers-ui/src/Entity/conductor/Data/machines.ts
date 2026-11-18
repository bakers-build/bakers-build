import { DrupalJsonApiParams } from 'drupal-jsonapi-params';
import type { DropshClient, JsonApiResource } from '../../../types.js';
import type { ListTable, Page } from '../../collection.js';
import { deriveConductorStatus } from './liveness.js';

/** One machine of the control plane, as the Machines tab lists it. */
export interface MachineRow {
  id: string;
  name: string;
  /** Online when any of its conductors is. */
  online: boolean;
  /** The machine's reported `current_load`: its active runs. */
  active: number;
  conductorIds: string[];
  ownerUserId: string | null;
}

const relId = (resource: JsonApiResource, name: string): string | null => {
  const data = resource.relationships?.[name]?.data;
  return data && !Array.isArray(data) ? data.id : null;
};

const toUnix = (value: unknown): number | null => {
  if (typeof value === 'number') return value;
  if (typeof value !== 'string' || value === '') return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : Math.floor(ms / 1000);
};

/**
 * The machines of these conductors, grouped from one conductor read with the
 * machine sideloaded.
 *
 * shortcut: a machine without a conductor, or past the first 50 conductors,
 * is not listed; read `bb_machine` directly when that matters.
 */
export const listMachineRows = async (
  client: DropshClient,
  ownerUserId: string | undefined,
  nowSeconds: number,
): Promise<Page<MachineRow>> => {
  const params = new DrupalJsonApiParams()
    .addInclude(['machine'])
    .addSort('drupal_internal__id', 'ASC')
    .addPageLimit(50);
  if (ownerUserId) params.addFilter('owner_user_id.id', ownerUserId);
  const doc = (await client.get('bb_conductor/bb_conductor', params)) as {
    data?: JsonApiResource[];
    included?: JsonApiResource[];
  };
  const machines = new Map<string, MachineRow>();
  for (const included of doc.included ?? []) {
    if (!included.id || included.type !== 'bb_machine--bb_machine') continue;
    const attrs = included.attributes ?? {};
    machines.set(included.id, {
      id: included.id,
      name: String(attrs.name || attrs.host_key || '(unnamed)'),
      online: false,
      active: Number(attrs.current_load ?? 0),
      conductorIds: [],
      ownerUserId: relId(included, 'owner_user_id'),
    });
  }
  for (const conductor of doc.data ?? []) {
    const row = machines.get(relId(conductor, 'machine') ?? '');
    if (!row || !conductor.id) continue;
    row.conductorIds.push(conductor.id);
    const attrs = conductor.attributes ?? {};
    const status = deriveConductorStatus(
      {
        present: true,
        status: typeof attrs.status === 'string' ? attrs.status : null,
        lastSeen: toUnix(attrs.last_seen),
        leaseExpiresAt: toUnix(attrs.lease_expires_at),
      },
      nowSeconds,
    );
    row.online ||= status === 'online';
  }
  const rows = [...machines.values()].filter((m) => m.conductorIds.length > 0);
  return { rows, hasNext: false, page: 0, total: rows.length };
};

export const MACHINE_TABLE: ListTable<MachineRow> = {
  noun: 'machine',
  emptyMessage: 'No machines with conductors.',
  columns: [
    {
      key: 'name',
      label: 'NAME',
      width: 0,
      min: 20,
      grow: 2,
      fields: ['name'],
      get: (row) => row.name,
    },
    {
      key: 'status',
      label: 'STATUS',
      width: 10,
      fields: ['status'],
      get: (row) => (row.online ? 'online' : 'offline'),
    },
    {
      key: 'active',
      label: 'ACTIVE',
      width: 8,
      fields: ['current_load'],
      get: (row) => String(row.active),
    },
    {
      key: 'conductors',
      label: 'CONDUCTORS',
      width: 12,
      fields: ['machine'],
      get: (row) => String(row.conductorIds.length),
    },
  ],
};
