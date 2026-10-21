import type { VNode } from '@opentui/core';
import {
  type ActionItem,
  actionItem,
} from '../../../Component/footer-actions/index.js';
import { flattenSections } from '../../../Component/section-list/index.js';
import type { RouteMetadata } from '../../../Routing/route.js';
import { AsyncScreen } from '../../../Screen/async-screen.js';
import type { FullScreenChrome } from '../../../Screen/full-screen.js';
import type { ScreenAction, ScreenContext } from '../../../Screen/screen.js';
import type { TicketDetailDocument } from '../../../types.js';
import { TICKET_SECTIONS } from '../Component/sections/index.js';
import {
  type AssignmentLabels,
  handleTicketCopy,
  sectionsForTab,
  tabViewTree,
  ticketCopyActions,
  ticketEditAction,
  ticketHeaderTree,
  ticketTitleOf,
} from '../Component/ticket-detail/index.js';
import { ticketDetailInputContext, ticketInputContext } from '../Data/input.js';
import {
  loadTicketView,
  readTicket,
  refreshTicket,
  saveTicket,
  ticketLoaded,
  watchTicket,
} from '../Data/store.js';

const INCLUDES = [
  'sub_tickets',
  'referenced_tickets',
  'blocked_by',
  'parent_id',
];
const RELATED_TAB = TICKET_SECTIONS.findIndex((tab) => tab.id === 'related');

/** Owns the ticket's related view and its interaction state. */
export class TicketRelatedScreen extends AsyncScreen<TicketDetailDocument> {
  static readonly route = {
    id: 'ticket.related',
    path: '/tickets/:ticketId/related',
    parent: 'project.tickets',
    tab: { id: 'related', label: 'Relationships', scope: 'ticket', weight: 30 },
    fallback: { routeId: 'my.work' },
    context: ticketInputContext,
  } satisfies RouteMetadata;
  readonly id = TicketRelatedScreen.route.id;
  readonly frameId = 'ticket';
  private selectedEntry = 0;
  private initializedKey: unknown;
  private labels: AssignmentLabels | undefined;
  private status = '';
  private releaseStore: (() => void) | undefined;
  private expanded = new Set<number>();

  reload(context: ScreenContext): void {
    refreshTicket(context);
    this.retry(context);
  }
  get document(): TicketDetailDocument | undefined {
    return this.readyValue;
  }

  override enter(context: ScreenContext): void {
    this.releaseStore?.();
    super.enter(context);
    if (context.contexts?.has(ticketDetailInputContext)) {
      const document = readTicket(context);
      this.replaceReady(document);
      this.initialize(document);
    }
    if (this.state === 'ready' && context.store) {
      this.replaceReady(readTicket(context, this.document));
      if (!ticketLoaded(context, INCLUDES)) this.retry(context);
    }
    this.releaseStore = watchTicket(context, (document) => {
      if (this.state === 'ready') this.replaceReady(document);
      context.requestDraw();
    });
    context.requestDraw();
  }

  override leave(): void {
    this.releaseStore?.();
    this.releaseStore = undefined;
    super.leave();
  }

  protected load(context: ScreenContext): Promise<TicketDetailDocument> {
    return loadTicketView(context, INCLUDES);
  }
  protected renderLoading(): string[] {
    return ['Loading related…'];
  }
  protected override didLoad(
    document: TicketDetailDocument,
    _context: ScreenContext,
  ): void {
    this.initialize(document);
  }

  private initialize(document: TicketDetailDocument): void {
    const key = document.data?.id ?? document;
    if (this.initializedKey === key) return;
    this.initializedKey = key;
    this.selectedEntry = 0;
    this.status = '';
    this.expanded = new Set<number>();
  }

  saveState(): { selectedEntry: number } {
    return { selectedEntry: this.selectedEntry };
  }
  restoreState(token: unknown): void {
    if (
      token &&
      typeof token === 'object' &&
      typeof (token as { selectedEntry?: unknown }).selectedEntry === 'number'
    )
      this.selectedEntry = (token as { selectedEntry: number }).selectedEntry;
  }
  setLabels(labels: AssignmentLabels | undefined): void {
    this.labels = labels;
  }

  select(index: number, context: ScreenContext): boolean {
    const next = Math.max(
      0,
      Math.min(index, Math.max(0, this.currentView(context).selectable - 1)),
    );
    if (next === this.selectedEntry) return false;
    this.selectedEntry = next;
    context.requestDraw();
    return true;
  }
  activate(index: number, context: ScreenContext): boolean {
    if (!this.document) return false;
    if (this.expanded.has(index)) this.expanded.delete(index);
    else this.expanded.add(index);
    context.requestDraw();
    return true;
  }

  override handleInput(input: string, context: ScreenContext): boolean {
    if (super.handleInput(input, context)) return true;
    if (this.state !== 'ready') return false;
    const view = this.currentView(context);
    if (input === 'y' || input === 'Y') {
      this.status = handleTicketCopy(input, context, this.document) ?? '';
      context.requestDraw();
      return true;
    }
    if ((input === 'enter' || input === ' ') && view.selectable > 0)
      return this.activate(this.selectedEntry, context);
    if (view.selectable > 1 && (input === 'j' || input === 'down'))
      return this.select(this.selectedEntry + 1, context);
    if (view.selectable > 1 && (input === 'k' || input === 'up'))
      return this.select(this.selectedEntry - 1, context);
    if (view.selectable > 1 && input === 'g') return this.select(0, context);
    if (view.selectable > 1 && input === 'G')
      return this.select(view.selectable - 1, context);
    return false;
  }
  commandForInput(input: string): string | undefined {
    return this.state === 'ready' && input === 'e'
      ? 'edit-assignment'
      : undefined;
  }
  actionForInput(
    input: string,
    context: ScreenContext,
  ): ScreenAction | undefined {
    return this.commandForInput(input) === 'edit-assignment'
      ? ticketEditAction(context, this.document)
      : undefined;
  }
  receiveResult(result: unknown, context: ScreenContext): void {
    if (
      result &&
      typeof result === 'object' &&
      (result as { type?: unknown }).type === 'ticket-assignment-updated'
    ) {
      const returned = result as {
        document?: TicketDetailDocument;
        options?: AssignmentLabels;
      };
      if (returned.document)
        this.replaceReady(saveTicket(context, returned.document));
      this.labels = returned.options;
      context.requestDraw();
    }
  }
  protected renderReady(
    document: TicketDetailDocument,
    context: ScreenContext,
  ): VNode {
    this.initialize(document);
    return this.currentView(context).body;
  }
  protected chrome(context: ScreenContext): FullScreenChrome {
    const document = this.document;
    if (!document) return { title: context.params?.ticketId ?? 'ticket' };
    this.initialize(document);
    const { identifier, title } = ticketTitleOf(document);
    const view = this.currentView(context);
    return {
      selectable: view.selectable,
      selectedIndex: this.selectedEntry,
      cursorMode: view.selectable > 1 ? 'select' : 'scroll',
      rowIds: view.rowIds,
      title: `${identifier} · ${title}`,
      header: ticketHeaderTree(document, identifier, title, [], this.labels),
    };
  }
  protected actions(context: ScreenContext): readonly ActionItem[] {
    if (!this.document) return [];
    const view = this.currentView(context);
    return [
      actionItem('detail-tab', 'Tab', 'section'),
      actionItem('detail-edit', 'e', 'edit'),
      ...ticketCopyActions(),
      actionItem(
        'detail-arrows',
        '↑↓',
        view.selectable > 1 ? 'select' : 'scroll',
      ),
      ...(view.selectable > 0
        ? [actionItem('detail-enter', 'Enter/Space', 'expand')]
        : []),
    ];
  }
  protected override notice(): string | undefined {
    return this.status || undefined;
  }
  override reset(): void {
    this.releaseStore?.();
    this.releaseStore = undefined;
    super.reset();
    this.selectedEntry = 0;
    this.initializedKey = undefined;
    this.labels = undefined;
    this.status = '';
    this.expanded = new Set<number>();
  }
  private currentView(context: ScreenContext) {
    const nowSeconds = context.nowSeconds?.() ?? Math.floor(Date.now() / 1000);
    return tabViewTree(this.document ?? {}, RELATED_TAB, {
      expanded: this.expanded,
      nowSeconds,
      selectedIndex: this.selectedEntry,
      ...(this.labels ? { labels: this.labels } : {}),
    });
  }
  renderNonInteractive(context: ScreenContext): string[] {
    const document = this.document;
    if (!document) return this.noticeRows(context) ?? [];
    const nowSeconds = context.nowSeconds?.() ?? Math.floor(Date.now() / 1000);
    return flattenSections(
      sectionsForTab(document, RELATED_TAB, this.labels, nowSeconds),
    ).lines;
  }
}
