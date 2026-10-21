import { DrupalJsonApiParams } from 'drupal-jsonapi-params';
import type { DropshClient, JsonApiRelationship } from '../../../types.js';
import { messageOf } from '../../transport.js';
import {
  MEMBERSHIP_PAGE_CAP,
  MEMBERSHIP_PAGE_SIZE,
  readMembershipPage,
  teamsFrom,
} from './teams.js';

// BB-391 AC4 (second round) — WHO is in one crew, as the team level's Users tab
// needs it.
//
// Uuids and nothing else. Resolving a uuid to a person is the `user` slice's job
// and a `Data/` module may not reach into another slice (boundary G2), so the
// SCREEN composes the two reads — the same shape `Entity/user/Screen/` already
// used to merge a user collection with the statistics document.
//
// The join is `drupal_internal__id`: `og_membership.entity_id` is a plain STRING
// base field carrying the group's NUMERIC id (BB-321 Fact 12), never its uuid.
// The routed uuid therefore has to be resolved to that number first, which is one
// extra read and the reason this is not a single filtered query.
//
// THIRD ROUND — both of this file's assumptions about the server are now
// measured rather than inferred, on a running control plane:
//
//   * `uid` is published as a RELATIONSHIP under exactly that public name
//     (`ResourceTypeRelationship`, public name `uid`), so
//     `relationships.uid.data.id` is correct. `entity_id` and `state` are
//     ATTRIBUTES; the bundle is published as `og_membership_type`, not `type`.
//   * `filter[entity_id]` resolves — a token read filtered on `entity_id=1`
//     returned exactly that crew's three rows, at HTTP 200 and with no 400.
//
// And the failure mode neither of them covers: a control plane that still
// REFUSES this read does not throw. It answers HTTP 200 with `data: []` and a
// `meta.omitted` block, so the walk would report an EMPTY crew — a real answer an
// operator can act on — for one it was never allowed to see. Hence the shared
// page reader in `teams.ts`, which reports that block as `withheld`.

/**
 * The member users of one crew, by uuid, in server order.
 *
 * `ids: null` is NOT ESTABLISHED — the team did not resolve, the membership read
 * was refused, or the walk outran its page cap. An EMPTY array is a measurement:
 * nobody is in this crew. The two must not collapse into one, because only one of
 * them is something an operator can act on.
 */
export interface TeamMemberIds {
  ids: string[] | null;
  /** Why `ids` is null; absent whenever `ids` is an array. */
  error?: string;
}

/** Id of a single-valued relationship linkage (`data` object), or undefined. */
function relId(rel: JsonApiRelationship | undefined): string | undefined {
  const data = rel?.data;
  if (!data || Array.isArray(data)) return undefined;
  return data.id ?? undefined;
}

/**
 * The active `bb_team` members of one team, as user uuids.
 *
 * Read from the RELATIONSHIP rather than through an `include`: `og_membership`
 * carries its member as `uid`, and a JSON:API document publishes a
 * relationship's linkage whether or not it was asked to sideload the resource.
 * The uuid is all this function returns, so the sideload would be payload nobody
 * here reads.
 *
 * PAGED against `links.next`, the only end-of-collection signal there is — the
 * server caps a page at 50 rows whatever `page[limit]` asked for. A walk that
 * outruns {@link MEMBERSHIP_PAGE_CAP} yields `null`, not the prefix it reached:
 * a crew list silently missing its last members is worse than one that admits it
 * does not know.
 */
export async function listTeamMemberIds(
  client: DropshClient,
  teamId: string,
): Promise<TeamMemberIds> {
  const internalId = await resolveInternalId(client, teamId);
  if (typeof internalId !== 'string') return internalId;

  const ids: string[] = [];
  for (let index = 0; index < MEMBERSHIP_PAGE_CAP; index += 1) {
    try {
      const page = await readMembershipPage(
        client,
        { entity_type: 'bb_team', entity_id: internalId },
        index * MEMBERSHIP_PAGE_SIZE,
      );
      // Checked BEFORE the rows are collected: a page that withheld some rows
      // and returned others would otherwise yield a crew list that is silently
      // missing people, which is the one thing this function refuses to return.
      if (page.withheld) {
        return {
          ids: null,
          error:
            'the control plane withheld the membership rows (meta.omitted) — ' +
            'the crew was not listed',
        };
      }
      for (const row of page.rows) {
        const id = relId(row.relationships?.uid);
        // A membership row naming no user is skipped rather than counted as an
        // anonymous member — there is no such person to open.
        if (id !== undefined) ids.push(id);
      }
      if (!page.hasNext) return { ids };
    } catch (caught) {
      return { ids: null, error: messageOf(caught) };
    }
  }
  return {
    ids: null,
    error: `more than ${MEMBERSHIP_PAGE_CAP * MEMBERSHIP_PAGE_SIZE} memberships — the crew was not listed`,
  };
}

/**
 * The team's `drupal_internal__id`, or the failure to report instead of it.
 *
 * A team that does not resolve gets NO membership query at all: without an
 * `entity_id` to filter by, the only query left would count every `bb_team`
 * membership on the instance and present the result as this crew's.
 */
async function resolveInternalId(
  client: DropshClient,
  teamId: string,
): Promise<string | TeamMemberIds> {
  const params = new DrupalJsonApiParams().addFilter('id', teamId);
  try {
    const doc = await client.get('bb_team/bb_team', params);
    const team = teamsFrom(doc as Parameters<typeof teamsFrom>[0])[0];
    if (team?.internalId === undefined) {
      return { ids: null, error: `no readable bb_team with uuid ${teamId}` };
    }
    return team.internalId;
  } catch (caught) {
    return { ids: null, error: messageOf(caught) };
  }
}
