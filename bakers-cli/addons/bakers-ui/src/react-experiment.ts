import { TicketReactMarkdownScreen } from './Entity/ticket/Screen/ticket-react-markdown.js';
import { register } from './Extension/store.js';

register('bakers/react-experiment', (api) => {
  api.add(TicketReactMarkdownScreen);
});
