import type { BbAgent, RuntimeLaunch } from '@bakers-build/conductor/contract';

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

/** An agent implementing this plugin's optional container support. */
export interface ContainerAgent extends BbAgent {
  readonly container: AgentContainer;
}

/** Container-specific inputs stay inside this plugin. */
export interface ContainerLaunch extends RuntimeLaunch {
  container?: AgentContainer;
}
