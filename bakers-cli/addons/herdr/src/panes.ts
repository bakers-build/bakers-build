// Herdr pane/tab CLI envelope parsers (BB-190) — the building blocks the
// intent-level `herdrAgentHost` (agents.ts) uses to talk to herdr. Kept small
// and herdr-internal; the conductor/TUI never see these pane shapes.

/** A herdr pane and the tab it sits in. */
export interface HerdrPaneRef {
  paneId: string;
  tabId: string;
}

/** A herdr pane plus its label. */
export interface HerdrPaneInfo extends HerdrPaneRef {
  label: string;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/**
 * Marker exported into an AGENT pane's interactive shell, so a user's opt-in
 * shell init can recognise an agent-run pane at startup and isolate its history
 * (BB-64). It is a plain `BB_*` env entry on purpose: it rides {@link envArgs}
 * like every other pane var instead of adding a second mechanism.
 *
 * AGENT panes only — the executor's per-run tab and its layout panes, plus the
 * TUI-hosted agents. NOT the workspace's own open-layout pane: that one is the
 * human's landing pane, and the opt-in unsets `HISTFILE`. See
 * `docs/conductor/node.md` § Agent-pane shell marker.
 */
export const AGENT_SHELL_ENV: Record<string, string> = {
  BB_AGENT_SHELL: '1',
};

/** BB_* env vars as `--env KEY=VALUE` args (never dump the full environment). */
export function envArgs(env: Record<string, string | undefined>): string[] {
  const out: string[] = [];
  for (const [key, value] of Object.entries(env)) {
    if (key.startsWith('BB_') && value != null) {
      out.push('--env', `${key}=${value}`);
    }
  }
  return out;
}

/** `{ paneId, tabId }` from a `herdr tab create` envelope. */
export function parseTabCreate(output: string): HerdrPaneRef {
  const parsed = JSON.parse(output) as unknown;
  const result = isRecord(parsed)
    ? (parsed.result as {
        root_pane?: { pane_id?: unknown };
        tab?: { tab_id?: unknown };
      })
    : undefined;
  const paneId = result?.root_pane?.pane_id;
  const tabId = result?.tab?.tab_id;
  if (typeof paneId !== 'string' || typeof tabId !== 'string') {
    throw new Error('herdr tab create returned invalid schema');
  }
  return { paneId, tabId };
}

/** `{ paneId, tabId }` from a `result.pane` envelope (pane current / split). */
export function parsePaneInfo(output: string): HerdrPaneRef {
  const parsed = JSON.parse(output) as unknown;
  const pane = isRecord(parsed)
    ? (parsed.result as { pane?: { pane_id?: unknown; tab_id?: unknown } })
        ?.pane
    : undefined;
  const paneId = pane?.pane_id;
  const tabId = pane?.tab_id;
  if (typeof paneId !== 'string' || typeof tabId !== 'string') {
    throw new Error('herdr returned no pane info');
  }
  return { paneId, tabId };
}

/** The id of the first tab whose label equals `label`, else null. */
export function findTabIdByLabel(output: string, label: string): string | null {
  const parsed = JSON.parse(output) as unknown;
  const tabs = isRecord(parsed)
    ? (parsed.result as { tabs?: unknown } | undefined)?.tabs
    : undefined;
  if (!Array.isArray(tabs)) return null;
  const match = tabs
    .filter(isRecord)
    .find((t) => t.label === label && typeof t.tab_id === 'string');
  return match ? (match.tab_id as string) : null;
}

/** Panes in `tabId` as `[{ paneId, tabId, label }]` from a `pane list` envelope. */
export function parsePanesInTab(
  output: string,
  tabId: string,
): HerdrPaneInfo[] {
  const parsed = JSON.parse(output) as unknown;
  const panes = isRecord(parsed)
    ? (parsed.result as { panes?: unknown } | undefined)?.panes
    : undefined;
  if (!Array.isArray(panes)) return [];
  return panes
    .filter(isRecord)
    .filter((p) => typeof p.pane_id === 'string' && p.tab_id === tabId)
    .map((p) => ({
      paneId: p.pane_id as string,
      tabId,
      label: typeof p.label === 'string' ? p.label : '',
    }));
}
