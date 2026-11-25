import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_WORKTREE_DIR } from '@bakers-build/addon-workspace-git';
import type { ConductorLogger } from '@bakers-build/core';
import type { OpenLayout } from './open-layout.js';
import { type HerdrExec, isRecord, parseJson } from './pane-layout.js';
import { parseWorkspaceList, type WorkspaceEntry } from './workspace-list.js';
import { ensureFocusSafeToRemove, normPath } from './worktrees.js';

export interface HerdrTab {
  tabId: string;
  label: string;
}

export function parseTabList(output: string): HerdrTab[] {
  const parsed = parseJson(output, 'tab list');
  const tabs = isRecord(parsed)
    ? (parsed.result as { tabs?: unknown } | undefined)?.tabs
    : undefined;
  if (!Array.isArray(tabs)) {
    return [];
  }
  return tabs
    .filter(isRecord)
    .filter((t) => typeof t.tab_id === 'string' && typeof t.label === 'string')
    .map((t) => ({
      tabId: t.tab_id as string,
      label: t.label as string,
    }));
}

/** What closing a branch workspace needs. */
export interface WorkspaceCloseDeps {
  /** The parent repo root; its own workspace is never closed. */
  root?: string;
  execHerdr: HerdrExec;
  logger: ConductorLogger;
  /** The open layout the executor applied to the workspace's first tab. */
  open: OpenLayout;
}

/**
 * Why the workspace holds more than bakers terminals, or null when it holds
 * only those: no pane reports an agent, every tab but the first is a run tab
 * (`#<runId>` label), and the first (open-layout) tab has at most the layout's
 * panes. An unreadable pane list counts as foreign.
 *
 * shortcut: reads a pane's agent from `pane list`'s `agent` field (non-empty =
 * live agent), not yet confirmed against a live herdr; upgrade when the live
 * check shows another shape.
 */
async function foreignContent(
  deps: WorkspaceCloseDeps,
  workspaceId: string,
): Promise<string | null> {
  const tabs = parseTabList(
    await deps.execHerdr(['tab', 'list', '--workspace', workspaceId]),
  );
  let panes: unknown;
  try {
    const parsed = parseJson(
      await deps.execHerdr(['pane', 'list', '--workspace', workspaceId]),
      'pane list',
    );
    panes = isRecord(parsed)
      ? (parsed.result as { panes?: unknown } | undefined)?.panes
      : undefined;
  } catch {
    panes = undefined;
  }
  if (
    !Array.isArray(panes) ||
    !panes.every((p) => isRecord(p) && typeof p.tab_id === 'string')
  )
    return 'pane list unreadable';
  const list = panes as Array<{ tab_id: string; agent?: unknown }>;
  if (list.some((p) => typeof p.agent === 'string' && p.agent !== ''))
    return 'a pane runs an agent';
  const [first, ...rest] = tabs;
  const foreignTab = rest.find((tab) => !/#\d+$/.test(tab.label));
  if (foreignTab) return `tab "${foreignTab.label}" is not a bakers run tab`;
  const firstPanes = list.filter((p) => p.tab_id === first?.tabId).length;
  if (firstPanes > 1 + (deps.open.panes?.length ?? 0))
    return `tab "${first?.label}" holds more panes than the open layout`;
  return null;
}

/**
 * Close `ws` when it holds only bakers terminals, after the BB-166 focus
 * guard. `false` only when it is focused and focus cannot move safely; a
 * workspace with anything else in it is kept, reported and counts as done.
 */
async function closeIfBakersOnly(
  deps: WorkspaceCloseDeps,
  ws: WorkspaceEntry,
): Promise<boolean> {
  const reason = await foreignContent(deps, ws.workspaceId);
  if (reason) {
    deps.logger.warn(
      { workspace: ws.workspaceId, reason },
      'herdr workspace kept: it holds more than bakers terminals',
    );
    return true;
  }
  if (!(await ensureFocusSafeToRemove(deps, ws.workspaceId))) return false;
  await deps.execHerdr(['workspace', 'close', ws.workspaceId]);
  return true;
}

// By path, not `isLinkedWorktree`: herdr may stop reporting a deleted worktree as linked.
const isRootWorkspace = (deps: WorkspaceCloseDeps, ws: WorkspaceEntry) =>
  deps.root !== undefined &&
  ws.checkoutPath !== null &&
  normPath(ws.checkoutPath) === normPath(deps.root);

/**
 * Close the workspace the executor opened for `branch`, found by its checkout
 * path, else by its label (the branch). None open is a finished close.
 */
export async function closeBranchWorkspace(
  deps: WorkspaceCloseDeps,
  branch: string,
  worktreePath?: string,
): Promise<boolean> {
  const workspaces = parseWorkspaceList(
    await deps.execHerdr(['workspace', 'list']),
  ).filter((ws) => !isRootWorkspace(deps, ws));
  const ws =
    (worktreePath &&
      workspaces.find(
        (w) =>
          w.checkoutPath !== null &&
          normPath(w.checkoutPath) === normPath(worktreePath),
      )) ||
    workspaces.find((w) => w.label === branch);
  return ws ? closeIfBakersOnly(deps, ws) : true;
}

/**
 * Close workspaces left by earlier versions: checkout missing on disk under
 * `<root>/.bakers-worktrees/`, a single tab, only bakers terminals.
 * `false` when one of them must wait for a safe focus.
 *
 * shortcut: a custom workspace-git `worktree_dir` is not swept; upgrade when a
 * project uses one.
 */
export async function sweepLeftoverWorkspaces(
  deps: WorkspaceCloseDeps,
): Promise<boolean> {
  if (!deps.root) return true;
  const dir = `${normPath(join(deps.root, DEFAULT_WORKTREE_DIR))}/`;
  let done = true;
  for (const ws of parseWorkspaceList(
    await deps.execHerdr(['workspace', 'list']),
  )) {
    const path = ws.checkoutPath;
    if (!path?.startsWith(dir) || existsSync(path)) continue;
    if (isRootWorkspace(deps, ws)) continue;
    const tabs = parseTabList(
      await deps.execHerdr(['tab', 'list', '--workspace', ws.workspaceId]),
    );
    if (tabs.length !== 1) continue;
    if (!(await closeIfBakersOnly(deps, ws))) done = false;
  }
  return done;
}
