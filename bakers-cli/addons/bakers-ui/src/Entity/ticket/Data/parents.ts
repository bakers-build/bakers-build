// BB-257 D7 — the PARENT CANDIDATE read: the tickets of one project that a new
// ticket could be filed under. A data module like its neighbours — it returns
// tickets and knows nothing about forms, `Option`s or popups; composing a picker
// label out of these two attributes is the adapter's job, and the boundary guard
// G2 keeps this file on the data side of that line.
//
// The query is built by `buildTicketQueryParams`, the SAME builder the project
// screen's `/` search uses, and that reuse is the argument rather than a
// convenience: it already implements the project filter plus the free-text
// search, so the parent picker cannot drift from the ticket list. How WIDE the
// search matches is the caller's choice (`match`): the edit form keeps the
// builder's server-resolved identifier+title search (BB-257 S5), while the parent FILTER
// picker matches by identifier only — the operator knows `BB-273`, not the
// title (BB-284, PM steer during coding) — and asks for tickets WITH
// children only (`filter[has_children]=1`, BB-300 D1, answered server-side
// by bb_core's HasChildrenFilterSubscriber).

import { asString } from '../../../lib/format.js';
import type { DropshClient, JsonApiResource } from '../../../types.js';
import type { JsonApiCollectionDoc } from '../../collection.js';
import { type ListOutcome, messageOf } from '../../transport.js';
import { buildTicketQueryParams } from './query.js';

/** One ticket offered as a possible parent, as the picker needs it. */
export interface ParentCandidate {
  id: string;
  /** `BB-nnn`; falls back to the uuid, so nothing renders as blank. */
  identifier: string;
  title: string;
}

/**
 * The primary type's sparse fieldset.
 *
 * A `bb_ticket` carries its whole description, and a page holds up to 50 of
 * them; the picker renders `BB-nnn · title` and needs nothing else.
 */
const FIELDS: string[] = ['identifier', 'title'];

/**
 * The most rows one read can return: Drupal's `OffsetPage::SIZE_MAX`, verified
 * against the control plane.
 *
 * Exported because a bag of exactly this length may be a TRUNCATED answer, and
 * only the module that performs the read knows the number. The picker discloses
 * it (R3: never imply the list is complete); it cannot infer it, since a full
 * page and a project with exactly this many tickets look identical from there.
 */
export const PARENT_PAGE_SIZE = 50;

const toCandidate = (item: JsonApiResource): ParentCandidate => {
  const id = item.id ?? '';
  return {
    id,
    identifier: asString(item.attributes?.identifier) ?? id,
    title: asString(item.attributes?.title) ?? 'Untitled',
  };
};

/**
 * One project's tickets matching `query`, as parent candidates.
 *
 * `match` picks how wide `query` matches: `'identifier+title'` (the default,
 * the edit form's Parent field — BB-257 S5) is the builder's free-text OR
 * group; `'identifier'` (the parent FILTER picker — BB-284, PM steer) is a
 * top-level `identifier CONTAINS` added after the builder, because the
 * operator filtering a list knows the identifier, not the title. The
 * identifier path also carries `filter[has_children]=1` (BB-300 D1): the
 * picker offers only tickets that HAVE children, answered server-side by
 * bb_core's HasChildrenFilterSubscriber; the edit form emits no such
 * filter, because a ticket must be fileable under a childless parent. The
 * `closed` filter runs the other way round (BB-309 D13): the edit form
 * offers OPEN tickets only, the filter picker sends no `closed` filter at all.
 *
 * Yields the OUTCOME rather than a swallowed array, so the adapter can record a
 * `parents` error like every other option bag (D4) instead of presenting an
 * empty candidate list as "this project has no tickets".
 */
export async function loadParentCandidates(
  client: DropshClient,
  projectId: string,
  query: string,
  match: 'identifier+title' | 'identifier' = 'identifier+title',
): Promise<ListOutcome<ParentCandidate>> {
  const params = buildTicketQueryParams(
    projectId,
    {
      query: match === 'identifier' ? '' : query,
      state: null,
      // BB-309 D13 — the two callers answer different questions, so they
      // filter differently. The EDIT FORM offers OPEN tickets only
      // (`filter[closed]=0`): filing work under a parent that is already
      // finished is not a case the form should present. That reverses the
      // rationale this line carried until BB-309 ("the parent picker must
      // still find a closed ticket to attach a follow-up to", BB-257 D6).
      // The parent FILTER picker keeps `null`, i.e. no `closed` filter at all:
      // narrowing a ticket list by a parent that has since been closed is
      // legitimate, and its children may well still be open.
      closed: match === 'identifier' ? null : false,
      // Explicitly null: the candidate read must never see the filter it feeds
      // (BB-284 F7/R2) — an active parent filter passed through here would
      // narrow the picker to that parent's own children.
      parent: null,
      // The same rule for the Who filter (BB-299): the candidate read takes
      // no criteria, so an active who can never narrow the parent picker.
      who: null,
      // Same rule for the owner filter (BB-416).
      owner: null,
      project: null,
    },
    // Its own page, stated explicitly: the picker discloses truncation at
    // PARENT_PAGE_SIZE, so inheriting the list's LIST_PAGE_SIZE (20 since
    // BB-292 D6a) would make that a lie.
    // And no includes — see below.
    { page: { size: PARENT_PAGE_SIZE, index: 0 }, includes: false },
  );
  if (match === 'identifier' && query)
    params.addFilter('identifier', query, 'CONTAINS');
  // BB-300 D1 — the parent FILTER picker offers only tickets that have
  // children; the server rewrites this param into a stock id IN (…) filter
  // (bb_core's HasChildrenFilterSubscriber), so paging stays honest. The
  // edit form (identifier+title) deliberately emits NO such filter: it must
  // be able to file a ticket under a childless parent.
  if (match === 'identifier') params.addFilter('has_children', '1');
  // Narrowed AFTER the shared builder rather than inside it: the builder serves
  // the ticket TABLE, which renders state, priority, assignee and more, and
  // `addFields` REPLACES a previous set for the same type (verified), so this
  // narrower set wins. The reuse argument of D7 is untouched.
  //
  // The builder's includes are switched OFF rather than kept: a sparse fieldset
  // that omits `parent_id`/`conductor_id` strips those relationships from the
  // rows, so the sideloaded resources arrive with nothing pointing at them
  // (BB-292 spec fact 5). The previous comment here claimed they survived;
  // measured, they did not, and the picker never rendered them anyway.
  params.addFields('bb_ticket--bb_ticket', FIELDS);
  try {
    const doc = (await client.get(
      'bb_ticket/bb_ticket',
      params,
    )) as JsonApiCollectionDoc;
    return { rows: (doc?.data ?? []).map(toCandidate) };
  } catch (caught) {
    return { rows: [], error: messageOf(caught) };
  }
}
