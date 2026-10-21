/**
 * BB-326 — the SINGLE DEFINITION SITE of the shared cockpit key scripts.
 *
 * Every driver that walks the New-ticket screen imports `NEW_TICKET_KEY_SCRIPT`
 * from HERE and never copies it: the real-PTY screen verifier
 * (`tests/pty/verify-screen.mjs`) and the BB-322 measurement driver.
 * A verifier that
 * runs a different walk than the one the old kernel was measured with cannot
 * tell "the screen is right" from "the harness agrees with itself", so the two
 * must be structurally incapable of drifting apart.
 *
 * BB-326 added `TICKETS_KEY_SCRIPT` and `DASHBOARD_KEY_SCRIPT` in the same
 * shape. Acceptance criterion A5 names three surfaces and the spike only ever
 * scripted the form, so the other two are written here rather than in the
 * verifier — one definition site for all of them, or the rule holds for one
 * script and not for the set.
 *
 * It lives in the real package rather than in the spike because the spike is
 * deleted with BB-326 while the verifier stays.
 *
 * Moved verbatim from `bakers-cli/spikes/bb-322/scripts/pty-drive.mjs` (the
 * `KEY` / `lit` / `TITLE_TEXT` / `DESCRIPTION_TEXT` helpers came with it,
 * because the script is written in terms of them). Behaviour is unchanged: the
 * walk, its expectations and its timeouts are byte-for-byte the measured ones.
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
  // compares against exactly this literal). Added with
  // `DASHBOARD_KEY_SCRIPT`, the first script that walks the bar both ways.
  shiftTab: '\u001b[Z',
  ctrlC: '\u0003',
};

/**
 * The New-ticket walk (spec D2): open the popup, fill and traverse every field,
 * then cancel.
 *
 * It is defined HERE rather than per subject on purpose — the comparison is
 * only worth anything if the four subjects are driven identically (spec R5). A
 * subject may override it via `bakers322.keys`, but then its transcript says so.
 *
 * There is no Ctrl+S and no Ctrl+D anywhere in it. Those are the form's two
 * submit paths; pressing either writes a real ticket to whichever control plane
 * the connection resolved to.
 */
export const TITLE_TEXT = 'BB-322 PTY driver walk';
export const DESCRIPTION_TEXT = 'driven by scripts/pty-drive.mjs';

export const NEW_TICKET_KEY_SCRIPT = [
  {
    label: 'open the New-ticket popup',
    send: 'n',
    expect: lit('New ticket'),
    timeoutMs: 9000,
  },
  {
    // MEASURED, not assumed: the popup paints "Loading new-ticket form…" and
    // then does NOT repaint when its option sources land — the next frame only
    // arrives on the next keystroke. Typing before that goes nowhere: the keys
    // are swallowed and the Title stays `<empty>`, which reads in a transcript
    // as "the form ignored input" rather than "the driver typed too early".
    // So the driver nudges with a key the form treats as navigation-or-nothing
    // until the field list is actually on screen.
    label:
      'wait for the async option sources (nudging — the popup does not repaint itself)',
    send: KEY.down,
    expect: lit('Title:'),
    repeatEveryMs: 700,
    timeoutMs: 20000,
  },
  {
    // Field navigation CLAMPS at both ends (`Form/form.ts` → `clamp(active + d,
    // 0, fields.length - 1)`), so any number of Ups lands on the first field
    // regardless of where the nudge left the cursor. `▸` is the active marker.
    label:
      'return to the first field (navigation clamps, so this is deterministic)',
    send: KEY.up,
    repeat: 4,
    expect: lit('▸ Title:'),
    // The nudge above may already have left the cursor on the first field, in
    // which case these Ups are no-ops that redraw the same frame — the marker
    // is then already on screen from before this step and would not reappear.
    // The step is informational; the steps that follow prove where the cursor
    // actually is.
    required: false,
  },
  {
    label: 'type into the Title field',
    send: TITLE_TEXT,
    expect: lit(TITLE_TEXT),
  },
  { label: 'focus Description', send: KEY.down, expect: lit('▸ Description:') },
  {
    label: 'type into the Description field',
    send: DESCRIPTION_TEXT,
    expect: lit(DESCRIPTION_TEXT),
  },
  {
    label: 'focus Parent — the autocomplete, i.e. the async option source',
    send: KEY.down,
    expect: lit('▸ Parent:'),
  },
  {
    // This is the step the whole screen was chosen for (spec D2): a debounced
    // query against a live option source.
    //
    // BB-326 CORRECTED THE EXPECTATION, not the keystrokes. The measured
    // walk asserted `›` alone, on the reasoning that the suggestion cursor is
    // "present only once real candidates came back". Driven against the
    // current, known-good kernel and inspected frame by frame, that is false:
    // focusing Parent already paints the UNFILTERED candidate list, cursor
    // included, so `›` is on screen before this step's first byte is sent and
    // the step passed vacuously. `search: bakers.build` is the echo of this step's own
    // input and is absent on the frame it starts from (`search: █`), so the
    // pair is a real assertion.
    //
    // What it still does NOT prove is the async ROUND TRIP: every candidate
    // begins with `bakers.build`, so the returned list is identical before and after,
    // and no reachable pattern distinguishes them. A narrowing query would,
    // but `send` is the byte sequence BB-322 measured and Task 6 compares
    // against — so the limitation is stated here rather than papered over.
    label: 'type a parent query — the debounced async option source',
    send: 'bakers.build',
    expectAll: [lit('search: bakers.build'), lit('›')],
    timeoutMs: 9000,
  },
  { label: 'focus Assignee', send: KEY.down, expect: lit('▸ Assignee:') },
  { label: 'cycle the Assignee select', send: KEY.right },
  { label: 'focus Conductor', send: KEY.down, expect: lit('▸ Conductor:') },
  { label: 'cycle the Conductor select', send: KEY.right },
  { label: 'focus Labels', send: KEY.down, expect: lit('▸ Labels:') },
  { label: 'toggle a label', send: ' ', expect: lit('[x]') },
  { label: 'focus Workflow', send: KEY.down, expect: lit('▸ Workflow:') },
  { label: 'cycle the Workflow select', send: KEY.right },
  {
    label: 'traverse all the way back up to the Title field',
    send: KEY.up,
    repeat: 6,
    expect: lit('▸ Title:'),
  },
  {
    // Esc, never Ctrl+S / Ctrl+D. Leaving the popup returns to the Dashboard,
    // and the top tab bar is the proof that the cancel actually happened. The
    // tab bar rather than the header text: the header reads "bakers.build dashboard"
    // unscoped and "<project> · dashboard" with `--project`, so matching it
    // would couple the shared key script to one subject's invocation.
    label: 'cancel WITHOUT submitting (Esc)',
    send: KEY.esc,
    expect: lit('[Dashboard]'),
  },
  { label: 'quit', send: 'q', settleMs: 500 },
];

// ---------------------------------------------------------------------------
// BB-326: the two surfaces acceptance criterion A5 adds to the New-ticket one
// ---------------------------------------------------------------------------
//
// Both are written in the SAME step shape as the walk above, and both add one
// field the New-ticket walk never needed:
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
// driver — `expect: x` is `expectAll: [x]`. The New-ticket script keeps the
// single form so its bytes stay the measured ones.
//
// SAFETY, as above: no Ctrl+S and no Ctrl+D anywhere. Neither script leaves a
// write behind — the Tickets walk types into the client-side search box and
// clears it again, and nothing here opens a form.

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
  // CURRENT kernel, where it made this step the only red one in the walk. The
  // New-ticket form does accept a multi-character chunk, which is why the walk
  // above can type a whole title in one send and this one cannot.
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

/**
 * The root Dashboard walk: the whole root tab cycle, forwards and backwards,
 * plus a reload.
 *
 * Booted WITHOUT a project (`bakers ui`), which is the only way to get the root
 * tab bar — `Dashboard · Projects · Conductors`. With `--project` the same
 * screen draws the project bar instead, so this script and the Tickets one
 * cannot share a boot.
 *
 * Every tab step asserts the bar AND that tab's own body, because the bar alone
 * is drawn by the kernel and would keep agreeing with itself while no screen
 * behind it ever repainted.
 *
 * There is deliberately no scroll assertion. The Dashboard's scroll offset is
 * clamped to `content − viewport`, and its content length is the number of
 * projects and users in the connected instance — so on a 40-row terminal there
 * is no pattern that is on screen only when scrolled, for any fixed number of
 * keypresses. The ↓/↑ round trip below is kept for what it does prove: forty
 * keystrokes later the screen is still the Dashboard and still repainting.
 */
export const DASHBOARD_KEY_SCRIPT = [
  {
    label: 'Tab → Projects',
    send: KEY.tab,
    expectAll: [lit('[Projects]'), lit('registered project(s)')],
    timeoutMs: 20000,
  },
  {
    label: 'Tab → Conductors',
    send: KEY.tab,
    expectAll: [lit('[Conductors]'), lit('conductor(s)'), lit('s start')],
    timeoutMs: 20000,
  },
  {
    label: 'Tab → back to the Dashboard (the cycle closes)',
    send: KEY.tab,
    expectAll: [lit('[Dashboard]'), lit('TICKETS CLOSED'), lit('RUNS CREATED')],
    timeoutMs: 20000,
  },
  {
    label: 'Shift+Tab → Conductors (the cycle runs backwards too)',
    send: KEY.shiftTab,
    expectAll: [lit('[Conductors]'), lit('conductor(s)')],
    timeoutMs: 20000,
  },
  {
    label: 'Tab → the Dashboard again',
    send: KEY.tab,
    expectAll: [lit('[Dashboard]'), lit('TICKETS CLOSED')],
    timeoutMs: 20000,
  },
  {
    label: 'scroll to the bottom of the scroll region',
    send: KEY.down,
    repeat: 20,
    settleMs: 600,
  },
  {
    label: 'scroll back to the top — the screen is intact and still repainting',
    send: KEY.up,
    repeat: 20,
    expectAll: [lit('[Dashboard]'), lit('TICKETS CLOSED')],
    timeoutMs: 15000,
  },
  {
    // Two steps, because one would be VACUOUS: `TICKETS CLOSED` is already on
    // screen when `R` is pressed, so asserting it here would pass without the
    // reload happening at all. The loading frame is what proves the reload
    // started — `AsyncScreen.retry()` puts the screen back into `loading` and
    // the body becomes `Loading dashboard…`, measured at ~450 ms wide against
    // the current kernel, i.e. many poll intervals.
    label: 'reload — the screen drops back to its loading state',
    send: 'R',
    expectAll: [lit('Loading dashboard…')],
    timeoutMs: 15000,
  },
  {
    label: 'the re-read statistics are painted again',
    send: '',
    expectAll: [lit('TICKETS CLOSED'), lit('RUNS CREATED'), lit('PER PROJECT')],
    timeoutMs: 20000,
  },
  { label: 'quit', send: 'q', settleMs: 500 },
];
