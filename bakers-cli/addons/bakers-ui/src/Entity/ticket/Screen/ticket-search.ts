import { serverMessage } from '../../../lib/jsonapi-error.js';
import type { ListFilterBadge } from '../../../Screen/full-screen.js';
import type { ScreenContext } from '../../../Screen/screen.js';
import { timerDebounce } from '../../../Widget/option-source.js';
import type { TicketRow } from '../Data/tickets.js';

export interface TicketSearchHost {
  /** The typed line; the host's loader sends it as `filter[search]`. */
  searchQuery: string;
  /** The rows on screen, narrowed locally while the server read is in flight.
   *  Absent on a screen that shows no ticket rows (Team → Work). */
  readonly rows?: readonly TicketRow[];
  /** Show these rows until the server answers; `[]` after a refusal. */
  showRows(rows: readonly TicketRow[]): void;
  /** Re-read for the current query — `AsyncScreen.reloadInPlace` plus any
   *  criteria-change bookkeeping (page one, cursor). */
  reloadSearch(context: ScreenContext): Promise<boolean>;
}

/**
 * The `/` search every terminal ticket list shares (BB-544 AC9).
 *
 * Composed, not inherited: the lists sit on `ListScreen` and on bare
 * `AsyncScreen`. The server resolves the line — identifiers and fragments,
 * origin references (`#19`, `bakers#19`, URLs) — so the screen only narrows
 * optimistically, debounces the reload, drops stale answers (through
 * `reloadInPlace`) and states a refusal as the server's sentence over an
 * emptied list, only while that line is still the query.
 */
export class TicketSearch {
  open = false;
  private refusal = '';
  private refusedQuery = '';
  private base: TicketRow[] = [];
  private cancel: (() => void) | undefined;

  constructor(private readonly host: TicketSearchHost) {}

  /** The server's refusal of the current line, or ''. */
  get status(): string {
    return this.host.searchQuery === this.refusedQuery ? this.refusal : '';
  }

  badge(): ListFilterBadge {
    const query = this.host.searchQuery;
    return query
      ? { id: 'search', label: '/ search', value: `search: ${query}` }
      : { id: 'search', label: '/ search' };
  }

  /** The meta-line hint while the field is open, or ''. */
  hint(): string {
    return this.open
      ? 'searching IDENTIFIER + TITLE + ORIGIN · type to filter · Backspace erase · Enter keep · Esc leave'
      : '';
  }

  /** Claims `/` to open the field and, while it is open, every key. */
  handleKey(input: string, context: ScreenContext): boolean {
    if (!this.open) {
      if (input !== '/') return false;
      this.open = true;
      this.base = [...(this.host.rows ?? [])];
      context.requestDraw();
      return true;
    }
    if (input === 'escape' || input === 'enter') {
      this.open = false;
      context.requestDraw();
      return true;
    }
    const query = this.host.searchQuery;
    if (input === 'backspace') this.host.searchQuery = query.slice(0, -1);
    else if (input.length === 1 && input >= ' ')
      this.host.searchQuery = query + input;
    else return true;
    if (this.host.rows !== undefined) {
      const needle = this.host.searchQuery.toLocaleLowerCase();
      this.host.showRows(
        this.base.filter(
          (row) =>
            row.identifier.toLocaleLowerCase().includes(needle) ||
            row.title.toLocaleLowerCase().includes(needle),
        ),
      );
    }
    this.cancel?.();
    const debounce = context.options?.debounce ?? timerDebounce;
    this.cancel = debounce(() => {
      void this.host.reloadSearch(context).then(
        (current) => {
          if (!current) return;
          this.refusal = '';
          this.refusedQuery = '';
          context.requestDraw();
        },
        (caught) => {
          this.refusal = serverMessage(caught);
          this.refusedQuery = this.host.searchQuery;
          this.host.showRows([]);
          context.requestDraw();
        },
      );
    }, 200);
    context.requestDraw();
    return true;
  }

  /** Close the field and drop a pending reload — on leave and reset. */
  close(): void {
    this.open = false;
    this.cancel?.();
    this.cancel = undefined;
  }

  reset(): void {
    this.close();
    this.refusal = '';
    this.refusedQuery = '';
    this.base = [];
  }
}
