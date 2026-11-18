import { DrupalJsonApiParams } from 'drupal-jsonapi-params';
import type { ConfirmRequest } from '../../../Screen/confirm-dialog.js';
import type { DropshClient } from '../../../types.js';
import { CANCELLED_RUN_STATE } from '../../run/Form/edit.js';

/** One run Restart runs cancels. */
export interface CoveredRun {
  readonly id: string;
  readonly number: string;
  readonly state: string;
  readonly identifier: string;
  readonly frozen: boolean;
  readonly errorLog: string;
}

/** What Restart runs acts on: a machine (all its conductors) or one conductor. */
export interface RestartTarget {
  readonly level: 'machine' | 'conductor';
  readonly label: string;
  readonly conductorIds: readonly string[];
  /** Whether the conductor, or any conductor of the machine, is online. */
  readonly online: boolean;
}

interface Resource {
  id?: string;
  attributes?: Record<string, unknown>;
  relationships?: { ticket_id?: { data?: { id?: string } | null } };
}

/** Whether `runId` is its ticket's newest run, in the failed-run breaker's order. */
const isNewest = async (
  client: DropshClient,
  ticketId: string,
  runId: string,
): Promise<boolean> => {
  const params = new DrupalJsonApiParams()
    .addFilter('ticket_id.id', ticketId)
    .addSort('changed', 'DESC')
    .addSort('drupal_internal__id', 'DESC')
    .addFields('bb_run--bb_run', ['drupal_internal__id'])
    .addPageLimit(1);
  const doc = (await client.get('bb_run/bb_run', params)) as {
    data?: Resource[];
  };
  return doc.data?.[0]?.id === runId;
};

/** One page of these conductors' runs in `states`, tickets included. */
const readRuns = async (
  client: DropshClient,
  conductorIds: readonly string[],
  states: string[],
  order: 'ASC' | 'DESC',
  openTicketsOnly = false,
) => {
  const params = new DrupalJsonApiParams()
    .addFilter('conductor_id.id', [...conductorIds], 'IN')
    .addFilter('state', states, 'IN')
    .addInclude(['ticket_id'])
    .addFields('bb_run--bb_run', [
      'state',
      'drupal_internal__id',
      'error_log',
      'ticket_id',
    ])
    .addFields('bb_ticket--bb_ticket', ['identifier', 'frozen'])
    .addSort('drupal_internal__id', order)
    .addPageLimit(50);
  if (openTicketsOnly) params.addFilter('ticket_id.closed', '0');
  const doc = (await client.get('bb_run/bb_run', params)) as {
    data?: Resource[];
    included?: Resource[];
  };
  const tickets = new Map(
    (doc.included ?? []).map((t) => [t.id ?? '', t.attributes ?? {}]),
  );
  return (doc.data ?? []).map((run) => {
    const ticketId = run.relationships?.ticket_id?.data?.id ?? '';
    const ticket = tickets.get(ticketId) ?? {};
    return {
      ticketId,
      run: {
        id: run.id ?? '',
        number: String(run.attributes?.drupal_internal__id ?? ''),
        state: String(run.attributes?.state ?? ''),
        identifier: String(ticket.identifier ?? '?'),
        frozen: ticket.frozen === true,
        errorLog: String(run.attributes?.error_log ?? ''),
      } satisfies CoveredRun,
    };
  });
};

/**
 * The runs Restart runs cancels: every claimed or running run of these
 * conductors, plus each open ticket's newest run when it failed on one of them.
 *
 * shortcut: the server's rule (`TicketInterventions::restartCoveredRuns`) is
 * mirrored here, and each of the two reads takes one page of 50 (active runs
 * stay below a machine's capacity; failed runs are read newest first); unify
 * once the site offers a restart endpoint.
 */
export const restartCoveredRuns = async (
  client: DropshClient,
  conductorIds: readonly string[],
): Promise<CoveredRun[]> => {
  if (conductorIds.length === 0) return [];
  const active = await readRuns(
    client,
    conductorIds,
    ['claimed', 'running'],
    'ASC',
  );
  const failed = await readRuns(client, conductorIds, ['failed'], 'DESC', true);
  const covered = active.map(({ run }) => run);
  const seen = new Set<string>();
  for (const { ticketId, run } of failed) {
    // Newest first: only a ticket's latest failed run can be its newest run.
    if (seen.has(ticketId)) continue;
    seen.add(ticketId);
    if (await isNewest(client, ticketId, run.id)) covered.push(run);
  }
  return covered;
};

/** The error-log line naming Restart runs, its level and the person. */
export const restartNote = (target: RestartTarget, person: string): string =>
  `Restart runs (${target.level} ${target.label}) by ${person}`;

const runLine = (run: CoveredRun): string =>
  `${run.identifier} · run #${run.number} · ${run.state}${
    run.frozen ? ' · frozen: the fresh run follows unfreeze' : ''
  }`;

const sameRuns = (a: readonly CoveredRun[], b: readonly CoveredRun[]) =>
  a.map((run) => run.id).join() === b.map((run) => run.id).join();

/**
 * Restart runs, for the confirmation dialog: cancel every covered run with a
 * note; the conductor then gives each ticket one fresh run.
 *
 * Confirm reads the set again and writes nothing when it changed.
 */
export const restartRunsRequest = (target: RestartTarget): ConfirmRequest => ({
  title: '↻ Restart runs',
  prepare: async (context) => {
    const client = context.services?.client;
    if (!client) throw new Error('No connection to read the runs.');
    const runs = await restartCoveredRuns(client, target.conductorIds);
    const name = `${target.level} ${target.label}`;
    if (runs.length === 0) return { message: `No runs to restart on ${name}.` };
    return {
      message: `Restart runs on ${name}?`,
      detail: [
        ...runs.map(runLine),
        'Each run is cancelled; its ticket gets one fresh run.',
        ...(target.online
          ? []
          : [
              'It is offline: tab and runtime cleanup and the fresh runs follow its next start.',
            ]),
      ].join('\n'),
      confirm: async (confirmContext) => {
        const services = confirmContext.services;
        if (!services) throw new Error('No connection to restart the runs.');
        const fresh = await restartCoveredRuns(
          services.client,
          target.conductorIds,
        );
        if (!sameRuns(fresh, runs))
          throw new Error(
            'The runs changed since the dialog opened. Open it again.',
          );
        const note = restartNote(target, services.currentUser ?? 'unknown');
        const writer = services.writeClient ?? services.client;
        for (const run of fresh) {
          await writer.update('bb_run--bb_run', run.id, {
            attributes: {
              state: CANCELLED_RUN_STATE,
              error_log: run.errorLog ? `${run.errorLog}\n${note}` : note,
            },
          });
        }
        return { type: 'runs-restarted', count: fresh.length };
      },
    };
  },
});
