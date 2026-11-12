import { DrupalBbRemote } from '@bakers-build/addon-remote-drupal';
import type { BbRemote, ToolHandler } from '@bakers-build/conductor/contract';
import {
  createBbConnectionClient,
  exec,
  loadBbConfig,
} from '@bakers-build/core';
import { gatherBatch } from './deployment.js';

export function deploymentTools(
  resolveRemote: (
    signal: AbortSignal,
  ) => Promise<Pick<BbRemote, 'resolveTicketByIdentifier'>>,
): Record<string, ToolHandler> {
  return {
    deployment_tickets: async (req) => {
      req.signal.throwIfAborted();
      const project = req.ticket?.projectId;
      if (!project)
        throw new Error('deployment_tickets requires a run ticket project');
      const ref = (value: unknown): string => {
        if (
          typeof value !== 'string' ||
          !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(value)
        )
          throw new Error('deployment_tickets requires a git ref or SHA');
        return value;
      };
      const since = ref(req.args.since);
      const to = ref(req.args.to);
      const gitLog = await exec(
        'git',
        [
          '-c',
          'core.hooksPath=/dev/null',
          '-c',
          'core.fsmonitor=false',
          'log',
          '--format=%x1e%H %s%n%b',
          '--no-show-signature',
          '--end-of-options',
          `${since}..${to}`,
          '--',
        ],
        {
          cwd: req.worktreePath,
          env: { GIT_NO_LAZY_FETCH: '1' },
          signal: req.signal,
        },
      );
      req.signal.throwIfAborted();
      let remote: Pick<BbRemote, 'resolveTicketByIdentifier'> | undefined;
      return {
        text: JSON.stringify(
          await gatherBatch({
            sinceRef: since,
            toRef: to,
            gitLog,
            resolve: async (id) => {
              req.signal.throwIfAborted();
              remote ??= await resolveRemote(req.signal);
              req.signal.throwIfAborted();
              const ticket = await remote.resolveTicketByIdentifier(
                { uuid: project },
                id,
              );
              req.signal.throwIfAborted();
              return ticket;
            },
          }),
        ),
      };
    },
  };
}

// Resolve credentials in the conductor's cwd, never from the run's worktree.
export function toolsFor(): Record<string, ToolHandler> {
  return deploymentTools(async (signal) => {
    const connection = await loadBbConfig({ resolveBases: [process.cwd()] });
    signal.throwIfAborted();
    return new DrupalBbRemote(
      await createBbConnectionClient(connection, { signal }),
    );
  });
}
