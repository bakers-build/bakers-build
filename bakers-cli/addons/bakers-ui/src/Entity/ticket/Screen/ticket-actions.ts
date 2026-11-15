import type { ConfirmRequest } from '../../../Screen/confirm-dialog.js';
import type { TicketDetailDocument } from '../../../types.js';
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
