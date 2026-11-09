import { actionItem } from '../../../Component/footer-actions/index.js';
import { copyThrough } from '../../../lib/clipboard.js';
import { serverMessage } from '../../../lib/jsonapi-error.js';
import type { RouteMetadata } from '../../../Routing/route.js';
import type {
  FullScreenChrome,
  ListFilterBadge,
} from '../../../Screen/full-screen.js';
import { ListScreen } from '../../../Screen/list-screen.js';
import type { ScreenContext } from '../../../Screen/screen.js';
import { resolveWhoCandidate } from '../../user/Data/users.js';
import { loadTicketDetail } from '../Data/detail.js';
import {
  CLOSED_FILTER_VALUES,
  cycleValue,
  DEFAULT_TICKET_CRITERIA,
  type ParentCriterion,
  type ProjectCriterion,
  STATE_FILTER_VALUES,
  type TicketCriteria,
  type WhoCriterion,
} from '../Data/query.js';
import {
  countTicketsIgnoringClosed,
  loadFilteredTickets,
  mapTicketDocument,
  TICKET_TABLE,
  type TicketPage,
  type TicketRow,
} from '../Data/tickets.js';
import { ticketUrl } from '../Data/url.js';
import { TicketFilterBar } from './ticket-filter-bar.js';
import { TicketSearch } from './ticket-search.js';

export class TicketsScreen extends ListScreen<TicketRow, void> {
  readonly frameId = 'tickets';
  protected readonly table = TICKET_TABLE;
  commandForInput(input: string): string | undefined {
    if (input === '/') return 'search';
    if (input === 'e') return 'edit-assignment-list';
    if (input === 'mouse-select') return 'leave-search';
    return undefined;
  }
  static readonly route = {
    id: 'project.tickets',
    path: '/projects/:projectId/tickets',
    parent: 'project.overview',
    tab: { id: 'tickets', label: 'Tickets', scope: 'project', weight: 20 },
  } satisfies RouteMetadata;
  readonly id = TicketsScreen.route.id;
  receiveResult(result: unknown, context: ScreenContext): void {
    if (
      result &&
      typeof result === 'object' &&
      (result as { type?: unknown }).type === 'parent-filter-set'
    ) {
      // BB-284 D6 — the picker's pick lands here through the same
      // `context.back(result)` channel as an assignment save (F4): a full
      // reload through `loadFilteredTickets`, same as `s`/`t`. BB-300 D2 —
      // a null parent is a committed CLEAR: it drops only the parent
      // criterion, the status/closed/Who criteria ride along (AC-3).
      const { parent } = result as { parent: ParentCriterion | null };
      this.setCriteria({ ...this.criteria, parent }, context);
      return;
    }
    if (
      result &&
      typeof result === 'object' &&
      (result as { type?: unknown }).type === 'who-filter-set'
    ) {
      // BB-299 D5 — the Who picker's pick lands through the same
      // `context.back(result)` channel as the parent picker's: a full reload
      // through `loadFilteredTickets`.
      const { who } = result as { who: WhoCriterion };
      this.setCriteria({ ...this.criteria, who }, context);
      return;
    }
    if (
      result &&
      typeof result === 'object' &&
      (result as { type?: unknown }).type === 'owner-filter-set'
    ) {
      // BB-416 — the SAME picker opened in owner mode: a second, independent
      // criterion. `who` rides along untouched — only `owner` changes.
      const { who: owner } = result as { who: WhoCriterion };
      this.setCriteria({ ...this.criteria, owner }, context);
      return;
    }
    if (
      result &&
      typeof result === 'object' &&
      (result as { type?: unknown }).type === 'project-filter-set'
    ) {
      // BB-540 — the project picker's pick lands through the same
      // `context.back(result)` channel as the parent/who pickers: a full
      // reload through `loadFilteredTickets`. A null project is a committed
      // CLEAR: it drops only the project criterion (AC-3).
      const { project } = result as { project: ProjectCriterion | null };
      this.setCriteria({ ...this.criteria, project }, context);
      return;
    }
    if (
      result &&
      typeof result === 'object' &&
      (result as { type?: unknown }).type === 'ticket-assignment-updated'
    ) {
      const returned = result as {
        ticketId: string;
        document?: Parameters<typeof mapTicketDocument>[0];
      };
      if (returned.document)
        this.replaceRow(
          returned.ticketId,
          mapTicketDocument(returned.document),
        );
      this.status = 'saved';
      context.requestDraw();
    }
  }
  private openingEdit = false;
  private status = '';
  private readonly search = new TicketSearch(this);
  override leave(): void {
    this.search.close();
    super.leave();
  }
  get searchQuery(): string {
    return this.criteria.query;
  }
  set searchQuery(query: string) {
    this.criteria = { ...this.criteria, query };
  }
  /** The search is a criteria change like any other (D5): page one. */
  reloadSearch(context: ScreenContext): Promise<boolean> {
    this.page = 0;
    return this.reloadInPlace(context);
  }
  row(id: string): TicketRow | undefined {
    return this.readyValue?.rows.find((candidate) => candidate.id === id);
  }
  selectId(id: string): boolean {
    const index = this.readyValue?.rows.findIndex(
      (candidate) => candidate.id === id,
    );
    if (index === undefined || index < 0) return false;
    this.selectedIndex = index;
    return true;
  }
  saveState(): {
    criteria: TicketCriteria;
    page: number;
    selectedTicketId: string | null;
    viewportAnchor: string | null;
  } {
    const selectedTicketId = this.rows[this.selectedIndex]?.id ?? null;
    return {
      criteria: { ...this.criteria },
      page: this.page,
      selectedTicketId,
      viewportAnchor: selectedTicketId,
    };
  }
  restoreState(token: unknown): void {
    if (!token || typeof token !== 'object') return;
    const saved = token as {
      criteria?: TicketCriteria;
      page?: unknown;
      selectedTicketId?: string | null;
    };
    if (saved.criteria) {
      this.criteria = { ...saved.criteria };
      // Tokens saved before BB-282 carry no closed; normalize so a stale
      // token cannot smuggle undefined into a predicate testing !== null.
      this.criteria.closed =
        this.criteria.closed ?? DEFAULT_TICKET_CRITERIA.closed;
      // Tokens saved before BB-299 carry no who; normalize so a stale token
      // cannot smuggle undefined into a predicate testing === null (R3).
      this.criteria.who = this.criteria.who ?? null;
      // Tokens saved before BB-416 carry no owner; same rule.
      this.criteria.owner = this.criteria.owner ?? null;
    }
    // Clamped for the same reason `closed` is normalised above: a stale token
    // must not smuggle a negative offset into the query.
    this.restorePage(saved);
    if (saved.selectedTicketId) this.selectId(saved.selectedTicketId);
  }
  applyMutation(change: { id: string } & Partial<TicketRow>): boolean {
    const current = this.row(change.id);
    return current
      ? this.replaceRow(change.id, { ...current, ...change })
      : false;
  }
  replaceRow(id: string, row: TicketRow): boolean {
    const current = this.readyValue;
    if (!current) return false;
    const index = current.rows.findIndex((candidate) => candidate.id === id);
    if (index < 0) return false;
    const rows = current.rows.slice();
    rows[index] = row;
    this.replaceReady({ ...current, rows });
    return true;
  }
  private _criteria: TicketCriteria = { ...DEFAULT_TICKET_CRITERIA };
  get criteria(): TicketCriteria {
    return this._criteria;
  }
  set criteria(v: TicketCriteria) {
    this._criteria = v;
  }
  /** The resolved current user: `undefined` not yet resolved, `null`
   *  definitively unresolvable, a WhoCriterion cached on success (BB-287 D5).
   *  Cleared by `reset()`. */
  private mine: WhoCriterion | null | undefined;
  private readonly filter = new TicketFilterBar(this);

  resolveMine(): WhoCriterion | null | undefined {
    return this.mine;
  }
  /** The ticket columns need no per-render context. */
  protected tableContext(): void {}
  protected loadRows(
    context: ScreenContext,
    page: number,
  ): Promise<TicketPage> {
    if (!context.services || !context.project)
      throw new Error('Tickets requires project context');
    return loadFilteredTickets(
      context.services.client,
      context.project.id,
      this.criteria,
      page,
    );
  }
  /**
   * What the `closed` criterion is holding back from the CURRENT search, keyed on
   * the criteria it was measured for (BB-370).
   *
   * KEYED, rather than a bare number, because the query moves one character at a
   * time while a probe is in flight: a count measured for `BB-7` standing beside
   * a frame that says `search: BB-73` would be a wrong number stated with the
   * same confidence as a right one. {@link hiddenNotice} states it only while the
   * key still matches, so a stale measurement disappears instead of lying.
   */
  private hiddenByClosed: {
    query: string;
    closed: boolean;
    count: number;
  } | null = null;
  /**
   * BB-370 — the page, plus the reason it is empty when the reason is `closed`.
   *
   * THE DEFECT: the shipped default hides closed rows, that criterion ANDs onto
   * the `/` search group, and in a mature project most tickets are closed — so an
   * operator who types a known `BB-N` usually lands on `No tickets.`, which is
   * the same four words the control plane shows for a ticket that does not exist.
   * The query was never wrong and neither was the server; what was missing was any
   * way to tell the two apart.
   *
   * The fix is LEGIBILITY, NOT INCLUSION. `closed: hidden` keeps ruling, the row
   * keeps not arriving and the server stays authoritative — the screen simply says
   * how many matches that one criterion is holding back, and which key releases
   * them. Un-filtering the search instead would have made `/` quietly stop obeying
   * a filter the operator set, on a screen whose whole point is that the meta line
   * states what is being filtered.
   *
   * The probe lives HERE, on the screen, and not in the query builder: it is a
   * SECOND read (the same query minus one criterion), it is worth paying for only
   * on an empty result, and `buildTicketQueryParams` has other callers that want
   * neither. It is measured after `super.load()` so both numbers come from the
   * same criteria, and it is awaited so the count and the emptiness it explains
   * reach the operator in one frame rather than two.
   */
  protected override async load(context: ScreenContext): Promise<TicketPage> {
    const page = await super.load(context);
    const { query, closed } = this.criteria;
    const measured = await this.measureHiddenByClosed(page, context);
    // A probe that outlived its own criteria says nothing about the current ones,
    // so it may neither state a count nor clear one.
    if (query === this.criteria.query && closed === this.criteria.closed)
      this.hiddenByClosed = measured;
    return page;
  }
  /**
   * The count, or `null` when there is nothing to explain.
   *
   * Four gates, and each is a claim the screen must not make. A NON-EMPTY page
   * needs no explanation (and the operator can see what arrived). No `query` means
   * the operator is not searching, so an empty list is the collection's own
   * answer. `closed === null` means that criterion is already off and cannot be
   * what is hiding anything. A total of zero means nothing is being held back at
   * all — a genuine no-match, where an `0 hidden` would send the operator to press
   * `x` for rows that exist nowhere.
   *
   * A FAILED probe is the fifth: an explanation is never a precondition, so its
   * error leaves the page exactly as the server answered it rather than turning a
   * good list into an error screen.
   */
  private async measureHiddenByClosed(
    page: TicketPage,
    context: ScreenContext,
  ): Promise<{ query: string; closed: boolean; count: number } | null> {
    const { query, closed } = this.criteria;
    if (page.rows.length > 0 || !query || closed === null) return null;
    if (!context.services || !context.project) return null;
    try {
      const total = await countTicketsIgnoringClosed(
        context.services.client,
        context.project.id,
        this.criteria,
      );
      return total !== null && total > 0
        ? { query, closed, count: total }
        : null;
    } catch {
      return null;
    }
  }
  /** `2 matches hidden by closed — press x`, or '' when nothing is established
   *  for the criteria on screen right now. */
  private hiddenNotice(): string {
    const hidden = this.hiddenByClosed;
    if (
      hidden === null ||
      hidden.query !== this.criteria.query ||
      hidden.closed !== this.criteria.closed
    )
      return '';
    return `${hidden.count} match${hidden.count === 1 ? '' : 'es'} hidden by closed — press x`;
  }
  /**
   * Re-apply the bar's criteria except the search line: the server already
   * resolved `filter[search]`, including origin references whose identifier
   * and title omit the typed text. The rest protects a cached re-entry from
   * clients that ignore the other query parameters.
   */
  protected override filterRow(row: TicketRow): boolean {
    return this.filter.applyTo(row);
  }
  /** Every criteria change starts over at page one: a narrowed filter applied on
   *  page 4 would otherwise land on an empty page (BB-292 D5). */
  setCriteria(criteria: TicketCriteria, context: ScreenContext): void {
    this.criteria = { ...criteria };
    this.page = 0;
    this.selectedIndex = 0;
    this.retry(context);
  }
  previewCriteria(criteria: TicketCriteria): void {
    this.criteria = { ...criteria };
  }
  /**
   * The mine toggle (BB-287 D3): `who` IS me ⇒ clear it; anything else ⇒ set
   * me. The first activation resolves the machine's username to the user uuid
   * (D4) — only a success (or a definitive miss) is cached, a read error
   * retries on the next press (D5). Every failure is a status, never a
   * criterion (D6, AC-8).
   */
  toggleMine(context: ScreenContext): void {
    const services = context.services;
    const currentUser = services?.currentUser;
    if (services === undefined || currentUser === undefined) {
      this.status = 'mine: no current user';
      context.requestDraw();
      return;
    }
    if (this.mine === null) {
      this.status = `mine: '${currentUser}' not found`;
      context.requestDraw();
      return;
    }
    if (this.mine !== undefined) {
      this.setCriteria(
        {
          ...this.criteria,
          who: this.criteria.who?.id === this.mine.id ? null : this.mine,
        },
        context,
      );
      return;
    }
    this.status = 'mine: resolving…';
    context.requestDraw();
    const guard = this.captureLifecycle(context);
    void resolveWhoCandidate(services.client, currentUser).then((outcome) => {
      if (!this.lifecycleIsCurrent(guard, context)) return;
      if (outcome.error !== undefined) {
        this.status = `mine: ${outcome.error}`;
        this.requestActiveDraw(context);
        return;
      }
      const candidate = outcome.rows[0];
      if (candidate === undefined) {
        this.mine = null;
        this.status = `mine: '${currentUser}' not found`;
        this.requestActiveDraw(context);
        return;
      }
      this.mine = { id: candidate.id, label: candidate.label };
      this.status = '';
      this.setCriteria({ ...this.criteria, who: this.mine }, context);
    });
  }
  /**
   * BB-326 — `y` copies the selected ticket's identifier, `Y` its link.
   *
   * TWO TARGETS AND NO MODE: the operator pastes an identifier into an agent
   * prompt or a chat line, and a link into a browser. Making one of them a
   * second keystroke away would be a mode; making the shifted key the "bigger"
   * variant is the ladder saying it in one press.
   *
   * It follows the CURSOR, not the page — the row `↑↓` is standing on is the
   * one thing the operator has already pointed at.
   */
  private copySelection(link: boolean, context: ScreenContext): string {
    const row = this.rows[this.selectedIndex];
    if (!row) return 'nothing to copy';
    return link
      ? copyThrough(
          context.copyToClipboard,
          ticketUrl(context.services?.baseUrl, row.id),
          `the link to ${row.identifier}`,
          `no link to ${row.identifier} · this session has no base URL`,
        )
      : copyThrough(
          context.copyToClipboard,
          row.identifier,
          row.identifier,
          'nothing to copy',
        );
  }
  protected renderLoading(): string[] {
    return ['Loading tickets…'];
  }
  /**
   * Every ticket filter as a badge — idle shortcut+caption, or active
   * shortcut plus value (BB-375 A′). Always the full set; never only
   * the active ones.
   */
  protected badges(): readonly ListFilterBadge[] {
    const mineOn =
      this.mine !== undefined &&
      this.mine !== null &&
      this.criteria.who?.id === this.mine.id;
    const badge = (
      id: string,
      label: string,
      value?: string,
    ): ListFilterBadge => (value ? { id, label, value } : { id, label });
    return [
      this.search.badge(),
      badge(
        'state',
        's state',
        this.criteria.state ? `state: ${this.criteria.state}` : undefined,
      ),
      // Label, never the uuid (BB-299 D3) — including when mine set who.
      badge(
        'who',
        'w who',
        this.criteria.who ? `who: ${this.criteria.who.label}` : undefined,
      ),
      badge('mine', 'm mine', mineOn ? 'mine' : undefined),
      // BB-416 — the second, independent picker: same shape as `who`, own
      // key, own criterion. Label, never the uuid.
      badge(
        'owner',
        'o owner',
        this.criteria.owner ? `owner: ${this.criteria.owner.label}` : undefined,
      ),
      // Identifier, never the uuid (AC-2).
      badge(
        'parent',
        'p parent',
        this.criteria.parent
          ? `parent: ${this.criteria.parent.identifier}`
          : undefined,
      ),
      // Standing whenever closed ≠ all — including the shipped default.
      badge(
        'closed',
        'x closed',
        this.criteria.closed === null
          ? undefined
          : this.criteria.closed
            ? 'closed: only'
            : 'closed: hidden',
      ),
      badge('clear', 'c clear'),
    ];
    // BB-540 — refactor to delegate to `this.filter.badges()` is on hold
    // until the bar learns the `owner` filter (BB-416): dropping the inline
    // call here would silently drop the owner badge.
  }

  protected chrome(context: ScreenContext): FullScreenChrome {
    const pagingLine = [this.countLabel(), ...this.pagingSegments()]
      .filter(Boolean)
      .join(' · ');
    const hidden = this.hiddenNotice();
    const searchOpen = this.search.hint();
    return {
      selectable: this.rows.length,
      selectedIndex: this.selectedIndex,
      rowIds: this.rowNodeIds,
      title: `${context.project?.name ?? context.project?.slug ?? ''} · tickets`,
      meta: [pagingLine, hidden, searchOpen].filter(Boolean).join('  ·  '),
    };
  }

  protected actions() {
    return [
      actionItem('tickets-edit', 'e', 'edit'),
      ...this.pagingActionItems(),
    ];
  }

  protected notice(): string | undefined {
    return this.search.status || this.status || undefined;
  }
  activate(index: number, context: ScreenContext): boolean {
    const row = this.readyValue?.rows[index];
    if (!row?.id || !context.navigate) return false;
    context.navigate('ticket.detail', { ticketId: row.id });
    return true;
  }
  select(index: number, context: ScreenContext): boolean {
    if (index < 0 || index >= this.rows.length) return false;
    this.selectedIndex = index;
    context.requestDraw();
    return true;
  }
  override handleInput(input: string, context: ScreenContext): boolean {
    if (super.handleInput(input, context)) return true;
    if (this.openingEdit) return true;
    if (this.search.handleKey(input, context)) return true;
    if (input === 'e') {
      const ticketId = this.rows[this.selectedIndex]?.id;
      if (!ticketId || this.openingEdit || !context.services) return true;
      this.openingEdit = true;
      this.status = 'loading assignment…';
      context.requestDraw();
      const guard = this.captureLifecycle(context);
      void loadTicketDetail(context.services.client, ticketId)
        .then((document) => {
          if (!this.lifecycleIsCurrent(guard, context)) return;
          context.navigate?.(
            'ticket.assignment.edit',
            { ...(context.params ?? {}), ticketId },
            { document },
          );
        })
        .catch((caught) => {
          if (!this.lifecycleIsCurrent(guard, context)) return;
          this.status = serverMessage(caught);
          this.requestActiveDraw(context);
        })
        .finally(() => {
          this.openingEdit = false;
        });
      return true;
    }
    // The paging arrows, dispatched HERE and not by the base (BB-294 D3). The
    // position is the load-bearing part: they are reached only PAST the search
    // branch above, which consumes them, so while the `/` field is open the arrows
    // stay inert — not appended as text (its text branch takes single characters
    // only) and not paging underneath the field. A base that claimed them first
    // would page there, which is why it exposes a helper instead.
    //
    // Which sequence means which move, why the kernel leaves both to the screen,
    // and why paging steps from the LOADED page live once, on
    // `ListScreen.handlePagingInput`.
    if (this.handlePagingInput(input, context)) return true;
    // BB-326 — the copy keys, and their POSITION is the whole reason `y` is
    // safe: they are reached only past the search branch above, which
    // consumes every printable character, so `y` typed into the `/` field is a
    // letter and never a copy. Nothing else in `src/` binds `y` or `Y`.
    if (input === 'y' || input === 'Y') {
      this.status = this.copySelection(input === 'Y', context);
      context.requestDraw();
      return true;
    }
    const rows = this.readyValue?.rows;
    if (input === 's') {
      this.setCriteria(
        {
          ...this.criteria,
          state: cycleValue(STATE_FILTER_VALUES, this.criteria.state),
        },
        context,
      );
      return true;
    }
    if (input === 'x') {
      this.setCriteria(
        {
          ...this.criteria,
          closed: cycleValue(CLOSED_FILTER_VALUES, this.criteria.closed),
        },
        context,
      );
      return true;
    }
    if (input === 'w') {
      // Open the Who picker as a modal child; its pick returns through
      // `receiveResult` (BB-299 D5), like the parent picker (BB-284 D4).
      context.navigate?.('project.tickets.who-filter', context.params ?? {});
      return true;
    }
    if (input === 'o') {
      // BB-416 — the SAME picker, opened in owner mode: `filterTarget`
      // steers `WhoFilterScreen` to emit `owner-filter-set` instead of
      // `who-filter-set` (`Screen/who-filter-form.ts`). `o` was free: the
      // screen's bound single keys are /, e, y, Y, s, x, w, p, m, c, n plus
      // the cursor/paging keys — `o` for "owner" reads as directly as `w` for
      // "who" and `p` for "parent" do.
      context.navigate?.('project.tickets.who-filter', {
        ...(context.params ?? {}),
        filterTarget: 'owner',
      });
      return true;
    }
    if (input === 'p') {
      // Open the parent picker as a modal child; its pick returns through
      // `receiveResult` (D4/D6).
      context.navigate?.('project.tickets.parent-filter', context.params ?? {});
      return true;
    }
    if (input === 'm') {
      // The one-keystroke mine filter (BB-287 D2) — a shortcut onto the who
      // criterion, reloaded through the same setCriteria path as the picker's.
      this.toggleMine(context);
      return true;
    }
    if (input === 'c') {
      this.setCriteria({ ...DEFAULT_TICKET_CRITERIA }, context);
      return true;
    }
    // BB-540 — refactor to delegate to `this.filter.handleKey(input, context)`
    // is on hold until the bar learns the `owner` filter (BB-416): delegating
    // would silently drop the `o` handler above.
    if (!rows) return false;
    if (this.handleCursorInput(input, context)) return true;
    if (input === 'enter') return this.activate(this.selectedIndex, context);
    return false;
  }
  override reset(): void {
    // The page, the cursor and the counter — a reset means a new project or
    // session, hence a different collection (BB-294).
    this.resetList();
    this.criteria = { ...DEFAULT_TICKET_CRITERIA };
    this.mine = undefined;
    this.openingEdit = false;
    this.status = '';
    this.search.reset();
    this.hiddenByClosed = null;
    super.reset();
  }
}
