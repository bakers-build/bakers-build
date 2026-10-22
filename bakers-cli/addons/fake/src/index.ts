import { writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import type {
  BbExecutor,
  ExecutorCapabilities,
  ExecutorPlugin,
  HookContext,
  HookName,
  HookResult,
  SpawnedSession,
  SpawnRunInput,
  WorktreeTeardown,
} from '@bakers-build/conductor/contract';

export { fakeInbox } from './inbox.js';
// BB-224: the fake fixture addon ships the whole deterministic conductor
// triple — the executor below plus the remote + workspace folded in from core.
export {
  FakeBbRemote,
  type FakeRemoteSeed,
  type FakeSeedRun,
  type FakeSeedTicket,
  fakeRemote,
} from './remote.js';
export { FakeWorkspace, fakeWorkspace } from './workspace.js';

export interface FakeExecutorOptions {
  outcome: 'exited' | 'failed';
  markerFile?: string;
}

export class FakeExecutor implements BbExecutor {
  readonly id = 'fake';
  /** Records runHook(name, cwd, ticket, env) calls for assertions. */
  readonly hookCalls: Array<{
    name: HookName;
    cwd: string;
    ticket: string;
    env?: Record<string, string>;
  }> = [];

  constructor(private readonly options: FakeExecutorOptions) {}

  capabilities(): ExecutorCapabilities {
    return { persistent: false };
  }

  /**
   * Hook slots whose "command" fails — `runHook` reports `ok:false` for these
   * (and still never throws), so a test can drive the BB-237 AC-6 path.
   */
  readonly failingHooks = new Set<HookName>();

  async runHook(
    name: HookName,
    cwd: string,
    ctx: HookContext,
    env?: Record<string, string>,
  ): Promise<HookResult> {
    // Recording no-op — the fake never runs a real shell command.
    this.hookCalls.push({
      name,
      cwd,
      ticket: ctx.ticket,
      ...(env ? { env } : {}),
    });
    if (this.failingHooks.has(name)) {
      return { hook: name, ran: true, ok: false, error: `${name} failed` };
    }
    return { hook: name, ran: true, ok: true };
  }

  async startRun(input: SpawnRunInput): Promise<SpawnedSession> {
    const branch = input.ticket.branchName;
    if (this.options.markerFile) {
      writeFileSync(
        this.markerPath(input.workspacePath, this.options.markerFile),
        JSON.stringify({
          run_uuid: input.run.uuid,
          ticket_uuid: input.ticket.uuid,
          handler: input.run.handler,
          instructions_sha256: input.instructions?.sha256 ?? null,
        }),
      );
    }
    return { sessionRef: branch };
  }

  private markerPath(workspacePath: string, markerFile: string): string {
    const workspace = resolve(workspacePath);
    const marker = resolve(join(workspace, markerFile));
    const markerRelativePath = relative(workspace, marker);
    if (
      isAbsolute(markerFile) ||
      markerRelativePath === '..' ||
      markerRelativePath.startsWith(`..${sep}`)
    ) {
      throw new Error(
        `markerFile must stay inside the workspace: ${markerFile}`,
      );
    }
    return marker;
  }

  async stopRun(_branch: string): Promise<void> {
    // No-op for the fake executor — no hosted agent to signal.
  }

  async cleanupRun(_branch: string): Promise<void> {
    // No-op for the fake executor — no hosted tab to close.
  }

  async removeWorktree(
    _branch: string,
    _worktreePath?: string,
  ): Promise<WorktreeTeardown> {
    // No hosted workspace for the fake executor — nothing to tear down. It is
    // non-persistent, so the reaper never calls this; report `unverified`
    // (nothing present here) for interface conformance.
    return 'unverified';
  }
}

/** dropsh-Plugin-Factory - Eintrag für das plugins-Array der conductor.config.js. */
export function fakeExecutor(
  options: Partial<FakeExecutorOptions> = {},
): ExecutorPlugin {
  const executor = new FakeExecutor({
    outcome: options.outcome ?? 'exited',
    ...(options.markerFile !== undefined
      ? { markerFile: options.markerFile }
      : {}),
  });
  return {
    kind: 'executor',
    id: 'fake',
    requiredModules: [],
    async createExecutor(_config, _deps) {
      return executor;
    },
  };
}
