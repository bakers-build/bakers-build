// The `runtime` slot: WHERE an agent process runs. The executor still decides
// in which client the run appears; the runtime rewrites the finished launch
// (for example into `docker run …`) just before `executor.startRun`.

import type { ConductorLogger } from '@bakers-build/core';
import type { ConductorFileConfig } from '../types.js';

/** The run a launch belongs to. */
export interface RuntimeRun {
  uuid: string;
  id: number;
}

/** The finished launch the conductor would hand to `executor.startRun`. */
export interface RuntimeLaunch {
  command: string;
  /** The run env, run token included. */
  env: Record<string, string>;
  workspacePath: string;
  run: RuntimeRun;
  /** The harness id of the chosen agent (`claude`, `codex`, …). */
  harness: string;
}

export interface BbRuntime {
  id: string;
  /** Rewrite the launch; a rejection fails the dispatch, never falls back to the host. */
  wrap(
    launch: RuntimeLaunch,
  ): Promise<{ command: string; env: Record<string, string> }>;
  /** Remove what `wrap` left for this run; called after each `cleanupRun`. */
  cleanup(run: RuntimeRun): Promise<void>;
  /** URL the run uses for the tool server, given the host URL; absent = unchanged. */
  toolsUrl?(hostUrl: string): string;
  /** Extra addresses the tool server also listens on; absent = 127.0.0.1 only. */
  toolServerHosts?(): Promise<string[]>;
}

export interface RuntimePlugin {
  readonly kind: 'runtime';
  readonly id: string;
  /** True when runs are isolated from the host, which switches the harness sandbox off. */
  readonly isolates: boolean;
  readonly requiredModules: string[];
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
