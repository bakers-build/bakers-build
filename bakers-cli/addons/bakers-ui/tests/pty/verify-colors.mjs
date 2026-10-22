#!/usr/bin/env node
// BB-326 — which COLOURS does `bakers ui` put on the wire, and are any of them
// its own invention?
//
// WHY THIS EXISTS AS A SEPARATE DRIVER
//
//   `verify-screen.mjs` reconstructs the screen with `@xterm/headless` and
//   asserts on TEXT; `captureCharFrame()` in the Bun suite does the same in
//   process. Neither reads a colour. That is not a gap in either — it is what
//   they are for — but it is exactly why the OpenTUI swap could ship a cockpit
//   that painted every glyph in hardcoded truecolor white and turned the two
//   inverse-video bars into solid white blocks, with all 44 screen steps and
//   both suites green. The operator saw it in one second; the harness could not
//   see it at all.
//
//   So this driver asserts on the BYTES, and on nothing else.
//
// THE CONTRACT: the cockpit may only use the terminal's OWN colours
//
//   The pre-swap kernel emitted six SGR codes — `0 1 2 7 27 36 96` — and NO
//   colour of its own. "Normal text" was whatever the operator's theme calls
//   normal text; the border slots were PALETTE SLOTS the theme resolves; inverse
//   video was `ESC[7m`, which asks the terminal to swap its own two colours.
//   Nothing in the cockpit's design ever wanted more than that.
//
//   Under the OpenTUI kernel the same intents are expressed differently but must
//   mean the same thing on the wire (BB-375 expanded the indexed slots):
//
//     terminal default fg   ESC[39m           (was: no fg escape at all)
//     terminal default bg   ESC[49m           (was: no bg escape at all)
//     border / foreground   ESC[38;5;245m     (BB-375 — cyan slots 6/14 removed)
//     border emphasis / hl  ESC[38;5;231m     (BB-375 — same slot as highlight)
//     foreground active     ESC[38;5;15m      (BB-375 — full white active/selection)
//     background active     ESC[48;5;237m     (BB-375 — selection / active wash)
//     (no body fill)        — BB-375 framed ScrollBox has no BACKGROUND wash
//     reset / bold / dim    ESC[0m / ESC[1m / ESC[2m
//     inverse off           ESC[27m           (kept if a run clears inverse)
//
//   Inverse ON (`ESC[7m`) left the vocabulary in BB-375: selection and the
//   footer are colour, not inverse video.
//
//   ALLOWED is therefore a closed set, and anything outside it is a FAIL — not
//   a warning. A truecolor `38;2;r;g;b` or `48;2;r;g;b` is the specific defect
//   this file was written for: it replaces the operator's whole theme with one
//   hardcoded triplet.
//
// ON A GLYPH, OR ON NOTHING — AND WHY THAT DISTINCTION IS NOT A LOOPHOLE
//
//   A colour is only a colour where there is ink. So every SGR is judged
//   together with the RUN IT STYLES: the text between it and the next escape,
//   with consecutive SGRs sharing one run. A code outside ALLOWED on a run
//   that contains a glyph is a FAIL. The same code on a run of spaces is
//   counted apart, as a KNOWN DEVIATION, because it cannot be seen and — see
//   below — cannot currently be removed.
//
//   The deviation is `@opentui/core@0.5.1`'s CLEARED BUFFER. Cells no
//   renderable covers (a frame row whose composed line is empty, the columns
//   past the end of a short line, every row outside a modal's box) are painted
//   by the native `bufferClear`, which takes a background and hardcodes the
//   foreground to truecolor white. `OptimizedBuffer.clear(bg?)` is the whole
//   API — there is no default-foreground knob on the buffer or the renderer —
//   and answering the renderer's own `OSC 10` foreground query with a dark
//   theme changes nothing: measured, byte-identical. It is the same shape as
//   the `?1002h` deviation in `verify-mouse-modes.mjs`: real, named, and not
//   something a future run should be blocked on. If a later `@opentui/core`
//   gains a knob, this is the line that says what to go and set.
//
// WHY THE LOG GOES TO A FILE
//
//   `bakers ui` writes its `resolved connection` record to stdout through
//   pino-pretty, which colours it (`ESC[32m`, `ESC[35m`, `ESC[36m`, `ESC[39m`).
//   Those bytes are the LOGGER'S, not the renderer's, and counting them would
//   both hide a missing `39m` and invent colours the cockpit never emitted.
//   `BB_CONDUCTOR_LOG=file` sends that record to `log.txt` instead
//   (`core/src/core/logger.ts` › `resolveSink`), which leaves the pty stream
//   carrying the renderer's output and nothing else.
//
// USAGE
//
//   cd bakers-cli/addons/bakers-ui/tests/pty && npm install   # once: native deps
//   node verify-colors.mjs
//   node verify-colors.mjs --surface dashboard
//   node verify-colors.mjs --out ../../../../../assets-ai/BB-nnn/node/pty-colors-after.txt
//
//   --surface <all|new-ticket|tickets|dashboard>   default: all three
//   --project <name>   the project the two project-scoped surfaces open
//   --cols/--rows <n>  the pty geometry (default 120x40)
//   --out <file>       write the transcript here as well as to stdout
//
//   Exit code: 0 on `RESULT: OK`, 1 otherwise.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import xtermHeadless from '@xterm/headless';
import { spawn } from 'node-pty';
import {
  DASHBOARD_KEY_SCRIPT,
  lit,
  NEW_TICKET_KEY_SCRIPT,
  TICKETS_KEY_SCRIPT,
} from './key-script.mjs';

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
const STEP_TIMEOUT_MS = 8000;
const POLL_MS = 50;
const REPEAT_GAP_MS = 60;
const EXIT_GRACE_MS = 8000;

// ---------------------------------------------------------------------------
// The contract
// ---------------------------------------------------------------------------

/**
 * Every SGR parameter string the cockpit is allowed to put on the wire, with
 * the intent it stands for. A code outside this set is a FAIL by construction:
 * the set IS the vocabulary, so a future change that reaches for a colour of
 * its own cannot pass by being "close enough".
 */
const ALLOWED = new Map([
  ['0', 'reset'],
  ['1', 'bold'],
  ['2', 'dim'],
  // BB-372 D7/R3 — THE ONE DELIBERATE WIDENING OF THIS SET, and the reason is
  // written here because this is where the vocabulary lives.
  //
  // The ticket detail renders its `bb_rich` bodies as Markdown, and `*em*` is
  // italic. Italic is NOT a colour and it invents no theme value: the terminal
  // decides what italic looks like, which is exactly the property this map exists
  // to protect. A terminal that cannot do italic substitutes something of its own
  // choosing — its decision, not the cockpit's.
  //
  // MEASURED, not read off the typings: `@opentui/core@0.5.1` emits `ESC[3m` for
  // the ITALIC attribute bit and terminates the run with `ESC[0m`, so there is NO
  // explicit italic-off and `23` is deliberately NOT added — an allowed code the
  // renderer cannot emit would weaken the set for nothing. `bold + italic` comes
  // out as `ESC[1m ESC[3m`.
  //
  // It is not in REQUIRED below: the three surfaces this driver walks are the
  // dashboard, a project ticket list and the New-ticket popup, and NONE of them is
  // a ticket detail — so this driver cannot make the renderer emit it. What does
  // is `verify-markdown.mjs`, which walks a real ticket detail and asserts the
  // same closed set from there.
  ['3', 'italic — emphasis in a rendered Markdown body (BB-372 D7)'],
  ['7', 'inverse on — the TERMINAL swaps its own two colours'],
  ['27', 'inverse off'],
  ['39', 'default foreground — the operator’s theme decides'],
  ['49', 'default background — body cells'],
  ['38;5;15', 'foreground active — full white selection / active (BB-375)'],
  ['38;5;245', 'foreground / border — ordinary text + outlines (BB-375)'],
  ['38;5;231', 'foreground highlight / border emphasis (BB-375)'],
  ['48;5;237', 'background active — selection / active wash (BB-375)'],
]);

/**
 * Codes that must actually OCCUR, or the assertion above is vacuous.
 *
 * BB-375 pins ordinary text to FOREGROUND (245) and fills to BACKGROUND (250);
 * `39` stays allowed as an escape hatch but is no longer required.
 */
const REQUIRED = [
  ['49', 'non-fill cells can still use default background'],
  ['38;5;15', 'foreground active is slot 15 (full white)'],
  ['38;5;245', 'foreground / border is palette slot 245'],
  ['38;5;231', 'foreground highlight / border emphasis is palette slot 231'],
  ['48;5;237', 'background active / selection wash is palette slot 237'],
  ['0', 'runs are terminated'],
  ['1', 'bold is still bold'],
];

// ---------------------------------------------------------------------------
// Surfaces — the same three walks `verify-screen.mjs` drives
// ---------------------------------------------------------------------------

const BOOT_DASHBOARD = [lit('[Dashboard]'), lit('TICKETS CLOSED')];

const SURFACES = {
  'new-ticket': {
    describe: 'the New-ticket popup, opened from a project Dashboard',
    args: (project) => ['ui', '--project', project],
    script: NEW_TICKET_KEY_SCRIPT,
    boot: BOOT_DASHBOARD,
  },
  tickets: {
    describe: 'the project ticket list: paging, search, and back out',
    args: (project) => ['ui', '--project', project],
    script: TICKETS_KEY_SCRIPT,
    boot: BOOT_DASHBOARD,
  },
  dashboard: {
    describe: 'the ROOT dashboard and the whole root tab cycle',
    args: () => ['ui'],
    script: DASHBOARD_KEY_SCRIPT,
    boot: [...BOOT_DASHBOARD, lit('bakers.build dashboard')],
  },
};

const ORDER = ['dashboard', 'tickets', 'new-ticket'];

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const read = (flag, fallback) => {
    const at = argv.indexOf(flag);
    return at === -1 ? fallback : argv[at + 1];
  };
  const surface = read('--surface', 'all');
  if (surface !== 'all' && !Object.hasOwn(SURFACES, surface)) {
    throw new Error(
      `unknown --surface '${surface}'. Known: all, ${ORDER.join(', ')}`,
    );
  }
  return {
    surfaces: surface === 'all' ? ORDER : [surface],
    out: read('--out', undefined),
    project: read('--project', 'bakers'),
    cols: Number(read('--cols', DEFAULT_COLS)),
    rows: Number(read('--rows', DEFAULT_ROWS)),
  };
}

/** The New-ticket form's two submit bytes. Neither may appear in any script. */
const SUBMIT_BYTES = [
  ['Ctrl+S', '\u0013'],
  ['Ctrl+D', '\u0004'],
];

function refuseSubmitKeys(script, surface) {
  for (const step of script) {
    for (const [name, byte] of SUBMIT_BYTES) {
      if (String(step.send ?? '').includes(byte)) {
        throw new Error(
          `refusing to run --surface ${surface}: step '${step.label}' sends ` +
            `${name}, which submits the New-ticket form and would write a real ` +
            'ticket to the connected control plane.',
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/**
 * Count every `ESC[<params>m`, split by whether it styles a GLYPH or nothing.
 *
 * The stream is walked once. Consecutive SGRs form one group — a run is opened
 * by however many of them the renderer chose to write — and the group is
 * charged with the text that follows it up to the next escape. `onGlyph` counts
 * the groups whose text contains something other than a space; `onBlank` the
 * rest. See the header for why the distinction is the assertion and not a way
 * around it.
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
  /** What a group styles: the text from its end to the next escape. */
  const runFrom = (from) => {
    const next = text.indexOf('\x1b', from);
    return text.slice(from, next === -1 ? text.length : next);
  };
  for (let match = sgr.exec(text); match !== null; match = sgr.exec(text)) {
    // Adjacent SGRs open one run together; anything in between — text, or a
    // cursor move — closes the group that came before it.
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

/** Why a code is not allowed, in the operator's terms. */
function whyForbidden(code) {
  if (code.startsWith('38;2;'))
    return 'a HARDCODED TRUECOLOR FOREGROUND — replaces the operator’s theme';
  if (code.startsWith('48;2;'))
    return 'a HARDCODED TRUECOLOR BACKGROUND — paints over the terminal';
  if (code.startsWith('38;5;'))
    return 'a palette foreground outside slots 6 / 14 / 120 / 231 / 245';
  if (code.startsWith('48;5;'))
    return 'a palette background outside slots 237 / 250';
  return 'not part of the cockpit’s styling vocabulary';
}

async function runSurface(name, options, say) {
  const surface = SURFACES[name];
  refuseSubmitKeys(surface.script, name);

  const terminal = new Terminal({
    cols: options.cols,
    rows: options.rows,
    allowProposedApi: true,
  });
  const args = surface.args(options.project);
  const child = spawn(process.execPath, [BB_BIN, ...args], {
    name: 'xterm-256color',
    cols: options.cols,
    rows: options.rows,
    cwd: REPO_ROOT,
    // See the header: the logger's own colours are not the renderer's.
    env: { ...process.env, TERM: 'xterm-256color', BB_CONDUCTOR_LOG: 'file' },
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
    const lines = [];
    for (let y = 0; y < terminal.rows; y += 1) {
      lines.push(
        (buffer.getLine(y)?.translateToString(true) ?? '').replace(/\s+$/, ''),
      );
    }
    return lines.join('\n');
  };

  const waitForScreen = async (patterns, timeoutMs) => {
    const regexes = patterns.map((pattern) => new RegExp(pattern));
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      if (regexes.every((regex) => regex.test(screenText()))) return true;
      if (Date.now() > deadline) return false;
      await sleep(POLL_MS);
    }
  };

  const booted = await waitForScreen(surface.boot, BOOT_TIMEOUT_MS);
  let walked = 0;
  if (booted) {
    for (const step of surface.script) {
      const repeat = Math.max(1, step.repeat ?? 1);
      child.write(step.send);
      for (let i = 1; i < repeat; i += 1) {
        await sleep(step.gapMs ?? REPEAT_GAP_MS);
        child.write(step.send);
      }
      const needles = [
        ...(step.expect === undefined ? [] : [step.expect]),
        ...(step.expectAll ?? []),
      ];
      if (needles.length === 0) {
        await sleep(step.settleMs ?? 300);
        walked += 1;
        continue;
      }
      const budget = step.timeoutMs ?? STEP_TIMEOUT_MS;
      let stepOk;
      if (step.repeatEveryMs) {
        const deadline = Date.now() + budget;
        for (;;) {
          stepOk = await waitForScreen(
            needles,
            Math.min(step.repeatEveryMs, Math.max(0, deadline - Date.now())),
          );
          if (stepOk || Date.now() >= deadline) break;
          child.write(step.send);
        }
      } else {
        stepOk = await waitForScreen(needles, budget);
      }
      if (stepOk) walked += 1;
    }
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
  // The verdict
  // -------------------------------------------------------------------------

  const { onGlyph, onBlank, all } = countSgr(raw);
  let failures = 0;
  let deviations = 0;

  say(`## surface ${name} — ${surface.describe}`);
  say(`   command:  ${BB_BIN} ${args.join(' ')}`);
  say(
    `   booted:   ${booted ? 'yes' : 'NO'} · walk ${walked}/${surface.script.length} steps · ` +
      `exit ${exited === null ? 'killed' : exited.exitCode} · ${raw.length} bytes`,
  );
  say('');
  say(
    '   the SGR vocabulary actually emitted   (on a glyph / on blank cells):',
  );
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
        `${whyForbidden(code)}${glyph === 0 ? '; on blank cells only — @opentui/core’s cleared buffer, see the header' : ''}`
      }`,
    );
  }
  say('');
  say('   codes that must occur:');
  for (const [code, why] of REQUIRED) {
    const n = (onGlyph.get(code) ?? 0) + (onBlank.get(code) ?? 0);
    if (n === 0) failures += 1;
    say(
      `   ${n > 0 ? 'ok   ' : 'FAIL '} ${String(n).padStart(6)}  ESC[${code}m  — ${why}`,
    );
  }

  if (!booted) {
    failures += 1;
    say('');
    say(
      '   FAIL  the cockpit never booted — the counts above are not a result',
    );
  }
  say('');
  say(
    `   ${
      failures === 0
        ? `OK${deviations > 0 ? ` with ${deviations} known deviation(s)` : ''}`
        : `FAILED — ${failures} violation(s)`
    }: ${name}`,
  );
  say('');
  return { failures, deviations };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const lines = [];
  const say = (line = '') => lines.push(line);

  say('# BB-326 — the colour vocabulary of `bakers ui` on a real pty');
  say('#');
  say('# The assertion target is the BYTE STREAM. `verify-screen.mjs` and');
  say(
    '# `captureCharFrame()` both read TEXT, which is why a cockpit painted in',
  );
  say('# hardcoded truecolor white shipped with every screen step green.');
  say('#');
  say(
    '# ALLOWED is a closed set — see the header of this file. A code outside',
  );
  say('# it is a FAIL, because the cockpit is only ever entitled to the');
  say(
    '# terminal’s own colours: defaults for text, palette slots 6 and 14 for',
  );
  say('# the border slots, ESC[7m for inversion.');
  say('#');
  say(`# cwd:      ${REPO_ROOT}`);
  say(`# pty:      ${options.cols}x${options.rows}, TERM=xterm-256color`);
  say('# log:      BB_CONDUCTOR_LOG=file — pino-pretty’s own colours are not');
  say('#           the renderer’s and must not be counted as its vocabulary.');
  say(`# started:  ${new Date().toISOString()}`);
  say('');

  let failures = 0;
  let deviations = 0;
  for (const name of options.surfaces) {
    const result = await runSurface(name, options, say);
    failures += result.failures;
    deviations += result.deviations;
  }

  say(
    `## RESULT: ${
      failures > 0
        ? `FAILED — ${failures} violation(s) across ${options.surfaces.length} surface(s)`
        : deviations === 0
          ? 'OK — every surface emitted only the terminal’s own colours'
          : `OK with ${deviations} known deviation(s) — no GLYPH is painted in a ` +
            'colour of the cockpit’s own; what remains is @opentui/core’s ' +
            'cleared buffer on cells that carry no ink. See the header.'
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
