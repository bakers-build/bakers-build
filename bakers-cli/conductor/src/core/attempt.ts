import { createHash } from 'node:crypto';

/**
 * Deterministic per-attempt session id family for a run (BB-473 review
 * round 4, Critical 2). A re-dispatch of the same run needs its own
 * collision-free session id — `claude`/`grok --session-id` refuse to start
 * when the id already names a transcript from a prior attempt — but the
 * previous fix (a `startedAt` time window) selects by *when*, not by *which
 * attempt*, and a worktree-keyed transcript directory can hold a sibling
 * run's session newer than that bound. An attempt family gives finalise an
 * IDENTITY to select by instead: attempt 0 is the run's own UUID (unchanged,
 * so every caller that only knows a single `sessionId` keeps working);
 * attempt n>0 is a stable UUID-shaped id derived from `${runUuid}:${n}`, so
 * both dispatch (which candidate to pin) and finalise (which candidate's
 * file exists) derive the SAME sequence from nothing but the run's own UUID
 * — no new persisted field, no schema change.
 */
export function attemptSessionId(runUuid: string, attempt: number): string {
  if (attempt <= 0) {
    return runUuid;
  }
  const hex = createHash('sha256')
    .update(`${runUuid}:${attempt}`)
    .digest('hex')
    .slice(0, 32)
    .split('');
  hex[12] = '5'; // version nibble — cosmetic, just keeps the shape UUID-like.
  hex[16] = ((Number.parseInt(hex[16] ?? '0', 16) & 0x3) | 0x8).toString(16); // variant nibble.
  const h = hex.join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

/** Bound on how many re-dispatches of one run this family covers. */
export const MAX_ATTEMPTS = 25;

/**
 * The full candidate sequence for a run, attempt 0 first. Both the dispatch
 * pin-selection loop and finalise's selection loop derive this from nothing
 * but the run's own UUID, so the two sides never need to agree through any
 * channel but the UUID itself.
 */
export function attemptFamily(runUuid: string, max = MAX_ATTEMPTS): string[] {
  return Array.from({ length: max }, (_, i) => attemptSessionId(runUuid, i));
}
