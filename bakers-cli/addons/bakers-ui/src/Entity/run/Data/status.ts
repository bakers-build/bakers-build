// Run status derivation. The `state` field is authoritative, but an active run
// (`running`/`claimed`) whose heartbeat has gone quiet OR whose claim lease has
// expired is surfaced as `stale` so a dead agent does not read as live. Mirrors
// the conductor liveness window; reuses `humanizeAge` for the relative age.
import { humanizeAge } from '../../../lib/format.js';
import type { RunRow } from './runs.js';

const STALE_WINDOW_SECONDS = 600;

/** The derived, display-facing status of a run. */
export type RunStatus =
  | 'running'
  | 'stale'
  | 'claimed'
  | 'done'
  | 'expired'
  | 'failed'
  | string;

/** Parse an ISO timestamp (or a numeric unix value) to unix seconds, or null. */
function toSeconds(value: string | number | null): number | null {
  if (value == null) return null;
  if (typeof value === 'number') return value;
  const ms = Date.parse(value);
  if (!Number.isNaN(ms)) return Math.floor(ms / 1000);
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Derive the run's display status. Terminal states (`done`/`expired`/`failed`)
 * pass through. An active run (`running`/`claimed`) is `stale` when its
 * heartbeat is older than the liveness window OR its claim has expired; else it
 * keeps its own state.
 */
export function deriveRunStatus(row: RunRow, nowSeconds: number): RunStatus {
  const state = row.state;
  if (state !== 'running' && state !== 'claimed') return state;
  const hb = toSeconds(row.heartbeat);
  if (hb != null && nowSeconds - hb > STALE_WINDOW_SECONDS) return 'stale';
  const claim = toSeconds(row.claimExpiresAt);
  if (claim != null && claim < nowSeconds) return 'stale';
  return state;
}

/** A short relative age of the run's start ("just now", "1h ago", …), '—'. */
export function runStartedAge(row: RunRow, nowSeconds: number): string {
  return humanizeAge(toSeconds(row.startedAt), nowSeconds);
}
