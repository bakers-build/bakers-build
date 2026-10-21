import type { DropshClient } from '../../../types.js';

/** A `bb_workspace` reachable by the identity, as the picker lists it. */
export interface WorkspaceOption {
  id: string;
  name: string;
}

/**
 * The workspaces the authenticated identity can see, for the cockpit's
 * workspace-picker (BB-472).
 *
 * Deliberately ONE page (`.list()`, the client's default page size), not the
 * full-pagination walk `@bakers-build/core`'s `discoverBbWorkspaces` does: that
 * walk exists for `bakers ui`'s startup recovery, which runs before any screen
 * and has no `DropshClient` — only a raw JSON:API `get`. Here the cockpit
 * already has a `DropshClient.collection()`, and the operating model this
 * ticket documents is one
 * conductor per workspace — an identity choosing between a HANDFUL of
 * workspaces, not paging through hundreds.
 */
export async function loadWorkspaces(
  client: DropshClient,
): Promise<WorkspaceOption[]> {
  const rows = await client.collection('bb_workspace').list();
  return rows.map((row) => ({
    id: row.id,
    name: (row.attr('name') as string | undefined) ?? row.id,
  }));
}
