// The shared list-cycling primitive. Slice-less like `transport.ts` — BOTH the
// ticket and the run slice import it, and the entity slices must stay acyclic
// (G1): a run → ticket import would close the project → ticket → run → ticket
// cycle (BB-282; the ticket query module re-exports both symbols so its
// established import sites keep working).

/** Next value in a cyclic list; `null` (== "all") wraps at both ends. */
export function cycleValue<T>(
  values: readonly T[],
  current: T | null,
): T | null {
  if (current == null) return values[0] ?? null;
  const i = values.indexOf(current);
  if (i < 0 || i === values.length - 1) return null;
  return values[i + 1] ?? null;
}

/** The closed cycle order; null ("all") wraps at both ends via cycleValue. */
export const CLOSED_FILTER_VALUES = [false, true] as const;

/**
 * Rows per page in the project ticket and run lists (BB-292 D1).
 *
 * Lives here, beside the shared closed cycle, because BOTH slices need it and
 * `Entity/cycle.ts` is the slice-less module they may each import without
 * closing the G1 cycle.
 *
 * 20 since the operator's live review of BB-292; the spec's measurements and
 * D6 were taken at 15, and the spec records the change rather than hiding it.
 *
 * The parent picker deliberately does NOT use this: it reads one un-paged bag of
 * `PARENT_PAGE_SIZE` candidates and discloses truncation at that number.
 */
export const LIST_PAGE_SIZE = 20;
