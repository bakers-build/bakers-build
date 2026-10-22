import { resolveBbProjectContext } from '@bakers-build/conductor/contract';
import { readBbProjectSelection } from '@bakers-build/conductor/project-context';
import {
  type BbCommandHost,
  createBbConnectionClient,
  discoverBbWorkspaces,
  loadReadyBbConnection,
  resolveConfigPath,
} from '@bakers-build/core';

/**
 * The resolved project/workspace context (BB-495). A value that cannot be
 * resolved is `null` (or `[]` for `workspace_ids`), never omitted — the shape
 * is always stable, which is what lets an unattended agent parse it without a
 * presence check per key.
 */
export interface BbInfoResult {
  project: string | null;
  project_id: string | null;
  workspace: string | null;
  workspace_id: string | null;
  workspace_ids: string[];
}

export interface ResolveBbInfoOptions {
  host: BbCommandHost;
  /** Defaults to `process.env`; injectable for tests. */
  env?: Record<string, string | undefined>;
  cwd?: string;
  explicitConfig?: string;
  connection?: string;
}

/**
 * Resolve the five context values BB-495 D3 gives an agent: read the
 * reserved env vars the conductor set at dispatch first (the fast path), and
 * for any that is unset, resolve it live over the connection — never
 * prompting, never writing to disk. This is what `bakers info` covers: the
 * agent that was not started by the conductor, and the shell where nothing
 * is set.
 */
export async function resolveBbInfo(
  opts: ResolveBbInfoOptions,
): Promise<BbInfoResult> {
  const env = opts.env ?? process.env;
  let project: string | null = env.BB_PROJECT ?? null;
  let projectId: string | null = env.BB_PROJECT_ID ?? null;
  let workspace: string | null = env.BB_WORKSPACE ?? null;
  let workspaceId: string | null = env.BB_WORKSPACE_ID ?? null;
  let workspaceIds: string[] = env.BB_WORKSPACE_IDS
    ? env.BB_WORKSPACE_IDS.split(',').filter((id) => id !== '')
    : [];

  const loadOpts: {
    cwd?: string;
    explicit: string | undefined;
    connection?: string;
    workspaceSelector?: string;
    workspaceIdOverride?: string;
  } = {
    ...(opts.cwd !== undefined ? { cwd: opts.cwd } : {}),
    explicit: opts.explicitConfig,
    ...(opts.connection ? { connection: opts.connection } : {}),
  };

  // Resolving the project layer is part of the same optional read as parsing
  // it: standing outside any checkout is not an error here, it is the ordinary
  // situation of someone who has a machine and a connection and no project
  // yet. Both the failed walk and an absent file report ENOENT, so the
  // connection-derived keys below still answer.
  let configured: ReturnType<typeof readBbProjectSelection> | undefined;
  try {
    configured = readBbProjectSelection(
      resolveConfigPath(undefined, opts.cwd ?? process.cwd()),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  if (project === null && configured) project = configured.project;
  if (workspace === null && configured?.workspace)
    workspace = configured.workspace;
  if (configured?.workspace) loadOpts.workspaceSelector = configured.workspace;
  if (configured && !configured.workspace) loadOpts.workspaceIdOverride = '';

  let connection: Awaited<ReturnType<typeof loadReadyBbConnection>> | null =
    null;
  if (
    workspace === null ||
    workspaceId === null ||
    workspaceIds.length === 0 ||
    (projectId === null && project !== null)
  ) {
    try {
      connection = await loadReadyBbConnection(opts.host, loadOpts);
      if (workspaceId === null) workspaceId = connection.workspace_id ?? null;
      if (workspace === null && connection.workspace_id) {
        try {
          const client = await createBbConnectionClient(connection);
          const ws = await client.resource(
            'bb_workspace',
            connection.workspace_id,
          );
          workspace = ws.attr<string>('name') ?? null;
        } catch {
          // Leave workspace null — the connection resolved but the resource
          // read did not; workspace_id/workspace_ids may still be usable.
        }
      }
      if (workspaceIds.length === 0) {
        try {
          const choices = await discoverBbWorkspaces(connection);
          workspaceIds = choices.map((c) => c.id);
        } catch {
          // Leave workspace_ids empty — not a hard failure for the other keys.
        }
      }
    } catch {
      // No usable connection — every connection-derived key stays null/empty.
    }
  }

  if (projectId === null && configured) {
    connection ??= await loadReadyBbConnection(opts.host, loadOpts);
    const client = await createBbConnectionClient(connection);
    const context = await resolveBbProjectContext(client, configured);
    projectId = context.projectId;
    project = context.project;
    workspaceId = context.workspaceId;
    workspace = context.workspace;
  }

  return {
    project,
    project_id: projectId,
    workspace,
    workspace_id: workspaceId,
    workspace_ids: workspaceIds,
  };
}
