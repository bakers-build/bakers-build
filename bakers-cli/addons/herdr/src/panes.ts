// Herdr pane env helpers (BB-190, BB-64): the agent-shell marker and the
// `--env` args every pane launch passes. Kept small and herdr-internal.

/**
 * Marker exported into an AGENT pane's interactive shell, so a user's opt-in
 * shell init can recognise an agent-run pane at startup and isolate its history
 * (BB-64). It is a plain `BAKERS_*` env entry on purpose: it rides {@link envArgs}
 * like every other pane var instead of adding a second mechanism.
 *
 * AGENT panes only — the executor's per-run tab and its layout panes. NOT the
 * workspace's own open-layout pane: that one is the human's landing pane, and the opt-in unsets `HISTFILE`. See
 * `docs/conductor/node.md` § Agent-pane shell marker.
 */
export const AGENT_SHELL_ENV: Record<string, string> = {
  BAKERS_AGENT_SHELL: '1',
};

/** BAKERS_* (and the internal BB_* hand-offs) env vars as `--env KEY=VALUE` args (never dump the full environment). */
export function envArgs(env: Record<string, string | undefined>): string[] {
  const out: string[] = [];
  for (const [key, value] of Object.entries(env)) {
    if (/^(BAKERS|BB)_/.test(key) && value != null) {
      out.push('--env', `${key}=${value}`);
    }
  }
  return out;
}
