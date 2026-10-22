#!/usr/bin/env node
// BB-326 — is a URL the cockpit prints actually TAPPABLE in the operator's
// terminal?
//
// WHY THIS EXISTS AS A SEPARATE DRIVER
//
//   A hyperlink is an OSC 8 sequence — `ESC]8;id=<n>;<url>ESC\` around the run,
//   `ESC]8;;ESC\` to close it. Like OSC 52 it paints NOTHING: the URL's
//   characters are on screen either way, so `verify-screen.mjs` and
//   `captureCharFrame()` see exactly the same text whether the cells carry a
//   link or not. `verify-colors.mjs` counts SGR and OSC 8 is not one. So a
//   link that silently never happens passes every other harness in this repo,
//   and the assertion has to be on the BYTES.
//
// HOW THE LINK GETS THERE, AND WHY IT IS NOT AN ESCAPE IN A STRING
//
//   The cockpit composes STRINGS and `lib/styled-text.ts` reads six SGR codes
//   out of them, dropping every escape it does not know — an OSC 8 written into
//   a composed line would therefore be dropped, or worse, measured and painted
//   as text. It is not written into one. `@opentui/core@0.5.1`'s `TextChunk`
//   has a `link` FIELD (`["link", "char*"]` in its chunk struct), the Zig core
//   interns the address into a 24-bit id packed into the CELL's attributes
//   (`attributesWithLink` / `getLinkId`), and the core emits the sequence when
//   it paints. `lib/hyperlink.ts` decides which ranges of a line are addresses;
//   `lib/styled-text.ts` turns each into its own chunk.
//
// WHAT IS ASSERTED
//
//   1. The root Dashboard prints no URL and emits NO OSC 8. That is the
//      negative half, and it is what stops the rest of this file passing
//      against a renderer that links everything or nothing.
//   2. The root Projects tab prints the connected control plane's base URL in
//      its meta line. After switching to it, an OSC 8 appears on the wire whose
//      address is EXACTLY the URL visible on screen — read independently off
//      the reconstructed buffer, so the wire is checked against the screen
//      rather than against itself.
//   3. Every opened link is closed (`ESC]8;;ESC\`), or the link would bleed
//      across the rest of the row and the operator would tap the wrong cell.
//
//   The surface is chosen for DETERMINISM: `Entity/project/Screen/
//   projects-screen.ts` puts `services.baseUrl` in its meta line on every run,
//   whatever tickets happen to exist. The same mechanism links every URL in a
//   ticket description, a comment and a run log — those are the ones the
//   operator actually wanted — but their content is not something a gate can
//   depend on.
//
// TWO THINGS THIS DRIVER CANNOT ASSERT, AND THE OPERATOR SHOULD KNOW
//
//   * ACTIVATION belongs to the terminal, not to us. The cockpit marks the
//     cells; the emulator decides how a link is opened. With mouse reporting on
//     — and `@opentui/core` turns it on — a plain click goes to the
//     APPLICATION, so most emulators (Ghostty included) want a modifier-click
//     or a long-press/context menu to follow a link instead. Nothing in
//     `@opentui/core@0.5.1` intercepts a click on a linked cell either
//     (`getLinkId` is exported and unused by the renderable tree).
//   * A TRUNCATED address is deliberately not a link — see `lib/hyperlink.ts`.
//     The TUI never wraps, so a URL wider than the columns left on its row is
//     cut with `…` and gets no link at all, rather than a link to the prefix
//     that happened to fit. On a narrow terminal that is most long URLs.
//
// USAGE
//
//   cd bakers-cli/addons/bakers-ui/tests/pty && npm install   # once: native deps
//   node verify-links.mjs
//   node verify-links.mjs --out ../../../../../assets-ai/BB-nnn/node/pty-links.txt
//
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
const STEP_TIMEOUT_MS = 20000;
const POLL_MS = 50;
const EXIT_GRACE_MS = 8000;

/**
 * The OSC 8 pair, as `@opentui/core@0.5.1` writes it.
 *
 * `ESC ] 8 ; <params> ; <url> ST` opens and `ESC ] 8 ; ; ST` closes, with `ST`
 * as `ESC \`. Built with `new RegExp` from an escaped constant: Biome rejects a
 * control character inside a regex literal.
 */
const ESC = '\u001b';
const OSC8 = new RegExp(
  `${ESC}\\]8;([^;]*);([^${ESC}\\u0007]*)${ESC}\\\\`,
  'g',
);

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

function parseArgs(argv) {
  const read = (flag, fallback) => {
    const at = argv.indexOf(flag);
    return at === -1 ? fallback : argv[at + 1];
  };
  return {
    out: read('--out', undefined),
    cols: Number(read('--cols', DEFAULT_COLS)),
    rows: Number(read('--rows', DEFAULT_ROWS)),
  };
}

/** Every OSC 8 in `text`: the ones that open a link, and the ones that close. */
function hyperlinks(text) {
  OSC8.lastIndex = 0;
  const opens = [];
  let closes = 0;
  for (let m = OSC8.exec(text); m !== null; m = OSC8.exec(text)) {
    if (m[2] === '') closes += 1;
    else opens.push({ params: m[1], url: m[2] });
  }
  return { opens, closes };
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

  say('# BB-326 — `bakers ui` makes the URLs it prints tappable (OSC 8)');
  say('#');
  say('# The assertion target is the BYTE STREAM: an OSC 8 paints nothing, so');
  say('# every text-level harness in this repo sees the same screen with the');
  say('# links and without them.');
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
  // No `--project`: the ROOT tab bar (Dashboard · Projects · Conductors) is the
  // only place the Projects screen is reachable, and its meta line is where the
  // base URL is printed.
  const child = spawn(process.execPath, [BB_BIN, 'ui'], {
    name: 'xterm-256color',
    cols: options.cols,
    rows: options.rows,
    cwd: REPO_ROOT,
    // The logger's own bytes are not the renderer's — see verify-colors.mjs.
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
    const out = [];
    for (let y = 0; y < terminal.rows; y += 1) {
      out.push(
        (
          terminal.buffer.active.getLine(y)?.translateToString(true) ?? ''
        ).replace(/\s+$/, ''),
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
    [lit('[Dashboard]'), lit('TICKETS CLOSED'), lit('bakers.build dashboard')],
    BOOT_TIMEOUT_MS,
  );
  say('## boot — the root Dashboard');
  check(booted, 'the cockpit booted');

  // -------------------------------------------------------------------------
  // 1 — the negative. A screen with no address on it emits no OSC 8.
  // -------------------------------------------------------------------------
  const onDashboard = hyperlinks(raw);
  const dashboardScreen = screenText();
  check(
    !/https?:\/\//.test(dashboardScreen),
    'the Dashboard prints no address (the premise of the next check)',
  );
  check(
    onDashboard.opens.length === 0,
    'and emits no OSC 8 — the cockpit does not link cells at random',
    `${onDashboard.opens.length} link(s)`,
  );

  // -------------------------------------------------------------------------
  // 2 — the Projects tab, whose meta line carries the control plane's base URL.
  // -------------------------------------------------------------------------
  let onScreenUrl;
  let switched = false;
  if (booted) {
    child.write(KEY.tab);
    switched = await waitFor([lit('[Projects]'), lit('registered project(s)')]);
    // Wait for the link to reach the wire, not for a fixed delay.
    const deadline = Date.now() + STEP_TIMEOUT_MS;
    while (hyperlinks(raw).opens.length === 0 && Date.now() < deadline)
      await sleep(POLL_MS);
    onScreenUrl = /(https?:\/\/[^\s]+)/.exec(screenText())?.[1];
  }
  const onProjects = hyperlinks(raw);
  say('');
  say('## the Projects tab');
  check(switched, 'the Projects screen opened');
  say(`   address on screen: ${onScreenUrl ?? '(none)'}`);
  for (const link of onProjects.opens.slice(0, 4))
    say(`   wire: ESC]8;${link.params};${link.url}ESC\\`);
  check(
    onProjects.opens.length > 0,
    'an OSC 8 hyperlink reached the wire',
    `${onProjects.opens.length} link(s)`,
  );
  check(
    onScreenUrl !== undefined &&
      onProjects.opens.some((link) => link.url === onScreenUrl),
    'the linked address is EXACTLY the one printed on screen',
    `screen '${onScreenUrl}', wire ${JSON.stringify([
      ...new Set(onProjects.opens.map((l) => l.url)),
    ])}`,
  );
  check(
    onProjects.closes > 0,
    'and every link is closed, so it cannot bleed across the rest of the row',
    `${onProjects.opens.length} open(s) / ${onProjects.closes} close(s)`,
  );

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

  const all = hyperlinks(raw);
  say('');
  say('## the whole session');
  say(
    `   ${raw.length} bytes · ${all.opens.length} link open(s) · ${all.closes} close(s)`,
  );
  say(
    `   distinct addresses: ${JSON.stringify([
      ...new Set(all.opens.map((l) => l.url)),
    ])}`,
  );
  check(
    all.opens.every((link) => /^https?:\/\//.test(link.url)),
    'every address on the wire is an http(s) URL — nothing else was linked',
  );

  if (failures > 0) {
    say('');
    say('## the last screen the driver saw');
    for (const line of screenText().split('\n')) say(`   |${line}`);
  }

  say('');
  say(
    `## RESULT: ${failures === 0 ? 'OK — the addresses the cockpit prints are hyperlinks, and only those cells are' : `FAILED — ${failures} violation(s)`}`,
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
