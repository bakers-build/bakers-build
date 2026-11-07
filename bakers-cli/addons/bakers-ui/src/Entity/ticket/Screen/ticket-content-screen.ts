import {
  type ActionItem,
  actionItem,
} from '../../../Component/footer-actions/index.js';
import { copyThrough } from '../../../lib/clipboard.js';
import { serverMessage } from '../../../lib/jsonapi-error.js';
import { BORDER, textNode } from '../../../lib/vnode.js';
import {
  AsyncScreen,
  type FullScreenChrome,
} from '../../../Screen/async-screen.js';
import { runRowAction } from '../../../Screen/row-action.js';
import type {
  ScreenAction,
  ScreenContext,
  ScreenId,
} from '../../../Screen/screen.js';
import type { TicketDetailDocument, UiViewMode } from '../../../types.js';
import {
  ADDONS_KEY,
  hasAddonsMessages,
  type SidebarTabId,
  TicketContent,
  type TicketContentProps,
} from '../Component/ticket-content/index.js';
import {
  initialExpandedKeys,
  resolveSelectedKey,
  retainExpandedKeys,
  type TicketContentTab,
  ticketContentModel,
  ticketContentRowId,
} from '../Component/ticket-content/model.js';
import {
  type AssignmentLabels,
  handleTicketCopy,
  ticketCopyActions,
  ticketEditAction,
  ticketHeaderTree,
  ticketTitleOf,
} from '../Component/ticket-detail/index.js';
import {
  ticketTeaserLines,
  ticketTeaserTree,
} from '../Component/ticket-teaser/index.js';
import { readTicketAddons, type TicketAddons } from '../Data/addons.js';
import { loadTicketDetail } from '../Data/detail.js';
import { ticketDetailInputContext } from '../Data/input.js';
import {
  loadTicketView,
  readTicket,
  refreshTicket,
  saveTicket,
  ticketLoaded,
  watchTicket,
} from '../Data/store.js';
import { updateTicketFrozen } from '../Data/write.js';

/** Overview width when the context carries none — a pipe has no terminal. */
const DEFAULT_COLUMNS = 80;

/**
 * Owns ticket content load, selection, chrome and paint for the three ticket
 * document routes. Route subclasses supply the tab, includes and pipe output.
 */
export abstract class TicketContentScreen extends AsyncScreen<TicketDetailDocument> {
  abstract readonly id: ScreenId;
  abstract readonly tab: TicketContentTab;
  readonly frameId = 'ticket';
  protected abstract readonly includes: readonly string[];
  private selectedKey: string | undefined;
  private initializedKey: unknown;
  protected labels: AssignmentLabels | undefined;
  private status = '';
  private readonly freezeBusy = new Set<string>();
  private releaseStore: (() => void) | undefined;
  private expanded = new Set<string>();
  protected viewMode: UiViewMode = 'full';
  /** Visit-local: the sidebar pane and Planning document tab last chosen. */
  private sidebarTab: SidebarTabId | undefined;
  private documentKey: string | undefined;
  /** Overview only (BB-661); a stale load after navigating away is dropped. */
  private addonsPreview: TicketAddons | undefined;
  private addonsPreviewGeneration = 0;
  private modelMemo:
    | {
        readonly document: TicketDetailDocument;
        readonly labels: AssignmentLabels | undefined;
        readonly now: number;
        readonly model: ReturnType<typeof ticketContentModel>;
      }
    | undefined;

  compact(): boolean {
    return this.viewMode !== 'full';
  }
  get document(): TicketDetailDocument | undefined {
    return this.readyValue;
  }
  message(context: ScreenContext): string[] | undefined {
    return this.noticeRows(context);
  }
  /**
   * What the content tree is built from. Every callback is guarded by the
   * visit it was built for — a click that lands after the route was left
   * changes nothing — and one press that calls several of them (select, then
   * toggle) paints once.
   */
  contentProps(context: ScreenContext): TicketContentProps {
    const model = this.syncModel(context);
    const selectedKey = this.selectedKey;
    let drawQueued = false;
    const live = (action: () => void): void => {
      if (!context.isActive()) return;
      action();
      if (drawQueued) return;
      drawQueued = true;
      queueMicrotask(() => {
        drawQueued = false;
        context.requestDraw();
      });
    };
    return {
      id: 'ticket-content',
      model,
      tab: this.tab,
      ...(selectedKey === undefined ? {} : { selectedKey }),
      expandedKeys: this.expanded,
      terminalColumns: context.terminalColumns ?? DEFAULT_COLUMNS,
      ...(this.sidebarTab === undefined ? {} : { sidebarTab: this.sidebarTab }),
      ...(this.documentKey === undefined
        ? {}
        : { documentKey: this.documentKey }),
      ...(this.addonsPreview === undefined
        ? {}
        : { addonsPreview: this.addonsPreview }),
      onOpenAddons: () => this.openAddons(context),
      onSidebarTab: (tab) =>
        live(() => {
          this.sidebarTab = tab;
        }),
      onDocumentTab: (key) =>
        live(() => {
          this.documentKey = key;
        }),
      select: (key) =>
        live(() => {
          this.selectedKey = key;
        }),
      toggle: (key) =>
        live(() => {
          const next = new Set(this.expanded);
          if (next.has(key)) next.delete(key);
          else next.add(key);
          this.expanded = next;
        }),
      activateProperty: (item) => {
        if (!context.isActive()) return;
        if (item.ticketId !== undefined) {
          context.navigate?.('ticket.detail', { ticketId: item.ticketId });
        } else if (item.href !== undefined) {
          // A terminal cannot open a browser; copying the URL is the reliable
          // stand-in. OSC 52 goes through the same writer as the `y` copy.
          this.status = copyThrough(
            context.copyToClipboard,
            item.href,
            `the link ${item.href}`,
            'nothing to copy',
          );
          context.requestDraw();
        }
      },
    };
  }

  reload(context: ScreenContext): void {
    refreshTicket(context);
    this.retry(context);
  }

  override enter(context: ScreenContext): void {
    this.releaseStore?.();
    this.sidebarTab = undefined;
    this.documentKey = undefined;
    super.enter(context);
    if (context.contexts?.has(ticketDetailInputContext)) {
      const document = readTicket(context);
      this.replaceReady(document);
      this.initialize(document, context);
    }
    this.viewMode =
      context.params?.view === 'teaser' || context.params?.view === 'board_card'
        ? context.params.view
        : 'full';
    if (this.state === 'ready' && context.store) {
      this.replaceReady(readTicket(context, this.document));
      if (!ticketLoaded(context, this.includes)) this.retry(context);
    }
    this.releaseStore = watchTicket(context, (document) => {
      if (this.state === 'ready') this.replaceReady(document);
      context.requestDraw();
    });
    this.loadAddonsPreview(context);
    context.requestDraw();
  }

  /** The inline card's data (BB-661); Overview only, loaded once per visit. */
  private loadAddonsPreview(context: ScreenContext): void {
    this.addonsPreview = undefined;
    if (this.tab !== 'overview') return;
    const client = context.services?.client;
    const ticketId = context.params?.ticketId;
    if (!client || !ticketId) return;
    const generation = ++this.addonsPreviewGeneration;
    void readTicketAddons(client, ticketId)
      .then((model) => {
        if (generation !== this.addonsPreviewGeneration || !context.isActive())
          return;
        this.addonsPreview = model;
        context.requestDraw();
      })
      // Best-effort preview (matches route.ts's optional-fetch convention): a
      // failed fetch just leaves the card absent rather than crashing the
      // Overview screen or surfacing an unhandled rejection.
      .catch(() => undefined);
  }

  override leave(): void {
    this.releaseStore?.();
    this.releaseStore = undefined;
    super.leave();
  }

  protected load(context: ScreenContext): Promise<TicketDetailDocument> {
    return loadTicketView(context, this.includes);
  }
  protected override didLoad(
    document: TicketDetailDocument,
    context: ScreenContext,
  ): void {
    this.initialize(document, context);
  }

  saveState(): { readonly selectedKey?: string } {
    return this.selectedKey === undefined
      ? {}
      : { selectedKey: this.selectedKey };
  }
  restoreState(token: unknown): void {
    if (!token || typeof token !== 'object' || !('selectedKey' in token))
      return;
    const key = (token as { selectedKey: unknown }).selectedKey;
    if (key === undefined || typeof key === 'string') this.selectedKey = key;
  }
  setLabels(labels: AssignmentLabels | undefined): void {
    this.labels = labels;
  }

  /**
   * The model's selectable keys, plus the inline addons card's row (BB-661
   * D1) when the Overview preview has a message worth reaching: a Tab/arrow
   * visit stops there and Enter opens the full send/poll screen, the same
   * keyboard reach the Details/Related sidebar card already has via its
   * own (Technical details) row.
   */
  private selectableKeys(context: ScreenContext): readonly string[] {
    const keys = this.syncModel(context).selectableKeys;
    if (
      this.tab === 'overview' &&
      this.addonsPreview &&
      hasAddonsMessages(this.addonsPreview)
    ) {
      return [...keys, ADDONS_KEY];
    }
    return keys;
  }
  private openAddons(context: ScreenContext): void {
    if (!context.isActive()) return;
    context.navigate?.('ticket.addons', {
      ticketId: context.params?.ticketId ?? '',
    });
  }
  select(index: number, context: ScreenContext): boolean {
    const keys = this.selectableKeys(context);
    if (keys.length === 0) return false;
    const next = Math.max(0, Math.min(index, keys.length - 1));
    const key = keys[next];
    if (key === undefined || key === this.selectedKey) return false;
    this.selectedKey = key;
    context.requestDraw();
    return true;
  }
  activate(index: number, context: ScreenContext): boolean {
    if (!this.document) return false;
    const keys = this.selectableKeys(context);
    const key = keys[index];
    if (key === undefined) return false;
    if (key === ADDONS_KEY) {
      this.selectedKey = key;
      context.requestDraw();
      this.openAddons(context);
      return true;
    }
    const next = new Set(this.expanded);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    this.expanded = next;
    this.selectedKey = key;
    context.requestDraw();
    return true;
  }

  private isFrozen(): boolean {
    return this.document?.data?.attributes?.frozen === true;
  }

  /**
   * PATCH `frozen` through the write client, then re-read on the session
   * client so the ladder and document agree with the server.
   */
  private toggleFrozen(context: ScreenContext): boolean {
    const id = this.document?.data?.id ?? context.params?.ticketId;
    if (!id || !context.services) return true;
    const next = !this.isFrozen();
    const guard = this.captureLifecycle(context);
    return runRowAction({
      rowId: id,
      busy: this.freezeBusy,
      context,
      perform: async () => {
        try {
          await updateTicketFrozen(
            context.services?.writeClient ?? context.services?.client,
            id,
            next,
          );
        } catch (caught) {
          throw new Error(serverMessage(caught));
        }
        return { message: next ? 'frozen' : 'no longer frozen' };
      },
      refresh: async (ctx) => {
        refreshTicket(ctx);
        if (!ctx.services) return;
        const document = await loadTicketDetail(
          ctx.services.client,
          id,
          this.includes,
        );
        this.replaceReadyIfCurrent(guard, saveTicket(ctx, document), ctx);
      },
      setStatus: (status) => {
        this.status = status;
      },
      captureLifecycle: () => guard,
      lifecycleIsCurrent: (current, ctx) =>
        this.lifecycleIsCurrent(current, ctx),
      failPrefix: 'freeze failed',
    });
  }

  override handleInput(input: string, context: ScreenContext): boolean {
    if (super.handleInput(input, context)) return true;
    if (this.state !== 'ready' || this.viewMode !== 'full') return false;
    const keys = this.selectableKeys(context);
    const selectedIndex = this.selectedIndexOf(keys);
    if (input === 'y' || input === 'Y') {
      this.status = handleTicketCopy(input, context, this.document) ?? '';
      context.requestDraw();
      return true;
    }
    if (input === 'f') return this.toggleFrozen(context);
    if ((input === 'enter' || input === ' ') && keys.length > 0)
      return this.activate(selectedIndex, context);
    if (keys.length > 1 && (input === 'j' || input === 'down'))
      return this.select(selectedIndex + 1, context);
    if (keys.length > 1 && (input === 'k' || input === 'up'))
      return this.select(selectedIndex - 1, context);
    if (keys.length > 1 && input === 'g') return this.select(0, context);
    if (keys.length > 1 && input === 'G')
      return this.select(keys.length - 1, context);
    return false;
  }
  commandForInput(input: string): string | undefined {
    return this.state === 'ready' && this.viewMode === 'full' && input === 'e'
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
  ) {
    this.initialize(document, context);
    return this.viewMode !== 'full'
      ? ticketTeaserTree(document, this.viewMode)
      : TicketContent(this.contentProps(context));
  }
  /** The full document reads as content inside the frame; compact is flush. */
  protected override flushBody(): boolean {
    return this.viewMode !== 'full';
  }
  protected chrome(context: ScreenContext): FullScreenChrome {
    const document = this.document;
    if (!document) return { title: context.params?.ticketId ?? 'ticket' };
    this.initialize(document, context);
    const { identifier, title } = ticketTitleOf(document);
    if (this.viewMode !== 'full')
      return {
        title: `${identifier} · ${title}`,
        header: ticketHeaderTree(
          document,
          identifier,
          title,
          [
            textNode({
              id: 'ticket-detail-header-mode',
              content: `view: ${this.viewMode}  ·  Esc back · q quit`,
              fg: BORDER,
            }),
          ],
          this.labels,
        ),
      };
    const keys = this.selectableKeys(context);
    const selectedIndex = this.selectedIndexOf(keys);
    return {
      selectable: keys.length,
      selectedIndex,
      cursorMode: keys.length > 1 ? 'select' : 'scroll',
      rowIds: keys.map(ticketContentRowId),
      title: `${identifier} · ${title}`,
      header: ticketHeaderTree(document, identifier, title, [], this.labels),
    };
  }
  protected actions(context: ScreenContext): readonly ActionItem[] {
    if (!this.document || this.viewMode !== 'full') return [];
    const selectable = this.selectableKeys(context).length;
    return [
      actionItem('detail-tab', 'Tab', 'section'),
      actionItem('detail-edit', 'e', 'edit'),
      // Freeze and paging before copy: at 80 columns the footer clips the
      // tail, and `Y:Copy link` is the hint that yields.
      actionItem('detail-freeze', 'f', this.isFrozen() ? 'unfreeze' : 'freeze'),
      actionItem('detail-arrows', '↑↓', selectable > 1 ? 'select' : 'scroll'),
      actionItem('detail-page', 'PgUp/PgDn', 'page'),
      ...ticketCopyActions(),
      ...(selectable > 0
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
    this.modelMemo = undefined;
    this.sidebarTab = undefined;
    this.documentKey = undefined;
    this.addonsPreview = undefined;
    this.addonsPreviewGeneration += 1;
    this.selectedKey = undefined;
    this.initializedKey = undefined;
    this.labels = undefined;
    this.status = '';
    this.freezeBusy.clear();
    this.expanded = new Set<string>();
    this.viewMode = 'full';
  }
  renderNonInteractive(context: ScreenContext): string[] {
    const document = this.document;
    if (!document) return this.message(context) ?? [];
    if (this.viewMode !== 'full')
      return ticketTeaserLines(document, this.viewMode);
    return this.fullNonInteractive(document, context);
  }
  protected abstract fullNonInteractive(
    document: TicketDetailDocument,
    context: ScreenContext,
  ): string[];

  private initialize(
    document: TicketDetailDocument,
    context: ScreenContext,
  ): void {
    const identity = document.data?.id ?? document;
    const model = this.modelOf(document, context);
    if (this.initializedKey === identity) {
      this.selectedKey = resolveSelectedKey(
        model.selectableKeys,
        this.selectedKey,
      );
      this.expanded = retainExpandedKeys(model.selectableKeys, this.expanded);
      return;
    }
    this.initializedKey = identity;
    this.selectedKey = resolveSelectedKey(model.selectableKeys, undefined);
    this.status = '';
    this.expanded = initialExpandedKeys(this.tab, model);
  }

  private syncModel(context: ScreenContext) {
    const document = this.document ?? {};
    this.initialize(document, context);
    return this.modelOf(document, context);
  }

  /**
   * The projection of one document, built once per document, labels and
   * second. A keypress reads it from input handling, selection, chrome,
   * actions and the body; parsing every body that many times per frame was
   * most of a keypress's cost on a long ticket.
   */
  private modelOf(document: TicketDetailDocument, context: ScreenContext) {
    const now = context.nowSeconds?.() ?? Math.floor(Date.now() / 1000);
    const memo = this.modelMemo;
    if (
      memo !== undefined &&
      memo.document === document &&
      memo.labels === this.labels &&
      memo.now === now
    )
      return memo.model;
    const model = ticketContentModel(
      document,
      this.tab,
      this.labels,
      now,
      context.services?.baseUrl,
    );
    this.modelMemo = { document, labels: this.labels, now, model };
    return model;
  }

  private selectedIndexOf(keys: readonly string[]): number {
    if (this.selectedKey === undefined) return 0;
    const index = keys.indexOf(this.selectedKey);
    return index < 0 ? 0 : index;
  }
}
