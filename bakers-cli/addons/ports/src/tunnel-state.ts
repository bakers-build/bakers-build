// BB-676 Task 3 — the MACHINE-wide tunnel record, `<homeBbDir()>/tunnels.json`.
//
// One file for every worktree on this machine, because the ingress list it
// drives is itself machine-wide (Cloudflare replaces the whole list on every
// upload — spec "Core: names, merge, upload"). A record's `desired` field
// is the crash-recoverable half of the contract: it is persisted BEFORE any
// network mutation, so a process that dies between "wrote intent" and
// "confirmed the API call" leaves something a later `up`/`down`/`reap` can
// retry idempotently, rather than a route that silently never happened.
//
// BB-681 Task 2 — schema 2: transport-agnostic. `accountId`/`tunnelId`/
// `zoneId` are gone; a single nonsecret `identity` string (the transport's
// own canonical remote identity, INCLUDING zone) plus the `transport`
// package id replace them. `dnsRecordId` is gone too — a transport's own
// nonsecret provider state (e.g. Named Cloudflare's DNS record id) now lives
// in the allowlisted `data` bag, which the generic layer never spreads
// blindly (see `tunnel-ops.ts`'s `validateTransportOutput`).

import { randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface TunnelDesiredRecord {
  readonly worktree: string;
  readonly ticket: string;
  readonly key: string;
  readonly service: string;
  readonly hostHeader?: string | undefined;
  readonly insecureTls?: boolean | undefined;
  /** Plain-HTTP container origin a transport may dial instead of `service`
   *  (see `TunnelRule.direct`); optional, so schema-2 files stay valid. */
  readonly direct?: string | undefined;
  /** The requested hostname, when the transport is zone-based (Named
   *  Cloudflare). Absent for an allocated-URL transport (Quick-style). */
  readonly hostname?: string | undefined;
  /** The actual applied URL — set only once the transport confirms the
   *  route is live; never populated optimistically from desired state. */
  readonly url?: string | undefined;
  /** Transport-owned, nonsecret provider state (e.g. a DNS record id).
   *  Validated by the owning transport's own `validateData`, never
   *  interpreted by the generic layer. */
  readonly data?: Record<string, unknown> | undefined;
  readonly desired: 'present' | 'absent';
  readonly applied: 'applied' | 'pending' | 'error';
  readonly error?: string | undefined;
}

/** The transport + remote identity this state belongs to — refuse reuse for
 *  a different transport or a different remote identity (e.g. a different
 *  tunnel/zone) while records or tombstones for the old one remain. Token
 *  rotation alone never changes `identity` — a transport's `identity` must
 *  be built only from nonsecret, stable fields. */
export interface TunnelIdentity {
  readonly transport: string;
  readonly identity: string;
}

export interface MachineTunnelState extends TunnelIdentity {
  readonly schemaVersion: 2;
  readonly records: readonly TunnelDesiredRecord[];
}

export function emptyState(identity: TunnelIdentity): MachineTunnelState {
  return {
    schemaVersion: 2,
    transport: identity.transport,
    identity: identity.identity,
    records: [],
  };
}

export type ReadResult =
  | { readonly ok: true; readonly state: MachineTunnelState }
  /** No file yet — not a failure; callers treat it as `emptyState`. */
  | { readonly ok: false; readonly reason: 'missing' }
  | {
      readonly ok: false;
      readonly reason: 'malformed';
      readonly detail: string;
    }
  | {
      readonly ok: false;
      readonly reason: 'permission';
      readonly detail: string;
    };

export class TunnelIdentityMismatchError extends Error {
  constructor(expected: TunnelIdentity, found: TunnelIdentity) {
    super(
      `tunnels.json belongs to a different transport/identity (expected ${expected.transport}/${expected.identity}, found ${found.transport}/${found.identity}) — refusing to reuse its state while records remain`,
    );
    this.name = 'TunnelIdentityMismatchError';
  }
}

export interface TunnelStateDeps {
  readFile(path: string): Promise<string>;
  writeFile(path: string, data: string, mode: number): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  mkdir(path: string): Promise<void>;
}

export const nodeTunnelStateDeps: TunnelStateDeps = {
  readFile: (path) => readFile(path, 'utf8'),
  writeFile: async (path, data, mode) => {
    await writeFile(path, data, { encoding: 'utf8', mode });
    await chmod(path, mode);
  },
  rename: (from, to) => rename(from, to),
  mkdir: async (path) => {
    await mkdir(path, { recursive: true });
  },
};

export function tunnelStatePath(home: string): string {
  return join(home, 'tunnels.json');
}

const ALLOWED_RECORD_KEYS = new Set([
  'worktree',
  'ticket',
  'key',
  'service',
  'hostHeader',
  'insecureTls',
  'direct',
  'hostname',
  'url',
  'data',
  'desired',
  'applied',
  'error',
]);

/** Unknown fields or a malformed shape are a hard error (spec) — never
 *  silently coerced or dropped. */
function isRecord(v: unknown): v is TunnelDesiredRecord {
  if (typeof v !== 'object' || v === null) return false;
  const obj = v as Record<string, unknown>;
  for (const k of Object.keys(obj)) {
    if (!ALLOWED_RECORD_KEYS.has(k)) return false;
  }
  return (
    typeof obj.worktree === 'string' &&
    typeof obj.ticket === 'string' &&
    typeof obj.key === 'string' &&
    typeof obj.service === 'string' &&
    (obj.desired === 'present' || obj.desired === 'absent') &&
    (obj.applied === 'applied' ||
      obj.applied === 'pending' ||
      obj.applied === 'error') &&
    (obj.hostname === undefined || typeof obj.hostname === 'string') &&
    (obj.url === undefined || typeof obj.url === 'string') &&
    (obj.hostHeader === undefined || typeof obj.hostHeader === 'string') &&
    (obj.insecureTls === undefined || typeof obj.insecureTls === 'boolean') &&
    (obj.direct === undefined || typeof obj.direct === 'string') &&
    (obj.error === undefined || typeof obj.error === 'string') &&
    (obj.data === undefined ||
      (typeof obj.data === 'object' && obj.data !== null))
  );
}

const ALLOWED_TOP_KEYS = new Set([
  'schemaVersion',
  'transport',
  'identity',
  'records',
]);

/**
 * Read `tunnels.json`. ENOENT reads as `missing` — the initial state, not a
 * failure. Malformed content and permission errors are distinct failure
 * reasons that BLOCK a mutation; they never masquerade as an empty file
 * (spec). A schema-1 (or otherwise invalid) file reads as `malformed` too —
 * it is left exactly as found, never silently migrated/coerced.
 */
export async function readMachineTunnelState(
  home: string,
  deps: TunnelStateDeps,
): Promise<ReadResult> {
  let raw: string;
  try {
    raw = await deps.readFile(tunnelStatePath(home));
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return { ok: false, reason: 'missing' };
    if (code === 'EACCES' || code === 'EPERM') {
      return {
        ok: false,
        reason: 'permission',
        detail: err instanceof Error ? err.message : String(err),
      };
    }
    return {
      ok: false,
      reason: 'malformed',
      detail: err instanceof Error ? err.message : String(err),
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return {
      ok: false,
      reason: 'malformed',
      detail: err instanceof Error ? err.message : String(err),
    };
  }
  const obj = parsed as Record<string, unknown> | null;
  if (
    !obj ||
    typeof obj !== 'object' ||
    !Object.keys(obj).every((k) => ALLOWED_TOP_KEYS.has(k)) ||
    obj.schemaVersion !== 2 ||
    typeof obj.transport !== 'string' ||
    typeof obj.identity !== 'string' ||
    !Array.isArray(obj.records) ||
    !obj.records.every(isRecord)
  ) {
    return {
      ok: false,
      reason: 'malformed',
      detail: 'unexpected tunnels.json shape (not schema 2)',
    };
  }
  return {
    ok: true,
    state: {
      schemaVersion: 2,
      transport: obj.transport,
      identity: obj.identity,
      records: obj.records as TunnelDesiredRecord[],
    },
  };
}

/** Throws when an on-disk state belongs to a different transport/identity
 *  AND still carries records or tombstones. */
export function assertIdentity(
  state: TunnelIdentity,
  identity: TunnelIdentity,
): void {
  if (
    state.transport !== identity.transport ||
    state.identity !== identity.identity
  ) {
    throw new TunnelIdentityMismatchError(identity, state);
  }
}

/**
 * Resolve the current state for a mutation: `missing` becomes a fresh empty
 * state under `identity`; `malformed`/`permission` throw, blocking the
 * mutation rather than silently starting from empty. An identity mismatch
 * throws UNLESS the on-disk record set is already empty — in that case a
 * mutation may rebind state to the new identity (e.g. operator switched
 * transport/zone after fully tearing the old one down). Credential rotation
 * alone never trips this, because `identity` excludes secrets.
 */
export async function readValidatedMachineState(
  home: string,
  identity: TunnelIdentity,
  deps: TunnelStateDeps,
): Promise<MachineTunnelState> {
  const read = await readMachineTunnelState(home, deps);
  if (!read.ok) {
    if (read.reason === 'missing') return emptyState(identity);
    throw new Error(`tunnels.json is ${read.reason}: ${read.detail}`);
  }
  if (
    read.state.transport !== identity.transport ||
    read.state.identity !== identity.identity
  ) {
    if (read.state.records.length === 0) return emptyState(identity);
    throw new TunnelIdentityMismatchError(identity, read.state);
  }
  return read.state;
}

/** Atomic rename on the same filesystem, mode 0600 — never a half-written file. */
export async function writeMachineTunnelState(
  home: string,
  state: MachineTunnelState,
  deps: TunnelStateDeps,
): Promise<void> {
  await deps.mkdir(home);
  const path = tunnelStatePath(home);
  const tmp = `${path}.${randomUUID()}.tmp`;
  await deps.writeFile(tmp, `${JSON.stringify(state, null, 2)}\n`, 0o600);
  await deps.rename(tmp, path);
}

/** The worktree-filtered view `list`/`status` read — never throws on a bad
 *  or missing file, because discovery must stay available regardless. */
export async function readTunnelState(
  worktree: string,
  home: string,
  deps: TunnelStateDeps,
): Promise<readonly TunnelDesiredRecord[]> {
  const read = await readMachineTunnelState(home, deps);
  if (!read.ok) return [];
  return read.state.records.filter((r) => r.worktree === worktree);
}

/** Pure keyed update: insert or replace the record for `(worktree, key)`. */
export function upsertRecord(
  records: readonly TunnelDesiredRecord[],
  record: TunnelDesiredRecord,
): TunnelDesiredRecord[] {
  const idx = records.findIndex(
    (r) => r.worktree === record.worktree && r.key === record.key,
  );
  if (idx === -1) return [...records, record];
  const next = records.slice();
  next[idx] = record;
  return next;
}
