import { DrupalJsonApiParams } from 'drupal-jsonapi-params';
import type { DropshClient } from '../../../types.js';
import type { JsonApiCollectionDoc } from '../../collection.js';
import { countActiveMembersByTeam, teamsFrom } from './teams.js';

// BB-391 (AC4) — ONE team. The twin of `Entity/project/Data/project.ts`, which
// resolves a project's identity without reading anything the project owns.
//
// The member count comes along because it is the only figure the team DETAIL has
// that the team-scoped statistics do not already serve: `?team_id=` narrows the
// counts to the team's active members but reports no headcount of its own.

/** One team, resolved: identity, workspace, and headcount when countable. */
export interface ResolvedTeam {
  id: string;
  /** Never empty — the uuid is the last fallback, so nothing renders blank. */
  name: string;
  workspace: string | undefined;
  /**
   * Active members, or `null` for NOT COUNTED — see
   * {@link countActiveMembersByTeam}. Never `0` as a stand-in for a refused read.
   */
  members: number | null;
}

/**
 * Resolve one team by uuid, with its workspace name and member count.
 *
 * Filtered rather than paged: the detail knows the uuid it was routed with, so it
 * asks for that team instead of walking the collection the list already walked.
 * The two reads go in parallel — neither answer depends on the other — and a
 * refused membership read leaves the identity intact with `members: null`.
 */
export async function resolveTeam(
  client: DropshClient,
  teamId: string,
): Promise<ResolvedTeam> {
  const params = new DrupalJsonApiParams()
    .addFilter('id', teamId)
    .addInclude(['workspace_id']);
  const [doc, counts] = await Promise.all([
    (async (): Promise<JsonApiCollectionDoc> => {
      try {
        return (await client.get(
          'bb_team/bb_team',
          params,
        )) as JsonApiCollectionDoc;
      } catch {
        return {};
      }
    })(),
    countActiveMembersByTeam(client),
  ]);

  const team = teamsFrom(doc)[0];
  if (team === undefined) {
    return { id: teamId, name: teamId, workspace: undefined, members: null };
  }
  return {
    id: team.id,
    name: team.name,
    workspace: team.workspace,
    members:
      counts === null || team.internalId === undefined
        ? null
        : (counts.get(team.internalId) ?? 0),
  };
}
