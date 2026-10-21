/**
 * Ticket-form adapter for translating terminal input into form intents.
 *
 * The generic form kernel deliberately has no knowledge of terminal screens;
 * consumers outside the kernel reach it through their entity form adapter.
 */
export { keyToIntent } from '../../../Form/index.js';
