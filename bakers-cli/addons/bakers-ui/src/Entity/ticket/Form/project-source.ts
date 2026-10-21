// BB-540 — the PROJECT OPTION SOURCE, modelled on the BB-299
// `whoOptionSource`: the candidate read + the two-character threshold, in the
// one place every load funnels through. The threshold is THIS field's policy
// (AC-3: a two-character gate, Del on an empty query clears) — not an
// `OptionSource.minQueryLength` the kernel would have to learn.

import type { DropshClient } from '../../../types.js';
import type { OptionSource } from '../../../Widget/index.js';
import { loadProjectCandidates } from '../Data/projects-search.js';

/**
 * The minimum fragment the project picker queries with (AC-3). Below this,
 * `load` returns an empty bag WITHOUT touching the client — and that includes
 * the `prime('')` at open, so opening the picker issues no query at all. The
 * accepted consequence is the same shape `whoOptionSource` already carries:
 * the picker opens empty rather than pre-browsable. The user's chip strip
 * already names the field (`r project`), so the empty start is legible.
 */
export const PROJECT_MIN_QUERY_LENGTH = 2;

/** How long the project picker waits before re-querying (the who picker's 150). */
const PROJECT_QUERY_DEBOUNCE_MS = 150;

/**
 * The `projects` option source: the read, the label and the error, together.
 *
 * The label is the project name verbatim. The criterion carries the name
 * along with the uuid (`TicketCriteria.project` is `{ id, label }`), so the
 * chip summary names the project without a second lookup — same shape as the
 * `who` picker's label riding along as `TicketCriteria.who.label` (D3).
 */
export function projectOptionSource(client: DropshClient): OptionSource {
  return {
    bag: 'projects',
    debounceMs: PROJECT_QUERY_DEBOUNCE_MS,
    async load(query: string) {
      if (query.length < PROJECT_MIN_QUERY_LENGTH) return { options: [] };
      const outcome = await loadProjectCandidates(client, query);
      return {
        options: outcome.rows.map((row) => ({ id: row.id, label: row.name })),
        error: outcome.error,
      };
    },
  };
}
