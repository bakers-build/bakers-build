import type { JsonApiClient } from 'dropsh/plugin';
import type { BbProjectSelection } from './cli/project-context.js';

export interface ResolvedBbProjectContext {
  projectId: string;
  project: string;
  workspaceId: string;
  workspace: string;
}

export class AmbiguousProjectNameError extends Error {
  override readonly name = 'AmbiguousProjectNameError';
}

export async function resolveBbProjectContext(
  client: JsonApiClient,
  selection: BbProjectSelection,
): Promise<ResolvedBbProjectContext> {
  let selectedWorkspace: { id: string; name: string } | undefined;
  if (selection.workspace) {
    const workspaces = await client
      .collection('bb_workspace')
      .where('name', '=', selection.workspace)
      .page(2)
      .list();
    const matchingWorkspace = workspaces[0];
    if (workspaces.length !== 1 || !matchingWorkspace) {
      const reachable = await client
        .collection('bb_workspace')
        .page(100)
        .list();
      const names = reachable.map((row) => row.attr<string>('name') ?? row.id);
      throw new Error(
        `${workspaces.length ? 'Ambiguous' : 'Unknown'} workspace "${selection.workspace}". Reachable workspaces: ${names.join(', ') || '(none)'}.`,
      );
    }
    selectedWorkspace = { id: matchingWorkspace.id, name: selection.workspace };
  }
  let query = client
    .collection('bb_project')
    .where('name', '=', selection.project);
  if (selectedWorkspace)
    query = query.where('group_id.workspace_id.id', '=', selectedWorkspace.id);
  const projects = await query.page(2).list();
  if (projects.length === 0) {
    const reachable = selectedWorkspace
      ? selectedWorkspace.name
      : (await client.collection('bb_workspace').page(100).list())
          .map((row) => row.attr<string>('name') ?? row.id)
          .join(', ');
    throw new Error(
      `bakers.build project "${selection.project}" not found. Reachable workspaces: ${reachable || '(none)'}.`,
    );
  }
  const contexts = await Promise.all(
    projects.map(async (project) => {
      const groupId = project.rel('group_id');
      if (!groupId)
        throw new Error(
          `bakers.build project "${selection.project}" has no owning group.`,
        );
      const group = await client.resource('bb_group', groupId);
      const workspaceId = group.rel('workspace_id');
      if (!workspaceId)
        throw new Error(
          `bakers.build project "${selection.project}" has no owning workspace.`,
        );
      const workspace = await client.resource('bb_workspace', workspaceId);
      return {
        projectId: project.id,
        project: selection.project,
        workspaceId,
        workspace: workspace.attr<string>('name') ?? workspaceId,
      };
    }),
  );
  if (contexts.length > 1)
    throw new AmbiguousProjectNameError(
      `bakers.build project "${selection.project}" is ambiguous: ${contexts.map((row) => `${row.workspace}/${row.project} (${row.projectId})`).join(', ')}. Commit bakers.workspace to disambiguate.`,
    );
  const context = contexts[0];
  if (!context)
    throw new Error(`bakers.build project "${selection.project}" not found.`);
  return context;
}
