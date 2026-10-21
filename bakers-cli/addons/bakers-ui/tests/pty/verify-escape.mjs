#!/usr/bin/env node
// BB-326 — does ESCAPE still reach the cockpit when it does not arrive alone?
//
// WHY THIS EXISTS AS A SEPARATE DRIVER
//
//   Escape is the prefix of every CSI sequence, so `@opentui/core@0.5.1` cannot
//   classify a lone `\x1b` the moment it lands — it holds the byte and waits to
//   see whether a `[` follows. The window is `DEFAULT_TIMEOUT_MS = 20` in
//   `src/lib/stdin-parser.ts`, wired by the renderer as
//   `new StdinParser({ timeoutMs: 20, armTimeouts: true, ... })`.
//
//   Anything that arrives inside that window is merged with the Escape. The
//   parser then reports the pair as an ALT chord — `\x1b` + `j` becomes one key
//   event with `sequence: '\x1bj'`, `meta: true` — and the kernel's ladder,
//   which asks `key === '\x1b'`, never matches. The Escape is gone, and so is
//   the key that followed it.
//
//   The hand-rolled kernel could not have this bug. `lib/splitInput` emitted a
//   bare trailing `\x1b` IMMEDIATELY and said so in its own comment: "`\x1b`
//   alone IS the Esc/back binding, and holding it would swallow Esc until the
//   next keystroke." There was no window to merge across.
//
//   THE MERGE IS A DELIVERY PROPERTY, SO NO IN-PROCESS TEST CAN SEE IT.
//   `createTestRenderer`'s `mockInput.pressKey` delivers one key per call, which
//   is the one shape that never reproduces this. A previous investigation
//   checked twelve Escape contexts through `node-pty` on a fast local link,
//   found every one correct, and correctly declined to ship a fix — a lone
//   Escape typed by a human on loopback is never merged with anything.
//
//   It is merged on the operator's link. Measured with REAL mosh
//   (mosh-client/mosh-server 1.4.0) over a loopback relay holding the RTT at
//   ~180 ms: mosh ships the first byte of a burst at once and rate-limits the
//   rest into the next send interval, so three Escape taps 40 ms apart reach the
//   far end's pty as TWO writes — `[1b]`, then `[1b 1b]`. The second write is
//   two Escapes glued into one chunk, and the cockpit ignores it.
//
// WHAT IT DOES
//
//   Boots the real cockpit on a real pty and presses Escape in the shapes a
//   coalescing link actually produces, asserting the cockpit reacts to each:
//
//     E1  a lone Escape closes the New-ticket popup           (the control)
//     E2  two Escapes GLUED in one write close it
//     E3  Escape then `j` 5 ms later closes it                (inside the 20 ms)
//     E4  Escape glued in front of a whole arrow sequence closes it
//
//   and that the fix cannot have eaten the CSI vocabulary:
//
//     E5  arrow-down still moves the popup's field cursor
//     E6  Shift+Tab still cycles the top tab bar backwards
//
// USAGE
//
//   cd bakers-cli/addons/bakers-ui/tests/pty && npm install    # once: native deps
//   node verify-escape.mjs
//
//   --cols/--rows <n>   the pty geometry (default 120x40)
//
//   Exit code: 0 on `RESULT: OK`, 1 otherwise.

import { execFileSync } from 'node:child_process';
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
const SETTLE_TIMEOUT_MS = 6000;
const EXIT_GRACE_MS = 8000;
const POLL_MS = 50;

/**
 * The gap in E3, in milliseconds.
 *
 * Strictly inside the parser's 20 ms window and comfortably above the pty's own
 * scheduling noise, so the two writes are two chunks on the wire and one pending
 * buffer in the parser — which is precisely the case the old kernel got right
 * and this one does not.
 */
const INSIDE_WINDOW_MS = 5;

const read = (flag, fallback) => {
  const at = process.argv.indexOf(flag);
  return at === -1 ? fallback : process.argv[at + 1];
};

const COLS = Number(read('--cols', 120));
const ROWS = Number(read('--rows', 40));

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

const say = (line = '') => console.log(line);

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

const child = spawn(
  '/bin/sh',
  [
    '-c',
    `exec ${JSON.stringify(process.execPath)} ${JSON.stringify(BB_BIN)} ui`,
  ],
  {
    name: 'xterm-256color',
    cols: COLS,
    rows: ROWS,
    cwd: REPO_ROOT,
    env: { ...process.env, TERM: 'xterm-256color' },
  },
);

let exited = null;
child.onData((data) => terminal.write(data));
child.onExit((event) => {
  exited = event;
});
// The emulator's replies go back to the child. A harness that drops them is not
// a terminal, and the renderer's startup CPR is one of them.
terminal.onData((data) => child.write(data));

/** The reconstructed screen as one string. */
const screen = () => {
  const buffer = terminal.buffer.active;
  const out = [];
  for (let y = 0; y < terminal.rows; y += 1) {
    out.push(
      (buffer.getLine(y)?.translateToString(true) ?? '').replace(/\s+$/, ''),
    );
  }
  return out.join('\n');
};

const waitUntil = async (predicate, timeoutMs) => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (predicate()) return true;
    if (Date.now() > deadline) return false;
    await sleep(POLL_MS);
  }
};

/** The New-ticket modal, by its own title row. */
const POPUP = /New ticket/;
const popupOpen = () => POPUP.test(screen());

const checks = [];
const check = (id, ok, detail) => {
  checks.push({ id, ok });
  say(`${ok ? 'ok  ' : 'FAIL'} ${id} — ${detail}`);
};

/**
 * Open the New-ticket popup and leave it open.
 *
 * Every Escape case starts from the same place, so a case that fails cannot
 * leave the next one testing a different screen.
 */
async function openPopup() {
  if (popupOpen()) return true;
  child.write('n');
  return await waitUntil(popupOpen, SETTLE_TIMEOUT_MS);
}

/** Force the popup shut between cases, whatever the case under test did. */
async function closePopup() {
  for (let attempt = 0; attempt < 6 && popupOpen(); attempt += 1) {
    child.write('\x1b');
    await waitUntil(() => !popupOpen(), 1200);
  }
  return !popupOpen();
}

/**
 * Press Escape in one delivery shape and report whether the cockpit acted.
 *
 * `writes` is a list of `[bytes, gapMsAfter]`. Each entry is one `write()` to
 * the pty, which is one chunk on the child's stdin — the unit the parser merges
 * across.
 */
async function escapeCase(id, description, writes) {
  if (!(await openPopup())) {
    check(id, false, `${description} — the popup never opened (setup failed)`);
    return;
  }
  for (const [bytes, gap] of writes) {
    child.write(bytes);
    if (gap) await sleep(gap);
  }
  const closed = await waitUntil(() => !popupOpen(), SETTLE_TIMEOUT_MS);
  check(
    id,
    closed,
    `${description} — the popup ${closed ? 'closed' : 'is STILL OPEN: the Escape was swallowed'}`,
  );
  await closePopup();
}

async function main() {
  const booted = await waitUntil(
    () => /TICKETS CLOSED/.test(screen()),
    BOOT_TIMEOUT_MS,
  );

  say('# BB-326 — does Escape survive a coalescing link?');
  say('#');
  say(`# command:  exec bakers ui`);
  say(`# cwd:      ${REPO_ROOT}`);
  say(`# pty:      ${COLS}x${ROWS}, TERM=xterm-256color`);
  say(`# commit:   ${commitSha()}`);
  say(`# started:  ${new Date().toISOString()}`);
  say('#');
  say('# The shapes below are the ones REAL mosh produces on a ~180 ms link:');
  say(
    '#   three Escape taps 40 ms apart reach the far pty as [1b] then [1b 1b].',
  );
  say('');

  if (!booted) {
    check('boot', false, 'the cockpit never reached the dashboard');
  } else {
    check('boot', true, 'the cockpit reached the dashboard');

    // --- the Escape shapes -------------------------------------------------
    await escapeCase('E1', 'a lone Escape (the control)', [['\x1b', 0]]);
    await escapeCase('E2', 'two Escapes GLUED in one write', [['\x1b\x1b', 0]]);
    await escapeCase(
      'E3',
      `Escape, then "j" ${INSIDE_WINDOW_MS} ms later (inside the 20 ms window)`,
      [
        ['\x1b', INSIDE_WINDOW_MS],
        ['j', 0],
      ],
    );
    await escapeCase('E4', 'Escape glued in front of a whole arrow sequence', [
      ['\x1b\x1b[B', 0],
    ]);

    // --- the CSI vocabulary must be untouched ------------------------------
    if (await openPopup()) {
      // Wait for the field cursor to be on Title FIRST. The popup's title row
      // paints before its body settles, so sampling the cursor the instant the
      // popup appears reads a half-drawn frame — and then any later repaint
      // satisfies a "the screen changed" test without the arrow having done
      // anything. Both ends of this check are the cursor itself.
      const startedOnTitle = await waitUntil(
        () => /▸ Title:/.test(screen()),
        SETTLE_TIMEOUT_MS,
      );
      child.write('\x1b[B');
      const onDescription = await waitUntil(
        () => /▸ Description:/.test(screen()),
        SETTLE_TIMEOUT_MS,
      );
      check(
        'E5',
        startedOnTitle && onDescription,
        `arrow-down still moves the popup's field cursor (Title → Description: ${onDescription})`,
      );
      await closePopup();
    } else {
      check('E5', false, 'arrow-down — the popup never opened (setup failed)');
    }

    const onDashboard = await waitUntil(
      () => /\[Dashboard\]/.test(screen()),
      SETTLE_TIMEOUT_MS,
    );
    child.write('\x1b[Z');
    const wrapped = await waitUntil(
      () => /\[Conductors\]/.test(screen()),
      SETTLE_TIMEOUT_MS,
    );
    check(
      'E6',
      onDashboard && wrapped,
      `Shift+Tab still cycles the top tab bar backwards (Dashboard → Conductors: ${wrapped})`,
    );
  }

  // --- leave ---------------------------------------------------------------
  child.write('q');
  await waitUntil(() => exited !== null, EXIT_GRACE_MS);
  if (exited === null) child.kill();

  const failed = checks.filter((entry) => !entry.ok);
  say('');
  say(`## checks: ${checks.length - failed.length} ok, ${failed.length} FAIL`);
  say(
    failed.length === 0
      ? '## RESULT: OK — Escape reaches the cockpit however the link delivers it'
      : `## RESULT: FAIL — ${failed.map((entry) => entry.id).join(', ')}`,
  );
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
