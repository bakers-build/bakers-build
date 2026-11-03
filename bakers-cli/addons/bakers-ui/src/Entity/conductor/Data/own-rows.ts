// BB-460 — "which conductors are MINE?", resolved once per screen.
//
// The Conductors list opens FILTERED (D1), so the operator's uuid must be known
// before the first read rather than on the first keypress the way BB-287's
// ticket list resolves it. That is the whole reason this is a small object with
// a cache instead of a function: the resolution happens on the load path, may
// fail there, and must not be retried on every 5 s refresh once it has been
// definitively answered.
//
// It takes the RESOLVER as an argument rather than importing it.
// `tests/boundary.test.ts` G2 forbids a `Data/` module reaching another slice,
// and `resolveWhoCandidate` lives in the user slice; the screens inject it, as
// they already inject `exists` and `thisMachineId` into `ConductorRowContext`.

import type { ListFilterBadge } from '../../../Component/list-chrome/index.js';
import type { DropshClient } from '../../../types.js';

/** Who the operator is, or why the screen could not establish it. */
export type OwnerOutcome =
  | { kind: 'resolved'; id: string; label: string }
  | { kind: 'unavailable'; reason: string };

/** The read this identity needs — `resolveWhoCandidate`'s shape, injected. */
export type OwnerResolver = (
  client: DropshClient,
  name: string,
) => Promise<{ rows: { id: string; label: string }[]; error?: string }>;

const messageOf = (caught: unknown): string =>
  caught instanceof Error ? caught.message : String(caught);

/**
 * The operator's user uuid, resolved at most once per screen lifetime.
 *
 * WHAT IS CACHED, AND WHAT IS NOT. A success is cached, and so is a definitive
 * miss — a name the collection does not hold will not start holding it inside one
 * session, and re-asking on every refresh would spend a request per poll to learn
 * the same "no". A READ ERROR is cached by neither: it says nothing about the
 * collection, only that this attempt failed, so the next load tries again
 * (BB-287 D5).
 */
export class OwnerIdentity {
  private cached: OwnerOutcome | null = null;

  constructor(private readonly resolveOwner: OwnerResolver) {}

  async resolve(
    client: DropshClient,
    currentUser: string | undefined,
  ): Promise<OwnerOutcome> {
    if (this.cached) return this.cached;
    if (currentUser === undefined) {
      // Not cached: the launcher supplies this, and a screen re-entered under a
      // different context may well have one.
      return { kind: 'unavailable', reason: 'mine: no current user' };
    }
    let outcome: { rows: { id: string; label: string }[]; error?: string };
    try {
      outcome = await this.resolveOwner(client, currentUser);
    } catch (caught) {
      return { kind: 'unavailable', reason: `mine: ${messageOf(caught)}` };
    }
    if (outcome.error !== undefined) {
      return { kind: 'unavailable', reason: `mine: ${outcome.error}` };
    }
    const row = outcome.rows[0];
    this.cached =
      row === undefined
        ? { kind: 'unavailable', reason: `mine: '${currentUser}' not found` }
        : { kind: 'resolved', id: row.id, label: row.label };
    return this.cached;
  }

  /** A new project or session means a new context; forget the answer. */
  reset(): void {
    this.cached = null;
  }
}

/**
 * The shipped default (BB-460 D1) — the list opens showing MINE.
 *
 * A product decision, and deliberately not an inheritance from the access layer:
 * BB-391 granted `view bb_conductor` to every session token on purpose, and
 * this default restores what operators had before it without touching that grant.
 */
export const DEFAULT_CONDUCTOR_MINE = true;

/** The filter strip both conductor screens show, so neither can word it its own way. */
export const mineBadges = (mine: boolean): ListFilterBadge[] => [
  mine
    ? { id: 'mine', label: 'm mine', value: 'mine' }
    : { id: 'mine', label: 'm mine' },
  { id: 'clear', label: 'c clear' },
];

/**
 * `5 hidden by mine — press m`, or '' when there is nothing to say (AC-2).
 *
 * Three cases collapse to the empty string and each for its own reason. `null` is
 * a total nobody established — a plane that reports no `meta.count` (R1) or a
 * failed probe — and a number nobody measured must not be printed. `0` is a
 * measured nothing: an operator sent to press `m` for rows that do not exist
 * learns only that the screen is guessing. Anything else is a fact, and it names
 * the key that releases it, because a count without a remedy is just a smaller
 * mystery.
 */
export const hiddenNotice = (hidden: number | null): string =>
  hidden === null || hidden <= 0 ? '' : `${hidden} hidden by mine — press m`;
