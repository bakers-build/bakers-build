// The shared conductor read for the conductor detail scope. ONE cached
// single-entity read (`include=machine`), so all four tabs share exactly one
// header instead of each re-deriving it.
import { toUnixSeconds } from '@bakers-build/core';
import { dataKey, type SessionStore } from '../../../Data/session-store.js';
import type { DropshClient, JsonApiResource } from '../../../types.js';
import { type ConductorStatus, deriveConductorStatus } from './liveness.js';

/** The conductor detail scope's shared header data. */
export interface ConductorDetail {
  id: string;
  /** Never empty — the uuid is the last fallback. */
  label: string;
  /** The `--conductor <name>` stem it was started from, if reported. */
  conductorName: string | undefined;
  /** The sideloaded machine's name (its label), or ''. */
  machineLabel: string;
  /** The linked project's uuid, or '' when unlinked — no project read here. */
  projectLabel: string;
  /** The `.bakers` dir it last registered from; '' when it never reported one. */
  workspaceRoot: string;
  lastPid: number | undefined;
  status: ConductorStatus;
  lastSeen: number;
  currentLoad: number;
  maxParallel: number;
  /** THIS record's machine host_key, for the `mine` derivation. */
  hostKey: string | undefined;
  /** The box's credential checks from its last heartbeat. */
  credentials: ConductorCredential[];
}

export interface ConductorCredential {
  name: string;
  status: 'ok' | 'warning' | 'error';
  expires_at?: string;
  reason: string;
}

/** `credential_health` is a JSON list; anything else reads as none. */
function credentialsOf(value: unknown): ConductorCredential[] {
  let list: unknown = value;
  if (typeof value === 'string') {
    try {
      list = JSON.parse(value);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(list)) return [];
  return list.filter(
    (c): c is ConductorCredential =>
      typeof c?.name === 'string' &&
      typeof c?.reason === 'string' &&
      ['ok', 'warning', 'error'].includes(c?.status),
  );
}

const str = (v: unknown): string | undefined =>
  typeof v === 'string' && v.length > 0 ? v : undefined;
const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined;

function singleRelId(raw: JsonApiResource, key: string): string | null {
  const data = raw.relationships?.[key]?.data;
  if (!data || Array.isArray(data)) return null;
  return data.id ?? null;
}

/** Read one conductor with its sideloaded machine, mapped to {@link ConductorDetail}. */
export async function loadConductorDetail(
  client: DropshClient,
  conductorId: string,
  nowSeconds: number,
): Promise<ConductorDetail> {
  const doc = (await client.get(
    `bb_conductor/bb_conductor/${conductorId}?include=machine`,
  )) as { data?: JsonApiResource; included?: JsonApiResource[] };
  const raw = doc?.data ?? { id: conductorId };
  const attrs = raw.attributes ?? {};
  const machineId = singleRelId(raw, 'machine');
  const machine = machineId
    ? (doc.included ?? []).find((r) => r.id === machineId)
    : undefined;
  const machineAttrs = machine?.attributes ?? {};
  const lastSeen = toUnixSeconds(attrs.last_seen) ?? 0;
  const leaseExpiresAt = toUnixSeconds(attrs.lease_expires_at) ?? 0;
  const hostKey = str(machineAttrs.host_key);
  return {
    id: raw.id ?? conductorId,
    label:
      str(attrs.label) ??
      str(attrs.conductor_id) ??
      str(attrs.machine_id) ??
      raw.id ??
      conductorId,
    conductorName: str(attrs.conductor_name),
    machineLabel: str(machineAttrs.name) ?? '',
    projectLabel: singleRelId(raw, 'project_id') ?? '',
    workspaceRoot: str(attrs.workspace_root) ?? '',
    lastPid: num(attrs.last_pid),
    status: deriveConductorStatus(
      {
        present: true,
        status: str(attrs.status) ?? null,
        lastSeen: lastSeen === 0 ? null : lastSeen,
        leaseExpiresAt: leaseExpiresAt === 0 ? null : leaseExpiresAt,
      },
      nowSeconds,
    ),
    lastSeen,
    currentLoad: num(machineAttrs.current_load) ?? num(attrs.current_load) ?? 0,
    maxParallel: num(machineAttrs.max_parallel) ?? num(attrs.max_parallel) ?? 0,
    hostKey,
    credentials: credentialsOf(attrs.credential_health),
  };
}

const conductorDetailKey = (id: string) =>
  dataKey<ConductorDetail>(`conductor/${id}`);

/** What the store-cached read needs from the outside world. */
interface ConductorDetailContext {
  readonly store?: SessionStore;
  readonly services?: { client: DropshClient };
}

/**
 * The store-cached single-entity read every tab of the conductor scope
 * shares — one request per conductor per session, not one per tab.
 */
export async function readConductorDetail(
  context: ConductorDetailContext,
  conductorId: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<ConductorDetail> {
  if (!context.services) throw new Error('Conductor detail requires services');
  const key = conductorDetailKey(conductorId);
  if (!context.store)
    return loadConductorDetail(
      context.services.client,
      conductorId,
      nowSeconds,
    );
  const cached = context.store.get(key);
  if (cached) return cached;
  const detail = await loadConductorDetail(
    context.services.client,
    conductorId,
    nowSeconds,
  );
  context.store.set(key, detail, ['detail']);
  return detail;
}
