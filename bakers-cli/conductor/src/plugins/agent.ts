import type { MarketplaceDeclaration } from './agent-home.js';
import type { SandboxHost, SandboxPreflight } from './sandbox-preflight.js';
import { PROVISION_TIMEOUT_MS } from './tools.js';

/**
 * Per-agent effort footprint parsed from that agent's run transcript
 * (BB-132). The metrics are transcript-derived and therefore
 * **agent-specific** (each agent's transcript has its own format), so parsing
 * lives behind the agent abstraction (see {@link BbAgent.parseFootprint}) —
 * the conductor stays agent-agnostic and writes the footprint verbatim.
 * `duration_s` is likewise derived from the transcript (its first→last entry
 * timestamps), NOT recomputed by the conductor from a re-read `started_at`
 * (BB-151): the log is the single source of the run's wall-clock length, so
 * there is no timestamp round-trip through JSON:API to mis-parse.
 */
export interface AgentFootprint {
  /** Total tokens across every usage bucket of every assistant turn. */
  tokens: number;
  /**
   * Wall-clock run length in seconds, derived from the transcript's first→last
   * entry timestamps (BB-151). 0 when the transcript has fewer than two
   * timestamped entries (empty/absent log).
   */
  duration_s: number;
  /** Number of assistant turns in the transcript. */
  agent_turns: number;
  /** Number of tool-use calls across all assistant turns. */
  tool_calls: number;
  /** Number of user-submitted prompts. */
  user_prompts: number;
  /** Total words across those user prompts. */
  user_prompt_words: number;
  /**
   * Active agent time in seconds: `duration_s` minus the time spent waiting on
   * the human, so the wait is `duration_s - active_s`. 0 means not measured,
   * which is also what harnesses without a net-time parser report.
   */
  active_s: number;
  /** Model of the last assistant turn, when present (informational). */
  model?: string;
}

/** An all-zero footprint — the honest result for an empty/absent transcript. */
export function emptyAgentFootprint(): AgentFootprint {
  return {
    tokens: 0,
    duration_s: 0,
    agent_turns: 0,
    tool_calls: 0,
    user_prompts: 0,
    user_prompt_words: 0,
    active_s: 0,
  };
}

/** See {@link BbAgent.runEnvPolicy}. */
export interface RunEnvPolicy {
  drop: boolean;
  deny: readonly string[];
}

/**
 * Env names a ticket must not set for an agent: they redirect the model API,
 * inject code into every process, or reconfigure git/ssh/proxies. `*` globs.
 */
export const DEFAULT_ENV_DENY: readonly string[] = [
  'ANTHROPIC_*',
  'OPENAI_*',
  'CLAUDE_*',
  'CODEX_*',
  'NODE_OPTIONS',
  'LD_*',
  'DYLD_*',
  'PATH',
  'BASH_ENV',
  'ENV',
  'GIT_*',
  'SSH_*',
  '*_PROXY',
  '*_proxy',
];

/** Whether `name` matches one of the `*`-glob `patterns`. */
export function matchesEnvDeny(
  name: string,
  patterns: readonly string[],
): boolean {
  return patterns.some((pattern) =>
    new RegExp(
      `^${pattern
        .split('*')
        .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
        .join('.*')}$`,
    ).test(name),
  );
}

/**
 * A bakers.build agent: the program the conductor runs to work a ticket (e.g. claude).
 * It knows how it is launched (CLI + model + flags) and where its per-run
 * transcript/log lives — so the conductor stays agent-agnostic and the CLI can
 * attach the run log on release without agent-specific knowledge.
 */
/**
 * Identity of the run a transcript lookup is scoped to (BB-473): the run's
 * own UUID (usable as a session id by agents that support pinning one) and,
 * optionally, when the run started (a lower bound for agents with no session
 * mechanism at all, so a stale transcript from a prior run in the same
 * worktree/cwd can never be selected). Both fields are optional so a call
 * site or addon that predates BB-473 keeps compiling and behaving exactly
 * as before (today's mtime/cwd-scan fallback).
 */
export interface AgentRunIdentity {
  sessionId: string;
  startedAt?: string | number | Date;
  /**
   * The run's full deterministic attempt-id family (BB-473 review round 4,
   * Critical 2), attempt 0 (== `sessionId`) first. When present, `getRunLog`
   * should select the transcript of the HIGHEST-numbered attempt whose file
   * actually exists, instead of the `startedAt` time window — a window
   * selects by *when*, which a sibling session newer than the bound can
   * still beat; a family selects by *which attempt*, which nothing outside
   * this run can collide with. Omitted, callers keep the pre-round-4
   * single-`sessionId` behaviour.
   */
  attemptFamily?: string[];
}

/** The MCP server name agents see for the conductor's addon tools. */
export const CONDUCTOR_TOOLS_SERVER = 'bakers';
/**
 * The tool-call timeout a launch sets on that server, past the longest
 * provision. Without it Claude Code's HTTP MCP client cuts a call at 60 s
 * (per-server `timeout`, else `MCP_TOOL_TIMEOUT`) and Codex at
 * `tool_timeout_sec` (60 s default).
 */
export const CONDUCTOR_TOOL_TIMEOUT_MS = PROVISION_TIMEOUT_MS + 60_000;
/** The run env var holding the run's bearer token for that server. */
export const CONDUCTOR_TOKEN_ENV = 'BAKERS_CONDUCTOR_TOKEN';
/** The run env var holding that server's URL, for `bakers conductor tools`. */
export const CONDUCTOR_URL_ENV = 'BAKERS_CONDUCTOR_URL';

/** What {@link BbAgent.installPlugins} hands the run's launch. */
export interface PluginLaunch {
  /** Merged into the run env: the harness's config-dir variable, never `HOME`. */
  env: Record<string, string>;
  /** Passed to `launchCommand` as its `args`. */
  args: string[];
  /** `built` when this call built the home, `reused` when it was complete. */
  home: 'built' | 'reused';
  /** Trust checks this run skips, for the run's `plugins` log entry. */
  trust_bypass?: string[];
  /** Declared plugins the harness cannot load, for the same entry. */
  gaps?: string[];
}

/** A path an isolating runtime mounts for an agent. */
export interface ContainerMount {
  host: string;
  container: string;
  readOnly?: boolean;
}

/** What {@link AgentContainer.prepare} gets: one run's home and launch. */
export interface AgentContainerContext {
  /** The per-run home on the host. */
  runHome: string;
  /** Where the run home is mounted in the container. */
  containerHome: string;
  workspacePath: string;
  /** The run env. */
  env: Readonly<Record<string, string>>;
  /** The operator's home on the host. */
  hostHome: string;
  /** Allowlist mode: the placeholder the run holds in `api.keyEnv`. */
  keyPlaceholder?: string;
}

/**
 * What an agent needs to run in an isolating container runtime. An agent
 * without it cannot start under such a runtime.
 */
export interface AgentContainer {
  /** Shell command, run in the image build, that installs the harness CLI. */
  install: string;
  /** Shown when none of the `api.auth` credentials is set. */
  credentialHint: string;
  api: {
    /** The model API an egress proxy forwards to. */
    target: string;
    /** Env that points the harness at another API base URL. */
    baseUrlEnv: string;
    /** Env the run holds a placeholder key in when a proxy adds the credential. */
    keyEnv: string;
    /**
     * Per conductor env name holding a credential, preferred first: the
     * headers a proxy sets (`{value}` is the secret) and appends to
     * (comma-separated).
     */
    auth: Record<
      string,
      { set: Record<string, string>; append?: Record<string, string> }
    >;
  };
  /** Prepare the run home on the host; return the agent's extra run env and mounts. */
  prepare(ctx: AgentContainerContext): {
    env: Record<string, string>;
    mounts: ContainerMount[];
  };
}

export interface BbAgent {
  /** Stable id, e.g. 'claude'. */
  readonly id: string;
  /** How this agent runs in an isolating container runtime; absent: it cannot. */
  readonly container?: AgentContainer;
  /** True when the catalog entry sets `plugins: false`: the run uses the user's own agent home. */
  readonly pluginsDisabled?: boolean;
  /**
   * Install the project's plugin marketplaces into `home` with the harness's
   * own commands (once; see `ensureHome`) and return how a run in it
   * launches. Called before every launch, in every security mode. Throws,
   * naming the plugin and the harness output, when the install fails.
   */
  installPlugins?(
    marketplaces: readonly MarketplaceDeclaration[],
    home: string,
  ): Promise<PluginLaunch>;
  /**
   * How the conductor treats ticket/project env_vars whose names match
   * `deny`: dropped when `drop`, kept (and still logged) otherwise. Omitted →
   * drop with {@link DEFAULT_ENV_DENY}.
   */
  readonly runEnvPolicy?: RunEnvPolicy;
  /**
   * Informational notes the conductor logs once per dispatch, before
   * `startRun`. Unsupported effort on a harness that cannot express it is
   * the current producer. Omitted when there is nothing to say.
   */
  readonly launchWarnings?: readonly string[];
  /**
   * True when this agent's runs must not reach the conductor's tools (a
   * measured claude run): the conductor issues no token and sets neither
   * {@link CONDUCTOR_URL_ENV} nor {@link CONDUCTOR_TOKEN_ENV}.
   */
  readonly withoutConductorTools?: boolean;
  /**
   * Build the full agent CLI invocation for a bakers.build prompt. With an empty
   * prompt, returns the bare launch command (no prompt argument).
   *
   * `run`, when given (BB-473), lets an agent that supports pinning its own
   * session/transcript id do so at launch (e.g. `claude --session-id
   * <uuid>`), so `getRunLog` can read that one file directly instead of
   * scanning a worktree-keyed directory by mtime — the mtime scan is what let
   * a resumed/re-dispatched/reused worktree finalise a FOREIGN transcript.
   * `workspacePath` is the dispatch workspace, for harness permissions that need
   * its Git metadata paths rather than the conductor's own working directory.
   *
   * `tools`, when given, is the conductor's MCP server for this run
   * ({@link CONDUCTOR_TOOLS_SERVER}); its bearer token is in the run env as
   * {@link CONDUCTOR_TOKEN_ENV}. An agent that cannot add an MCP server ignores it.
   *
   * `env` is the run env the command starts in, for an agent whose harness
   * filters it (Codex). Its values may be secret: never put them in argv
   * unless the harness drops them otherwise.
   *
   * `args` are the {@link PluginLaunch} args of this run, when plugins are on.
   */
  launchCommand(
    prompt: string,
    run?: AgentRunIdentity,
    workspacePath?: string,
    tools?: { url: string },
    env?: Readonly<Record<string, string>>,
    args?: readonly string[],
  ): string;
  /**
   * Locate and read this agent's run transcript for a run that executed in
   * `worktreePath`. MUST return '' (never throw) when nothing is found.
   *
   * `run`, when given (BB-473), scopes the lookup to that run's own
   * transcript — by direct filename lookup for agents that support pinning a
   * session id at launch, or (for agents with no such mechanism) by
   * discarding any transcript older than `run.startedAt`. Omitted, the call
   * preserves today's directory-scan-by-mtime behaviour.
   */
  getRunLog(worktreePath: string, run?: AgentRunIdentity): Promise<string>;
  /**
   * Whether this agent already owns a transcript/session named `sessionId`
   * under `worktreePath` (BB-473). Some CLIs refuse to start when a
   * `--session-id` they are handed is already in use (`claude`, `grok`), so
   * the conductor calls this **before** pinning the run's own UUID into
   * `launchCommand` — a live re-dispatch of the same run must still be able
   * to launch, even though the UUID it would pin already names a transcript
   * from the run's first attempt. Optional: an agent whose launch mechanism
   * cannot collide (no pinning at all, or a CLI that creates-if-missing like
   * `pi`) declares none, and the conductor always pins for it.
   */
  sessionExists?(worktreePath: string, sessionId: string): Promise<boolean>;
  /**
   * Parse this agent's run transcript (as returned by {@link getRunLog}) into
   * a footprint of effort metrics (BB-132). The transcript format is
   * agent-specific, so each agent owns its own parser. MUST be tolerant of
   * blank/partial/absent input (never throw) — an empty log yields
   * {@link emptyAgentFootprint}.
   */
  parseFootprint(log: string): AgentFootprint;
  /**
   * Whether this agent's OS sandbox can start on this machine. The conductor
   * withholds claims and refuses to spawn while it reports a cause. Returns
   * ok without probing when the agent does not run sandboxed. Optional: an
   * agent without it is never checked.
   */
  sandboxPreflight?(host?: SandboxHost): Promise<SandboxPreflight>;
}
