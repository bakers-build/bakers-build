// BB-676 Task 3 — `bringUp`/`takeDown`/`reap` for the named-tunnel model:
// one machine-wide desired-record set reconciled under `withTunnelLock`.
//
// BB-681 Task 2 — this module no longer knows Cloudflare (or any other
// provider): all remote I/O is delegated to the injected `PortsTransport`
// (`transport.ts`). `TunnelOpsDeps` is now state/lock I/O only.

import type { TunnelRule } from './claims.js';
import { publicHostname } from './claims.js';
import { type LockDeps, withTunnelLock } from './lock.js';
import type { PortsTransport } from './transport.js';
import {
  readTunnelState,
  readValidatedMachineState,
  type TunnelDesiredRecord,
  type TunnelStateDeps,
  upsertRecord,
  writeMachineTunnelState,
} from './tunnel-state.js';

export interface OpResult {
  readonly ok: boolean;
  readonly message: string;
}

export interface OperationContext {
  readonly worktree: string;
  readonly ticket: string;
  readonly home: string;
  readonly transport: PortsTransport;
  readonly signal?: AbortSignal;
}

/** Provider I/O (API calls, subprocess spawning, …) is injected WITHIN each
 *  transport module, never here — this is state/lock I/O only. */
export type TunnelOpsDeps = TunnelStateDeps & Partial<LockDeps>;

function recordKey(r: Pick<TunnelDesiredRecord, 'worktree' | 'key'>): string {
  return `${r.worktree}:${r.key}`;
}

/** Copy only defined/allowlisted fields from what a transport returns —
 *  never blindly spread arbitrary transport output into persisted state.
 *  Also enforces: every desired-present input key survives in the output
 *  (an adapter cannot silently erase it), and no output record invents a
 *  key that wasn't in the input. `data`, when present, is validated against
 *  the transport's own allowlist. */
function validateTransportOutput(
  input: readonly TunnelDesiredRecord[],
  output: readonly TunnelDesiredRecord[],
  transport: Pick<PortsTransport, 'id' | 'validateData'>,
): TunnelDesiredRecord[] {
  const inputKeys = new Set(input.map(recordKey));
  const presentKeys = new Set(
    input.filter((r) => r.desired === 'present').map(recordKey),
  );
  const outputKeys = new Set(output.map(recordKey));
  for (const r of output) {
    const k = recordKey(r);
    if (!inputKeys.has(k)) {
      throw new Error(
        `ports transport '${transport.id}' returned record '${k}' not present in the input`,
      );
    }
  }
  for (const k of presentKeys) {
    if (!outputKeys.has(k)) {
      throw new Error(
        `ports transport '${transport.id}' dropped desired-present record '${k}'`,
      );
    }
  }
  return output.map((r) => {
    if (r.data !== undefined) transport.validateData(r.data);
    return {
      worktree: r.worktree,
      ticket: r.ticket,
      key: r.key,
      service: r.service,
      hostHeader: r.hostHeader,
      insecureTls: r.insecureTls,
      direct: r.direct,
      hostname: r.hostname,
      url: r.url,
      data: r.data,
      desired: r.desired,
      applied: r.applied,
      error: r.error,
    };
  });
}

/**
 * Hand the COMPLETE desired set to the transport's own `reconcile`, letting
 * it durably checkpoint partial progress mid-flight (under the same lock as
 * the caller), then validate + sanitize whatever it returns before the
 * caller persists it.
 */
export async function reconcileTunnels(
  records: readonly TunnelDesiredRecord[],
  ctx: {
    readonly transport: PortsTransport;
    readonly home: string;
    readonly signal?: AbortSignal | undefined;
  },
  deps: TunnelOpsDeps,
): Promise<{
  readonly records: readonly TunnelDesiredRecord[];
  readonly ok: boolean;
}> {
  const { transport, home, signal } = ctx;
  const checkpoint = async (
    partial: readonly TunnelDesiredRecord[],
  ): Promise<void> => {
    const sanitized = validateTransportOutput(records, partial, transport);
    await writeMachineTunnelState(
      home,
      {
        schemaVersion: 2,
        transport: transport.id,
        identity: transport.identity,
        records: sanitized,
      },
      deps,
    );
  };
  const result = await transport.reconcile(
    records,
    signal === undefined ? { checkpoint } : { signal, checkpoint },
  );
  const sanitized = validateTransportOutput(records, result.records, transport);
  return { records: sanitized, ok: result.ok };
}

/** N5/F: is a stored record's applied target still what a freshly observed
 *  `TunnelRule` resolves to? A restarted container can get a new bound port
 *  (or a changed Host header) between two discovery passes for the same key
 *  — this is the single comparison `bringUp`, `needsShare` and `reap` must
 *  all share, so a changed target is picked up consistently everywhere
 *  instead of only on an explicit `up <key>`. */
export function sameOrigin(
  a: {
    readonly hostHeader?: string | undefined;
    readonly insecureTls?: boolean | undefined;
    readonly direct?: string | undefined;
  },
  b: {
    readonly hostHeader?: string | undefined;
    readonly insecureTls?: boolean | undefined;
    readonly direct?: string | undefined;
  },
): boolean {
  return (
    (a.hostHeader ?? null) === (b.hostHeader ?? null) &&
    (a.insecureTls ?? false) === (b.insecureTls ?? false) &&
    (a.direct ?? null) === (b.direct ?? null)
  );
}

/** Does `record` already match everything `rule` resolves to right now? */
export function recordMatchesRule(
  record: Pick<
    TunnelDesiredRecord,
    'service' | 'hostHeader' | 'insecureTls' | 'direct'
  >,
  rule: TunnelRule,
): boolean {
  return record.service === rule.service && sameOrigin(record, rule);
}

async function withLock<T>(
  ctx: Pick<OperationContext, 'home' | 'signal'>,
  deps: TunnelOpsDeps,
  op: () => Promise<T>,
): Promise<T> {
  return deps.spawn
    ? withTunnelLock(ctx.home, op, ctx.signal, { spawn: deps.spawn })
    : withTunnelLock(ctx.home, op, ctx.signal);
}

function writeState(
  home: string,
  transport: Pick<PortsTransport, 'id' | 'identity'>,
  records: readonly TunnelDesiredRecord[],
  deps: TunnelOpsDeps,
): Promise<void> {
  return writeMachineTunnelState(
    home,
    {
      schemaVersion: 2,
      transport: transport.id,
      identity: transport.identity,
      records,
    },
    deps,
  );
}

export async function bringUp(
  rule: TunnelRule,
  ctx: OperationContext,
  deps: TunnelOpsDeps,
): Promise<OpResult & { readonly hostname?: string | undefined }> {
  return withLock(ctx, deps, async () => {
    const identity = {
      transport: ctx.transport.id,
      identity: ctx.transport.identity,
    };
    let state: Awaited<ReturnType<typeof readValidatedMachineState>>;
    try {
      state = await readValidatedMachineState(ctx.home, identity, deps);
    } catch (err) {
      return {
        ok: false,
        message: err instanceof Error ? err.message : String(err),
      };
    }
    const hostname = ctx.transport.zone
      ? publicHostname(ctx.ticket, rule.key, ctx.transport.zone)
      : undefined;
    const existing = state.records.find(
      (r) => r.worktree === ctx.worktree && r.key === rule.key,
    );
    // BB-681 review C4: no "already shared" fast path. The spec requires
    // every up/down/reap to reconcile the COMPLETE desired set so a dead
    // Quick process or a lost frp registration recovers on a repeated `up` —
    // a short-circuit here would skip the provider's own liveness check
    // (`recordMatchesRule` alone only compares declared desired fields,
    // never asks the transport whether the route is actually still live).
    //
    // BB-681 review N3: carry the PREVIOUSLY applied URL through when the
    // origin is unchanged, so a transient read failure on the fast-path
    // reuse check (e.g. Quick's log file) sees a record with its last-known
    // URL instead of `undefined` — avoiding a spurious kill-and-respawn of a
    // still-live process over nothing but a flaky re-read. A transport that
    // actually needs to recreate the route still overwrites `url` itself.
    const originUnchanged =
      existing !== undefined && recordMatchesRule(existing, rule);
    const desired = upsertRecord(state.records, {
      worktree: ctx.worktree,
      ticket: ctx.ticket,
      key: rule.key,
      hostname,
      service: rule.service,
      hostHeader: rule.hostHeader,
      insecureTls: rule.insecureTls,
      direct: rule.direct,
      data: existing?.data,
      url: originUnchanged ? existing.url : undefined,
      desired: 'present',
      applied: 'pending',
    });
    await writeState(ctx.home, ctx.transport, desired, deps);

    const result = await reconcileTunnels(
      desired,
      { transport: ctx.transport, home: ctx.home, signal: ctx.signal },
      deps,
    );
    await writeState(ctx.home, ctx.transport, result.records, deps);

    const applied = result.records.find(
      (r) => r.worktree === ctx.worktree && r.key === rule.key,
    );
    if (!applied || applied.applied !== 'applied') {
      return {
        ok: false,
        message: applied?.error ?? 'tunnel reconciliation failed',
      };
    }
    // A URL is reported "shared" only after APPLIED confirmation, never
    // optimistically from the desired state written above.
    const at =
      applied.url ?? (applied.hostname ? `https://${applied.hostname}` : '');
    return { ok: true, message: `shared at ${at}`, hostname: applied.hostname };
  });
}

export async function takeDown(
  worktree: string,
  key: string | undefined,
  ctx: OperationContext,
  deps: TunnelOpsDeps,
): Promise<OpResult> {
  return withLock(ctx, deps, async () => {
    const identity = {
      transport: ctx.transport.id,
      identity: ctx.transport.identity,
    };
    let state: Awaited<ReturnType<typeof readValidatedMachineState>>;
    try {
      state = await readValidatedMachineState(ctx.home, identity, deps);
    } catch (err) {
      return {
        ok: false,
        message: err instanceof Error ? err.message : String(err),
      };
    }
    const targets = state.records.filter(
      (r) => r.worktree === worktree && (key === undefined || r.key === key),
    );
    // Idempotent: nothing recorded is already the desired end state.
    if (targets.length === 0) {
      return {
        ok: true,
        message: key
          ? `no tunnel for key ${key}`
          : 'no tunnels for this worktree',
      };
    }
    let desired = state.records;
    for (const t of targets) {
      desired = upsertRecord(desired, {
        ...t,
        desired: 'absent',
        applied: 'pending',
      });
    }
    await writeState(ctx.home, ctx.transport, desired, deps);

    const result = await reconcileTunnels(
      desired,
      { transport: ctx.transport, home: ctx.home, signal: ctx.signal },
      deps,
    );
    await writeState(ctx.home, ctx.transport, result.records, deps);

    return result.ok
      ? { ok: true, message: `stopped ${targets.length} tunnel(s)` }
      : {
          ok: false,
          message: 'some tunnels could not be removed; retry `down`',
        };
  });
}

export interface ReapResult extends OpResult {
  readonly removedRecords: number;
  /** F: records whose freshly observed rule changed from what was persisted
   *  (e.g. a container restart rebound the target port) and were re-upserted
   *  with the new target rather than left stale. */
  readonly refreshedRecords?: number;
}

/** F: a liveness check reports "still here" plus, when the caller can also
 *  re-derive the current rule, "and this is what it resolves to NOW" —
 *  letting `reap` detect and upsert a changed target (N5's "changed bound
 *  port" comparison) instead of only pruning/preserving. */
export interface ReapLiveness {
  readonly live: boolean;
  readonly rule?: TunnelRule;
}

/**
 * Reconcile machine state against which worktrees/services still exist.
 * `isWorktreeLive`/`isServiceLive` are injected so Task 4's CLI can decide
 * liveness (deleted worktree, stopped service) without this module knowing
 * about discovery.
 */
export async function reap(
  ctx: Pick<OperationContext, 'home' | 'transport' | 'signal'>,
  isLive: (record: TunnelDesiredRecord) => Promise<ReapLiveness>,
  deps: TunnelOpsDeps,
): Promise<ReapResult> {
  return withLock(ctx, deps, async () => {
    const identity = {
      transport: ctx.transport.id,
      identity: ctx.transport.identity,
    };
    let state: Awaited<ReturnType<typeof readValidatedMachineState>>;
    try {
      state = await readValidatedMachineState(ctx.home, identity, deps);
    } catch (err) {
      return {
        ok: false,
        removedRecords: 0,
        message: err instanceof Error ? err.message : String(err),
      };
    }
    let desired = state.records;
    let removedRecords = 0;
    let refreshedRecords = 0;
    for (const record of state.records) {
      if (record.desired !== 'present') continue;
      const { live, rule } = await isLive(record);
      if (!live) {
        desired = upsertRecord(desired, {
          ...record,
          desired: 'absent',
          applied: 'pending',
        });
        removedRecords += 1;
        continue;
      }
      if (rule && !recordMatchesRule(record, rule)) {
        desired = upsertRecord(desired, {
          ...record,
          service: rule.service,
          hostHeader: rule.hostHeader,
          insecureTls: rule.insecureTls,
          direct: rule.direct,
          applied: 'pending',
          error: undefined,
        });
        refreshedRecords += 1;
      }
    }
    // F: a record stuck `pending`/`error` (a prior failed reconcile) is
    // retried on every reap, not just the pass where it first broke — once a
    // transient failure clears, reap is the only thing that notices without
    // an explicit `up <key>` naming it again.
    // BB-681 review C4: reap always reconciles the complete desired set,
    // even with nothing LOCALLY changed — a dead Quick process or a lost frp
    // registration is invisible here (this loop only compares OUR records
    // against `isLive`'s discovery evidence); only the transport's own
    // `reconcile` can notice and repair that, and it only gets the chance
    // when this call actually happens. A truly empty desired set (no
    // `present` records at all) has nothing for a transport to reconcile and
    // skips the call, same as before.
    if (desired.length === 0) {
      return { ok: true, removedRecords: 0, message: 'nothing to reap' };
    }
    await writeState(ctx.home, ctx.transport, desired, deps);
    const result = await reconcileTunnels(
      desired,
      { transport: ctx.transport, home: ctx.home, signal: ctx.signal },
      deps,
    );
    await writeState(ctx.home, ctx.transport, result.records, deps);
    const parts = [
      removedRecords > 0
        ? `reaped ${removedRecords} stale tunnel record(s)`
        : undefined,
      refreshedRecords > 0
        ? `refreshed ${refreshedRecords} changed tunnel record(s)`
        : undefined,
    ].filter((p): p is string => p !== undefined);
    return {
      ok: result.ok,
      removedRecords,
      refreshedRecords,
      // BB-681 review N5: this reconciles the complete desired set every
      // pass (C4) — "retried pending" implied something was outstanding,
      // when a no-change pass may equally mean every record was already
      // live and reconciled as a no-op.
      message: parts.length > 0 ? parts.join('; ') : 'reconciled; no changes',
    };
  });
}

export { readTunnelState };
