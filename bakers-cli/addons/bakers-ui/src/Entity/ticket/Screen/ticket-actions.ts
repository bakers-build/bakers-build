import { DrupalJsonApiParams } from 'drupal-jsonapi-params';
import type { ConfirmRequest } from '../../../Screen/confirm-dialog.js';
import type { TicketDetailDocument } from '../../../types.js';
import { CANCELLABLE_RUN_STATES } from '../../run/Form/edit.js';
import { cancelRun, runNumber } from '../../run/Screen/run-actions.js';
import { loadTicketDetail } from '../Data/detail.js';
import { cancelEditPayload } from '../Form/edit.js';

const identifierOf = (document: TicketDetailDocument): string =>
  String(document.data?.attributes?.identifier ?? document.data?.id ?? '');

/** Cancel ticket, for the confirmation dialog. */
export const cancelTicketRequest = (
  document: TicketDetailDocument,
): ConfirmRequest => ({
  title: '✕ Cancel ticket',
  prepare: () =>
    Promise.resolve({
      message: `Cancel ${identifierOf(document)}?`,
      detail: 'The ticket moves to cancelled.',
      confirm: async (context) => {
        const services = context.services;
        const ticketId = document.data?.id;
        if (!services || !ticketId)
          throw new Error('No connection to cancel the ticket.');
        await (services.writeClient ?? services.client).update(
          'bb_ticket--bb_ticket',
          ticketId,
          cancelEditPayload(),
        );
        return {
          type: 'ticket-cancelled',
          document: await loadTicketDetail(services.client, ticketId),
        };
      },
    }),
});

/**
 * Restart run, for the confirmation dialog: cancel the ticket's active run and
 * nothing else; the conductor claims the ticket again as usual.
 *
 * The Overview document carries no runs (transcripts are big), so the dialog
 * reads them when it opens, with only the fields it needs. A run that ended
 * since leaves nothing to confirm.
 */
export const restartRunRequest = (
  ticketId: string,
  identifier: string,
): ConfirmRequest => ({
  title: '↻ Restart run',
  prepare: async (context) => {
    const client = context.services?.client;
    if (!client) throw new Error('No connection to read the runs.');
    const document = (await client.get(
      `bb_ticket/bb_ticket/${ticketId}`,
      new DrupalJsonApiParams()
        .addInclude(['runs'])
        .addFields('bb_run--bb_run', ['state', 'drupal_internal__id']),
    )) as TicketDetailDocument;
    const active = document.included?.find(
      (resource) =>
        resource.type === 'bb_run--bb_run' &&
        CANCELLABLE_RUN_STATES.has(String(resource.attributes?.state ?? '')),
    );
    const runId = active?.id;
    if (!runId) return { message: 'No active run any more.' };
    return {
      message: `Restart run${runNumber(document, runId)} of ${identifier}?`,
      detail: 'The active run is cancelled; the conductor starts a new one.',
      confirm: (confirmContext) => cancelRun(confirmContext, document, runId),
    };
  },
});
