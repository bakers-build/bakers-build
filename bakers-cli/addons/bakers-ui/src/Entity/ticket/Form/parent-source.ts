// BB-284 D5 — the PARENT OPTION SOURCE, extracted from `create-data.ts` so the
// create form and the parent-filter picker compose the SAME source: one read
// (`loadParentCandidates`), one label policy, one error channel, two consumers.
// The no-drift argument spec F2 makes for the query builder, applied to the
// source — a copied source would let the two pickers disagree about what a
// parent row looks like.

import type { DropshClient } from '../../../types.js';
import type { OptionSource } from '../../../Widget/index.js';
import { loadParentCandidates, type ParentCandidate } from '../Data/parents.js';
import type { ParentOption } from './create.js';

/**
 * How long the parent picker waits before re-querying (BB-257 D7).
 *
 * A property of THIS field's source, not of the kernel: the kernel drives
 * whatever sources a form declares and has no interest in how long any of them
 * waits.
 */
const PARENT_QUERY_DEBOUNCE_MS = 150;

/**
 * `BB-nnn · <title>` — the picker label, composed HERE (BB-257 D5).
 *
 * The kernel filters candidates by a case-insensitive substring of
 * `Option.label` and knows nothing of identifiers or titles. AC-5's "matching
 * on identifier AND on title" is therefore met by what the label is MADE OF,
 * not by a second rule in the kernel: a substring of this string is a match on
 * either half. Exported so the pickers' own tests can state the rule once.
 */
export const parentLabel = (row: ParentCandidate): string =>
  `${row.identifier} · ${row.title}`;

const toParentOption = (row: ParentCandidate): ParentOption => ({
  id: row.id,
  label: parentLabel(row),
  identifier: row.identifier,
  title: row.title,
});

/**
 * The `parents` option source for one project: the read, the label and the
 * error, together.
 *
 * The candidate read never sees the filter it feeds (spec F7/R2):
 * `loadParentCandidates` builds its query with `parent: null` criteria, so an
 * active parent filter can never narrow the picker to that parent's children.
 *
 * `match` is forwarded to the read: the create form searches identifier AND
 * title (default), the parent FILTER picker matches by identifier only
 * (BB-284, PM steer — the operator knows `BB-273`, not the title).
 */
export function parentOptionSource(
  client: DropshClient,
  projectId: string,
  match: 'identifier+title' | 'identifier' = 'identifier+title',
): OptionSource<ParentOption> {
  return {
    bag: 'parents',
    debounceMs: PARENT_QUERY_DEBOUNCE_MS,
    async load(query: string) {
      const outcome = await loadParentCandidates(
        client,
        projectId,
        query,
        match,
      );
      return {
        options: outcome.rows.map(toParentOption),
        error: outcome.error,
      };
    },
  };
}
