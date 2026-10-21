/**
 * How long a conductor may go without a heartbeat before it is stale.
 *
 * Mirrors the server-side ConductorDeriver
 * (web/modules/custom/bb_core/modules/bb_dashboard/src/Dashboard/ConductorDeriver.php).
 */
const STALE_WINDOW_SECONDS = 600;

/**
 * The derived liveness of a conductor.
 *
 * These three words are the server's, and they are deliberately the only ones:
 * the dashboard, the ticket board, the CLI listing and the cockpit all describe
 * the same conductor the same way. A `registry-only` fourth state existed while
 * a local registry could name a conductor the control plane had never heard of;
 * with the control plane as the sole list there is nothing left for it to
 * denote.
 *
 * BB-450 D11: the fresh state is `online`, not `running` — the word the
 * kernel used to print while the server's derived value (`ConductorDeriver::
 * nodeStatus()`) already said `online`. `stale` and `offline` already agreed;
 * only the fresh state had two names for one state.
 */
export type ConductorLiveness = 'online' | 'stale' | 'offline';

/** The raw liveness inputs of a `bb_conductor` record. */
export interface ConductorLivenessInput {
  status?: string | null;
  /** Unix seconds of the last heartbeat. */
  lastSeen?: number | null;
  /** Unix seconds the lease runs out. */
  leaseExpiresAt?: number | null;
}

/**
 * Derives whether a conductor is alive from its own record.
 *
 * `offline` is only ever self-declared: a conductor writes it as it exits, and
 * a heartbeat sets `online` unconditionally, so the flag means "it shut down
 * cleanly" rather than "it is not answering". Everything that is neither
 * clearly shut down nor clearly fresh is `stale` — including a crash, which
 * keeps `online` on the record until the lease lapses. Calling that state
 * `running` would block a restart until the reaper caught up; calling it
 * `offline` would claim a clean shutdown that did not happen.
 */
export function deriveConductorLiveness(
  input: ConductorLivenessInput,
  nowSeconds: number,
): ConductorLiveness {
  if (input.status === 'offline') return 'offline';
  if (input.lastSeen == null || input.lastSeen <= 0) return 'stale';
  if (nowSeconds - input.lastSeen > STALE_WINDOW_SECONDS) return 'stale';
  if (input.leaseExpiresAt != null && input.leaseExpiresAt < nowSeconds) {
    return 'stale';
  }
  return 'online';
}

/**
 * A control-plane timestamp as unix seconds, or `null` when it says nothing.
 *
 * Drupal's JSON:API serialises a `timestamp` field as **ISO-8601**
 * (`'2026-08-04T05:27:20+00:00'`), not as the unix integer the name suggests.
 * Both readers of these fields got that wrong, in mirror-image ways: the
 * cockpit's `typeof === 'number'` guard rejected the string and fell back to 0,
 * showing a conductor that was demonstrably ticking as `stale` with an unknown
 * age; the CLI declared the value `number` for the compiler alone, so every
 * arithmetic comparison was NaN — and since NaN comparisons are false, `stale`
 * was quietly unreachable there.
 *
 * `0` is treated as unknown rather than as 1970: no conductor heartbeat has
 * ever legitimately been at the epoch, and reading it as a real timestamp would
 * report a fresh conductor as decades stale.
 */
export function toUnixSeconds(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0 ? value : null;
  }
  if (typeof value === 'string' && value !== '') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : Math.floor(parsed / 1000);
  }
  return null;
}
