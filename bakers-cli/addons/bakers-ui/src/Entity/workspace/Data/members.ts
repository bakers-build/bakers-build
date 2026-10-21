import { DrupalJsonApiParams } from 'drupal-jsonapi-params';
import type {
  DropshClient,
  JsonApiRelationship,
  JsonApiResource,
} from '../../../types.js';
import { LIST_PAGE_SIZE } from '../../cycle.js';

export const WORKSPACE_LEAD_ROLE = 'bb_workspace-bb_workspace-lead';

interface RoleLinkage {
  id?: string;
  meta?: { drupal_internal__target_id?: unknown };
}

export interface WorkspaceMemberships {
  memberIds: string[];
  leadIds: Set<string>;
}

const singleId = (relationship: JsonApiRelationship | undefined) => {
  const data = relationship?.data;
  return data && !Array.isArray(data) ? data.id : undefined;
};

/** Complete active roster for one workspace, including the explicit lead rank. */
export async function loadWorkspaceMemberships(
  client: DropshClient,
  workspaceId: string,
): Promise<WorkspaceMemberships> {
  const workspace = await client
    .collection('bb_workspace')
    .where('id', '=', workspaceId)
    .first();
  const internalId = workspace?.attr('drupal_internal__id');
  if (typeof internalId !== 'number' && typeof internalId !== 'string') {
    throw new Error(`no readable bb_workspace with uuid ${workspaceId}`);
  }

  const memberIds: string[] = [];
  const leadIds = new Set<string>();
  let offset = 0;
  while (true) {
    const params = new DrupalJsonApiParams()
      .addFilter('entity_type', 'bb_workspace')
      .addFilter('entity_id', String(internalId))
      .addFilter('state', 'active')
      .addSort('drupal_internal__id', 'ASC')
      .addPageLimit(LIST_PAGE_SIZE);
    if (offset > 0) params.addPageOffset(offset);
    const document = (await client.get('og_membership/default', params)) as {
      data?: JsonApiResource[];
      links?: { next?: unknown };
      meta?: { omitted?: unknown };
    };
    if (document.meta?.omitted) {
      throw new Error('the control plane withheld workspace memberships');
    }
    for (const row of document.data ?? []) {
      const userId = singleId(row.relationships?.uid);
      if (!userId) continue;
      memberIds.push(userId);
      const roles = row.relationships?.roles?.data;
      if (
        Array.isArray(roles) &&
        roles.some(
          (role) =>
            (role as RoleLinkage).meta?.drupal_internal__target_id ===
            WORKSPACE_LEAD_ROLE,
        )
      ) {
        leadIds.add(userId);
      }
    }
    if (!document.links?.next) return { memberIds, leadIds };
    offset += LIST_PAGE_SIZE;
  }
}
