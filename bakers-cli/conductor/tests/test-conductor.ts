import type {
  BbExecutor,
  BbRemote,
  BbWorkspace,
  HookContext,
  HookName,
  HookResult,
  WorktreeTeardown,
} from '@bakers-build/conductor/contract';
import type { ConductorLogger } from '@bakers-build/core';
import { Conductor } from '../src/core/conductor.js';
import type { HookRunner } from '../src/core/hook-runner.js';
import type { ResolvedAgent } from '../src/plugins/plugins.js';
import type { ConductorFileConfig } from '../src/types.js';

/**
 * The recorders a test double may carry beside the executor contract. The
 * conductor suites' doubles record hooks and teardown in one place — on the
 * executor double — which predates the slot split; {@link TestConductor} hands
 * those recorders to their owners, so the assertions stay as they were.
 */
interface Recorders {
  runHook?(
    name: HookName,
    cwd: string,
    ctx: HookContext,
    env?: Record<string, string>,
  ): Promise<HookResult>;
  removeWorktree?(
    branch: string,
    worktreePath?: string,
  ): Promise<WorktreeTeardown>;
}

/**
 * A {@link Conductor} whose hook runner is the executor double's `runHook`
 * recorder and whose `workspace.remove` is its `removeWorktree` recorder, when
 * the double has them. Each call looks the recorder up afresh, so a test may
 * still wrap it after construction. A double without recorders gets the
 * conductor's own hook runner and the workspace's own `remove`.
 */
export class TestConductor extends Conductor {
  constructor(
    config: ConductorFileConfig,
    remote: BbRemote,
    executor: BbExecutor,
    workspace: BbWorkspace,
    agents: ResolvedAgent[],
    logger: ConductorLogger,
    checkoutRoot?: string,
    frozenStateFile?: string,
    hookRunner?: HookRunner,
    readMachine?: ConstructorParameters<typeof Conductor>[9],
  ) {
    const rec = executor as BbExecutor & Recorders;
    const wired: BbWorkspace = Object.create(workspace);
    wired.remove = (branch, worktreePath) =>
      rec.removeWorktree
        ? rec.removeWorktree(branch, worktreePath)
        : workspace.remove(branch, worktreePath);
    const runHook: HookRunner | undefined =
      hookRunner ??
      (rec.runHook
        ? (name, cwd, ctx, env) =>
            (rec.runHook as NonNullable<Recorders['runHook']>)(
              name,
              cwd,
              ctx,
              env,
            )
        : undefined);
    super(
      config,
      remote,
      executor,
      wired,
      agents,
      logger,
      checkoutRoot,
      frozenStateFile,
      runHook,
      readMachine,
    );
  }
}
