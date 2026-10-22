#!/usr/bin/env node
// BB-326 — where on the TERMINAL does the cockpit's frame begin, and does its
// footer survive?
//
// WHY THIS EXISTS AS A SEPARATE DRIVER
//
//   `screenMode: 'main-screen'` does not mean "the top of the terminal". It
//   means "wherever the cursor is": `@opentui/core@0.5.1` probes the cursor
//   position while it sets the terminal up (the reply is a plain CPR, reported
//   below as evidence) and anchors its render surface on that row. Every byte
//   written before the renderer exists therefore PUSHES THE WHOLE FRAME DOWN —
//   and the surface keeps its full `renderer.height`, so what falls off the
//   bottom is silently clipped. The status footer is the last composed row, so
//   it is the first thing to go.
//
//   The hand-rolled kernel could not have this bug: it opened every draw with
//   `ESC[H ESC[2J`, which homed the cursor and cleared the screen. The swap
//   dropped that write on the grounds that "replacing the whole row set and
//   letting the renderer diff the cells IS the clear" — true of the surface's
//   CONTENTS, and silent about where the surface starts.
//
//   No in-process test can see this. `createTestRenderer` hands back a buffer
//   whose row 0 is the frame's row 0 by construction, and `captureCharFrame()`
//   reads that buffer — so the anchor is a property of the real terminal only,
//   which is why the guard lives here and not in `tests-bun/`.
//
// WHAT IT DOES
//
//   Prints a known block of shell output, THEN execs `bakers ui` into the same
//   pty — the ordinary condition of any terminal that has been used. It then
//   reads the reconstructed screen and asserts the three things the operator
//   reported on:
//
//     A1  the frame's top border is on terminal row 0;
//     A2  none of the pre-cockpit output is still on screen;
//     A3  the status footer ("q quit") is on screen at all.
//
//   The terminal's own query replies are written BACK to the child. A headless
//   harness that drops them is not a terminal, and the reply that matters here
//   is exactly the one the defect is made of.
//
// USAGE
//
//   cd bakers-cli/addons/bakers-ui/tests/pty && npm install    # once: native deps
//   node verify-anchor.mjs
//   node verify-anchor.mjs --out ../../../../../assets-ai/BB-nnn/node/pty-anchor-after.txt
//
//   --cols/--rows <n>   the pty geometry (default 120x40)
//   --prefill <n>       lines of shell output before the cockpit (default 12)
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

const BOOT_TIMEOUT_MS = 25000;
const EXIT_GRACE_MS = 8000;
const POLL_MS = 50;

/**
 * The marker the pre-cockpit block is made of.
 *
 * Deliberately its own output and not `bakers ui`'s own preamble: the cockpit
 * already prints ~11 lines (the update notice and the resolved-connection log)
 * and reproduces the defect on its own, but how many lines those are is not
 * this driver's to promise. A block printed here is the stated precondition.
 */
const MARKER = 'PRE-COCKPIT-OUTPUT';

const read = (flag, fallback) => {
  const at = process.argv.indexOf(flag);
  return at === -1 ? fallback : process.argv[at + 1];
};

const COLS = Number(read('--cols', 120));
const ROWS = Number(read('--rows', 40));
const PREFILL = Number(read('--prefill', 12));
const OUT = read('--out', undefined);

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

const report = [];
const say = (line = '') => {
  report.push(line);
  console.log(line);
};

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

const terminal = new Terminal({
  cols: COLS,
  rows: ROWS,
  allowProposedApi: true,
});

// `exec` replaces the shell, so the cockpit inherits the pty with the cursor
// already part-way down — the whole precondition, in one process.
const script =
  `i=1; while [ $i -le ${PREFILL} ]; do echo "${MARKER} $i"; i=$((i+1)); done; ` +
  `exec ${JSON.stringify(process.execPath)} ${JSON.stringify(BB_BIN)} ui`;
const child = spawn('/bin/sh', ['-c', script], {
  name: 'xterm-256color',
  cols: COLS,
  rows: ROWS,
  cwd: REPO_ROOT,
  env: { ...process.env, TERM: 'xterm-256color' },
});

let exited = null;
child.onData((data) => terminal.write(data));
child.onExit((event) => {
  exited = event;
});
/** Every reply the emulator sent back — the CPR among them, as evidence. */
const replies = [];
terminal.onData((data) => {
  replies.push(data);
  child.write(data);
});

/** The reconstructed screen, one entry per physical row, right edge trimmed. */
const rowsOf = () => {
  const buffer = terminal.buffer.active;
  const out = [];
  for (let y = 0; y < terminal.rows; y += 1) {
    out.push(
      (buffer.getLine(y)?.translateToString(true) ?? '').replace(/\s+$/, ''),
    );
  }
  return out;
};

const waitForScreen = async (pattern, timeoutMs) => {
  const regex = new RegExp(pattern);
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (regex.test(rowsOf().join('\n'))) return true;
    if (Date.now() > deadline) return false;
    await sleep(POLL_MS);
  }
};

/**
 * The cockpit's own top border. Matched on the `╭─ ╳ bakers.build` opening rather than
 * on a run of box characters, so a modal's border can never satisfy it.
 */
const TOP_BORDER = /^╭─ ╳ bakers.build /;
/** The status footer's one stable token, present on every screen's hint line. */
const FOOTER = /q quit/;

async function main() {
  const booted = await waitForScreen('TICKETS CLOSED', BOOT_TIMEOUT_MS);

  say('# BB-326 — where the cockpit anchors its frame on a real pty');
  say('#');
  say(`# command:  /bin/sh -c '<${PREFILL} lines of output>; exec bakers ui'`);
  say(`# cwd:      ${REPO_ROOT}`);
  say(`# pty:      ${COLS}x${ROWS}, TERM=xterm-256color`);
  say(`# commit:   ${commitSha()}`);
  say(`# started:  ${new Date().toISOString()}`);
  say('#');
  say('# The emulator ANSWERS the renderer’s queries; the answers are written');
  say('# back to the child. The startup CPR below is the mechanism itself —');
  say('# `main-screen` mode anchors the render surface on the row it names.');
  say(`# replies:  ${JSON.stringify(replies)}`);
  // Matched on the tail rather than on the CSI introducer: an ESC in a regex
  // literal is a lint error, and `[<row>;<col>R` at the end of a reply is
  // already unambiguous — every other reply here ends in `$y` or `c`.
  const cpr = replies
    .map((reply) => /\[(\d+);(\d+)R$/.exec(reply))
    .find(Boolean);
  say(
    `# CPR row:  ${cpr ? cpr[1] : '(none observed)'} — 1 means the cockpit homed the cursor first`,
  );
  say('#');
  say();

  const screen = rowsOf();
  const checks = [];
  const judge = (ok, label, detail) => {
    checks.push(ok);
    say(`${ok ? 'ok  ' : 'FAIL'} ${label}`);
    say(`     ${detail}`);
  };

  judge(
    booted,
    'boot — the cockpit painted its dashboard body',
    booted
      ? 'TICKETS CLOSED is on screen'
      : `TICKETS CLOSED never appeared within ${BOOT_TIMEOUT_MS} ms`,
  );

  const borderRow = screen.findIndex((line) => TOP_BORDER.test(line));
  judge(
    borderRow === 0,
    'A1 anchor — the frame’s top border is on terminal row 0',
    borderRow === 0
      ? 'top border on row 0'
      : borderRow === -1
        ? 'no top border found on the screen at all'
        : `top border found on row ${borderRow} (want 0) — the frame is pushed ` +
          `down by ${borderRow} row(s) of output the renderer never owned, and ` +
          'the same number falls off the bottom',
  );

  const survivors = screen
    .map((line, index) => ({ line, index }))
    .filter((row) => row.line.includes(MARKER));
  judge(
    survivors.length === 0,
    'A2 clear — no pre-cockpit output is left on screen',
    survivors.length === 0
      ? `all ${PREFILL} marker lines were cleared`
      : `${survivors.length} marker line(s) still on screen, first on row ${survivors[0].index}`,
  );

  const footerRow = screen.findIndex((line) => FOOTER.test(line));
  judge(
    footerRow !== -1,
    'A3 footer — the status footer is on screen',
    footerRow === -1
      ? 'the footer ("q quit") is nowhere on the screen: the frame is longer ' +
          'than the room left below the anchor and the bottom was clipped'
      : `footer found on row ${footerRow} of ${ROWS}`,
  );

  say();
  say('## reconstructed screen');
  say();
  say(
    screen
      .map((line, index) => `${String(index).padStart(2)}|${line}`)
      .join('\n'),
  );
  say();

  child.write('q');
  const deadline = Date.now() + EXIT_GRACE_MS;
  while (exited === null && Date.now() < deadline) await sleep(POLL_MS);
  const exitOk = exited !== null && exited.exitCode === 0;
  judge(
    exitOk,
    'exit — the cockpit leaves on `q`',
    exited === null
      ? `still running ${EXIT_GRACE_MS} ms after 'q'; killed`
      : `code ${exited.exitCode}, signal ${exited.signal ?? 'none'}`,
  );
  if (exited === null) {
    try {
      child.kill('SIGKILL');
    } catch {
      /* already gone */
    }
  }

  const failures = checks.filter((ok) => !ok).length;
  say();
  say(`## checks: ${checks.length - failures} ok, ${failures} FAIL`);
  say(
    failures === 0
      ? '## RESULT: OK — the frame is anchored at the top of the terminal and ' +
          'its footer is on screen'
      : '## RESULT: FAILED',
  );

  if (OUT !== undefined) {
    const target = resolve(process.cwd(), OUT);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, `${report.join('\n')}\n`);
    process.stderr.write(`\nverification → ${target}\n`);
  }
  process.exit(failures === 0 ? 0 : 1);
}

await main();
