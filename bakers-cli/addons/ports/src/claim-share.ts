// BB-676 spec v5 — shared "bring up everything eligible" predicate AND I/O
// loop (`shareAll`, pass-6 review cleanup), used by both the `tunnel` inbox
// message and `bakers ports up` with no service key, so the two "share
// everything" entry points cannot drift apart.

import type { ClaimedDiscovery, ClaimedService } from './claims.js';

/** Eligible = a healthy (or prepared-Drupal-passthrough) claim with a rule. */
export function eligible(service: ClaimedService): boolean {
  return service.rules.length > 0;
}

/** Every eligible service of `discovery` is shared on every "bring up
 *  everything" pass — BB-681 review C4: an already-`applied` record is
 *  never short-circuited here either, because the SPEC requires every
 *  up/down/reap to reconcile the complete desired set (a dead Quick process
 *  or a lost frp registration must recover on a repeated `up`, not only when
 *  the recorded fields disagree with the freshly observed rule).
 *  `bringUp`/`reconcileTunnels` own the actual idempotence (a live, matching
 *  route is a cheap no-op there); this is the pure selection half of "bring
 *  up everything" (spec v5's `bakers ports up` with no key, and the `tunnel`
 *  inbox message), kept separate from the I/O loop so a test drives it
 *  without a real `bringUp`. BB-681 review over-engineering pass: no
 *  per-record state check is needed any more — every call site already has
 *  no further reason to pass `records` here, so it was dropped. */
export function servicesToShare(discovery: ClaimedDiscovery): ClaimedService[] {
  return discovery.services.filter(eligible);
}

/** One `bringUp` outcome, paired with the service it was for. */
export interface ShareOutcome<R> {
  readonly service: ClaimedService;
  readonly result: R;
}

/**
 * BB-676 pass-6 review cleanup — the "bring up everything" I/O loop, shared
 * between `bakers ports up` (no key) and the `tunnel` inbox message so the two
 * "share everything" entry points cannot drift apart: one call per selected
 * service, in order, keeping going past a single failure, every outcome kept
 * for the caller to report its own way (stdout lines vs. a Markdown list).
 */
export async function shareAll<R extends { ok: boolean; message: string }>(
  services: readonly ClaimedService[],
  bringUp: (service: ClaimedService) => Promise<R>,
): Promise<ShareOutcome<R>[]> {
  const outcomes: ShareOutcome<R>[] = [];
  for (const service of services) {
    outcomes.push({ service, result: await bringUp(service) });
  }
  return outcomes;
}
