// BB-681 Task 2 — the pluggable transport contract. Every provider
// package (`@bakers-build/addon-ports-cloudflare`, and later Quick/frp) implements
// this; the generic ports layer (`tunnel-ops.ts`) never knows a provider's
// own field names or API shapes — only this contract.

import type { TunnelDesiredRecord } from './tunnel-state.js';

export type { TunnelDesiredRecord };

export interface PortsTransport {
  /** The transport's own package/short id — persisted as `tunnels.json`'s
   *  `transport` field. */
  readonly id: string;
  /** Nonsecret canonical remote identity, INCLUDING zone when the transport
   *  is zone-based — used to detect "transport/zone/remote identity changed
   *  while records exist" (see `tunnel-state.ts`). Must never include a
   *  secret: credential rotation alone must not change this. */
  readonly identity: string;
  /** Present for a zone-based transport (Named Cloudflare); absent for an
   *  allocated-URL transport (Quick-style) — not used by Task 2 itself, but
   *  the type must carry it for later tasks. */
  readonly zone?: string | undefined;
  /** Reject any provider state that isn't this transport's own allowlisted
   *  shape — thrown, never silently coerced. */
  validateData(data: unknown): void;
  /**
   * Reconcile the COMPLETE desired record set (every worktree/ticket/key,
   * including tombstones for records that should no longer exist) against
   * the remote. `checkpoint` lets the adapter durably acknowledge partial
   * ownership progress mid-reconcile, under the same lock, so a crash
   * between steps can resume correctly on the next call.
   */
  reconcile(
    records: readonly TunnelDesiredRecord[],
    context: {
      readonly signal?: AbortSignal | undefined;
      checkpoint(records: readonly TunnelDesiredRecord[]): Promise<void>;
    },
  ): Promise<{
    readonly records: readonly TunnelDesiredRecord[];
    readonly ok: boolean;
  }>;
}

export type PortsTransportFactory = (
  settings: unknown,
  context: { readonly home: string },
) => Promise<PortsTransport>;

/** Thrown for a missing/malformed transport package or a malformed
 *  `PortsTransport` contract — a safe diagnostic naming what's wrong, never
 *  a raw crash deeper in the stack. */
export class InvalidTransportModuleError extends Error {
  constructor(spec: string, detail: string) {
    super(`ports transport '${spec}' is invalid: ${detail}`);
    this.name = 'InvalidTransportModuleError';
  }
}

/** Runtime-check a value against the `PortsTransport` shape — a malformed
 *  factory result (missing `reconcile`, wrong types, …) is rejected here,
 *  before any state mutation. */
export function assertPortsTransport(
  value: unknown,
  spec: string,
): asserts value is PortsTransport {
  if (typeof value !== 'object' || value === null) {
    throw new InvalidTransportModuleError(
      spec,
      'factory did not return an object',
    );
  }
  const obj = value as Record<string, unknown>;
  if (typeof obj.id !== 'string' || obj.id === '') {
    throw new InvalidTransportModuleError(spec, 'missing string "id"');
  }
  if (typeof obj.identity !== 'string' || obj.identity === '') {
    throw new InvalidTransportModuleError(spec, 'missing string "identity"');
  }
  if (obj.zone !== undefined && typeof obj.zone !== 'string') {
    throw new InvalidTransportModuleError(
      spec,
      '"zone" must be a string when present',
    );
  }
  if (typeof obj.validateData !== 'function') {
    throw new InvalidTransportModuleError(
      spec,
      'missing function "validateData"',
    );
  }
  if (typeof obj.reconcile !== 'function') {
    throw new InvalidTransportModuleError(spec, 'missing function "reconcile"');
  }
}
