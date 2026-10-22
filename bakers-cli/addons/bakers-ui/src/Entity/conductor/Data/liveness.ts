// Conductor liveness derivation.
//
// The rule itself lives in `@bakers-build/core` (`deriveConductorLiveness`) so the
// CLI listing, this cockpit and the server-side ConductorDeriver
// (web/modules/custom/bb_core/modules/bb_dashboard/src/Dashboard/ConductorDeriver.php)
// cannot drift into describing one conductor three ways. What stays here is the
// one thing core cannot answer: whether a bb_conductor record exists at all.
import {
  type ConductorLiveness,
  deriveConductorLiveness,
} from '@bakers-build/core';

/** The derived liveness state of a conductor. */
export type ConductorStatus = ConductorLiveness | 'registry-only';

/** The raw liveness inputs derived from a `bb_conductor` record. */
export interface ConductorInput {
  present?: boolean;
  status?: string | null;
  lastSeen?: number | null;
  leaseExpiresAt?: number | null;
}

export function deriveConductorStatus(
  conductor: ConductorInput,
  nowSeconds: number,
): ConductorStatus {
  // `registry-only` means "something names this conductor but the control plane
  // has no record of it". The Conductors screen reads the control plane itself,
  // so every row it builds is present by construction and this branch cannot
  // fire there; it remains for callers that join a record against another list.
  if (!conductor?.present) return 'registry-only';
  return deriveConductorLiveness(conductor, nowSeconds);
}

// `humanizeAge` moved to `lib/format.ts` (BB-236, entity-slice Phase 0): it is a
// generic relative-time formatter with no conductor vocabulary, and keeping it here
// is what made `Component/comment-item` and `Deriver/run-status` import a CONDUCTOR
// module. Its test moved with it, to `tests/lib/format.test.ts`.
