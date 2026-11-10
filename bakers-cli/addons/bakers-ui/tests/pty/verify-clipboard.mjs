#!/usr/bin/env node
// BB-326 — does `y` / `Y` really put the operator's ticket into THEIR
// clipboard, and does the cockpit ever put something there they did not ask for?
//
// WHY THIS EXISTS AS A SEPARATE DRIVER
//
//   The operator drives the cockpit from a phone, over mosh, in Ghostty.
//   `@opentui/core@0.5.1` emits `?1002h` (drag reporting) unconditionally from
//   its Zig core, so the TERMINAL'S OWN selection is gone — see the known
//   deviation in `verify-mouse-modes.mjs`. Dragging to select on a phone was
//   never realistic anyway. So the cockpit copies for them, with OSC 52: the
//   escape travels to the operator's own terminal emulator, which is why it
//   works through ssh and through mosh where an `xclip` on this host would not.
//
//   OSC 52 is INVISIBLE to every other harness in this repo.
//   `verify-screen.mjs` and `captureCharFrame()` reconstruct TEXT; `\x1b]52;c;…`
//   is consumed by the terminal and paints nothing, so a copy binding that
//   silently does nothing passes both suites. `verify-colors.mjs` counts SGR
//   only. The assertion therefore has to be on the BYTES, and this file asserts
//   on nothing else.
//
// WHAT IS ASSERTED
//
//   1. `y` on the ticket LIST emits exactly one `ESC]52;c;<base64>ESC\`, and the
//      base64 decodes to the identifier of the row the cursor is on. Decoding
//      is the point: a driver that only counted sequences would pass against a
//      cockpit that copied the wrong ticket, or the empty string.
//   2. `Y` on the ticket LIST emits one more, decoding to that same ticket's
//      control-plane URL — `<base_url>/admin/bakers/ticket/<uuid>`.
//   3. `y` and `Y` on the ticket DETAIL do the same for the open ticket.
//   4. THE NEGATIVE, and the reason `y` was chosen: with the `/` search field
//      open, `y` is TEXT. The screen must type it and the wire must stay quiet.
//      A copy binding that shadowed an existing one would show up here as a
//      sequence that should not exist.
//   5. Every copy says so in the footer. A copy the operator cannot see is
//      indistinguishable from one that failed.
//
//   And the standing invariant, checked over the WHOLE transcript: the cockpit
//   emits an OSC 52 only on the keystrokes that asked for one. Booting,
//   navigating, paging and quitting must put nothing in the clipboard — this is
//   the operator's real system clipboard, not a buffer of ours.
//
// USAGE
//
//   cd bakers-cli/addons/bakers-ui/tests/pty && npm install   # once: native deps
//   node verify-clipboard.mjs
//   node verify-clipboard.mjs --out ../../../../../assets-ai/BB-nnn/node/pty-clipboard.txt
//
//   --project <name>   the project the walk opens (default: bakers)
//   --cols/--rows <n>  the pty geometry (default 120x40)
//   --out <file>       write the transcript here as well as to stdout
//
//   Exit code: 0 on `RESULT: OK`, 1 otherwise.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import xtermHeadless from '@xterm/headless';
import { spawn } from 'node-pty';
import { KEY, lit } from './key-script.mjs';

// `@xterm/headless` is CommonJS and exposes `Terminal` on the default export
// only; a named import of it is `undefined` at runtime, not a build error.
const { Terminal } = xtermHeadless;

const HERE = dirname(fileURLToPath(import.meta.url));
/** `<repo>` — this file sits at `<repo>/bakers-cli/addons/bakers-ui/tests/pty`. */
const REPO_ROOT = resolve(HERE, '../../../../..');
const BB_BIN = resolve(REPO_ROOT, 'bakers-cli/bin/bakers');

const DEFAULT_COLS = 120;
const DEFAULT_ROWS = 40;
const BOOT_TIMEOUT_MS = 25000;
const STEP_TIMEOUT_MS = 15000;
const POLL_MS = 50;
const EXIT_GRACE_MS = 8000;

/**
 * One OSC 52 clipboard write, as it appears on the wire.
 *
 * `ESC ] 52 ; <targets> ; <base64> ST`, where OpenTUI's `ST` is `ESC \`. Built
 * with `new RegExp` and an escaped constant rather than written as a literal:
 * Biome rejects a control character inside a regex literal, and this file needs
 * the escape byte itself.
 */
const ESC = '\u001b';
const OSC52 = new RegExp(
  `${ESC}\\]52;([^;]*);([A-Za-z0-9+/=]*)${ESC}\\\\`,
  'g',
);

/** `<base_url>/admin/bakers/ticket/<uuid>` — the ticket's page on the control
 *  plane, which is what `Y` is for. The uuid is JSON:API's own resource id and
 *  `BbEntityUuidConverter` is what makes that path resolve. */
const TICKET_URL =
  /^https?:\/\/[^\s/]+\/admin\/bakers\/ticket\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const IDENTIFIER = /^[A-Z][A-Z0-9]*-\d+$/;

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

function parseArgs(argv) {
  const read = (flag, fallback) => {
    const at = argv.indexOf(flag);
    return at === -1 ? fallback : argv[at + 1];
  };
  return {
    out: read('--out', undefined),
    project: read('--project', 'bakers'),
    cols: Number(read('--cols', DEFAULT_COLS)),
    rows: Number(read('--rows', DEFAULT_ROWS)),
  };
}

/** Every OSC 52 write in `text`, decoded. */
function clipboardWrites(text) {
  OSC52.lastIndex = 0;
  const writes = [];
  for (let m = OSC52.exec(text); m !== null; m = OSC52.exec(text)) {
    writes.push({
      at: m.index,
      target: m[1],
      base64: m[2],
      text: Buffer.from(m[2], 'base64').toString('utf8'),
    });
  }
  return writes;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const lines = [];
  const say = (line = '') => lines.push(line);
  let failures = 0;
  const check = (ok, label, detail = '') => {
    if (!ok) failures += 1;
    say(`   ${ok ? 'ok   ' : 'FAIL '} ${label}${detail ? ` — ${detail}` : ''}`);
  };

  say('# BB-326 — `bakers ui` copies to the operator’s clipboard over OSC 52');
  say('#');
  say('# The assertion target is the BYTE STREAM: an OSC 52 write paints');
  say('# nothing, so every text-level harness in this repo is blind to it.');
  say('#');
  say(`# cwd:      ${REPO_ROOT}`);
  say(`# pty:      ${options.cols}x${options.rows}, TERM=xterm-256color`);
  say(`# started:  ${new Date().toISOString()}`);
  say('');

  const terminal = new Terminal({
    cols: options.cols,
    rows: options.rows,
    allowProposedApi: true,
  });
  const args = ['ui', '--project', options.project];
  const child = spawn(process.execPath, [BB_BIN, ...args], {
    name: 'xterm-256color',
    cols: options.cols,
    rows: options.rows,
    cwd: REPO_ROOT,
    // The logger's own bytes are not the renderer's — see verify-colors.mjs.
    env: {
      ...process.env,
      TERM: 'xterm-256color',
      BAKERS_CONDUCTOR_LOG: 'file',
    },
  });

  let raw = '';
  let exited = null;
  child.onData((data) => {
    raw += data;
    terminal.write(data);
  });
  child.onExit((event) => {
    exited = event;
  });

  const screenText = () => {
    const buffer = terminal.buffer.active;
    const out = [];
    for (let y = 0; y < terminal.rows; y += 1) {
      out.push(
        (buffer.getLine(y)?.translateToString(true) ?? '').replace(/\s+$/, ''),
      );
    }
    return out.join('\n');
  };

  const waitFor = async (patterns, timeoutMs = STEP_TIMEOUT_MS) => {
    const regexes = patterns.map((p) => new RegExp(p));
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      if (regexes.every((r) => r.test(screenText()))) return true;
      if (Date.now() > deadline) return false;
      await sleep(POLL_MS);
    }
  };

  const booted = await waitFor(
    [lit('[Dashboard]'), lit('TICKETS CLOSED')],
    BOOT_TIMEOUT_MS,
  );
  say('## boot');
  check(booted, 'the cockpit booted on the project Dashboard');

  /**
   * The identifier of the row the cursor is on, read off the SCREEN — and read
   * by its ATTRIBUTE, not by a glyph.
   *
   * `lib/ansi.ts` `styleVisibleLines` marks the selection by wrapping the whole
   * fitted row in `ESC[7m … ESC[0m`; there is no marker character to grep for.
   * So this asks the reconstructed buffer which row is inverse. The footer is
   * inverse too and is excluded by never looking at the last row.
   *
   * Reading it independently is the point: it is what the decoded clipboard
   * text is checked AGAINST, so a cockpit that copied the wrong row would fail
   * rather than agree with itself.
   */
  const selectedIdentifier = () => {
    const buffer = terminal.buffer.active;
    for (let y = 0; y < terminal.rows - 1; y += 1) {
      const line = buffer.getLine(y);
      // Column 2: the first character of the fitted row, past the two-space
      // indent `styleVisibleLines` puts inside the inverse run.
      if (!line?.getCell(2)?.isInverse()) continue;
      const hit = /\b([A-Z][A-Z0-9]*-\d+)\b/.exec(line.translateToString(true));
      if (hit) return hit[1];
    }
    return undefined;
  };

  const walk = [];
  /**
   * Send a key and wait.
   *
   * `expectAll` waits for screen TEXT; `writes` waits for the number of OSC 52
   * sequences on the wire to reach a count. The copy steps use the SECOND,
   * deliberately: the footer notice from a previous copy is still on screen when
   * the next key is pressed, so waiting for `copied ` would pass against a key
   * that did nothing at all. Counting the writes is both non-vacuous and the
   * actual thing under test.
   */
  const step = async (label, send, { expectAll, writes, timeoutMs } = {}) => {
    if (send !== '') child.write(send);
    let ok = true;
    if (expectAll !== undefined) ok = await waitFor(expectAll, timeoutMs);
    if (ok && writes !== undefined) {
      const deadline = Date.now() + (timeoutMs ?? STEP_TIMEOUT_MS);
      while (clipboardWrites(raw).length < writes && Date.now() < deadline)
        await sleep(POLL_MS);
      ok = clipboardWrites(raw).length >= writes;
    }
    if (expectAll === undefined && writes === undefined) await sleep(600);
    // The screen is kept per step so a failure can SHOW what the driver was
    // looking at. The cockpit clears the terminal on `q`, so a dump taken at the
    // end of the run would be blank — which is the least useful moment to look.
    walk.push({
      label,
      ok,
      writes: clipboardWrites(raw).length,
      screen: screenText(),
    });
    return ok;
  };

  if (booted) {
    say('');
    say('## the walk');
    await step('switch to the Tickets tab', KEY.tab, {
      expectAll: [lit('[Tickets]'), lit('IDENTIFIER'), lit('page 1')],
      timeoutMs: 20000,
    });

    // -----------------------------------------------------------------------
    // 1/2 — the ticket LIST
    // -----------------------------------------------------------------------
    const listIdentifier = selectedIdentifier();
    await step('press y on the ticket list', 'y', { writes: 1 });
    const afterListY = screenText();
    await step('press Y on the ticket list', 'Y', { writes: 2 });
    const afterListShiftY = screenText();
    const listWrites = clipboardWrites(raw).slice(0, 2);

    say('');
    say('## 1/2 — the ticket LIST');
    say(`   selected row on screen: ${listIdentifier ?? '(not read)'}`);
    for (const w of listWrites)
      say(
        `   wire: ESC]52;${w.target};${w.base64}ESC\\  decodes to  ${w.text}`,
      );
    check(
      listWrites.length === 2,
      'y and Y each emitted exactly one OSC 52 write',
      `${listWrites.length} write(s)`,
    );
    check(
      listWrites[0]?.target === 'c',
      'the write targets the system clipboard (`c`), not the X11 primary selection',
      `target '${listWrites[0]?.target}'`,
    );
    check(
      listWrites[0] !== undefined &&
        IDENTIFIER.test(listWrites[0].text) &&
        listWrites[0].text === listIdentifier,
      'y copied the identifier of the row the cursor is on',
      `copied '${listWrites[0]?.text}', cursor on '${listIdentifier}'`,
    );
    check(
      listWrites[1] !== undefined && TICKET_URL.test(listWrites[1].text),
      'Y copied that ticket’s control-plane URL',
      `copied '${listWrites[1]?.text}'`,
    );
    check(
      new RegExp(`copied ${listIdentifier ?? '\\u0000'}\\b`).test(afterListY),
      'the footer names what y put in the clipboard',
    );
    check(
      afterListShiftY.includes(`copied the link to ${listIdentifier}`),
      'the footer names what Y put in the clipboard',
    );

    // -----------------------------------------------------------------------
    // 2/2 — the ticket DETAIL, opened with Enter from that same row
    // -----------------------------------------------------------------------
    const opened = await step('open the selected ticket', KEY.enter, {
      // BB-346 renamed the hint to `Tab section` — on this screen the key
      // switches a section of the open ticket, not a level's tab. The driver
      // waits on the detail screen's footer, so the literal has to track it.
      expectAll: [lit('Tab section · e edit')],
    });
    const detailIdentifier = /([A-Z][A-Z0-9]*-\d+)\s+·/.exec(screenText())?.[1];
    await step('press y on the ticket detail', 'y', { writes: 3 });
    const afterDetailY = screenText();
    await step('press Y on the ticket detail', 'Y', { writes: 4 });
    const detailWrites = clipboardWrites(raw).slice(2, 4);

    say('');
    say('## 2/2 — the ticket DETAIL');
    check(opened, 'the detail screen opened');
    say(`   open ticket on screen: ${detailIdentifier ?? '(not read)'}`);
    for (const w of detailWrites)
      say(
        `   wire: ESC]52;${w.target};${w.base64}ESC\\  decodes to  ${w.text}`,
      );
    check(
      detailWrites.length === 2,
      'y and Y each emitted exactly one OSC 52 write',
      `${detailWrites.length} write(s)`,
    );
    check(
      detailWrites[0] !== undefined &&
        detailWrites[0].text === detailIdentifier,
      'y copied the open ticket’s identifier',
      `copied '${detailWrites[0]?.text}', open '${detailIdentifier}'`,
    );
    check(
      detailWrites[1] !== undefined && TICKET_URL.test(detailWrites[1].text),
      'Y copied the open ticket’s control-plane URL',
      `copied '${detailWrites[1]?.text}'`,
    );
    check(
      afterDetailY.includes(`copied ${detailIdentifier}`),
      'the detail footer names what was copied',
    );
    // The notice LEADS the footer, and that is the assertion rather than "the
    // whole key ladder is still there". `Kernel/frame.ts` truncates the footer
    // from the RIGHT, and on the operator's actual device — a phone — it
    // truncates a long way in. So what has to be guaranteed is that the copy
    // notice is the part that survives, which is a property of its POSITION.
    check(
      /^ R reload · copied BB-\d+/.test(afterDetailY.split('\n').at(-1) ?? ''),
      'the notice leads the footer, so a narrow terminal cannot truncate it away',
      `footer: '${(afterDetailY.split('\n').at(-1) ?? '').slice(0, 60)}…'`,
    );

    // -----------------------------------------------------------------------
    // 3 — the negative: `y` inside the `/` search field is a LETTER
    // -----------------------------------------------------------------------
    await step('back to the ticket list', KEY.esc, {
      expectAll: [lit('IDENTIFIER'), lit('[Tickets]')],
    });
    const beforeSearch = clipboardWrites(raw).length;
    await step('open the search field', '/');
    await step('type y into it', 'y', { expectAll: [lit('search: y')] });
    const duringSearch = clipboardWrites(raw).length - beforeSearch;
    say('');
    say('## 3 — `y` inside the search field is a LETTER, not a copy');
    check(
      duringSearch === 0,
      'nothing reached the clipboard while typing',
      `${duringSearch} write(s)`,
    );
    check(
      /search: y/.test(screenText()),
      'the letter landed in the query instead',
    );

    await step('leave search', KEY.enter);
    await step('quit', 'q');
  }

  const deadline = Date.now() + EXIT_GRACE_MS;
  while (exited === null && Date.now() < deadline) await sleep(POLL_MS);
  if (exited === null) {
    try {
      child.kill('SIGKILL');
    } catch {
      /* already gone */
    }
  }

  // -------------------------------------------------------------------------
  // The standing invariant, over the whole session.
  // -------------------------------------------------------------------------
  const all = clipboardWrites(raw);
  say('');
  say('## the whole session');
  say(`   ${raw.length} bytes · ${all.length} OSC 52 write(s) in total`);
  say('   the walk, and how many writes had happened by the end of each step:');
  for (const s of walk)
    say(
      `   ${s.ok ? 'ok   ' : 'warn '} ${String(s.writes).padStart(2)}  ${s.label}`,
    );
  check(
    all.length === 4,
    'the cockpit wrote to the clipboard on the four keystrokes that asked, and on no other',
    `${all.length} write(s)`,
  );
  check(
    all.every((w) => w.text.length > 0),
    'no empty write — an empty copy would silently wipe the operator’s clipboard',
  );

  const stalled = walk.find((s) => !s.ok);
  if (stalled) {
    say('');
    say(`## the screen when '${stalled.label}' timed out`);
    for (const line of stalled.screen.split('\n')) say(`   |${line}`);
  }

  say('');
  say(
    `## RESULT: ${failures === 0 ? 'OK — the clipboard is written on request, with the right text, and never otherwise' : `FAILED — ${failures} violation(s)`}`,
  );

  const text = `${lines.join('\n')}\n`;
  process.stdout.write(text);
  if (options.out !== undefined) {
    const out = resolve(process.cwd(), options.out);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, text);
    process.stderr.write(`\nverification → ${out}\n`);
  }
  process.exit(failures === 0 ? 0 : 1);
}

await main();
