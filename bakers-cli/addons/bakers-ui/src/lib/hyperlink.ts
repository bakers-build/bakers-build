/**
 * BB-326 — which stretches of a composed line are ADDRESSES.
 *
 * The operator's Ghostty renders OSC 8 hyperlinks, so a URL in a ticket
 * description, a comment or a run log can be something they tap rather than
 * something they have to retype on a phone keyboard. This module answers the
 * only question the cockpit has to answer for that: given one row's content,
 * which ranges of it point where. `lib/vnode.ts`'s `linked` turns each range
 * into its own `TextChunk` with a `link`, and `@opentui/core`'s Zig core writes
 * the escape.
 *
 * ------------------------------------------------------------------------
 * WHY THE RULES ARE NARROW
 * ------------------------------------------------------------------------
 *
 * This runs on EVERY row of EVERY frame, over text nobody wrote for it: table
 * rows, key ladders, branch names, JSON fragments in a run log. A
 * scanner that is too eager turns ordinary text into a link the operator can
 * tap by accident; one that trims wrongly produces a link that goes somewhere
 * other than it reads. So:
 *
 *  - only `http://` and `https://`. Not a bare host, not `www.`, not `ftp:`,
 *    not `file:` — a `file:///…` link in a shared log would be an invitation to
 *    tap something that resolves on the wrong machine.
 *  - the run ends at whitespace. A row may carry another column after the URL,
 *    and a padded one may carry trailing spaces.
 *  - trailing sentence punctuation and an UNBALANCED closing bracket are not
 *    part of the address. Prose writes `(see https://x/y)` and means the URL to
 *    stop before the `)`; a path that opened its own parenthesis keeps it.
 *  - a run that ends in `…` is not a link at all: something upstream cut it,
 *    and offering a tap to `https://bakers…/very/lo` — the prefix that happened
 *    to fit — would send the operator somewhere that is not the ticket. Better
 *    no link than a wrong one.
 *
 * THE COST OF THAT LAST RULE has MOVED, and this is what it is now. It used to
 * be the whole story: the scanner ran on a line the frame had already fitted
 * with `lib/ansi.ts`'s `fitLine`, so any URL past the terminal's width lost its
 * link. Since BB-340 the cut is the RENDERER's — a cell's `truncate` against
 * a Yoga budget — and it happens strictly after this scan, so a converted row's
 * long URL keeps its link and is merely drawn short. The rule still bites where
 * a producer truncates its own text before handing it over (`Widget/chrome.ts`'s
 * `clip`, which appends exactly that `…`), which is why it stays.
 *
 * The invariant that makes all of this SAFE rather than merely careful: this
 * function only ever reports RANGES. It never rewrites, normalises or completes
 * anything, and `linked` splits on those ranges, so the chunks still
 * concatenate to the row character for character. A mis-scan can mis-attribute
 * a link; it cannot mangle a single glyph on screen.
 */

/** One address found in a line: `[start, end)` in UTF-16 code units, and the
 *  text of exactly that range. */
export interface UrlRun {
  readonly start: number;
  readonly end: number;
  readonly url: string;
}

/**
 * The candidate run: a scheme, then everything up to whitespace or a character
 * that cannot appear in a URL.
 *
 * `…` is excluded from the run explicitly, so a truncated address stops at the
 * ellipsis and can be recognised as truncated by looking at what follows.
 */
const CANDIDATE = /https?:\/\/[^\s…<>"'`\\^{}|]+/g;

/** Punctuation prose puts AFTER an address, never inside one. */
const TRAILING = /[.,;:!?]+$/;

const NO_RUNS: readonly UrlRun[] = [];

/**
 * Drop a closing bracket the URL did not open.
 *
 * Counted rather than stripped: `https://x/a_(b)` is a real path shape, and
 * `(https://x/a)` is prose. Comparing the counts is what tells the two apart
 * without a list of exceptions.
 */
function trimUnbalanced(url: string): string {
  let out = url;
  for (;;) {
    const last = out.at(-1);
    if (last !== ')' && last !== ']' && last !== '}') break;
    const open = last === ')' ? '(' : last === ']' ? '[' : '{';
    const opened = out.split(open).length - 1;
    const closed = out.split(last).length - 1;
    if (opened >= closed) break;
    out = out.slice(0, -1);
  }
  return out;
}

/** Every http(s) address in `line`, as ranges into it. */
export function urlRuns(line: string): readonly UrlRun[] {
  // The cheap gate: this is called once per composed row per frame, and the
  // overwhelming majority of rows carry no scheme at all.
  if (!line.includes('://')) return NO_RUNS;
  const runs: UrlRun[] = [];
  CANDIDATE.lastIndex = 0;
  for (
    let match = CANDIDATE.exec(line);
    match !== null;
    match = CANDIDATE.exec(line)
  ) {
    const start = match.index;
    // An ellipsis directly after the run means a producer cut the address off
    // (`Widget/chrome.ts`'s `clip`). What is on screen is a prefix, so there is
    // no link to offer.
    if (line[start + match[0].length] === '…') continue;
    const url = trimUnbalanced(match[0].replace(TRAILING, ''));
    if (url === '' || url.endsWith('//')) continue;
    runs.push({ start, end: start + url.length, url });
  }
  return runs;
}
