import type { VNode } from '@opentui/core';
import {
  type ActionItem,
  actionItem,
} from '../../../Component/footer-actions/index.js';
import { flattenSections } from '../../../Component/section-list/index.js';
import { ListCursor } from '../../../lib/cursor.js';
import { columnNode } from '../../../lib/vnode.js';
import type { RouteMetadata } from '../../../Routing/route.js';
import { AsyncScreen } from '../../../Screen/async-screen.js';
import type { FullScreenChrome } from '../../../Screen/full-screen.js';
import type { ScreenAction, ScreenContext } from '../../../Screen/screen.js';
import type { TicketDetailDocument } from '../../../types.js';
import { listRowIds, listTableRows, listTableTree } from '../../collection.js';
import { TICKET_RUN_TABLE, ticketRunRows } from '../../run/Data/runs.js';
import { isRunCancellable } from '../../run/Form/edit.js';
import {
  handleTicketCopy,
  ticketCopyActions,
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

const INCLUDES = ['runs'];

/** Owns the ticket's runs view and its interaction state. */
export class TicketRunsScreen extends AsyncScreen<TicketDetailDocument> {
  static readonly route = {
    id: 'ticket.runs',
    path: '/tickets/:ticketId/runs',
    parent: 'project.tickets',
    tab: { id: 'runs', label: 'Runs', scope: 'ticket', weight: 40 },
    fallback: { routeId: 'my.work' },
    context: ticketInputContext,
  } satisfies RouteMetadata;
  readonly id = TicketRunsScreen.route.id;
  readonly frameId = 'ticket';
  private readonly cursor = new ListCursor();
  private initializedKey: unknown;
  private status = '';
  private releaseStore: (() => void) | undefined;

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
    return ['Loading runs…'];
  }
  protected override didLoad(
    document: TicketDetailDocument,
    context: ScreenContext,
  ): void {
    this.initialize(document);
    if (context.params?.runId)
      context.navigate?.(
        'run.detail',
        {
          ticketId: document.data?.id ?? context.params.ticketId ?? '',
          runId: context.params.runId,
        },
        document,
      );
  }

  private initialize(document: TicketDetailDocument): void {
    const key = document.data?.id ?? document;
    if (this.initializedKey === key) return;
    this.initializedKey = key;
    this.cursor.index = 0;
    this.status = '';
  }

  saveState(): { selectedEntry: number } {
    return { selectedEntry: this.cursor.index };
  }
  restoreState(token: unknown): void {
    if (
      token &&
      typeof token === 'object' &&
      typeof (token as { selectedEntry?: unknown }).selectedEntry === 'number'
    )
      this.cursor.index = (token as { selectedEntry: number }).selectedEntry;
  }

  select(index: number, context: ScreenContext): boolean {
    const next = Math.max(
      0,
      Math.min(index, Math.max(0, this.currentView(context).selectable - 1)),
    );
    if (next === this.cursor.index) return false;
    this.cursor.index = next;
    context.requestDraw();
    return true;
  }
  activate(index: number, context: ScreenContext): boolean {
    if (!this.document) return false;
    const run = ticketRunRows(this.document)[index];
    if (!run?.id || !context.navigate) return false;
    context.navigate(
      'run.detail',
      {
        ticketId: this.document.data?.id ?? context.params?.ticketId ?? '',
        runId: run.id,
      },
      this.document,
    );
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
      return this.activate(this.cursor.index, context);
    if (view.selectable > 1 && (input === 'j' || input === 'down'))
      return this.select(this.cursor.index + 1, context);
    if (view.selectable > 1 && (input === 'k' || input === 'up'))
      return this.select(this.cursor.index - 1, context);
    if (view.selectable > 1 && input === 'g') return this.select(0, context);
    if (view.selectable > 1 && input === 'G')
      return this.select(view.selectable - 1, context);
    return false;
  }
  /** The selected run, when it can still be edited (claimed or running). */
  private editableRun(): { id: string } | undefined {
    if (!this.document) return undefined;
    const run = ticketRunRows(this.document)[this.cursor.index];
    return run?.id && isRunCancellable(run.state) ? { id: run.id } : undefined;
  }
  commandForInput(input: string): string | undefined {
    return this.state === 'ready' && input === 'e' && this.editableRun()
      ? 'edit-run'
      : undefined;
  }
  actionForInput(
    input: string,
    context: ScreenContext,
  ): ScreenAction | undefined {
    const run = this.editableRun();
    if (this.commandForInput(input) !== 'edit-run' || !run) return undefined;
    return {
      type: 'navigate',
      routeId: 'run.edit',
      params: {
        ticketId: this.document?.data?.id ?? context.params?.ticketId ?? '',
        runId: run.id,
      },
      result: this.document,
    };
  }
  receiveResult(result: unknown, context: ScreenContext): void {
    if (
      result &&
      typeof result === 'object' &&
      (result as { type?: unknown }).type === 'run-cancelled'
    ) {
      const document = (result as { document?: TicketDetailDocument }).document;
      if (document) this.replaceReady(saveTicket(context, document));
      context.requestDraw();
      return;
    }
    if (
      result &&
      typeof result === 'object' &&
      (result as { type?: unknown }).type === 'ticket-assignment-updated'
    ) {
      const returned = result as {
        document?: TicketDetailDocument;
      };
      if (returned.document)
        this.replaceReady(saveTicket(context, returned.document));
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
      selectedIndex: this.cursor.index,
      cursorMode: view.selectable > 1 ? 'select' : 'scroll',
      rowIds: view.rowIds,
      title: `${identifier} · ${title}`,
      header: ticketHeaderTree(document, identifier, title, []),
    };
  }
  protected actions(context: ScreenContext): readonly ActionItem[] {
    if (!this.document) return [];
    const view = this.currentView(context);
    return [
      actionItem('detail-tab', 'Tab', 'section'),
      ...(this.editableRun()
        ? [actionItem('detail-edit', 'e', 'edit run')]
        : []),
      ...ticketCopyActions(),
      actionItem(
        'detail-arrows',
        '↑↓',
        view.selectable > 1 ? 'select' : 'scroll',
      ),
      ...(view.selectable > 0
        ? [actionItem('detail-enter', 'Enter', 'open run')]
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
    this.cursor.index = 0;
    this.initializedKey = undefined;
    this.status = '';
  }
  private currentView(context: ScreenContext) {
    const nowSeconds = context.nowSeconds?.() ?? Math.floor(Date.now() / 1000);
    const rows = ticketRunRows(this.document ?? {});
    return {
      body: columnNode(
        'ticket-detail',
        listTableTree(TICKET_RUN_TABLE, rows, nowSeconds, {
          selectedIndex: this.cursor.index,
        }),
      ),
      selectable: rows.length,
      rowIds: listRowIds(TICKET_RUN_TABLE, rows),
    };
  }
  renderNonInteractive(context: ScreenContext): string[] {
    const document = this.document;
    if (!document) return this.noticeRows(context) ?? [];
    const nowSeconds = context.nowSeconds?.() ?? Math.floor(Date.now() / 1000);
    return flattenSections([
      {
        heading: 'Runs',
        lines: listTableRows(
          TICKET_RUN_TABLE,
          ticketRunRows(document),
          nowSeconds,
        ),
      },
    ]).lines;
  }
}
