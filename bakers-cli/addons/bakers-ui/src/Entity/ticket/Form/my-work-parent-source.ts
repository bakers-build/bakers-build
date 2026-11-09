// BB-540 — the My work PARENT OPTION SOURCE: the same kernel as the
// project-scoped `parentOptionSource` (one read, one label, one error channel),
// but the read is NOT scoped to a project — My work spans every project the
// operator is assigned to, and the picker offers parents from all of them.
//
// The read is `loadAllParentCandidates`, which mirrors
// `loadParentCandidates` minus the `filter[project_id.id]=<uuid>` clause. Both
// reads still pin `parent: null` and `who: null` criteria (F7), so an active
// parent filter can never narrow the picker to that parent's own children.

import type { DropshClient } from '../../../types.js';
import type { OptionSource } from '../../../Widget/index.js';
import { loadAllParentCandidates } from '../Data/parents-all.js';
import type { ParentOption } from './parent-source.js';

/** How long the My work parent picker waits before re-querying. */
const PARENT_QUERY_DEBOUNCE_MS = 150;

const toParentOption = (row: {
  id: string;
  identifier: string;
  title: string;
}): ParentOption => ({
  id: row.id,
  label: `${row.identifier} · ${row.title}`,
  identifier: row.identifier,
  title: row.title,
});

/**
 * The `parents` option source for the My work screen: every ticket that has
 * children, across every project the operator can see.
 *
 * The two-character gate lives inside the source's `load()` (D6 of BB-299,
 * applied), so the prime at open issues NO query — the picker opens empty
 * rather than pre-browsable.
 */
export function myWorkParentOptionSource(client: DropshClient): OptionSource {
  return {
    bag: 'parents',
    debounceMs: PARENT_QUERY_DEBOUNCE_MS,
    async load(query: string) {
      if (query.length < 2) return { options: [] };
      const outcome = await loadAllParentCandidates(client, query);
      return {
        options: outcome.rows.map(toParentOption),
        error: outcome.error,
      };
    },
  };
}
