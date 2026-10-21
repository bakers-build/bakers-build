import type {
  HookListener,
  HookListenerContext,
} from '@bakers-build/conductor/contract';
import { exec } from '@bakers-build/core';
import { parseWorkspaceList } from './workspace-list.js';

/** The sidebar token; operators show it with `$bb_frozen` in a row. */
export const FROZEN_TOKEN = 'bb_frozen';

async function reportOnWorktree(
  ctx: HookListenerContext,
  token: string[],
): Promise<void> {
  const workspace = parseWorkspaceList(
    await exec('herdr', ['workspace', 'list']),
  ).find((w) => w.checkoutPath === ctx.worktreePath);
  if (!workspace) return;
  await exec('herdr', [
    'workspace',
    'report-metadata',
    workspace.workspaceId,
    '--source',
    'bakers',
    ...token,
  ]);
}

/**
 * Marks a frozen ticket's workspace in herdr's sidebar with display-only
 * metadata. A rename is avoided on purpose: run teardown matches labels.
 */
export const herdrFrozenMarker: HookListener = {
  id: 'herdr-frozen-marker',
  on_freeze: (ctx) =>
    reportOnWorktree(ctx, ['--token', `${FROZEN_TOKEN}=frozen`]),
  on_resume: (ctx) => reportOnWorktree(ctx, ['--clear-token', FROZEN_TOKEN]),
};
