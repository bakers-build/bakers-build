// BB-540 — the My work PARENT CANDIDATE read. Mirrors `loadParentCandidates`
// from `parents.ts` but does NOT scope the read by `filter[project_id.id]`:
// My work spans every project the operator is assigned to, so a parent picker
// they reach from My work must offer parents from all of them.
//
// The remaining policy bits stay: `parent: null` and `who: null` criteria
// (F7), so an active parent filter can never narrow the picker to that
// parent's own children, and `has_children = 1` so the picker offers only
// tickets that CAN be picked.

import { DrupalJsonApiParams } from 'drupal-jsonapi-params';
import type { DropshClient, JsonApiResource } from '../../../types.js';
import type { JsonApiCollectionDoc } from '../../collection.js';
import { type ListOutcome, messageOf } from '../../transport.js';
import type { ParentCandidate } from './parents.js';

/** A page of candidates for the My work parent picker. */
export const MY_WORK_PARENT_PAGE_SIZE = 50;

const toCandidate = (item: JsonApiResource): ParentCandidate => {
  const id = item.id ?? '';
  return {
    id,
    identifier: (item.attributes?.identifier as string | undefined) ?? id,
    title: (item.attributes?.title as string | undefined) ?? 'Untitled',
  };
};

/**
 * One page of tickets that have children, across every project.
 *
 * The `filter[identifier][operator]=CONTAINS` shape is the same one the
 * project-scoped parent picker uses for `match === 'identifier'` (BB-284,
 * PM steer). `has_children = 1` filters on the server side via
 * `HasChildrenFilterSubscriber`.
 */
export async function loadAllParentCandidates(
  client: DropshClient,
  query: string,
): Promise<ListOutcome<ParentCandidate>> {
  const params = new DrupalJsonApiParams()
    .addPageLimit(MY_WORK_PARENT_PAGE_SIZE)
    .addFields('bb_ticket--bb_ticket', ['identifier', 'title']);
  if (query) params.addFilter('identifier', query, 'CONTAINS');
  params.addFilter('has_children', '1');
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
