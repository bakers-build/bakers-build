import type { ConfirmRequest } from '../../../Screen/confirm-dialog.js';
import type { TicketDetailDocument } from '../../../types.js';
import { restartRunsRequest } from '../../conductor/Screen/restart-runs.js';
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
 * Restart runs of one ticket, for the confirmation dialog: the site lists the
 * ticket's runs to restart, OK cancels them. Returns the ticket as read
 * afterwards, so the detail repaints with its runs and derived_status.
 */
export const restartTicketRequest = (
  ticketId: string,
  identifier: string,
): ConfirmRequest => {
  const request = restartRunsRequest({
    level: 'ticket',
    label: identifier,
    args: { ticket: ticketId },
  });
  return {
    ...request,
    prepare: async (context) => {
      const prompt = await request.prepare(context);
      const confirm = prompt.confirm;
      if (!confirm) return prompt;
      return {
        ...prompt,
        confirm: async (confirmContext, checked) => {
          await confirm(confirmContext, checked);
          const client = confirmContext.services?.client;
          // The cancel landed; a failed re-read must not report it as failed.
          const document = client
            ? await loadTicketDetail(client, ticketId).catch(() => undefined)
            : undefined;
          return { type: 'run-cancelled', document };
        },
      };
    },
  };
};
