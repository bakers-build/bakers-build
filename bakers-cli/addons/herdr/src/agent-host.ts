// Herdr's own agent-host contract (BB-194 AC-3). It used to live in
// `@bakers-build/core` as `AgentLaunchHost`/`HostedAgent`, but the agent-host seam is
// a TUI/renderer concern, not a conductor-engine one — so core dropped it and
// herdr types its impl LOCALLY. This interface imports nothing removed and
// nothing from `@bakers-build/addon-bakers-ui`: the renderer owns its own
// prompt-level `TuiAgentService`, and the conductor `bakers ui` entry adapts this
// mechanism-level (`command`-based) host to it. Structurally compatible, no
// cross-package type coupling.

/** A hosted agent as reported by the host. `id` is the host-owned stable handle
 *  (survives a TUI restart); `group` is the opaque grouping key it was launched
 *  under; `label` is a human tag for the list. */
export interface HostedAgent {
  id: string;
  group: string;
  label: string;
}

/**
 * The INTENT-level agent host herdr provides. The caller says "launch an agent
 * in this group", "show that agent", "list this group" — it never names panes,
 * tabs, splits or zoom. The host (herdr) owns the whole layout policy. `group`
 * is OPAQUE (bakers passes the project slug). `command` is the resolved shell
 * command the agent runs (the renderer's prompt is turned into a command by the
 * `bakers ui` entry before it reaches here — herdr stays agent-binary-agnostic).
 */
export interface AgentLaunchHost {
  /**
   * Start an agent and return its stable handle. The host decides where the
   * session is placed and shows it; the caller only supplies intent + a group.
   */
  launch(opts: {
    group: string;
    cwd: string;
    command: string;
    env?: Record<string, string | undefined> | undefined;
    label?: string | undefined;
  }): Promise<HostedAgent>;
  /** The live agents of a group — the source of truth for the list, rebuilt
   *  from the host on demand so sessions survive a TUI restart. */
  list(group: string): Promise<HostedAgent[]>;
  /** Bring one agent to the foreground (the host zooms/switches as it sees fit). */
  focus(id: string): Promise<void>;
  /** Stop showing a group's agents and return focus to the caller. Durable —
   *  the agents keep running; this never terminates them. */
  hide(group: string): Promise<void>;
  /** Terminate one agent for good. */
  kill(id: string): Promise<void>;
  /** Send literal text to an agent's input. */
  sendText(id: string, text: string): Promise<void>;
}

/** A workspace (or other plugin) that can host agents at the intent level. */
export interface AgentLaunchHostProvider {
  agentHost: AgentLaunchHost;
}
