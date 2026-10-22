#!/usr/bin/env node

// BB-345 (re-entry) — V5 for the SIXTH list: the project-level Ticket-Agents
// tab, at three widths.
//
// WHY IT IS A SEPARATE SCRIPT FROM `capture-lists.mjs`
//
//   That one walks the ROOT tab bar (`Dashboard · Projects · Conductors`), which
//   is the bar `bakers ui` draws with no project. Ticket-Agents is a PROJECT-level
//   tab (`scope: 'project'`, order 30), so it is reachable only from a boot that
//   carries a project — `bakers ui --project <name>` — where the same header draws
//   the project bar instead. Two boots, two scripts; merging them would make one
//   script take a flag that changes what it is walking.
//
//   What it serves is the same, and it is the surface the `review` step returned
//   the ticket over. `Agent/Component/agent-list/` was the last hand-written
//   per-entity list renderer, and all three of the ticket's findings were live on
//   it. Read the frames below for:
//
//     - a header row is present (`AGENT` / `PROJECT`);
//     - no column is cut while the row still has unused columns (AC 5);
//     - no row runs past the right edge.
//
//   Bold is NOT readable here and is not meant to be — `@xterm/headless`
//   reconstructs GLYPHS. The header's emphasis is asserted on cells in
//   `tests-bun/Screen/list-table-layout.test.ts`, which is the only harness that
//   can see an attribute at all.
//
//   THE ROWS ARE THE HOST'S LIVE SET, not fixture data: they come from
//   `context.services.agents.list(<project slug>)`, i.e. whatever herdr is
//   running for that project on this machine at this moment. So an EMPTY capture
//   is a legitimate outcome and says so on the frame (`No ticket agents.`) — it
//   is a statement about the host, never about the renderer.
//
//   It sends only Tab. It writes nothing to any control plane.
//
// USAGE
//
//   cd bakers-cli/addons/bakers-ui/tests/pty && npm install   # once: native deps
//   node capture-agents.mjs --project bakers --out ../../../../../assets-ai/BB-nnn/node/agents.txt

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

const flag = (name, fallback) => {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? fallback : process.argv[at + 1];
};
const project = flag('project', 'bakers');
const outFile = flag('out', null);
const report = [];
const say = (line) => {
  console.log(line);
  report.push(line);
};

/** One boot per width: Dashboard → Tab → Tickets → Tab → Ticket-Agents. */
const walk = async (cols) => {
  const terminal = new Terminal({ cols, rows: 24, allowProposedApi: true });
  const child = spawn(process.execPath, [BB_BIN, 'ui', '--project', project], {
    name: 'xterm-256color',
    cols,
    rows: 24,
    cwd: REPO_ROOT,
    env: { ...process.env, TERM: 'xterm-256color' },
  });
  child.onData((data) => terminal.write(data));

  // The screen with its right edge intact: the edge is the thing being read, so
  // only the trailing blanks of each line go — never a column of content.
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
  // Two tabs from the project dashboard: Tickets (order 20), then
  // Ticket-Agents (order 30).
  for (let i = 0; i < 2; i += 1) {
    child.write('\t');
    await sleep(SETTLE_MS);
  }
  const lines = snapshot();
  const longest = lines.reduce((n, l) => Math.max(n, l.length), 0);
  say('');
  say(
    `### Ticket-Agents @ ${cols} columns — longest painted row: ${longest}/${cols}`,
  );
  say('```');
  for (const line of lines) say(line);
  say('```');
  child.kill();
  await sleep(500);
};

say('# BB-345 (re-entry) — the SIXTH list, on a real pty');
say(
  `# command:  ${BB_BIN} ui --project ${project}   (Tab → Tickets, Tab → Ticket-Agents)`,
);
say('# terminal: @xterm/headless over node-pty, TERM=xterm-256color, 24 rows');
say(
  '# read for: the AGENT/PROJECT header row present; no column cut while the',
);
say('#           row has unused columns; no row past the right edge.');
say(
  '# NOT readable here: bold. Glyphs only — the header emphasis is asserted on',
);
say('#           cells in tests-bun/Screen/list-table-layout.test.ts.');

for (const cols of WIDTHS) await walk(cols);

if (outFile) {
  writeFileSync(outFile, `${report.join('\n')}\n`);
  console.log(`\ncapture → ${outFile}`);
}
process.exit(0);
