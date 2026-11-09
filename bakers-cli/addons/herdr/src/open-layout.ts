import type { OpenWorkspaceContext } from '@bakers-build/conductor/contract';
import type { ConductorLogger } from '@bakers-build/core';
import { type PaneSpec, renderTemplate } from './config.js';
import {
  applyPaneLayout,
  type HerdrExec,
  isRecord,
  parseJson,
} from './pane-layout.js';

/**
 * Layout applied to a fresh worktree's initial (root) pane (BB-139): `command`
 * launches a tool in the main pane (e.g. `spiceedit`) so the human lands in an
 * editor instead of a bare shell; `panes[]` are optional splits off it. Same
 * shape as the executor's per-state layout minus `tabLabel` — there is only ONE
 * open layout, not a per-ticket-state map.
 *
 * BB-234: `{identifier}`, `{branch}`, `{title}` and `{worktreePath}` expand in
 * `command` **and** in every `panes[].command`. The root command is rendered
 * here before the finished layout reaches `applyPaneLayout` — that shared
 * helper types its root command VERBATIM on purpose, because its other caller
 * (the run tab) pre-assembles `KEY='value' <agent>` env prefixes whose values
 * may legitimately contain braces (spec D2).
 *
 * BB-374: `tabLabel` / `panelLabel` are chrome strings applied after the
 * layout via `herdr tab rename` / `herdr pane rename` ("panel label" = pane
 * label). Defaults ship when keys are absent on an active layout; `open: {}`
 * remains the full opt-out (no command, no splits, no labels). The overview
 * **tab** default is `{identifier} · {title}` with `{title}` capped at
 * {@link OPEN_TAB_TITLE_MAX} so the always-visible tab bar stays readable;
 * the pane/panel label still gets the full title.
 *
 * Unset → {@link DEFAULT_OPEN_LAYOUT}, the ticket deep link. `{}` → the bare
 * empty tab (`applyPaneLayout` issues no calls for an empty layout).
 */
export interface OpenLayout {
  command?: string;
  panes?: PaneSpec[];
  /**
   * Overview tab label template. Default: `{identifier} · {title}` (title
   * truncated to {@link OPEN_TAB_TITLE_MAX} when rendering).
   */
  tabLabel?: string;
  /**
   * Overview root-pane label template (`herdr pane rename`). Default:
   * `{identifier} · {title}` (full title).
   */
  panelLabel?: string;
}

/** Max `{title}` length substituted into the overview **tab** label (BB-374). */
export const OPEN_TAB_TITLE_MAX = 30;

/** Cap overview-tab `{title}` and append `...` when truncated. */
export function truncateOpenTabTitle(title: string): string {
  if (title.length <= OPEN_TAB_TITLE_MAX) {
    return title;
  }
  return `${title.slice(0, OPEN_TAB_TITLE_MAX)}...`;
}

/** Default overview tab chrome (BB-374) — always-visible tab bar identity. */
export const DEFAULT_OPEN_TAB_LABEL = '{identifier} · {title}';
/** Default overview pane/panel label template (BB-374). */
export const DEFAULT_OPEN_PANEL_LABEL = '{identifier} · {title}';

/**
 * The shipped default open layout (BB-234): a fresh worktree's initial pane
 * renders the ticket it belongs to instead of an anonymous shell prompt.
 *
 * It lives in **code, not config**, because a default each repo has to opt into
 * would leave the defect in place for every other consumer of this addon; the
 * addon already ships opinionated defaults of this kind (`BUILTIN_DEFAULTS` in
 * `./config.js`), and `bakers ui` is a command of the very host that ships it.
 *
 * `open: {}` is the documented opt-out back to the pre-BB-234 bare tab, so
 * the default is not a one-way door.
 */
export const DEFAULT_OPEN_LAYOUT: OpenLayout = {
  command: 'bakers ui --ticket {identifier}',
  tabLabel: DEFAULT_OPEN_TAB_LABEL,
  panelLabel: DEFAULT_OPEN_PANEL_LABEL,
};

/** `open: {}` — the opt-out back to the bare tab: no command, splits or labels. */
export function isEmptyLayout(open: OpenLayout): boolean {
  return (
    open.command === undefined &&
    !open.panes?.length &&
    open.tabLabel === undefined &&
    open.panelLabel === undefined
  );
}

/** A workspace's initial pane, and its tab when herdr reported one. */
export interface RootPane {
  paneId: string;
  tabId?: string;
}

/**
 * The root pane of a `worktree create`/`worktree open` response
 * (`result.root_pane`, tab id from it or `result.tab`), or null when the
 * response carries none.
 */
export function parseRootPane(
  output: string,
  command: string,
): RootPane | null {
  const parsed = parseJson(output, command);
  if (!isRecord(parsed) || !isRecord(parsed.result)) return null;
  const result = parsed.result as {
    root_pane?: { pane_id?: unknown; tab_id?: unknown };
    tab?: { tab_id?: unknown };
  };
  const paneId = result.root_pane?.pane_id;
  if (typeof paneId !== 'string' || !paneId) return null;
  const tabIdRaw = result.root_pane?.tab_id ?? result.tab?.tab_id;
  const tabId = typeof tabIdRaw === 'string' && tabIdRaw ? tabIdRaw : undefined;
  return tabId !== undefined ? { paneId, tabId } : { paneId };
}

/**
 * The first pane of `herdr pane list --workspace <id>` — the initial pane of a
 * workspace that was just created and has no other pane yet.
 *
 * shortcut: assumes `result.panes[]` with `pane_id`/`tab_id`, like `tab list`'s
 * `result.tabs[]`; not yet confirmed against a live herdr, upgrade when the
 * live check shows another shape.
 */
export function parseFirstPane(output: string): RootPane | null {
  const parsed = parseJson(output, 'pane list');
  const panes = isRecord(parsed)
    ? (parsed.result as { panes?: unknown } | undefined)?.panes
    : undefined;
  if (!Array.isArray(panes)) return null;
  const first = panes.find(
    (p) => isRecord(p) && typeof p.pane_id === 'string' && p.pane_id,
  ) as { pane_id: string; tab_id?: unknown } | undefined;
  if (!first) return null;
  return typeof first.tab_id === 'string' && first.tab_id
    ? { paneId: first.pane_id, tabId: first.tab_id }
    : { paneId: first.pane_id };
}

/**
 * Apply `open` to a fresh worktree's root pane — by default (BB-234) the
 * ticket's `bakers ui` deep link, so the tab shows the ticket instead of a
 * bare shell. The splits get the worktree checkout as their cwd. BB-374 then
 * renames the overview tab and root pane.
 *
 * Best-effort: a broken layout is logged and swallowed so a startup-command
 * failure can NEVER wedge dispatch.
 */
export async function applyOpenLayout(
  execHerdr: HerdrExec,
  logger: ConductorLogger,
  open: OpenLayout,
  root: RootPane,
  path: string,
  ctx: OpenWorkspaceContext,
): Promise<void> {
  try {
    // Render the ROOT command here (spec D2). `applyPaneLayout` types its
    // root command verbatim for the run tab's brace-bearing env-prefixed
    // agent command, so templating it there would corrupt that; the split
    // commands it already renders from the same `vars`.
    const vars = {
      identifier: ctx.identifier,
      branch: ctx.branch,
      title: ctx.title,
      worktreePath: path,
    };
    const layout: OpenLayout = {
      ...open,
      ...(open.command !== undefined
        ? { command: renderTemplate(open.command, vars) }
        : {}),
    };
    await applyPaneLayout(execHerdr, root.paneId, layout, path, vars);
    await applyOverviewLabels(execHerdr, logger, open, root, vars);
  } catch (err) {
    logger.warn(
      { branch: ctx.branch, worktree: path, err: String(err) },
      'herdr open-layout failed (best-effort, ignored)',
    );
  }
}

/**
 * Best-effort overview tab + pane renames (BB-374). Skipped for the
 * `open: {}` opt-out. A missing tab id falls back to `pane get`.
 */
async function applyOverviewLabels(
  execHerdr: HerdrExec,
  logger: ConductorLogger,
  open: OpenLayout,
  root: RootPane,
  vars: Record<string, string>,
): Promise<void> {
  if (isEmptyLayout(open)) {
    return;
  }

  // Tab bar is always visible; cap title length and mark truncation with
  // `...`. Pane/panel label keeps the full title for pane borders.
  const tabVars = {
    ...vars,
    title: truncateOpenTabTitle(vars.title ?? ''),
  };
  const tabLabel = renderTemplate(
    open.tabLabel ?? DEFAULT_OPEN_TAB_LABEL,
    tabVars,
  );
  const panelLabel = renderTemplate(
    open.panelLabel ?? DEFAULT_OPEN_PANEL_LABEL,
    vars,
  );

  let tabId = root.tabId;
  if (!tabId) {
    try {
      tabId = (await resolveTabIdForPane(execHerdr, root.paneId)) ?? undefined;
    } catch (err) {
      logger.warn(
        { paneId: root.paneId, err: String(err) },
        'herdr overview tab id lookup failed (best-effort, ignored)',
      );
    }
  }
  if (tabId) {
    try {
      await execHerdr(['tab', 'rename', tabId, tabLabel]);
    } catch (err) {
      logger.warn(
        { tabId, err: String(err) },
        'herdr overview tab rename failed (best-effort, ignored)',
      );
    }
  }

  try {
    await execHerdr(['pane', 'rename', root.paneId, panelLabel]);
  } catch (err) {
    logger.warn(
      { paneId: root.paneId, err: String(err) },
      'herdr overview pane rename failed (best-effort, ignored)',
    );
  }
}

/** `pane get <id>` → `result.pane.tab_id` when present. */
async function resolveTabIdForPane(
  execHerdr: HerdrExec,
  paneId: string,
): Promise<string | null> {
  const output = await execHerdr(['pane', 'get', paneId, '--json']);
  const parsed = parseJson(output, 'pane get');
  const tabId = isRecord(parsed)
    ? (parsed.result as { pane?: { tab_id?: unknown } } | undefined)?.pane
        ?.tab_id
    : undefined;
  return typeof tabId === 'string' && tabId ? tabId : null;
}
