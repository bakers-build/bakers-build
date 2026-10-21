import { type PaneSpec, renderTemplate } from './config.js';
import { envArgs } from './panes.js';

export type HerdrExec = (
  args: string[],
  opts?: { redactArgs?: (args: string[]) => string[] },
) => Promise<string>;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseJson(output: string, command: string): unknown {
  try {
    return JSON.parse(output) as unknown;
  } catch {
    throw new Error(`herdr ${command} returned invalid JSON`);
  }
}

export function parsePaneSplit(output: string): string {
  const parsed = parseJson(output, 'pane split');
  const paneId = isRecord(parsed)
    ? (parsed.result as { pane?: { pane_id?: unknown } } | undefined)?.pane
        ?.pane_id
    : undefined;
  if (typeof paneId !== 'string') {
    throw new Error('herdr pane split returned invalid schema');
  }
  return paneId;
}

/**
 * A pane layout: an optional command run in the root/main pane, plus optional
 * split panes. Shared by the executor's per-run tab (`startRun`) and the
 * workspace's initial open pane (`herdrWorkspace` `open`) — one code path, no
 * duplication. The per-state `StateConfig` (executor) and the workspace `open`
 * option both narrow to this shape (the executor adds `tabLabel`; there is only
 * one open layout, not a per-state map).
 */
export interface PaneLayout {
  /** Command run in the initial root/main pane (typed verbatim, not templated). */
  command?: string;
  /** Extra split panes off the root; each command is `renderTemplate`'d. */
  panes?: PaneSpec[];
}

/**
 * Apply a {@link PaneLayout} to an existing root pane: run `command` in the root
 * pane, then split each configured pane (with `--cwd cwd`) and run its
 * `renderTemplate`'d command. The root command is typed VERBATIM (the caller
 * pre-assembles it — e.g. the executor's env-prefixed agent command, BB-101/128);
 * only split commands are templated from `vars`.
 *
 * `opts.redactCommand` supplies a log-safe rewrite of the root command (env
 * VALUES masked, key names kept — BB-99): when it returns a different string a
 * `redactArgs` scrubber is passed so a failed `pane run` exec-log never carries a
 * secret, while the command herdr actually runs stays real. An empty layout
 * (`{}`) issues no calls at all — the caller's unconfigured default is preserved.
 *
 * `opts.env` is forwarded to each split pane as `--env` args (BB_* only, see
 * {@link envArgs}). It is deliberately per-CALLER rather than baked in: this
 * primitive serves both the executor's agent tab and the workspace's own open
 * pane, and only the former's panes are agent-owned (BB-64). The ROOT pane is
 * not touched — it already exists when we get here, so its environment came from
 * whoever created it. Omitted ⇒ no `--env` at all.
 */
export async function applyPaneLayout(
  execHerdr: HerdrExec,
  rootPaneId: string,
  layout: PaneLayout,
  cwd: string,
  vars: Record<string, string>,
  opts?: {
    redactCommand?: (command: string) => string;
    env?: Record<string, string | undefined>;
  },
): Promise<void> {
  if (layout.command) {
    const command = layout.command;
    const runArgs = ['pane', 'run', rootPaneId, command];
    const redacted = opts?.redactCommand?.(command);
    if (redacted !== undefined && redacted !== command) {
      await execHerdr(runArgs, {
        redactArgs: (args) => args.map((a) => (a === command ? redacted : a)),
      });
    } else {
      await execHerdr(runArgs);
    }
  }

  for (const spec of layout.panes ?? []) {
    const splitPaneId = parsePaneSplit(
      await execHerdr([
        'pane',
        'split',
        rootPaneId,
        '--direction',
        spec.direction,
        '--cwd',
        cwd,
        spec.focus ? '--focus' : '--no-focus',
        ...envArgs(opts?.env ?? {}),
      ]),
    );
    await execHerdr([
      'pane',
      'run',
      splitPaneId,
      renderTemplate(spec.command, vars),
    ]);
  }
}
