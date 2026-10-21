// BB-340 Task 13 — `pad` AND `sanitizeDisplay` USED TO LIVE HERE, and are
// deliberately gone.
//
// `pad` fitted a value to a field of exactly N DISPLAY COLUMNS, which is why it
// reached `lib/width.ts` — and `sanitizeDisplay` existed only to make that
// measurement honest (a TAB counted as zero columns where it rendered as one, so
// the field came out a column short and every later column of the table drifted).
// Its two callers were the dashboard's bars and the ticket detail's Runs table,
// both of which composed their columns into ONE STRING because the surface they
// fed was a pipe as well as a screen.
//
// Neither composes now: each states its cells and their Yoga budgets
// (`lib/vnode.ts`'s `Cell`), the renderer places the values, and the pipe prints
// them one space apart and unaligned. That last part is a real change to what
// `bakers ui … | cat` emits, made with the operator's approval; it is what takes the last display-column
// measurement off the non-TTY path (R5/D8).

/** Read a value as a string, or `undefined` when it is not one. */
export function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/**
 * A short relative age label ("just now", "3m ago", …); '—' when unknown.
 *
 * Lived in `Deriver/liveness.ts` until BB-236, which is why a comment renderer
 * and the run deriver both imported a CONDUCTOR module for it. It is a generic
 * time formatter with no entity vocabulary, so it belongs here — and moving it
 * removes those two cross-entity edges instead of grandfathering them.
 */
export function humanizeAge(
  lastSeenSeconds: number | null,
  nowSeconds: number,
): string {
  if (lastSeenSeconds == null) return '—';
  const delta = Math.max(0, nowSeconds - lastSeenSeconds);
  if (delta < 45) return 'just now';
  if (delta < 3600) return `${Math.round(delta / 60)}m ago`;
  if (delta < 86_400) return `${Math.round(delta / 3600)}h ago`;
  return `${Math.round(delta / 86_400)}d ago`;
}

/** Seconds per accepted unit suffix, largest first — the order both functions read. */
const DURATION_UNITS: ReadonlyArray<
  readonly [suffix: string, seconds: number]
> = [
  ['d', 86_400],
  ['h', 3600],
  ['m', 60],
];

/**
 * Parse a human duration into SECONDS, or `null` when it is not one.
 *
 * Accepts `1d 2h 30m`, `1h30m`, `3h`, `90m` and a BARE INTEGER read as minutes
 * — the last because the common case in a popup is typing a number, and every
 * other tracker reads it the same way. Storage is seconds everywhere else
 * (BB-308 D5); this grammar exists only at the terminal edge.
 *
 * An EMPTY input is 0, not null: clearing the field is a real edit, and the
 * caller needs to tell "the operator cleared it" from "the operator typed
 * nonsense". A negative or unknown-unit input is nonsense and yields null.
 */
export function parseDuration(input: string): number | null {
  const text = input.trim().toLowerCase();
  if (text === '') return 0;
  if (/^\d+$/.test(text)) return Number(text) * 60;
  // One or more `<digits><unit>` groups, whitespace optional between them, and
  // nothing else — anchored, so `1x` and `-5m` fall through to null.
  if (!/^(\d+[dhm]\s*)+$/.test(text)) return null;
  let seconds = 0;
  for (const [, amount, unit] of text.matchAll(/(\d+)([dhm])/g)) {
    const factor = DURATION_UNITS.find(([suffix]) => suffix === unit)?.[1];
    if (factor === undefined) return null;
    seconds += Number(amount) * factor;
  }
  return seconds;
}

/**
 * Render SECONDS as a compact `1d 2h 30m`, largest unit first.
 *
 * Zero-valued leading units are dropped; a zero total reads `0m` rather than an
 * empty string, so a deliberate zero is never mistaken for an absent value —
 * which is `—`, the same em dash `humanizeAge` uses for an unknown timestamp.
 */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null) return '—';
  if (seconds <= 0) return '0m';
  let rest = Math.floor(seconds);
  const parts: string[] = [];
  for (const [suffix, factor] of DURATION_UNITS) {
    const value = Math.floor(rest / factor);
    if (value > 0) parts.push(`${value}${suffix}`);
    rest -= value * factor;
  }
  return parts.length > 0 ? parts.join(' ') : '0m';
}
