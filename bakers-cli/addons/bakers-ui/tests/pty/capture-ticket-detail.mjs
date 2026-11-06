#!/usr/bin/env node

// BB-369 — capture the ticket detail's three new surfaces on a REAL screen.
//
// WHY THIS EXISTS BESIDE THE FLAT RENDER
//
//   `bakers ui BB-369 | cat` proves AC-4 and nothing else. Three of this
//   ticket's facts exist only in the TTY:
//
//     - the `State:` header row is drawn by the CHROME, so it is on screen on
//       every tab — the flat render has no tabs and cannot show that;
//     - `Latest summary` is a COLLAPSIBLE entry: collapsed it shows a five-line
//       extract with `… +N more lines`, and only `Enter` reveals the rest;
//     - `Blocked by` lives on the Related tab, which the flat render flattens
//       away.
//
//   And the geometry is the risk this ticket carries (spec R1/R3): the state row
//   feeds `headerRowCount()` → `chromeHeight()`, which sizes the body window
//   before Yoga runs. Only a real boot through the kernel shows what an operator
//   actually loses and gains.
//
// WHY THE RECONSTRUCTED SCREEN AND NOT THE BYTE STREAM
//
//   The same reason `verify-screen.mjs` gives: a cell-diffing renderer writes
//   each label exactly once, ever, so a literal grep of the pty stream passes on
//   the first paint and times out on everything after it. BB-322 measured this
//   on two independent frameworks, which makes it a property of the METHOD. So
//   the pty output is fed through `@xterm/headless` and every expectation is
//   read off the RECONSTRUCTED SCREEN — the thing an operator sees.
//
// WHAT IT DOES NOT DO
//
//   It sends only Enter, Tab and q. It never sends Ctrl+S or Ctrl+D — a
//   form's two submit paths, which would write REAL data to whichever control
//   plane the connection resolved to. It opens a deep link to
//   an existing ticket and never leaves the detail screen, so no write path is
//   reachable at all.
//
// USAGE
//
//   cd bakers-cli/addons/bakers-ui/tests/pty && npm install     # once: native deps
//   node capture-ticket-detail.mjs --ticket BB-369
//   node capture-ticket-detail.mjs --ticket BB-23 \
//     --out ../../../../../assets-ai/BB-nnn/node/pty-ticket-detail.txt
//
//   --ticket <identifier>   the deep link to open (required)
//   --expect-blocker <re>   a pattern the Related tab's Blocked by must show
//   --expect-summary <re>   a pattern the expanded Latest summary must show
//   --out <file>            write the transcript here as well as to stdout
//   --cols/--rows <n>       pty geometry (default 120x40)
//
//   Exit code: 0 on `RESULT: OK`, 1 otherwise.

import { execFileSync } from 'node:child_process';
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

const DEFAULT_COLS = 120;
const DEFAULT_ROWS = 40;
/** The cockpit re-execs under Bun and then reads the control plane. */
const BOOT_TIMEOUT_MS = 30000;
const STEP_TIMEOUT_MS = 9000;
const POLL_MS = 50;
const EXIT_GRACE_MS = 8000;

const KEY = { enter: '\r', tab: '\t', quit: 'q' };

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const lit = (text) => String(text).replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

function parseArgs(argv) {
  const read = (flag, fallback) => {
    const at = argv.indexOf(flag);
    return at === -1 ? fallback : argv[at + 1];
  };
  const ticket = read('--ticket', undefined);
  if (ticket === undefined)
    throw new Error('--ticket <identifier> is required');
  return {
    ticket,
    out: read('--out', undefined),
    expectBlocker: read('--expect-blocker', undefined),
    expectSummary: read('--expect-summary', undefined),
    cols: Number(read('--cols', DEFAULT_COLS)),
    rows: Number(read('--rows', DEFAULT_ROWS)),
  };
}

/** `git rev-parse HEAD`, or a stated absence — never a guess. */
function commitSha() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    }).trim();
  } catch (error) {
    return `(unavailable: ${error.message})`;
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const terminal = new Terminal({
    cols: options.cols,
    rows: options.rows,
    allowProposedApi: true,
  });
  const args = ['ui', options.ticket];
  const child = spawn(process.execPath, [BB_BIN, ...args], {
    name: 'xterm-256color',
    cols: options.cols,
    rows: options.rows,
    cwd: REPO_ROOT,
    env: { ...process.env, TERM: 'xterm-256color' },
  });
  let exited = null;
  child.onData((data) => terminal.write(data));
  child.onExit((event) => {
    exited = event;
  });

  /** The reconstructed screen as plain lines, trailing blanks trimmed. */
  const snapshot = () => {
    const buffer = terminal.buffer.active;
    const lines = [];
    for (let y = 0; y < terminal.rows; y += 1) {
      lines.push(
        (buffer.getLine(y)?.translateToString(true) ?? '').replace(/\s+$/, ''),
      );
    }
    return lines;
  };
  const screenText = () => snapshot().join('\n');

  /**
   * Wait until EVERY pattern matches the SAME screen.
   *
   * Same screen, not "each seen at some point": a walk between tabs is only
   * proven when the chrome and the body agree in one frame.
   */
  const waitForScreen = async (patterns, timeoutMs) => {
    const regexes = patterns.map((pattern) => new RegExp(pattern));
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const text = screenText();
      if (regexes.every((regex) => regex.test(text))) return true;
      if (Date.now() > deadline) return false;
      await sleep(POLL_MS);
    }
  };

  const t0 = performance.now();
  const since = () => performance.now() - t0;
  const report = [];
  const say = (line = '') => report.push(line);

  say('# BB-369 — real-PTY capture of the ticket detail (state, latest');
  say('# summary, blocked_by), asserted on the RECONSTRUCTED SCREEN.');
  say('#');
  say(`# ticket:  ${options.ticket}`);
  say(`# command: ${BB_BIN} ${args.join(' ')}`);
  say(`# cwd:     ${REPO_ROOT}`);
  say(`# pty:     ${options.cols}x${options.rows}, TERM=xterm-256color`);
  say(`# commit:  ${commitSha()}`);
  say(`# started: ${new Date().toISOString()}`);
  say('#');

  let ok = true;
  let failure = '';
  const judged = [];

  /**
   * One judged step: send a key, wait for the patterns, capture the frame.
   *
   * THE STALE-PASS GUARD, and it is the reason this helper is not three lines.
   * `waitForScreen` tests the screen BEFORE its first sleep, so a step whose
   * expectation is ALREADY satisfied returns instantly — before the keystroke's
   * repaint has landed — and then captures the previous frame while reporting
   * `ok`. Measured, not feared: the first version of this driver "proved" that
   * `Enter` expanded the summary by matching `Latest summary`, a string that was
   * already on the collapsed screen, and the captured before/after frames came
   * out byte-identical.
   *
   * So every step that sends a key must expect something that is FALSE on the
   * screen in front of it. If it is not, the step is recorded as
   * `NOT PROVEN (stale)` and fails the run rather than passing quietly.
   */
  const step = async (
    label,
    send,
    patterns,
    { capture = true, timeoutMs = STEP_TIMEOUT_MS } = {},
  ) => {
    if (!ok) return;
    const at = since();
    const before = screenText();
    const alreadyTrue = patterns.every((p) => new RegExp(p).test(before));
    if (send !== null && alreadyTrue) {
      judged.push({ label, passed: false });
      ok = false;
      failure =
        `'${label}' is NOT PROVEN: every expected pattern was already on ` +
        'screen before the key was sent, so a pass would not show the key did ' +
        'anything. Choose a pattern that is false until the key lands.';
      say(`[${at.toFixed(0).padStart(6)} ms] FAIL ${label}`);
      say(`             NOT PROVEN (stale) — ${failure}`);
      return;
    }
    if (send !== null) child.write(send);
    const passed = await waitForScreen(patterns, timeoutMs);
    judged.push({ label, passed });
    say(
      `[${at.toFixed(0).padStart(6)} ms] ${passed ? 'ok  ' : 'FAIL'} ${label}`,
    );
    say(
      `             send ${send === null ? '(nothing — boot)' : JSON.stringify(send)}` +
        `  expect ${patterns.map((p) => `/${p}/`).join(' AND ')}` +
        `${send === null ? '' : '  (verified false before the send)'}`,
    );
    if (!passed) {
      ok = false;
      failure = `'${label}' expected ${patterns
        .map((p) => `/${p}/`)
        .join(' AND ')} and it never appeared on ONE screen`;
    }
    if (capture) {
      say();
      say(`## frame after: ${label}`);
      say();
      say(screenText());
      say();
    }
  };

  // ---------------------------------------------------------------------
  // The walk
  // ---------------------------------------------------------------------

  // Boot. The identifier proves the deep link resolved; `Overview` proves the
  // chrome's tab bar painted. Waiting on the identifier ALONE would return while
  // the body still reads its loading copy.
  //
  // Its own, much longer budget: `cmdUi` re-execs the cockpit under Bun and only
  // then reads the control plane, so the first paint is nothing like a keystroke
  // repaint. On a warm control plane this returns in about 1.5 s; the step
  // budget would still be a coin-flip on a cold one.
  await step(
    'boot — the detail screen painted, deep-linked',
    null,
    [lit(options.ticket), 'Overview'],
    { timeoutMs: BOOT_TIMEOUT_MS },
  );

  // AC-1. The row is the chrome's third header child, so it is on screen before
  // any key is pressed and on every tab after.
  await step(
    'AC-1 — the header box carries a `State:` row on the opened tab',
    null,
    ['State:'],
    { capture: false },
  );

  // AC-2, collapsed. Overview's expandable entry 0 is the summary (D4), so the
  // caret is on it in a freshly opened detail without any navigation. `▸` is the
  // COLLAPSED caret (`▾` is expanded), so this pins the state and not just the
  // heading.
  await step(
    'AC-2 — Overview shows a `Latest summary` entry, COLLAPSED (`▸`)',
    null,
    ['▸ Latest summary'],
  );

  // AC-2, expanded. `Enter` acts on entry 0 — the summary, not the description.
  // The caret flip is what proves it: `▾ Latest summary` is false on the
  // collapsed screen, so the stale-pass guard cannot wave this through.
  await step(
    'AC-2 — `Enter` on entry 0 expands the summary (caret flips to `▾`)',
    KEY.enter,
    options.expectSummary === undefined
      ? ['▾ Latest summary']
      : ['▾ Latest summary', options.expectSummary],
  );

  // AC-3. The tab order is Overview, Comments, Related, Runs, so Related is two
  // Tabs away. Each step expects the tab bar's OWN active marker, which is false
  // until that Tab lands. The `State:` row must still be there on Related — that
  // is the half of AC-1 the flat render cannot show.
  await step(
    'walk — Tab off Overview onto Comments',
    KEY.tab,
    ['\\[Comments\\]'],
    {
      capture: false,
    },
  );
  await step(
    'AC-3 + AC-1 — the Related tab shows `Blocked by`, and `State:` is STILL in the header',
    KEY.tab,
    options.expectBlocker === undefined
      ? ['\\[Related\\]', 'Blocked by', 'State:']
      : ['\\[Related\\]', 'Blocked by', options.expectBlocker, 'State:'],
  );

  // `q` is the last key of the walk; a cockpit that paints correctly and then
  // will not leave is a regression, so the exit is judged and not a footnote.
  child.write(KEY.quit);
  const exitDeadline = Date.now() + EXIT_GRACE_MS;
  while (exited === null && Date.now() < exitDeadline) await sleep(POLL_MS);
  const exitOk = exited !== null && exited.exitCode === 0;
  judged.push({ label: 'exit on `q`', passed: exitOk });
  if (ok && !exitOk) {
    ok = false;
    failure =
      exited === null
        ? `the cockpit was still running ${EXIT_GRACE_MS} ms after 'q'`
        : `the cockpit left with exit code ${exited.exitCode} after 'q'`;
  }
  say(
    `[${since().toFixed(0).padStart(6)} ms] ${exitOk ? 'ok  ' : 'FAIL'} exit — ${
      exited === null
        ? `still running ${EXIT_GRACE_MS} ms after 'q'; killed`
        : `code ${exited.exitCode}, signal ${exited.signal ?? 'none'}`
    }`,
  );
  if (exited === null) {
    try {
      child.kill('SIGKILL');
    } catch {
      /* already gone */
    }
  }

  const passedCount = judged.filter((s) => s.passed).length;
  say();
  say(`## steps: ${passedCount} ok, ${judged.length - passedCount} FAIL`);
  say(
    `## RESULT: ${ok ? 'OK — every step was satisfied ON SCREEN' : `FAILED — ${failure}`}`,
  );

  const text = `${report.join('\n')}\n`;
  process.stdout.write(text);
  if (options.out !== undefined) {
    const out = resolve(process.cwd(), options.out);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, text);
    process.stderr.write(`\ncapture → ${out}\n`);
  }
  process.exit(ok ? 0 : 1);
}

await main();
