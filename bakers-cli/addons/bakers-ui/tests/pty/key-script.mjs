/**
 * BB-326 — the SINGLE DEFINITION SITE of the shared cockpit key scripts.
 *
 * Every driver that walks a cockpit screen imports its script from HERE and
 * never copies it (`verify-screen.mjs`, `verify-colors.mjs`). A verifier that
 * runs a different walk than the one the kernel was measured with cannot tell
 * "the screen is right" from "the harness agrees with itself", so the drivers
 * must be structurally incapable of drifting apart.
 *
 * It lives in the real package rather than in the spike because the spike is
 * deleted with BB-326 while the verifier stays.
 *
 * The `KEY` / `lit` helpers were moved verbatim from
 * `bakers-cli/spikes/bb-322/scripts/pty-drive.mjs`.
 *
 * `.mjs`, not `.ts`: it is imported by plain-Node PTY drivers that run without
 * a build step, and by a driver outside this package's `tsconfig` rootDir.
 */

// ---------------------------------------------------------------------------
// Expectation helper
// ---------------------------------------------------------------------------

/**
 * Screen text as a LITERAL expectation.
 *
 * Everything a key step waits for is screen text, and screen text is full of
 * regex metacharacters: `[ ] work:code`, `scripts/pty-drive.mjs`, `[x]`. Handed
 * to `new RegExp` unescaped, `[x]` is a character class matching the letter x
 * anywhere in the stream — which is how a step reports success against a frame
 * that does not contain what it was waiting for.
 */
export const lit = (text) =>
  String(text).replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

// ---------------------------------------------------------------------------
// The key script (shared by every driver — same screen, same walk)
// ---------------------------------------------------------------------------

export const KEY = {
  up: '\u001b[A',
  down: '\u001b[B',
  right: '\u001b[C',
  left: '\u001b[D',
  esc: '\u001b',
  enter: '\r',
  tab: '\t',
  // BB-326: the backwards half of the top-tab cycle (`tui-kernel.ts`
  // compares against exactly this literal).
  shiftTab: '\u001b[Z',
  ctrlC: '\u0003',
};

// ---------------------------------------------------------------------------
// BB-326: the Tickets surface
// ---------------------------------------------------------------------------
//
// A step waits for `expect` (one pattern) or:
//
//   expectAll: string[]  — every pattern must match the SAME reconstructed
//                          screen. A tab switch is only proven by the bar AND
//                          the body agreeing; asserting the bar alone would
//                          pass against a kernel that repaints its chrome and
//                          nothing else, which is exactly the failure mode a
//                          cell-diffing renderer has.
//
// A step with `send: ''` sends nothing and only waits. It exists so a walk can
// assert the SECOND half of an asynchronous transition — the frame after the
// loading frame — without a keystroke in between that would make the wait
// ambiguous.
//
// EVERY expectation here was checked to be non-vacuous against the current
// kernel: it must be absent on the frame the step starts from. An expectation
// that already holds when the key is pressed proves nothing and is the easiest
// way for a driver to report a success it never observed.
//
// `expect` (one pattern) and `expectAll` (several) are the same thing to a
// driver — `expect: x` is `expectAll: [x]`.
//
// SAFETY: no Ctrl+S and no Ctrl+D anywhere — those submit a form and would
// write to the connected control plane. The Tickets walk leaves no write
// behind: it types into the client-side search box and clears it again, and
// nothing here opens a form.

/**
 * The Tickets walk: paging, the debounced search and the way back out.
 *
 * Booted on a PROJECT (`bakers ui --project <name>`), which lands on the project
 * Dashboard — the Tickets screen is one Tab away and is reached by the same key
 * an operator presses, not by a deep link that would skip the transition being
 * verified.
 *
 * The one data assumption is stated rather than hidden: paging needs a project
 * with more than one page of tickets (> 20 open ones). `page 2` is the assertion
 * and not a row count, so the walk survives the collection changing under it.
 */
export const TICKETS_KEY_SCRIPT = [
  {
    // The list is an async screen: the first frame is `Loading tickets…` and the
    // rows arrive afterwards, so this step's budget covers a control-plane read.
    label: 'switch to the Tickets tab',
    send: KEY.tab,
    expectAll: [lit('[Tickets]'), lit('IDENTIFIER'), lit('page 1')],
    timeoutMs: 20000,
  },
  {
    label: 'page forward — the next page is a fresh control-plane read',
    send: KEY.right,
    expectAll: [lit('page 2'), lit('← prev')],
    timeoutMs: 15000,
  },
  {
    label: 'page back',
    send: KEY.left,
    expectAll: [lit('page 1'), lit('→ next')],
    timeoutMs: 15000,
  },
  {
    // BB-370 gave search mode an affordance of its own: `/` now swaps the key
    // hints for the search-mode ones, so the frame after it is no longer
    // byte-identical to the frame before it, as it was when this step was
    // written. The assertion still lives in `verify-id-search.mjs` section 2,
    // which measures exactly that difference and is the driver that ticket
    // authored; this walk keeps the step expectation-less so it stays the KEY
    // walk and does not acquire a second definition of the same check.
    label: 'enter search mode (asserted by verify-id-search.mjs — see comment)',
    send: '/',
    settleMs: 600,
  },
  // The query is typed ONE CHARACTER PER STEP, and that is not cosmetic.
  // `lib/mouse.ts` `splitInput` deliberately keeps a run of non-report bytes as
  // ONE key token ("a pasted or multi-byte key must stay a single chunk"), and
  // `TicketsScreen`'s search branch only accepts `input.length === 1`. Sending
  // `'zzz'` in one write is therefore dropped in full — measured against the
  // CURRENT kernel, where it made this step the only red one in the walk.
  //
  // The letter `q` must never be typed here. The kernel quits on `q` whether or
  // not the screen consumed it (`tui-kernel.ts`: the quit is guarded by
  // `modal`, not by `handled`), so a query containing one ends the session
  // mid-walk. `z` is safe and, three of them deep, matches nothing.
  {
    label: 'type the query — first character',
    send: 'z',
    expectAll: [lit('search: z')],
    timeoutMs: 15000,
  },
  {
    label: 'type the query — second character',
    send: 'z',
    expectAll: [lit('search: zz')],
    timeoutMs: 15000,
  },
  {
    // `No tickets.` and `0 of 0` are the debounced reload's own evidence: they
    // are what the control plane answered, not what the keystroke echoed. A
    // query of three z's matching nothing is the point — an assertion on a
    // matching row would depend on which tickets happen to exist.
    label: 'type the query — the debounced reload returns an empty collection',
    send: 'z',
    expectAll: [lit('search: zzz'), lit('No tickets.'), lit('0 of 0')],
    timeoutMs: 15000,
  },
  {
    // Enter leaves search mode and changes NOTHING on screen — the filter
    // stays. It therefore gets no expectation; the step after it is what proves
    // search mode is really off, because `c` would otherwise be typed into the
    // query instead of clearing it.
    label: 'commit the search (Enter leaves search mode; the filter stays)',
    send: KEY.enter,
    settleMs: 600,
  },
  {
    // `→ next` is on the footer only when the collection has more than one page
    // again, which is exactly what "the filter is gone" means here. It was
    // absent on the previous frame (0 results), so this cannot pass vacuously.
    label: 'clear every criterion — the full collection comes back',
    send: 'c',
    expectAll: [lit('→ next'), lit('page 1')],
    timeoutMs: 15000,
  },
  {
    label: 'leave the Tickets screen (Esc → the project Dashboard)',
    send: KEY.esc,
    expectAll: [lit('[Dashboard]')],
    timeoutMs: 15000,
  },
  { label: 'quit', send: 'q', settleMs: 500 },
];
