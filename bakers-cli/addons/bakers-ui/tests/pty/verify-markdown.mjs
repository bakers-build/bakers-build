#!/usr/bin/env node
// BB-372 V6 — does a REAL ticket detail, on a REAL pty, against the REAL
// control plane, draw its `bb_rich` bodies as Markdown?
//
// WHY THIS EXISTS AS A SEPARATE DRIVER
//
//   `verify-colors.mjs` owns the cockpit's SGR vocabulary but walks a project
//   ticket list, not a ticket detail. So it cannot observe the one
//   code this ticket adds to the wire (`ESC[3m`, italic — D7/R3): its `ALLOWED`
//   map gains the entry, and this driver is what actually makes the renderer
//   emit it and then reads the bytes back.
//
//   The Bun suite (`tests-bun/Kernel/ticket-detail-markdown.test.ts`) asserts the
//   same attributes on a real renderer in process. What it cannot do is prove
//   that the attribute survives the trip to a terminal, or that a LIVE ticket
//   body — written by a human, not by a fixture — renders. That is this file.
//
// WHAT IT ASSERTS
//
//   M1  the ticket detail booted — its identifier and the `[Overview]` active-tab
//       marker are on screen (NOT `Description`, which is below the fold on a
//       ticket with a long `Links` section — see the predicate);
//   M2  no row of the reconstructed screen carries a RAW Markdown marker
//       (`**`, a backtick, `- [ ]`, `~~`, a leading `#`) — the defect itself —
//       EXCEPT where the marker is the CONTENT OF A CODE SPAN, which the D2
//       invariant preserves character for character on purpose.
//
//       That exception used to key off palette cyan (slot 6). BB-375 dropped
//       cyan: code spans use BORDER, which shares slot 245 with ordinary
//       FOREGROUND, so colour can no longer tell code content from a missed
//       marker. M2 therefore only flags structural leftovers (`- [ ]`, `~~`,
//       leading `# `) and treats `` ` `` / `**` as advisory — they are too
//       common inside rendered code on live tickets to judge without a distinct
//       accent slot.
//
//       THIS CHECK ALREADY EARNED ITS KEEP. Its first run found a raw backtick on
//       the most-read row of the Comments tab — a collapsed header whose preview
//       is that comment's ATX first line (D8) — because a heading's content was
//       not being inline-rendered. `lib/markdown.ts` now runs the inline rules
//       inside a heading too; the comment there records the measurement.
//   M3  the rendered glyphs the subset inserts are present (`•`/`☐`/`☑`/`│`);
//   M4  `ESC[3m` on the wire, REPORTED rather than required: whether an italic
//       run appears depends on whether the ticket's own author wrote `*em*`, which
//       is not this driver's to arrange. That `@opentui/core@0.5.1` emits exactly
//       `ESC[3m` for the ITALIC bit — and terminates the run with `ESC[0m` rather
//       than an explicit `23` — was measured directly under a pty; see the note
//       beside `ALLOWED` in `verify-colors.mjs`.
//   M5  every SGR the run emitted onto a GLYPH is inside `verify-colors.mjs`'s
//       vocabulary plus italic — i.e. the widening is exactly one code.
//
//   The walk: open the ticket, where the `Latest summary` and `Description`
//   entries BOTH arrive expanded — Overview lists both since BB-369 D3/D4, both
//   are `bb_rich` bodies, and the Overview seed opens both with no keypress, so
//   the walk asserts them and round-trips the toggle rather than pressing Enter to
//   reveal them — switch to the Comments tab (which expands its newest
//   comment by itself), then expand every remaining comment in turn and read each
//   one past the fold — a marker below the fold is a marker. All three of the
//   screen's `bb_rich` bodies are therefore under M2 and M3.
//
// USAGE
//
//   cd bakers-cli/addons/bakers-ui/tests/pty && npm install   # once: native deps
//   node verify-markdown.mjs --ticket BB-372
//   node verify-markdown.mjs --out ../../../../../assets-ai/BB-nnn/node/pty-markdown.txt
//
//   --ticket <id>      the ticket to open (default BB-372)
//   --cols/--rows <n>  the pty geometry (default 120x40)
//   --out <file>       write the transcript here as well as to stdout
//
//   Exit code: 0 on `RESULT: OK`, 1 otherwise.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import xtermHeadless from '@xterm/headless';
import { spawn } from 'node-pty';
import { KEY } from './key-script.mjs';

// `@xterm/headless` is CommonJS and exposes `Terminal` on the default export
// only; a named import of it is `undefined` at runtime, not a build error.
const { Terminal } = xtermHeadless;

const HERE = dirname(fileURLToPath(import.meta.url));
/** `<repo>` — this file sits at `<repo>/bakers-cli/addons/bakers-ui/tests/pty`. */
const REPO_ROOT = resolve(HERE, '../../../../..');
const BB_BIN = resolve(REPO_ROOT, 'bakers-cli/bin/bakers');

const DEFAULT_COLS = 120;
const DEFAULT_ROWS = 40;
const BOOT_TIMEOUT_MS = 30000;
const STEP_TIMEOUT_MS = 10000;
const POLL_MS = 50;
const EXIT_GRACE_MS = 8000;

/**
 * The wire vocabulary, copied from `verify-colors.mjs` and widened by ONE.
 *
 * Kept as a copy rather than imported because that file exports nothing: the two
 * drivers assert the same closed set from different surfaces, and a divergence
 * between them is itself a finding. `3` is this ticket's addition — see D7/R3 and
 * the note beside `ALLOWED` in `verify-colors.mjs`.
 *
 * `23` (italic off) is deliberately ABSENT, and that is measured rather than
 * assumed: `@opentui/core@0.5.1` terminates a styled run with `ESC[0m` and never
 * writes an explicit attribute-off, so an entry for it would permit a code the
 * renderer cannot emit.
 */
const ALLOWED = new Map([
  ['0', 'reset'],
  ['1', 'bold'],
  ['2', 'dim'],
  ['3', 'italic — emphasis in a rendered Markdown body (BB-372 D7)'],
  ['7', 'inverse on — the TERMINAL swaps its own two colours'],
  ['27', 'inverse off'],
  ['39', 'default foreground — the operator’s theme decides'],
  ['49', 'default background — the operator’s theme decides'],
  // BB-375 — cyan 6/14 gone; same closed set as verify-colors.mjs.
  ['38;5;15', 'foreground active (full white)'],
  ['38;5;245', 'foreground / border'],
  ['38;5;231', 'foreground highlight / border emphasis'],
  ['48;5;237', 'background active'],
]);

/**
 * Structural markers that must NOT reach a cell (M2 hard fail).
 * `` ` `` / `**` are advisory only after BB-375 — see header comment.
 */
const RAW_MARKERS_HARD = [
  ['a task marker', /- \[[ xX]\]/],
  ['~~', /~~/],
];
const RAW_MARKERS_ADVISORY = [
  ['**', /\*\*/],
  ['a backtick', /`/],
];

/** Glyphs the subset INSERTS — at least one must be on screen. */
const RENDERED_GLYPHS = ['•', '☐', '☑', '│', '────────'];

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

function parseArgs(argv) {
  const read = (flag, fallback) => {
    const at = argv.indexOf(flag);
    return at === -1 ? fallback : argv[at + 1];
  };
  return {
    ticket: read('--ticket', 'BB-372'),
    out: read('--out', undefined),
    cols: Number(read('--cols', DEFAULT_COLS)),
    rows: Number(read('--rows', DEFAULT_ROWS)),
  };
}

/**
 * Count every `ESC[<params>m`, split by whether it styles a GLYPH or nothing.
 *
 * The same walk `verify-colors.mjs` performs, and for the same reason: a colour
 * is only a colour where there is ink, and `@opentui/core@0.5.1`'s cleared buffer
 * paints cells no renderable covers with a hardcoded truecolor foreground. That
 * deviation is real, named there, and lands only on blank cells.
 */
function countSgr(text) {
  const onGlyph = new Map();
  const onBlank = new Map();
  // biome-ignore lint/suspicious/noControlCharactersInRegex: reading the SGR escapes out of the pty stream is this file's entire job.
  const sgr = /\x1b\[([0-9;]*)m/g;
  let group = [];
  let groupEnd = -1;
  const charge = (run) => {
    if (group.length === 0) return;
    const bucket = run.trim() === '' ? onBlank : onGlyph;
    for (const code of group) bucket.set(code, (bucket.get(code) ?? 0) + 1);
    group = [];
  };
  const runFrom = (from) => {
    const next = text.indexOf('\x1b', from);
    return text.slice(from, next === -1 ? text.length : next);
  };
  for (let match = sgr.exec(text); match !== null; match = sgr.exec(text)) {
    if (group.length > 0 && match.index !== groupEnd) charge(runFrom(groupEnd));
    group.push(match[1] === '' ? '0' : match[1]);
    groupEnd = match.index + match[0].length;
  }
  charge(groupEnd === -1 ? '' : runFrom(groupEnd));
  const total = new Map(onGlyph);
  for (const [code, n] of onBlank) total.set(code, (total.get(code) ?? 0) + n);
  return {
    onGlyph,
    onBlank,
    all: [...total.entries()].sort(
      (a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1),
    ),
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const lines = [];
  const say = (line = '') => lines.push(line);

  say('# BB-372 — a real ticket detail on a real pty: is the body Markdown?');
  say('#');
  say('# `verify-colors.mjs` walks a ticket list — never a ticket DETAIL —');
  say('# so it cannot observe the');
  say(
    '# one code this ticket puts on the wire. This driver makes the renderer',
  );
  say('# emit it and reads the bytes back.');
  say('#');
  say(`# cwd:      ${REPO_ROOT}`);
  say(`# ticket:   ${options.ticket}`);
  say(`# pty:      ${options.cols}x${options.rows}, TERM=xterm-256color`);
  say(`# started:  ${new Date().toISOString()}`);
  say('');

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
    // The logger's own colours are not the renderer's — see verify-colors.mjs.
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

  const screenText = () => screenRows().map((row) => row.text);

  /** Every row of the reconstructed screen as TEXT (BB-375: no cyan code mask). */
  const screenRows = () => {
    const buffer = terminal.buffer.active;
    const out = [];
    for (let y = 0; y < terminal.rows; y += 1) {
      const line = buffer.getLine(y);
      const text = (line?.translateToString(true) ?? '').replace(/\s+$/, '');
      out.push({ text });
    }
    return out;
  };

  const waitForScreen = async (patterns, timeoutMs) => {
    const regexes = patterns.map((pattern) => new RegExp(pattern));
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const text = screenText().join('\n');
      if (regexes.every((regex) => regex.test(text))) return true;
      if (Date.now() > deadline) return false;
      await sleep(POLL_MS);
    }
  };

  // THE IDENTIFIER AND THE FOREGROUND_ACTIVE-TAB MARKER, not `Description`.
  //
  // `Description` was the second half of this predicate, and it is a property of
  // the FOLD rather than of the boot: the Overview tab lists `Parent`, `Links`,
  // `Latest summary` and only then `Description`, so on a ticket with a long
  // `Links` section the `Description` caret row starts BELOW the visible rows and
  // the predicate never matches — measured on BB-369, whose 30-odd evidence
  // links push it off a 40-row pty. That reported `M1 the ticket detail never
  // drew` about a screen that had drawn perfectly, i.e. a FALSE FAILURE on correct
  // output, which is the one kind of result a verifier must not produce.
  //
  // `[Overview]` is the bracketed FOREGROUND_ACTIVE tab marker, which only the ticket detail
  // draws, and the identifier pins WHICH ticket — together they say "the detail of
  // this ticket is on screen" without depending on how tall any section above the
  // fold happens to be. That the body rendered is what M2/M3 answer, and they read
  // every screen of the walk rather than only the first.
  const booted = await waitForScreen(
    [options.ticket, '\\[Overview\\]'],
    BOOT_TIMEOUT_MS,
  );

  /** Every screen the walk passed through, so a marker anywhere is caught. */
  const seen = [];
  const capture = (label) => {
    const rows = screenRows();
    seen.push({ label, rows });
    return rows;
  };

  const steps = [];
  if (booted) {
    capture('the ticket detail as it opens (both entries already expanded)');
    // BOTH ENTRIES ARRIVE EXPANDED. The overview seed opens `Latest summary`
    // and `Description` with no keypress, so this driver no longer presses
    // Enter to reveal them — it asserts they are there, then round-trips the
    // toggle so the collapse path stays walked. Pressing Enter first, as this
    // driver used to, would COLLAPSE the summary and the wait would time out on
    // a screen the walk had genuinely reached.
    steps.push([
      'Latest summary and Description arrive expanded',
      await waitForScreen(
        ['▾ Latest summary', '▾ Description'],
        STEP_TIMEOUT_MS,
      ),
    ]);
    capture(
      'Latest summary and Description expanded (rendered bb_rich bodies)',
    );
    // Entry 0 is the summary: collapse it, then expand it again.
    child.write('\r');
    steps.push([
      'collapse Latest summary',
      await waitForScreen(['▸ Latest summary'], STEP_TIMEOUT_MS),
    ]);
    child.write('\r');
    steps.push([
      'expand Latest summary again',
      await waitForScreen(['▾ Latest summary'], STEP_TIMEOUT_MS),
    ]);
    capture('Latest summary re-expanded');
    // Tab to the Comments tab. It expands its newest comment by itself
    // (`initialExpandedComments`).
    //
    // WAITED FOR ON THE FOREGROUND_ACTIVE TAB MARKER, not on a caret: `▾` was already on
    // screen from the step above, so a caret predicate passed while the tab had
    // not switched at all and this driver reported a walk it never made.
    child.write('\t');
    steps.push([
      'switch to the Comments tab',
      await waitForScreen(['\\[Comments\\]'], STEP_TIMEOUT_MS),
    ]);
    capture('the Comments tab, newest comment expanded');
    // Expand EVERY comment, one at a time. On this tab `↑↓` selects an entry and
    // `Enter` toggles it, so walking down and expanding is what puts the whole
    // handoff corpus on screen — and bakers.build handoff comments are the Markdown this
    // ticket exists for. It is also the only way to reach an ITALIC run: emphasis
    // lives in the older comments, not in the newest one the tab opens with.
    for (let entry = 0; entry < 8; entry += 1) {
      child.write('\r');
      await sleep(200);
      capture(`the Comments tab, entry ${entry} expanded`);
      // Read the whole of it before moving on: an expanded handoff is longer than
      // a screen, and a marker below the fold is a marker.
      for (let page = 0; page < 8; page += 1) {
        child.write(KEY.down.repeat(4));
        await sleep(120);
        capture(
          `the Comments tab, entry ${entry}, ${(page + 1) * 4} rows down`,
        );
      }
    }
  }

  child.write('q');
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
  // The verdict
  // -------------------------------------------------------------------------

  let failures = 0;
  let deviations = 0;

  say(`   command:  ${BB_BIN} ${args.join(' ')}`);
  say(
    `   booted:   ${booted ? 'yes' : 'NO'} · exit ${
      exited === null ? 'killed' : exited.exitCode
    } · ${raw.length} bytes`,
  );
  for (const [label, ok] of steps) {
    say(`   ${ok ? 'ok   ' : 'FAIL '} walk step: ${label}`);
    if (!ok) failures += 1;
  }
  if (!booted) {
    failures += 1;
    say('   FAIL  M1 the ticket detail never drew — nothing below is a result');
  } else {
    say('   ok    M1 the ticket detail drew, [Overview] on screen');
  }
  say('');

  for (const { label, rows } of seen) {
    say(`## screen: ${label}`);
    for (const { text } of rows) if (text !== '') say(`   │${text}`);
    say('');
  }

  say('   M2 — no structural RAW Markdown marker on any row of any screen');
  say(
    '        (`**` / backticks advisory only — BB-375, no distinct code slot):',
  );
  for (const [name, pattern] of RAW_MARKERS_HARD) {
    const missed = [];
    for (const { label, rows } of seen) {
      for (const { text } of rows) {
        if (pattern.test(text)) missed.push(`${label}: ${text.trim()}`);
      }
    }
    if (missed.length > 0) failures += 1;
    say(
      `   ${missed.length === 0 ? 'ok   ' : 'FAIL '} ${String(missed.length).padStart(4)} missed   ${name}`,
    );
    for (const hit of missed.slice(0, 6)) say(`         MISSED  ${hit}`);
  }
  for (const [name, pattern] of RAW_MARKERS_ADVISORY) {
    const hits = [];
    for (const { label, rows } of seen) {
      for (const { text } of rows) {
        if (pattern.test(text)) hits.push(`${label}: ${text.trim()}`);
      }
    }
    say(
      `   note  ${String(hits.length).padStart(4)} hits (advisory)   ${name}`,
    );
    for (const hit of [...new Set(hits)].slice(0, 3)) {
      say(`         hit ${hit}`);
    }
  }
  // A leading `#` is judged apart: a run number (`#4599`) legitimately opens a
  // columned row, so only `# ` at the start of a row is an unrendered heading.
  const headings = seen.flatMap(({ label, rows }) =>
    rows
      .filter(({ text }) => /^\s*#{1,6}\s/.test(text))
      .map(({ text }) => `${label}: ${text.trim()}`),
  );
  if (headings.length > 0) failures += 1;
  say(
    `   ${headings.length === 0 ? 'ok   ' : 'FAIL '} ${String(headings.length).padStart(4)}  an unrendered ATX heading`,
  );
  for (const hit of headings.slice(0, 5)) say(`         ${hit}`);
  say('');

  say('   M3 — the glyphs the subset INSERTS, on real cells:');
  const joined = seen
    .map(({ rows }) => rows.map(({ text }) => text).join('\n'))
    .join('\n');
  const present = RENDERED_GLYPHS.filter((glyph) => joined.includes(glyph));
  if (present.length === 0) {
    failures += 1;
    say('   FAIL  none of • ☐ ☑ │ ──────── is on screen — nothing rendered');
  } else {
    say(`   ok    present: ${present.join(' ')}`);
  }
  say('');

  const { onGlyph, onBlank, all } = countSgr(raw);

  say('   M4 — italic (ESC[3m) really is on the wire:');
  const italic = (onGlyph.get('3') ?? 0) + (onBlank.get('3') ?? 0);
  if (italic === 0) {
    say(
      '   note      0  ESC[3m — no row on screen carried an italic run, which',
    );
    say(
      '                 depends on whether this ticket`s author wrote *em* and',
    );
    say(
      '                 is not this driver`s to arrange. The code IS what the',
    );
    say('                 renderer emits for the ITALIC bit (measured under a');
    say('                 pty), and the attribute itself is asserted in');
    say('                 tests-bun/Kernel/ticket-detail-markdown.test.ts.');
  } else {
    say(`   ok    ${String(italic).padStart(6)}  ESC[3m reached the terminal`);
  }
  say('');

  say('   M5 — the SGR vocabulary emitted   (on a glyph / on blank cells):');
  for (const [code, n] of all) {
    const glyph = onGlyph.get(code) ?? 0;
    const blank = onBlank.get(code) ?? 0;
    const allowed = ALLOWED.get(code);
    let verdict;
    if (allowed) verdict = 'ok   ';
    else if (glyph > 0) {
      verdict = 'FAIL ';
      failures += 1;
    } else {
      verdict = 'known';
      deviations += 1;
    }
    say(
      `   ${verdict} ${String(n).padStart(6)}  (${String(glyph).padStart(6)} / ${String(
        blank,
      ).padStart(6)})  ESC[${code}m  — ${
        allowed ??
        'not part of the cockpit’s styling vocabulary; on blank cells only ⇒ @opentui/core’s cleared buffer'
      }`,
    );
  }
  say('');
  say(
    `## RESULT: ${
      failures > 0
        ? `FAILED — ${failures} violation(s)`
        : `OK${deviations > 0 ? ` with ${deviations} known deviation(s)` : ''}`
    }`,
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
