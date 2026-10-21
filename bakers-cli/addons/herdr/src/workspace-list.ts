import { isRecord, parseJson } from './pane-layout.js';

/** One `herdr workspace list` entry. */
export interface WorkspaceEntry {
  workspaceId: string;
  /** Workspace label; null when herdr omits it. */
  label: string | null;
  focused: boolean;
  isLinkedWorktree: boolean;
  /** The worktree's parent repo root — the shared key between a linked
   * ticket worktree and its main checkout. Null when herdr reports none. */
  repoRoot: string | null;
  /** The workspace's checkout directory. Null when herdr reports none. */
  checkoutPath: string | null;
}

/**
 * Parse `herdr workspace list` (which always emits JSON; it takes no `--json`
 * flag). Enumerates every workspace on the host with its `label`, `focused`
 * flag and its `worktree.{is_linked_worktree,repo_root}`.
 */
export function parseWorkspaceList(output: string): WorkspaceEntry[] {
  const parsed = parseJson(output, 'workspace list');
  const workspaces = isRecord(parsed)
    ? (parsed.result as { workspaces?: unknown } | undefined)?.workspaces
    : undefined;
  if (!Array.isArray(workspaces)) {
    return [];
  }
  return workspaces
    .filter(isRecord)
    .filter((w) => typeof w.workspace_id === 'string')
    .map((w) => {
      const wt = isRecord(w.worktree) ? w.worktree : undefined;
      return {
        workspaceId: w.workspace_id as string,
        label: typeof w.label === 'string' ? w.label : null,
        focused: w.focused === true,
        isLinkedWorktree: wt?.is_linked_worktree === true,
        repoRoot: typeof wt?.repo_root === 'string' ? wt.repo_root : null,
        checkoutPath:
          typeof wt?.checkout_path === 'string' ? wt.checkout_path : null,
      };
    });
}
