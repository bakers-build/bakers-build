#!/usr/bin/env node
// BB-326 — screen-level verification of the REAL cockpit under a real pty.
//
// WHY THE SCREEN AND NOT THE BYTE STREAM
//
//   A cell-diffing renderer writes each label exactly once, ever. Moving the
//   focus marker from Title to Description writes only the changed cells, so
//   `▸ Description:` is never sent as a contiguous run of bytes and every
//   literal grep of the pty stream after the first paint times out. BB-322 hit
//   this on two independent frameworks (OpenTUI and Rezi), which makes it a
//   property of the METHOD rather than of one framework. So this driver feeds
//   the pty output through `@xterm/headless` and asserts on the RECONSTRUCTED
//   SCREEN — the thing an operator actually sees.
//
// WHY IT RUNS AGAINST THE CURRENT KERNEL FIRST (spec D6, risk R1)
//
//   A harness that has only ever been run against the new renderer cannot tell
//   "the screen is right" from "the harness agrees with itself". The current,
//   hand-rolled kernel is the calibration: every expectation in the key scripts
//   is proven to pass against a known-good screen BEFORE the renderer is
//   swapped. A step that fails at that point is a bug in the script or in this
//   file — never in the renderer.
//
// WHAT IT DOES NOT DO
//
//   It never sends Ctrl+S or Ctrl+D. Those are the New-ticket form's two submit
//   paths and would write a REAL ticket to whichever control plane the
//   connection resolved to. The check below is not decoration: it refuses to
//   run a script that contains either byte.
//
// USAGE
//
//   cd bakers-cli/addons/bakers-ui/tests/pty && npm install      # once: native deps
//   node verify-screen.mjs --surface new-ticket
//   node verify-screen.mjs --surface tickets --out ../../../../../assets-ai/BB-nnn/node/pty-tickets-before.txt
//
//   --surface <new-ticket|tickets|dashboard>   which walk, and which deep link
//   --out <file>       write the transcript here as well as to stdout
//   --project <name>   the project the two project-scoped surfaces open
//   --cols/--rows <n>  the pty geometry (default 120x40)
//   --boot-timeout <ms>
//
//   Exit code: 0 on `RESULT: OK`, 1 otherwise.

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
const DEFAULT_BOOT_TIMEOUT_MS = 25000;
const DEFAULT_STEP_TIMEOUT_MS = 8000;
/** How often the reconstructed screen is re-read while waiting for a step. */
const POLL_MS = 50;
/** Gap between the sends of one `repeat`ed step. */
const DEFAULT_REPEAT_GAP_MS = 60;
/** How long `q` is given to end the process before it is killed. */
const EXIT_GRACE_MS = 8000;

// ---------------------------------------------------------------------------
// Surfaces — the whole of what `--surface` selects
// ---------------------------------------------------------------------------

/**
 * What "booted" means: the tab bar AND the statistics body.
 *
 * The chrome alone is not enough. `[Dashboard]` and the header are painted
 * while the body still reads `Loading dashboard…`, so a boot wait on the chrome
 * returns before the first control-plane read has landed and the walk starts
 * typing into a screen that is still loading — measured, not feared.
 */
const BOOT_DASHBOARD = [lit('[Dashboard]'), lit('TICKETS CLOSED')];

/**
 * A surface pairs a key script with the `bakers ui` invocation it is written
 * against, and with the pattern that says the cockpit finished booting.
 *
 * The deep link is here rather than in `key-script.mjs` because it is this
 * driver's business how it starts the subject; the WALK is the shared artefact
 * and lives at its single definition site.
 *
 * `--project` is load-bearing on the two project-scoped surfaces, not
 * decoration. Without a project in scope the New-ticket form's Parent field
 * renders `(no project context — open a project to pick a parent)` and its
 * debounced autocomplete never queries, so the one async option source the walk
 * exists to exercise would not run; and there is no Tickets tab at all.
 */
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
    // No `--project`: the root tab bar exists only outside a project.
    args: () => ['ui'],
    script: DASHBOARD_KEY_SCRIPT,
    boot: [...BOOT_DASHBOARD, lit('bakers.build dashboard')],
  },
};

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const read = (flag, fallback) => {
    const at = argv.indexOf(flag);
    return at === -1 ? fallback : argv[at + 1];
  };
  const surface = read('--surface', 'new-ticket');
  if (!Object.hasOwn(SURFACES, surface)) {
    throw new Error(
      `unknown --surface '${surface}'. Known: ${Object.keys(SURFACES).join(', ')}`,
    );
  }
  return {
    surface,
    out: read('--out', undefined),
    project: read('--project', 'bakers'),
    cols: Number(read('--cols', DEFAULT_COLS)),
    rows: Number(read('--rows', DEFAULT_ROWS)),
    bootTimeoutMs: Number(read('--boot-timeout', DEFAULT_BOOT_TIMEOUT_MS)),
  };
}

// ---------------------------------------------------------------------------
// Safety
// ---------------------------------------------------------------------------

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

/** The patterns a step must see on ONE screen, in a single list. */
const needlesOf = (step) => [
  ...(step.expect === undefined ? [] : [step.expect]),
  ...(step.expectAll ?? []),
];

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

/**
 * Which runtime the cockpit ENDED UP in.
 *
 * `cmdUi` re-execs `bakers ui` under the `bun` the renderer addon depends on
 * (BB-326 Task 2), so the process this driver spawned is not necessarily the
 * process that painted. The transcript has to name the runtime that did, or a
 * before/after comparison cannot say whether the renderer or the runtime moved.
 * Read from `/proc`, which is Linux-only; elsewhere the absence is reported
 * rather than filled in.
 */
function describeRuntime(pid) {
  const cmdlineOf = (id) => {
    try {
      return readFileSync(`/proc/${id}/cmdline`, 'utf8').split('\0');
    } catch {
      return [];
    }
  };
  const childrenOf = (id) => {
    try {
      return readFileSync(`/proc/${id}/task/${id}/children`, 'utf8')
        .trim()
        .split(/\s+/)
        .filter(Boolean);
    } catch {
      return [];
    }
  };
  const seen = [];
  const walk = (id, depth) => {
    if (depth > 4) return;
    const argv = cmdlineOf(id);
    if (argv.length > 0) seen.push(argv[0]);
    for (const child of childrenOf(id)) walk(child, depth + 1);
  };
  walk(String(pid), 0);
  if (seen.length === 0) {
    return `node ${process.version} (no /proc on this platform — descendants not inspected)`;
  }
  const bun = seen.find((binary) => /(^|\/)bun(\.exe)?$/.test(binary));
  if (bun === undefined) {
    return `node ${process.version} — NO bun descendant; the cockpit painted on Node${
      process.env.BB_UI_NO_BUN ? ' ($BB_UI_NO_BUN is set)' : ''
    }`;
  }
  let version = '(version unavailable)';
  try {
    version = execFileSync(bun, ['--version'], { encoding: 'utf8' }).trim();
  } catch {
    /* keep the stated absence */
  }
  return `bun ${version} at ${bun} (re-exec'd by cmdUi from node ${process.version})`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const surface = SURFACES[options.surface];
  refuseSubmitKeys(surface.script, options.surface);

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
   * Same screen, not "each seen at some point": a walk between screens is only
   * proven when the chrome and the body agree in one frame. Matching them
   * across frames would pass for a kernel that repainted its tab bar over a
   * body that never changed.
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

  say('# BB-326 — real-PTY screen verification of `bakers ui`');
  say('#');
  say(
    '# The assertion target is the RECONSTRUCTED SCREEN (@xterm/headless over',
  );
  say(
    '# a real pty), never the raw byte stream: a cell-diffing renderer writes',
  );
  say(
    '# each label exactly once, so a stream grep passes step 1 and times out',
  );
  say('# on everything after it.');
  say('#');
  say(`# surface:  ${options.surface} — ${surface.describe}`);
  say(`# command:  ${BB_BIN} ${args.join(' ')}`);
  say(`# cwd:      ${REPO_ROOT}`);
  say(
    `# script:   ${surface.script.length} steps, imported from ./key-script.mjs`,
  );
  say(`# pty:      ${options.cols}x${options.rows}, TERM=xterm-256color`);
  say(`# commit:   ${commitSha()}`);
  say(`# started:  ${new Date().toISOString()}`);

  let ok = true;
  let failure = '';
  let okCount = 0;
  let failCount = 0;

  const booted = await waitForScreen(surface.boot, options.bootTimeoutMs);
  // Only meaningful once the cockpit is up: before the re-exec there is no
  // descendant to find.
  say(`# runtime:  ${describeRuntime(child.pid)}`);
  say('#');
  say('# The runtime line is not decoration. Since BB-326 Task 2 the cockpit');
  say('# re-execs under Bun, so a BEFORE run captured with $BB_UI_NO_BUN=1');
  say('# would differ from the after run in the runtime AND the renderer, and');
  say(
    '# a difference in the screen could be blamed on either. This baseline is',
  );
  say('# taken with the re-exec left alone — current kernel, Bun runtime — so');
  say('# the only thing that moves between before and after is the renderer.');
  say('#');
  say();
  const bootLabel = `boot — the cockpit painted ${surface.boot.join(' + ')}`;
  if (booted) okCount += 1;
  else failCount += 1;
  say(
    `[${since().toFixed(0).padStart(6)} ms] ${booted ? 'ok  ' : 'FAIL'} ${bootLabel}`,
  );
  if (!booted) {
    ok = false;
    failure = `the cockpit never painted ${surface.boot.join(' + ')} within ${options.bootTimeoutMs} ms`;
  }

  if (ok) {
    for (const step of surface.script) {
      const at = since();
      const repeat = Math.max(1, step.repeat ?? 1);
      child.write(step.send);
      for (let i = 1; i < repeat; i += 1) {
        await sleep(step.gapMs ?? DEFAULT_REPEAT_GAP_MS);
        child.write(step.send);
      }
      let sends = repeat;
      let stepOk = true;
      const needles = needlesOf(step);
      if (needles.length > 0) {
        const budget = step.timeoutMs ?? DEFAULT_STEP_TIMEOUT_MS;
        if (step.repeatEveryMs) {
          // A step that must NUDGE: the screen it waits for only arrives on the
          // next keystroke, so the send is repeated inside the budget.
          const deadline = Date.now() + budget;
          for (;;) {
            stepOk = await waitForScreen(
              needles,
              Math.min(step.repeatEveryMs, Math.max(0, deadline - Date.now())),
            );
            if (stepOk || Date.now() >= deadline) break;
            child.write(step.send);
            sends += 1;
          }
        } else {
          stepOk = await waitForScreen(needles, budget);
        }
        if (stepOk) okCount += 1;
        else failCount += 1;
        if (!stepOk && step.required !== false) {
          ok = false;
          failure ||= `key step '${step.label}' expected ${needles
            .map((n) => `/${n}/`)
            .join(' AND ')} and it never appeared on ONE screen`;
        }
      } else {
        await sleep(step.settleMs ?? 300);
        okCount += 1;
      }
      say(
        `[${at.toFixed(0).padStart(6)} ms] ${stepOk ? 'ok  ' : 'FAIL'} ${step.label}${
          step.required === false && !stepOk ? '  (informational)' : ''
        }`,
      );
      say(
        `             send ${JSON.stringify(step.send)}${sends > 1 ? ` x${sends}` : ''}${
          needles.length > 0
            ? `  expect ${needles.map((n) => `/${n}/`).join(' AND ')}`
            : `  (no expectation — settle ${step.settleMs ?? 300} ms)`
        }`,
      );
      if (needles.length > 0) {
        say(
          `             ${stepOk ? `satisfied after ${(since() - at).toFixed(0)} ms` : 'never appeared on one screen'}`,
        );
      }
      if (!ok) break;
    }
  }

  // `q` is the last step of every script; give the process a moment to leave on
  // its own before killing it, so a hung teardown shows up as a killed process
  // in the transcript rather than passing silently.
  const exitDeadline = Date.now() + EXIT_GRACE_MS;
  while (exited === null && Date.now() < exitDeadline) await sleep(POLL_MS);

  // The teardown is part of what the migration replaces — today `finish()`
  // writes the reset escapes and drops raw mode, tomorrow `renderer.destroy()`
  // does. A cockpit that paints correctly and then will not leave is a
  // regression, so the exit is a judged step and not a footnote.
  const exitOk = exited !== null && exited.exitCode === 0;
  if (exitOk) okCount += 1;
  else failCount += 1;
  if (ok && !exitOk) {
    ok = false;
    failure =
      exited === null
        ? `the cockpit was still running ${EXIT_GRACE_MS} ms after 'q'`
        : `the cockpit left with exit code ${exited.exitCode} after 'q'`;
  }

  say();
  say('## final reconstructed screen');
  say();
  say(screenText());
  say();
  say(
    `[${since().toFixed(0).padStart(6)} ms] ${exitOk ? 'ok  ' : 'FAIL'} exit — ${
      exited === null
        ? `still running ${EXIT_GRACE_MS} ms after 'q'; killed`
        : `code ${exited.exitCode}, signal ${exited.signal ?? 'none'}`
    }`,
  );
  say(`## steps: ${okCount} ok, ${failCount} FAIL`);
  say(
    `## RESULT: ${
      ok
        ? 'OK — every step of the key script was satisfied ON SCREEN'
        : `FAILED — ${failure}`
    }`,
  );

  if (exited === null) {
    try {
      child.kill('SIGKILL');
    } catch {
      /* already gone */
    }
  }

  const text = `${report.join('\n')}\n`;
  process.stdout.write(text);
  if (options.out !== undefined) {
    const out = resolve(process.cwd(), options.out);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, text);
    process.stderr.write(`\nverification → ${out}\n`);
  }
  process.exit(ok ? 0 : 1);
}

await main();
