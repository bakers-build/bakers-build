// BB-284 D4 — the parent-filter picker as a DECLARATION over the form kernel
// (BB-236): one `autocomplete` field, and one `toObject` that yields the picked
// parent as the criterion the ticket list filters by. The mechanics — typing,
// the kernel's local filter, the suggestion cursor, pick and cancel — all live in
// `Form/`; nothing of them is repeated here.
//
// AC-4: this screen's only ticket read is `loadParentCandidates`, composed as
// `parentOptionSource` (D5) — the same source the create form's Parent field
// loads through, never a second lookup path.

import { declareForm, type FormState } from '../../../Form/index.js';
import { PARENT_PAGE_SIZE } from '../Data/parents.js';
import type { ParentOption } from './parent-source.js';

export interface ParentFilterValues {
  /** The PICKED parent's uuid, or null. `parentQuery` holds what was typed. */
  parent: string | null;
  parentQuery: string;
}

export interface ParentFilterOptions {
  /**
   * The parent candidates. Optional so an ABSENT bag ("nothing can be offered")
   * stays distinguishable from an empty one ("searched, nothing matched") — the
   * same rule as the create form's `parents` bag (BB-257 D8).
   */
  parents?: ParentOption[] | undefined;
  errors?: { parents?: string | undefined } | undefined;
}

/** The picked parent, as `TicketCriteria.parent` carries it (D1). */
export type ParentFilterPayload = { id: string; identifier: string } | null;

/**
 * The declaration. One field, no action row: Enter on the autocomplete IS the
 * commit — the screen backs with the payload on `submit`.
 */
export const PARENT_FILTER_FORM = declareForm<
  ParentFilterValues,
  ParentFilterOptions,
  ParentFilterPayload
>({
  fields: (f) => [
    f.autocomplete('parent', 'Parent', {
      from: 'parents',
      query: 'parentQuery',
      // BB-300 D2 — the filter can be removed INSIDE the picker: Del (or
      // Backspace on an empty query) clears the pick, and the screen commits
      // the null payload.
      clearable: true,
      // Defensive: unreachable from this route — the screen requires project
      // context — but declared, so the field stays printable (AC-15).
      absentNote: '(no project context)',
      pageSize: PARENT_PAGE_SIZE,
    }),
  ],
  toObject: (v, o) => {
    // The identifier rides along with the uuid, so the criteria summary can
    // NAME the parent without a second lookup (AC-2).
    const hit = (o.parents ?? []).find((p) => p.id === v.parent);
    return hit ? { id: hit.id, identifier: hit.identifier } : null;
  },
});

export type ParentFilterState = FormState<ParentFilterValues>;
