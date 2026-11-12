import { DrupalBbRemote } from '@bakers-build/addon-remote-drupal';
import type { BbRemote, ToolHandler } from '@bakers-build/conductor/contract';
import {
  createBbConnectionClient,
  exec,
  loadBbConfig,
} from '@bakers-build/core';
import { gatherBatch } from './deployment.js';

export function deploymentTools(
  remote: Pick<BbRemote, 'resolveTicketByIdentifier'>,
): Record<string, ToolHandler> {
  return {
    deployment_tickets: async (req) => {
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
        { cwd: req.worktreePath, env: { GIT_NO_LAZY_FETCH: '1' } },
      );
      return {
        text: JSON.stringify(
          await gatherBatch({
            sinceRef: since,
            toRef: to,
            gitLog,
            resolve: (id) => remote.resolveTicketByIdentifier(project, id),
          }),
        ),
      };
    },
  };
}

// Resolve credentials in the conductor's cwd, never from the run's worktree.
export function toolsFor(): Record<string, ToolHandler> {
  let remote: Promise<DrupalBbRemote> | undefined;
  return deploymentTools({
    resolveTicketByIdentifier: async (project, id) => {
      remote ??= loadBbConfig({ resolveBases: [process.cwd()] }).then(
        async (connection) =>
          new DrupalBbRemote(await createBbConnectionClient(connection)),
      );
      return (await remote).resolveTicketByIdentifier(project, id);
    },
  });
}
