#!/usr/bin/env node

// BB-345 — V5: capture the two lists that CHANGED SHAPE, at three widths.
//
// WHY THIS EXISTS BESIDE `verify-screen.mjs`
//
//   The drivers assert; this one SHOWS. Projects and Conductors each gained a
//   header row (spec D6) and their free-text columns became growers, and no
//   automated check states what an operator should see afterwards. The
//   acceptance criteria this serves are read off a frame by a human:
//
//     - a header row is present on both lists;
//     - no column is cut while the row still has unused columns (AC 5);
//     - no row runs past the right edge.
//
//   80, 120 and 160 because that is the range the criterion names.
//
//   It reconstructs the screen through `@xterm/headless` for the same reason
//   `verify-screen.mjs` does: a cell-diffing renderer writes each label exactly
//   once, so grepping the byte stream finds nothing after the first paint.
//
//   It sends only Tab. It never sends Ctrl+S or Ctrl+D — the New-ticket form's
//   two submit paths, which would write a REAL ticket to whichever control
//   plane the connection resolved to.
//
// USAGE
//
//   cd bakers-cli/addons/bakers-ui/tests/pty && npm install   # once: native deps
//   node capture-lists.mjs --out ../../../../../assets-ai/BB-nnn/node/lists.txt

import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import xtermHeadless from '@xterm/headless';
import { spawn } from 'node-pty';

const { Terminal } = xtermHeadless;
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '../../../../..');
const BB_BIN = resolve(REPO_ROOT, 'bakers-cli/bin/bakers');

const WIDTHS = [80, 120, 160];
const BOOT_MS = 12000;
const SETTLE_MS = 2500;
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

const outFlag = process.argv.indexOf('--out');
const outFile = outFlag === -1 ? null : process.argv[outFlag + 1];
const report = [];
const say = (line) => {
  console.log(line);
  report.push(line);
};

/** One boot per width: tab to Projects, capture; tab to Conductors, capture. */
const walk = async (cols) => {
  const terminal = new Terminal({ cols, rows: 24, allowProposedApi: true });
  const child = spawn(process.execPath, [BB_BIN, 'ui'], {
    name: 'xterm-256color',
    cols,
    rows: 24,
    cwd: REPO_ROOT,
    env: { ...process.env, TERM: 'xterm-256color' },
  });
  child.onData((data) => terminal.write(data));

  // The screen with trailing blanks kept: the right edge is the thing being
  // read, so trimming it would erase the evidence.
  const snapshot = () => {
    const buffer = terminal.buffer.active;
    const lines = [];
    for (let y = 0; y < terminal.rows; y += 1) {
      lines.push(
        (buffer.getLine(y)?.translateToString(true) ?? '').replace(/\s+$/, ''),
      );
    }
    while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
    return lines;
  };

  await sleep(BOOT_MS);
  for (const tab of ['Projects', 'Conductors']) {
    child.write('\t');
    await sleep(SETTLE_MS);
    const lines = snapshot();
    const longest = lines.reduce((n, l) => Math.max(n, l.length), 0);
    say('');
    say(
      `### ${tab} @ ${cols} columns — longest painted row: ${longest}/${cols}`,
    );
    say('```');
    for (const line of lines) say(line);
    say('```');
  }
  child.kill();
  await sleep(500);
};

say('# BB-345 V5 — the two lists that changed shape, on a real pty');
say(`# command:  ${BB_BIN} ui   (Tab → Projects, Tab → Conductors)`);
say('# terminal: @xterm/headless over node-pty, TERM=xterm-256color, 24 rows');
say('# read for: a header row present; no column cut while the row has unused');
say('#           columns; no row past the right edge.');

for (const cols of WIDTHS) await walk(cols);

if (outFile) {
  writeFileSync(outFile, `${report.join('\n')}\n`);
  console.log(`\ncapture → ${outFile}`);
}
process.exit(0);
