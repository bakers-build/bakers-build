#!/usr/bin/env node
// BB-370 — the reproducible condition for `/` as a TICKET-ID FILTER, on a real
// pty, against whatever control plane the connection config resolves to.
//
// WHY A PTY DRIVER AND NOT ONLY THE VITEST CASE
//
//   `tests/Screen/tickets-id-search.test.ts` pins the behaviour against a
//   fixture control plane, which is what a regression test should do. It cannot
//   answer the question the operator's report actually raises — whether the
//   defect is the criteria, the OR-group encoding, the key path, or the typing
//   speed — because a fixture is not a measurement of any of them. This driver
//   is: it types into the real cockpit and reads the reconstructed screen.
//
// WHAT IT MEASURES, IN ORDER
//
//   1. `/` alone paints a frame BYTE-IDENTICAL to the one before it, so search
//      mode has no affordance of its own.
//   2. An identifier typed as ONE burst and as separate keystrokes reach the
//      query identically — the chunking hypothesis, refuted rather than assumed.
//   3. `/<identifier of a CLOSED ticket>` answers `No tickets.` under the
//      shipped `closed: hidden` default, and the SAME query finds the SAME
//      ticket once `x` cycles that one criterion. That is the defect.
//
// WHAT "RESULT: OK" MEANS AFTER THE FIX
//
//   The confirmed direction is LEGIBILITY, not inclusion: `closed: hidden` keeps
//   ruling and the row keeps not arriving, so section 5's "not listed" check is
//   permanent and passes on both sides of the fix. Two checks are RED today and
//   are the ones that must flip — that `/` shows search mode is open, and that
//   the frame states HOW MANY matches the closed criterion is holding back. A
//   run that reports them OK is a run against a fixed cockpit.
//
// WHAT IT DOES NOT DO
//
//   It types no `q` into any query: the kernel quits on `q` whether or not the
//   screen consumed it (`tui-kernel.ts` guards the quit on `modal`, not on
//   `handled`), so a `q` mid-walk ends the session. It sends no Ctrl+S/Ctrl+D
//   and writes nothing to any control plane.
//
// USAGE
//
//   cd bakers-cli/addons/bakers-ui/tests/pty && npm install   # once: native deps
//   node verify-id-search.mjs --project bakers --closed-ticket BB-73
//   node verify-id-search.mjs --project bakers --closed-ticket BB-73 \
//     --out ../../../../../assets-ai/BB-nnn/node/pty-id-search.txt
//
//   --project <name>          the project whose ticket list is walked
//   --closed-ticket <BB-N>  a CLOSED ticket of that project — the subject
//   --open-ticket <BB-N>    an OPEN ticket on the list's first page
//   --cols/--rows <n>         pty geometry (default 160x45)

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import xtermHeadless from '@xterm/headless';
import { spawn } from 'node-pty';

// `@xterm/headless` is CommonJS and exposes `Terminal` on the default export
// only; a named import of it is `undefined` at runtime, not a build error.
const { Terminal } = xtermHeadless;

const HERE = dirname(fileURLToPath(import.meta.url));
/** `<repo>` — this file sits at `<repo>/bakers-cli/addons/bakers-ui/tests/pty`. */
const REPO_ROOT = resolve(HERE, '../../../../..');
const BB_BIN = resolve(REPO_ROOT, 'bakers-cli/bin/bakers');

const BOOT_MS = 30000;
const SETTLE_MS = 3000;
const KEY_GAP_MS = 120;

const flag = (name, fallback) => {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? fallback : process.argv[at + 1];
};

const PROJECT = flag('project', 'bakers');
const CLOSED_TICKET = flag('closed-ticket', 'BB-73');
const OPEN_TICKET = flag('open-ticket', 'BB-370');
const COLS = Number(flag('cols', '160'));
const ROWS = Number(flag('rows', '45'));
const OUT = flag('out', undefined);

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

const transcript = [];
const say = (line) => {
  transcript.push(line);
  console.log(line);
};

const term = new Terminal({ cols: COLS, rows: ROWS, allowProposedApi: true });
const pty = spawn(BB_BIN, ['ui', '--project', PROJECT], {
  name: 'xterm-256color',
  cols: COLS,
  rows: ROWS,
  cwd: REPO_ROOT,
  env: { ...process.env, TERM: 'xterm-256color' },
});
pty.onData((data) => term.write(data));

const screen = () => {
  const lines = [];
  for (let y = 0; y < term.rows; y++)
    lines.push(term.buffer.active.getLine(y)?.translateToString(true) ?? '');
  return lines.join('\n');
};

const waitFor = async (pattern, ms, label) => {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (pattern.test(screen())) return true;
    await sleep(50);
  }
  say(`!! TIMEOUT waiting for ${label}`);
  return false;
};

/** The count line plus the identifiers on screen — the whole of what a case
 *  asserts on, and short enough to read in a transcript. */
const report = (label) => {
  const lines = screen()
    .split('\n')
    .filter((line) => line.trim());
  const count = (
    lines.find((line) => line.includes('ticket(s)')) ?? '(no count line)'
  ).trim();
  const empty = lines.find((line) => line.includes('No tickets.'));
  const rows = lines
    .filter((line) => /^\s+BB-\d+/.test(line))
    .map((line) => line.trim().split(/\s+/)[0]);
  say('');
  say(`===== ${label} =====`);
  say(count);
  say(empty ? '>>> No tickets.' : `rows: ${rows.join(', ')}`);
  // The whole reconstructed frame, so a case can ask whether the operator can
  // READ something — the hidden-count copy lives wherever the fix puts it.
  const text = lines.join('\n');
  return { count, rows, text, empty: Boolean(empty) };
};

/** Does the frame state how many matches a criterion is holding back? Anchored
 *  so it cannot match across a `·` segment boundary — the meta line already
 *  carries the words `closed: hidden`. */
const statesHiddenCount = (text) => /\b\d+\b[^·\n]{0,20}hidden/i.test(text);

/** Open `/`, type the text one keystroke at a time, let the debounce land. */
const typeSearch = async (text) => {
  pty.write('/');
  await sleep(700);
  for (const character of text) {
    pty.write(character);
    await sleep(KEY_GAP_MS);
  }
  await sleep(SETTLE_MS);
};

/** Leave search mode (Enter keeps the filter) and clear every criterion. */
const clearSearch = async () => {
  pty.write('\r');
  await sleep(500);
  pty.write('c');
  await sleep(SETTLE_MS);
};

const failures = [];
const check = (ok, label) => {
  say(`${ok ? 'OK  ' : 'FAIL'} — ${label}`);
  if (!ok) failures.push(label);
};

await waitFor(/\[Dashboard\]/, BOOT_MS, 'the cockpit to boot');
await waitFor(/TICKETS CLOSED/, BOOT_MS, 'the dashboard body');
pty.write('\t');
await waitFor(/IDENTIFIER/, BOOT_MS, 'the ticket list');
await sleep(SETTLE_MS);
const baseline = report('1. baseline — the shipped default');
check(
  baseline.rows.includes(OPEN_TICKET),
  `${OPEN_TICKET} is on the first page`,
);
check(
  !baseline.rows.includes(CLOSED_TICKET),
  `${CLOSED_TICKET} is absent: it is closed and the default hides closed rows`,
);

// 1. the affordance
const before = screen();
pty.write('/');
await sleep(1200);
const identical = before === screen();
say('');
say(`===== 2. the frame after '/' =====`);
say(
  identical
    ? 'byte-identical to the frame before it — search mode has no affordance'
    : 'changed — search mode paints something of its own',
);
check(!identical, 'pressing `/` shows the operator that search mode is open');

// 2. the same identifier as one burst, then as separate keystrokes
for (const character of OPEN_TICKET) {
  pty.write(character);
  await sleep(KEY_GAP_MS);
}
await sleep(SETTLE_MS);
const slow = report(`3. '${OPEN_TICKET}' typed one keystroke at a time`);
check(slow.rows.includes(OPEN_TICKET), `keystrokes find ${OPEN_TICKET}`);
await clearSearch();
pty.write('/');
await sleep(700);
pty.write(OPEN_TICKET);
await sleep(SETTLE_MS);
const burst = report(`4. '${OPEN_TICKET}' written as ONE burst`);
check(burst.rows.includes(OPEN_TICKET), `a burst finds ${OPEN_TICKET} too`);
await clearSearch();

// 3. the defect: the same query, one criterion apart
await typeSearch(CLOSED_TICKET);
const hidden = report(`5. '${CLOSED_TICKET}' under closed: hidden`);
// PERMANENT expectation under the confirmed fix direction: the operator's
// `closed: hidden` keeps ruling, so the row is not listed and the server stays
// authoritative. This holds before and after the fix.
check(
  hidden.empty && !hidden.rows.includes(CLOSED_TICKET),
  `${CLOSED_TICKET} is not listed — the closed criterion still rules`,
);
// THE ONE THAT MUST FLIP: today the frame gives the operator no way to tell
// "no such ticket" from "the closed criterion is holding matches back".
check(
  statesHiddenCount(hidden.text),
  'the frame states HOW MANY matches the closed criterion is hiding',
);
pty.write('\r');
await sleep(500);
pty.write('x');
await sleep(SETTLE_MS);
const cycled = report(`6. the same query, closed filter cycled once (x)`);
check(
  cycled.rows.includes(CLOSED_TICKET),
  `the SAME query finds ${CLOSED_TICKET} once the closed criterion moves`,
);

pty.write('q');
await sleep(1200);
try {
  pty.kill();
} catch {
  // The cockpit has already exited on `q`; nothing left to signal.
}

say('');
say(
  failures.length === 0
    ? 'RESULT: OK — every expectation held'
    : `RESULT: ${failures.length} unmet expectation(s):\n  - ${failures.join('\n  - ')}`,
);
if (OUT) {
  const target = resolve(process.cwd(), OUT);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, `${transcript.join('\n')}\n`, 'utf8');
  console.log(`\nwritten: ${target}`);
}
process.exit(failures.length === 0 ? 0 : 1);
