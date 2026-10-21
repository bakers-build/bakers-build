// Public screen primitives for lazy UI entry modules.

export {
  type ActionItem,
  actionItem,
} from './Component/footer-actions/index.js';
export { plainLine } from './Component/markdown/index.js';
export type { Section } from './Component/section-list/index.js';
export { flattenSections, lineText } from './Component/section-list/index.js';
export {
  createSessionStore,
  type DataKey,
  dataKey,
  type SessionStore,
} from './Data/session-store.js';
export type { ListColumn, ListTable } from './Entity/collection.js';
export {
  listRowIds,
  listTableRows,
  listTableTree,
} from './Entity/collection.js';
export {
  firstLineSummary,
  handleTicketCopy,
  tabViewTree,
  ticketCopyActions,
  ticketEditAction,
  ticketHeaderTree,
  ticketTitleOf,
} from './Entity/ticket/Component/ticket-detail/index.js';
export {
  ticketDetailInputContext,
  ticketInputContext,
} from './Entity/ticket/Data/input.js';
export {
  readTicket,
  saveTicket,
  watchTicket,
} from './Entity/ticket/Data/store.js';
export { type ContributionApi, register } from './Extension/store.js';
export { copyThrough } from './lib/clipboard.js';
export { ListCursor } from './lib/cursor.js';
export { columnNode, textNode } from './lib/vnode.js';
export type {
  RouteMetadata,
  ScreenClass,
  TabMetadata,
  TabReference,
} from './Routing/route.js';
export { AsyncScreen } from './Screen/async-screen.js';
export { type RowActionOptions, runRowAction } from './Screen/row-action.js';
export type { Screen, ScreenAction, ScreenContext } from './Screen/screen.js';
export type { TicketDetailDocument } from './types.js';
