/**
 * The list selection cursor: an index plus the four move keys (BB-294).
 *
 * Extracted from verbatim copies in `ticket/Screen/tickets.ts`,
 * `run/Screen/runs.ts` and `project/Screen/projects-screen.ts`. It is a plain
 * composed object, not a base class or a mixin, because some of them are
 * `AsyncScreen<Row[]>` and others `AsyncScreen<Page<Row>>`: no single base class
 * spans them, and
 * putting the index on `AsyncScreen` itself would hand a `selectedIndex` to every
 * form, detail and dashboard screen that has no rows.
 *
 * It claims the move keys and NOTHING else — not `Enter`, which resolves to a
 * per-screen `activate()`, and not the LEFT/RIGHT arrows, which page. So a caller
 * keeps its own dispatch order simply by calling `handle` where its move keys used
 * to be.
 */
export class ListCursor {
  /** The selected row, or -1 on an empty list (see `handle`). */
  index = 0;

  /**
   * Apply `input` as a cursor move over `length` rows; false when it is not a
   * cursor key, so the caller's `else if` chain continues unchanged.
   *
   * The clamping arithmetic is copied EXACTLY from the four call sites, including
   * `Math.min(index + 1, length - 1)` yielding -1 when `length` is 0. That is
   * today's behaviour, `present()` maps it back to -1, and BB-294 is
   * behaviour-neutral — fixing it here would be a change smuggled into a refactor.
   */
  handle(input: string, length: number): boolean {
    if (input === 'j' || input === 'down')
      this.index = Math.min(this.index + 1, length - 1);
    else if (input === 'k' || input === 'up')
      this.index = Math.max(this.index - 1, 0);
    else if (input === 'g') this.index = 0;
    else if (input === 'G') this.index = Math.max(0, length - 1);
    else return false;
    return true;
  }

  reset(): void {
    this.index = 0;
  }
}
