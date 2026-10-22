import { DrupalJsonApiParams } from 'drupal-jsonapi-params';
import type { DropshClient, JsonApiResource } from '../../../types.js';
import { LIST_PAGE_SIZE } from '../../cycle.js';

/** Complete project UUID set linked to one team. */
export async function listLinkedProjectIds(
  client: DropshClient,
  teamId: string,
): Promise<string[]> {
  const ids: string[] = [];
  let offset = 0;
  while (true) {
    const params = new DrupalJsonApiParams()
      .addFilter('teams.id', teamId)
      .addSort('drupal_internal__id', 'ASC')
      .addPageLimit(LIST_PAGE_SIZE);
    if (offset > 0) params.addPageOffset(offset);
    const document = (await client.get('bb_project/bb_project', params)) as {
      data?: JsonApiResource[];
      links?: { next?: unknown };
      meta?: { omitted?: unknown };
    };
    if (document.meta?.omitted !== undefined) {
      throw new Error('the control plane withheld linked project rows');
    }
    ids.push(
      ...(document.data ?? []).flatMap((project) =>
        project.id ? [project.id] : [],
      ),
    );
    if (!document.links?.next) return ids;
    offset += LIST_PAGE_SIZE;
  }
}
