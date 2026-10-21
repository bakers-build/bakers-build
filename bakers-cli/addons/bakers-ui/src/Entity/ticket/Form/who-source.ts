// BB-299 D5/D6 — the WHO OPTION SOURCE: the user candidate read plus the
// two-character threshold, in the one place every load funnels through. The
// threshold is THIS field's policy, exactly as `debounceMs` is (answered
// question 4) — not an `OptionSource.minQueryLength` the kernel would have to
// learn, and never a caller skipping the call.

import type { DropshClient } from '../../../types.js';
import type { OptionSource } from '../../../Widget/index.js';
import { loadWhoCandidates } from '../../user/Data/users.js';

/**
 * The minimum fragment the Who picker queries with (D6). Below this, `load`
 * returns an empty bag WITHOUT touching the client — and that includes the
 * `prime('')` at open, so opening the picker issues no query at all. The
 * accepted consequence: the Who picker opens empty rather than pre-browsable —
 * that IS AC-5.
 */
export const WHO_MIN_QUERY_LENGTH = 2;

/** How long the Who picker waits before re-querying (the parent picker's 150). */
const WHO_QUERY_DEBOUNCE_MS = 150;

/**
 * The `who` option source: the read, the label and the error, together.
 *
 * The candidate read never sees the filter it feeds (the parent filter's F7,
 * applied): `loadWhoCandidates` takes no criteria, so an active who filter can
 * never narrow the picker to that user's own tickets' assignees.
 */
export function whoOptionSource(client: DropshClient): OptionSource {
  return {
    bag: 'who',
    debounceMs: WHO_QUERY_DEBOUNCE_MS,
    async load(query: string) {
      if (query.length < WHO_MIN_QUERY_LENGTH) return { options: [] };
      const outcome = await loadWhoCandidates(client, query);
      return {
        options: outcome.rows.map((u) => ({ id: u.id, label: u.label })),
        error: outcome.error,
      };
    },
  };
}
