import { defineContext } from '../../../Routing/context.js';
import type { RouteMetadata } from '../../../Routing/route.js';
import type { TicketDetailDocument } from '../../../types.js';

export interface TicketDetailInput {
  readonly document: TicketDetailDocument;
}

export const ticketDetailInputContext = defineContext<TicketDetailInput>(
  'ticket-detail-input',
  'input',
);

export const ticketInputContext: NonNullable<RouteMetadata['context']> = (
  _params,
  state,
  base,
) => {
  const supplied = state as TicketDetailInput | undefined;
  return supplied?.document
    ? base.set(ticketDetailInputContext, supplied)
    : base;
};
