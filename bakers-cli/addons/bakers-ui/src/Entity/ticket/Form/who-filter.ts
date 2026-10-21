// BB-299 D5 — the who-filter picker as a DECLARATION over the form kernel
// (BB-236), mirroring the BB-284 parent filter field-for-field: one
// `autocomplete` field, and one `toObject` that yields the picked user as the
// criterion the ticket list filters by. The mechanics — typing, the kernel's
// local filter, the suggestion cursor, pick and cancel — all live in `Form/`;
// nothing of them is repeated here.
//
// The screen's only user read is `loadWhoCandidates`, composed as
// `whoOptionSource` (D5) — never a second lookup path.

import {
  declareForm,
  type FormState,
  type Option,
} from '../../../Form/index.js';
import { WHO_PAGE_SIZE } from '../../user/Data/users.js';
import type { WhoCriterion } from '../Data/query.js';

export interface WhoFilterValues {
  /** The PICKED user's uuid, or null. `whoQuery` holds what was typed. */
  who: string | null;
  whoQuery: string;
}

export interface WhoFilterOptions {
  /**
   * The who candidates. Optional so an ABSENT bag ("nothing can be offered")
   * stays distinguishable from an empty one ("searched, nothing matched") —
   * the same rule as the parent filter's `parents` bag.
   */
  who?: Option[] | undefined;
  errors?: { who?: string | undefined } | undefined;
}

/** The picked user, as `TicketCriteria.who` carries it (D3). */
export type WhoFilterPayload = WhoCriterion | null;

/**
 * Which criterion the shared picker is setting (BB-416). `'assignee'` is
 * the default — every caller from before this filter existed navigates
 * without naming a target, and must keep landing here. `whoOptionSource`
 * offers the same user candidates either way; only the emitted result's
 * `type` differs (`Screen/who-filter-form.ts`).
 */
export type WhoFilterTarget = 'assignee' | 'owner';

/**
 * The declaration. One field, no action row: Enter on the autocomplete IS the
 * commit — the screen backs with the payload on `submit`.
 */
export const WHO_FILTER_FORM = declareForm<
  WhoFilterValues,
  WhoFilterOptions,
  WhoFilterPayload
>({
  fields: (f) => [
    f.autocomplete('who', 'Who', {
      from: 'who',
      query: 'whoQuery',
      // Defensive: unreachable from this route — the screen requires services
      // context — but declared, so the field stays printable.
      absentNote: '(no services context)',
      pageSize: WHO_PAGE_SIZE,
    }),
  ],
  toObject: (v, o) => {
    // The label rides along with the uuid, so the criteria summary can NAME
    // the user without a second lookup (D3).
    const hit = (o.who ?? []).find((u) => u.id === v.who);
    return hit ? { id: hit.id, label: hit.label } : null;
  },
});

export type WhoFilterState = FormState<WhoFilterValues>;
