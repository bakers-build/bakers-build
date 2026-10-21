import { DrupalJsonApiParams } from 'drupal-jsonapi-params';
import type {
  DropshClient,
  JsonApiRelationship,
  JsonApiResource,
} from '../../../types.js';
import { LIST_PAGE_SIZE } from '../../cycle.js';

export type MemberParentType = 'bb_team' | 'bb_workspace';

const relationshipId = (
  relationship: JsonApiRelationship | undefined,
): string | undefined => {
  const data = relationship?.data;
  return data && !Array.isArray(data) ? data.id : undefined;
};

/** Reject a contextual member route unless the user is active in its parent. */
export async function assertActiveMember(
  client: DropshClient,
  parentType: MemberParentType,
  parentId: string,
  userId: string,
): Promise<void> {
  const parent = await client
    .collection(parentType)
    .where('id', '=', parentId)
    .first();
  const internalId = parent?.attr('drupal_internal__id');
  if (typeof internalId !== 'number' && typeof internalId !== 'string') {
    throw new Error(`no readable ${parentType} with uuid ${parentId}`);
  }

  let offset = 0;
  while (true) {
    const params = new DrupalJsonApiParams()
      .addFilter('entity_type', parentType)
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
      throw new Error(`the control plane withheld ${parentType} memberships`);
    }
    if (
      (document.data ?? []).some(
        (row) => relationshipId(row.relationships?.uid) === userId,
      )
    ) {
      return;
    }
    if (!document.links?.next) {
      throw new Error(
        `user ${userId} is not an active member of ${parentType} ${parentId}`,
      );
    }
    offset += LIST_PAGE_SIZE;
  }
}
