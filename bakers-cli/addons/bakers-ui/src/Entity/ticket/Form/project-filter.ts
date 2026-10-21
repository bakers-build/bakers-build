// BB-540 — the project-filter picker as a DECLARATION over the form kernel
// (BB-236), mirroring the BB-299 `WHO_FILTER_FORM`: one `autocomplete`
// field, and one `toObject` that yields the picked project as the criterion
// the ticket list filters by. The mechanics — typing, the kernel's local
// filter, the suggestion cursor, pick and cancel — all live in `Form/`;
// nothing of them is repeated here.
//
// The screen's only project read is `loadProjectCandidates`, composed as
// `projectOptionSource` — never a second lookup path.

import { declareForm, type FormState } from '../../../Form/index.js';
import { PROJECT_PAGE_SIZE } from '../Data/projects-search.js';
import type { ProjectCriterion } from '../Data/query.js';

export interface ProjectFilterValues {
  /** The PICKED project's uuid, or null. `projectQuery` holds what was typed. */
  project: string | null;
  projectQuery: string;
}

export interface ProjectFilterOptions {
  /**
   * The project candidates. Optional so an ABSENT bag ("nothing can be offered")
   * stays distinguishable from an empty one ("searched, nothing matched") — the
   * same rule as the who filter's `who` bag.
   */
  projects?: { id: string; label: string }[] | undefined;
  errors?: { projects?: string | undefined } | undefined;
}

/** The picked project, as `TicketCriteria.project` carries it. */
export type ProjectFilterPayload = ProjectCriterion | null;

/**
 * The declaration. One field, no action row: Enter on the autocomplete IS the
 * commit — the screen backs with the payload on `submit`.
 */
export const PROJECT_FILTER_FORM = declareForm<
  ProjectFilterValues,
  ProjectFilterOptions,
  ProjectFilterPayload
>({
  fields: (f) => [
    f.autocomplete('project', 'Project', {
      from: 'projects',
      query: 'projectQuery',
      // AC-3: clearing IS a commit — the null payload reaches the list, which
      // drops the project criterion and keeps the rest.
      clearable: true,
      // Defensive: unreachable from this route — the screen requires services
      // context — but declared, so the field stays printable.
      absentNote: '(no services context)',
      pageSize: PROJECT_PAGE_SIZE,
    }),
  ],
  toObject: (v, o) => {
    // The label rides along with the uuid, so the criteria summary can NAME
    // the project without a second lookup (AC-2).
    const hit = (o.projects ?? []).find((p) => p.id === v.project);
    return hit ? { id: hit.id, label: hit.label } : null;
  },
});

export type ProjectFilterState = FormState<ProjectFilterValues>;
