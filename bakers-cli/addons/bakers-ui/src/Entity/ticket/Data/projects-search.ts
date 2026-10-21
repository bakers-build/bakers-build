// BB-540 — the PROJECT CANDIDATE read for the project-filter picker (the
// My work screen's `r` key on the bar). A data module like its neighbours:
// it returns projects and knows nothing about forms, `Option`s or popups; the
// label, the form declaration and the screen all sit above this file (boundary
// guard G2, the `Data/` leaf rule).
//
// The query is built directly against `bb_project` (not through
// `buildTicketQueryParams`, since this read is NOT a ticket read): every
// bb_project the operator can name is fair game, and the
// `filter[name][operator]=CONTAINS&filter[name][value]=<query>` form is
// exactly what Drupal JSON:API expects. `display_name`-style computed fields
// would not be filterable; `name` is the canonical label.

import { DrupalJsonApiParams } from 'drupal-jsonapi-params';
import { asString } from '../../../lib/format.js';
import type { DropshClient, JsonApiResource } from '../../../types.js';
import type { JsonApiCollectionDoc } from '../../collection.js';
import { type ListOutcome, messageOf } from '../../transport.js';

/** One project offered as a possible filter, as the picker needs it. */
export interface ProjectCandidate {
  id: string;
  /** The project's `name`; falls back to the uuid, so nothing renders blank. */
  name: string;
}

/**
 * The most rows one read can return: Drupal's `OffsetPage::SIZE_MAX`, verified
 * against the control plane.
 *
 * Exported because a bag of exactly this length may be a TRUNCATED answer, and
 * only the module that performs the read knows the number. The picker does
 * not currently disclose truncation here (project names are short and a small
 * bag is rare), but the constant is the same shape `parents` and `users`
 * already publish so a future disclosure can find it.
 */
export const PROJECT_PAGE_SIZE = 50;

const toCandidate = (item: JsonApiResource): ProjectCandidate => {
  const id = item.id ?? '';
  return {
    id,
    name: asString(item.attributes?.name) ?? id,
  };
};

/**
 * One page of projects whose `name` contains the typed fragment.
 *
 * `name` is a plain string field on `bb_project` (no `display_name`
 * computed field), so `filter[name][operator]=CONTAINS` is a real server-side
 * filter — matching is name-only, the same restriction the Who picker's
 * matching carries for the same reason (R4 of BB-299). The two-character
 * gate (AC-3 of BB-540) is THIS field's policy, encoded in the source that
 * calls this read, NOT here — the data layer returns whatever it was asked
 * for, including an empty array for the empty query.
 *
 * Yields the OUTCOME rather than a swallowed array, so the adapter can record
 * a `projects` error like every other option bag (D4) instead of presenting an
 * empty candidate list as "no projects exist".
 */
export async function loadProjectCandidates(
  client: DropshClient,
  query: string,
): Promise<ListOutcome<ProjectCandidate>> {
  const params = new DrupalJsonApiParams();
  if (query) params.addFilter('name', query, 'CONTAINS');
  params.addPageLimit(PROJECT_PAGE_SIZE);
  try {
    const doc = (await client.get(
      'bb_project/bb_project',
      params,
    )) as JsonApiCollectionDoc;
    return { rows: (doc?.data ?? []).map(toCandidate) };
  } catch (caught) {
    return { rows: [], error: messageOf(caught) };
  }
}
