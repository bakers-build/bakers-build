#!/usr/bin/env node
// BB-326 — the TERMINAL CURSOR, verified on a real pty.
//
// WHY A DRIVER OF ITS OWN, AND NOT ANOTHER `verify-screen` EXPECTATION
//
//   `verify-screen.mjs` asserts on the reconstructed SCREEN — the characters an
//   operator sees. That is the right target for everything it checks, and it is
//   structurally blind to this change: the cockpit's insertion point is no
//   longer a character. It used to be an inverse-video cell spliced into the row
//   (`Widget/text.ts`'s `\x1b[7m…\x1b[27m`); on an operator decision it became a
//   real terminal cursor, because they drive the cockpit over mosh from a phone
//   and mosh's local predictive echo — the thing that makes a typed character
//   appear before the network round trip — only works when the terminal has a
//   cursor to predict at.
//
//   So the guard has to read what the TERMINAL thinks its cursor is doing. That
//   is `@xterm/headless`'s own cursor state, reconstructed from the same byte
//   stream: `buffer.active.cursorX`/`cursorY` for the position, and
//   `coreService.isCursorHidden` for the `?25h`/`?25l` the renderer emits. Both
//   are the terminal's answer, not the cockpit's claim about itself — the same
//   relationship `verify-screen` has to the frame.
//
//   `tests-bun/Kernel/create-form-keys.test.ts` asserts the same thing through
//   `renderer.getCursorState()`. That is the renderer's INTENT; this is what
//   came out the other end of a pty. Both are worth having, and they are not
//   the same claim: a renderer can intend a cursor at (14, 41) and emit nothing.
//
// WHAT IT DOES NOT DO
//
//   It never sends Ctrl+S or Ctrl+D — the New-ticket form's two submit paths,
//   which would write a real ticket to whichever control plane the connection
//   resolved to. The check below refuses to run a step containing either.
//
// USAGE
//
//   cd bakers-cli/addons/bakers-ui/tests/pty && npm install      # once: native deps
//   node verify-cursor.mjs
//   node verify-cursor.mjs --out ../../../../../assets-ai/bakers.build-nnn/node/pty-cursor.txt
//
//   --project <name>   the project the popup opens under
//   --cols/--rows <n>  the pty geometry (default 120x40)
//   --boot-timeout <ms>
//
//   Exit code: 0 on `RESULT: OK`, 1 otherwise.

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import xtermHeadless from '@xterm/headless';
import { spawn } from 'node-pty';
import { lit } from './key-script.mjs';

const { Terminal } = xtermHeadless;

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '../../../../..');
const BB_BIN = resolve(REPO_ROOT, 'bakers-cli/bin/bakers');

const DEFAULT_COLS = 120;
const DEFAULT_ROWS = 40;
const DEFAULT_BOOT_TIMEOUT_MS = 25000;
const DEFAULT_STEP_TIMEOUT_MS = 8000;
const POLL_MS = 50;
const EXIT_GRACE_MS = 8000;

/** The two hint rows the Dashboard shows once its first read has landed. */
const BOOT = [lit('[Dashboard]'), lit('TICKETS CLOSED')];

const KEY = {
  up: '[A',
  down: '[B',
  left: '[D',
  esc: '',
};

/**
 * A short title, and a long one that MUST wrap.
 *
 * The popup's body is a fixed 58 columns and a `text` value is indented four,
 * so a row holds 54. Hand-derived: `…the New ticket` is 49 columns and adding
 * ` popup` would make 55, so the break falls before `popup` — which is what
 * makes the second row's first character a known cell.
 */
const SHORT = 'abcdef';
const LONG =
  'a title long enough to wrap inside the New ticket popup and then some';
const LONG_ROW_0 = 'a title long enough to wrap inside the New ticket';
const LONG_ROW_1 = 'popup and then some';

/**
 * The walk.
 *
 * Each step sends keys and then states what the CURSOR must be doing, as a
 * predicate over the terminal's own cursor state plus the reconstructed screen
 * (needed to locate the row the value is on — the popup floats, so no row index
 * is a constant).
 */
const STEPS = [
  {
    label: 'the dashboard shows NO cursor — nothing on it takes typed text',
    send: '',
    expect: ({ hidden }) => (hidden ? null : 'the cursor is visible'),
  },
  {
    label: 'open the New-ticket popup',
    send: 'n',
    screen: [lit('New ticket')],
    timeoutMs: 9000,
  },
  {
    label: 'wait for the async option sources (nudging — see verify-screen)',
    send: KEY.down,
    screen: [lit('Title:')],
    repeatEveryMs: 700,
    timeoutMs: 20000,
  },
  {
    label: 'return to the first field (navigation clamps)',
    send: KEY.up,
    repeat: 4,
    screen: [lit('▸ Title:')],
  },
  {
    // The empty field is exactly where an operator starts typing, so the cursor
    // has to be there before a single character exists.
    label: 'an EMPTY active Title already carries the cursor, on its value row',
    send: '',
    expect: ({ hidden, y, rowOf }) => {
      if (hidden) return 'the cursor is hidden';
      const title = rowOf('▸ Title:');
      if (title < 0) return 'no active Title row on screen';
      return y === title + 1 ? null : `cursor row ${y}, wanted ${title + 1}`;
    },
  },
  {
    label: 'type into Title — the cursor trails the typed characters',
    send: SHORT,
    screen: [lit(SHORT)],
    expect: ({ hidden, x, y, rowOf, lines }) => {
      if (hidden) return 'the cursor is hidden';
      const title = rowOf('▸ Title:');
      const value = lines[title + 1] ?? '';
      const at = value.indexOf(SHORT);
      if (at < 0) return `'${SHORT}' is not on the value row: ${value}`;
      if (y !== title + 1) return `cursor row ${y}, wanted ${title + 1}`;
      // One past the last character typed.
      const want = at + SHORT.length;
      return x === want ? null : `cursor column ${x}, wanted ${want}`;
    },
  },
  {
    label: '← moves the insertion point INSIDE the value (BB-283)',
    send: KEY.left,
    repeat: 3,
    expect: ({ hidden, x, y, rowOf, lines }) => {
      if (hidden) return 'the cursor is hidden';
      const title = rowOf('▸ Title:');
      const value = lines[title + 1] ?? '';
      const at = value.indexOf(SHORT);
      if (at < 0) return `'${SHORT}' is not on the value row: ${value}`;
      if (y !== title + 1) return `cursor row ${y}, wanted ${title + 1}`;
      // Three characters back from the end: the cell holding 'd'.
      const want = at + SHORT.length - 3;
      return x === want ? null : `cursor column ${x}, wanted ${want} (on 'd')`;
    },
  },
  {
    label: '↓ to Description moves the cursor to the OTHER field',
    send: KEY.down,
    screen: [lit('▸ Description:')],
    expect: ({ hidden, y, rowOf }) => {
      if (hidden) return 'the cursor is hidden';
      const at = rowOf('▸ Description:');
      if (at < 0) return 'no active Description row on screen';
      return y === at + 1 ? null : `cursor row ${y}, wanted ${at + 1}`;
    },
  },
  {
    // Parent is an `autocomplete`, and BB-326's widget-fit F2 conversion made
    // that kind's QUERY ROW carry a terminal cursor too — it used to draw its own
    // `▌` character. Whether this field HAS a query row depends on the instance:
    // the row exists only once the candidate bag has loaded, and an absent or
    // failed bag draws a note instead. So the assertion is the BICONDITIONAL,
    // which is both environment-independent and strictly stronger than the
    // `hidden`-only check it replaces — it now also fails a query row that has no
    // cursor, which is the F2 regression, as well as a cursor left hovering over
    // a field nobody can type into, which is the original one.
    label: '↓ to Parent — the cursor is on the query row, or nowhere',
    send: KEY.down,
    screen: [lit('▸ Parent:')],
    expect: ({ hidden, x, y, rowOf, lines }) => {
      const at = rowOf('search:');
      if (at < 0) {
        return hidden
          ? null
          : 'Parent has no query row, but the cursor is visible';
      }
      if (hidden) return 'the query row is on screen but carries no cursor';
      if (y !== at) return `cursor row ${y}, wanted ${at} (the query row)`;
      // One past `search: `, which is the cell the `▌` used to occupy.
      const row = lines[at] ?? '';
      const want = row.indexOf('search: ') + 'search: '.length;
      return x === want ? null : `cursor column ${x}, wanted ${want}`;
    },
  },
  {
    label: 'back up to Description brings it back',
    send: KEY.up,
    screen: [lit('▸ Description:')],
    expect: ({ hidden }) => (hidden ? 'the cursor is hidden' : null),
  },
  {
    // THE SECOND BLOCKER THE DECISION DOC RECORDED, driven: `TextareaRenderable`
    // "publishes no source-offset mapping, which is what makes the caret land on
    // the right cell of a wrapped line". Typed here, on a real terminal.
    //
    // Into DESCRIPTION, which is still empty — Title already holds `abcdef` from
    // the steps above, and appending to it would shift every wrap boundary this
    // step hand-derives.
    label: 'a description longer than the popup wraps, cursor on row TWO',
    send: LONG,
    screen: [lit(LONG_ROW_0), lit(LONG_ROW_1)],
    timeoutMs: 15000,
    expect: ({ hidden, x, y, rowOf, lines }) => {
      if (hidden) return 'the cursor is hidden';
      const at = rowOf('\u25b8 Description:');
      const second = lines[at + 2] ?? '';
      const col = second.indexOf(LONG_ROW_1);
      if (col < 0) return `row two is not the wrapped tail: ${second}`;
      if (y !== at + 2) return `cursor row ${y}, wanted ${at + 2}`;
      const want = col + LONG_ROW_1.length;
      return x === want ? null : `cursor column ${x}, wanted ${want}`;
    },
  },
  {
    // Twenty \u2190 from the end of the value: nineteen reach the start of row
    // two and the twentieth reaches the END of row one, the cell the soft
    // break's eaten space would have occupied. The cursor must jump a row UP —
    // which is the whole of "the offset is mapped onto the WRAPPED rows", and
    // the case the decision doc said the widget could not do.
    label: 'twenty \u2190 walk the insertion point onto the FIRST wrapped row',
    send: KEY.left,
    repeat: LONG_ROW_1.length + 1,
    expect: ({ hidden, x, y, rowOf, lines }) => {
      if (hidden) return 'the cursor is hidden';
      const at = rowOf('\u25b8 Description:');
      const first = lines[at + 1] ?? '';
      const col = first.indexOf(LONG_ROW_0);
      if (col < 0) return `row one is not the wrapped head: ${first}`;
      if (y !== at + 1) return `cursor row ${y}, wanted ${at + 1} (row ONE)`;
      const want = col + LONG_ROW_0.length;
      return x === want ? null : `cursor column ${x}, wanted ${want}`;
    },
  },
  {
    // SURVIVES REDRAWS. \u2192 then \u2190 is two more frames that both move the
    // cursor and put it back, so a cursor that is only correct in the frame its
    // own keystroke produced cannot pass this: the value is untouched and the
    // cell has to be the one the previous step measured.
    label: 'the cursor survives two more redraws and returns to the same cell',
    send: '\u001b[C\u001b[D',
    expect: ({ hidden, x, y, rowOf, lines }) => {
      if (hidden) return 'the cursor is hidden after the redraws';
      const at = rowOf('\u25b8 Description:');
      const first = lines[at + 1] ?? '';
      const col = first.indexOf(LONG_ROW_0);
      if (col < 0) return `row one changed: ${first}`;
      if (y !== at + 1) return `cursor row ${y}, wanted ${at + 1}`;
      const want = col + LONG_ROW_0.length;
      return x === want ? null : `cursor column ${x}, wanted ${want}`;
    },
  },
  {
    label: 'Esc closes the popup and takes the cursor with it',
    send: KEY.esc,
    screen: [lit('[Dashboard]')],
    expect: ({ hidden }) => (hidden ? null : 'the cursor is still visible'),
  },
  { label: 'quit', send: 'q', settleMs: 500 },
];

// ---------------------------------------------------------------------------

const SUBMIT_BYTES = [
  ['Ctrl+S', ''],
  ['Ctrl+D', ''],
];
for (const step of STEPS) {
  for (const [name, byte] of SUBMIT_BYTES) {
    if (String(step.send ?? '').includes(byte)) {
      throw new Error(
        `refusing to run: step '${step.label}' sends ${name}, which submits the ` +
          'New-ticket form and would write a real ticket.',
      );
    }
  }
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

function parseArgs(argv) {
  const options = {
    project: 'bakers',
    cols: DEFAULT_COLS,
    rows: DEFAULT_ROWS,
    bootTimeout: DEFAULT_BOOT_TIMEOUT_MS,
    out: undefined,
  };
  const NUMERIC = {
    '--cols': 'cols',
    '--rows': 'rows',
    '--boot-timeout': 'bootTimeout',
  };
  const STRINGS = { '--project': 'project', '--out': 'out' };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (NUMERIC[flag] !== undefined) {
      options[NUMERIC[flag]] = Number(value);
      i += 1;
    } else if (STRINGS[flag] !== undefined) {
      options[STRINGS[flag]] = value;
      i += 1;
    }
  }
  return options;
}

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
  const args = ['ui', '--project', options.project];
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

  const lines = () => {
    const buffer = terminal.buffer.active;
    const out = [];
    for (let y = 0; y < terminal.rows; y += 1) {
      out.push(
        (buffer.getLine(y)?.translateToString(true) ?? '').replace(/\s+$/, ''),
      );
    }
    return out;
  };

  /**
   * The terminal's own cursor state.
   *
   * `cursorY` is relative to the buffer's viewport base, which is what a
   * full-screen application's rows are; `isCursorHidden` is the private-mode
   * flag `?25l`/`?25h` set. Both 0-based/boolean as the terminal holds them —
   * no translation, so nothing here can be off by one on its own.
   */
  const cursor = () => {
    const buffer = terminal.buffer.active;
    return {
      x: buffer.cursorX,
      y: buffer.cursorY,
      hidden: Boolean(terminal._core?.coreService?.isCursorHidden),
    };
  };

  const state = () => {
    const rendered = lines();
    return {
      ...cursor(),
      lines: rendered,
      rowOf: (needle) => rendered.findIndex((row) => row.includes(needle)),
    };
  };

  const waitForScreen = async (patterns, timeoutMs) => {
    const regexes = patterns.map((pattern) => new RegExp(pattern));
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const text = lines().join('\n');
      if (regexes.every((regex) => regex.test(text))) return true;
      if (Date.now() > deadline) return false;
      await sleep(POLL_MS);
    }
  };

  /** Wait until the cursor predicate is satisfied, or report its last reason. */
  const waitForCursor = async (predicate, timeoutMs) => {
    const deadline = Date.now() + timeoutMs;
    let reason = 'never evaluated';
    for (;;) {
      reason = predicate(state());
      if (reason === null) return null;
      if (Date.now() > deadline) return reason;
      await sleep(POLL_MS);
    }
  };

  const t0 = performance.now();
  const since = () => performance.now() - t0;
  const report = [];
  const say = (line = '') => report.push(line);

  say('# BB-326 — the terminal CURSOR, verified on a real pty');
  say('#');
  say("# The assertion target is the terminal's own cursor state as");
  say('# @xterm/headless reconstructs it from the pty byte stream:');
  say('# buffer.active.cursorX/cursorY and coreService.isCursorHidden. The');
  say("# cockpit's insertion point is no longer a character, so the screen");
  say('# verifier is structurally blind to it.');
  say('#');
  say(`# command:  ${BB_BIN} ${args.join(' ')}`);
  say(`# geometry: ${options.cols}x${options.rows}`);
  say(`# commit:   ${commitSha()}`);
  say(`# date:     ${new Date().toISOString()}`);
  say();

  let ok = 0;
  let failed = 0;

  const booted = await waitForScreen(BOOT, options.bootTimeout);
  say(
    `[${String(Math.round(since())).padStart(6)} ms] ${booted ? 'ok   ' : 'FAIL '}boot — the dashboard is on screen`,
  );
  if (!booted) failed += 1;

  if (booted) {
    for (const step of STEPS) {
      const timeoutMs = step.timeoutMs ?? DEFAULT_STEP_TIMEOUT_MS;
      const repeat = step.repeat ?? 1;
      for (let i = 0; i < repeat; i += 1) {
        if (step.send) child.write(step.send);
        if (repeat > 1) await sleep(60);
      }
      if (step.settleMs) await sleep(step.settleMs);

      let problem = null;
      if (step.screen) {
        const seen = await waitForScreen(step.screen, timeoutMs);
        if (!seen) problem = `screen never showed ${step.screen.join(' + ')}`;
      }
      if (problem === null && step.expect) {
        problem = await waitForCursor(step.expect, timeoutMs);
      }
      const now = state();
      const where = `cursor ${now.hidden ? 'HIDDEN' : `at (row ${now.y}, col ${now.x})`}`;
      if (problem === null) {
        ok += 1;
        say(
          `[${String(Math.round(since())).padStart(6)} ms] ok    ${step.label} — ${where}`,
        );
      } else {
        failed += 1;
        say(
          `[${String(Math.round(since())).padStart(6)} ms] FAIL  ${step.label} — ${problem} (${where})`,
        );
      }
      // A repeatEveryMs step nudges until its screen appears; the loop above
      // already waited, so nothing more is needed here.
    }
  }

  const deadline = Date.now() + EXIT_GRACE_MS;
  while (exited === null && Date.now() < deadline) await sleep(POLL_MS);
  if (exited === null) {
    child.kill();
    say(`[${String(Math.round(since())).padStart(6)} ms] FAIL exit — killed`);
    failed += 1;
  } else {
    say(
      `[${String(Math.round(since())).padStart(6)} ms] ok   exit — code ${exited.exitCode}, signal ${exited.signal}`,
    );
  }

  say(`## steps: ${ok} ok, ${failed} FAIL`);
  say(
    failed === 0
      ? '## RESULT: OK — the terminal cursor is where the insertion point is'
      : `## RESULT: FAIL — ${failed} expectation(s) unmet`,
  );

  const text = `${report.join('\n')}\n`;
  process.stdout.write(text);
  if (options.out) {
    const target = resolve(process.cwd(), options.out);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, text, 'utf8');
  }
  process.exit(failed === 0 ? 0 : 1);
}

await main();
