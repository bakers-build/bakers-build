// The `runtime` slot: WHERE an agent process runs. The executor still decides
// in which client the run appears; the runtime rewrites the finished launch
// (for example into `docker run …`) just before `executor.startRun`.

import type { ConductorLogger } from '@bakers-build/core';
import type { ConductorFileConfig } from '../types.js';
import type { AgentRuntimeInfo } from './agent.js';
import type { RuntimeReport } from './agent-args.js';

/** The run a launch belongs to. */
export interface RuntimeRun {
  uuid: string;
  id: number;
}

/** The finished launch the conductor would hand to `executor.startRun`. */
export interface RuntimeLaunch extends AgentRuntimeInfo {
  command: string;
  /** The run env, run token included. */
  env: Record<string, string>;
  workspacePath: string;
  run: RuntimeRun;
  /** Host-authorized destination, never selected by the run. */
  ticketBranch?: string;
  /** The harness id of the chosen agent (`claude`, `codex`, …). */
  harness: string;
  homePath?: string;
  readPaths?: string[];
  writePaths?: string[];
}

export interface BbRuntime {
  id: string;
  /** Allocate a private home before the agent prepares its command and files. */
  prepareRun?(
    run: RuntimeRun,
    agent: AgentRuntimeInfo,
  ): Promise<{ homePath: string; env?: Record<string, string> }>;
  /** Rewrite the launch; a rejection fails the dispatch, never falls back to the host. */
  wrap(
    launch: RuntimeLaunch,
  ): Promise<{ command: string; env: Record<string, string> }>;
  /** Remove what `wrap` left for this run; called after each `cleanupRun`. */
  cleanup(run: RuntimeRun): Promise<void>;
  /** Explicitly import a run-local commit into its authorized ticket branch. */
  transferCommit?(runUuid: string, commit: string): Promise<void>;
  /** URL the run uses for the tool server, given the host URL; absent = unchanged. */
  toolsUrl?(hostUrl: string): string;
  /** Extra addresses the tool server also listens on; absent = 127.0.0.1 only. */
  toolServerHosts?(): Promise<string[]>;
}

export interface RuntimePlugin {
  readonly kind: 'runtime';
  readonly id: string;
  /** True when runs are isolated from the host; agent permissions remain unchanged. */
  readonly isolates: boolean;
  readonly requiredModules: string[];
  readonly readOnly?: RuntimeReport;
  createRuntime(
    config: ConductorFileConfig,
    deps: { logger: ConductorLogger },
  ): Promise<BbRuntime>;
}

/** The default: runs start on the host exactly as the executor launches them. */
export const hostRuntime: RuntimePlugin = {
  kind: 'runtime',
  id: 'host',
  isolates: false,
  requiredModules: [],
  createRuntime: async () => ({
    id: 'host',
    wrap: async ({ command, env }) => ({ command, env }),
    cleanup: async () => {},
  }),
};
