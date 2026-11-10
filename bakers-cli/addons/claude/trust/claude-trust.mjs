/**
 * claude-trust — launch wrapper of `@bakers-build/addon-claude` for a run in a worktree.
 *
 *   node claude-trust.mjs <worktree> <command> [args…]
 *
 * Marks exactly <worktree> as trusted in `~/.claude.json`, or `$CLAUDE_CONFIG_DIR/.claude.json`
 * when the run has an agent home
 * (`projects[<worktree>].hasTrustDialogAccepted`), so Claude Code does not stop the run at
 * its workspace trust dialog, then runs the command. Every other key is kept; an already
 * trusted worktree is not written. The write goes to a temporary file that is renamed over
 * the original, under a `<file>.lock` so concurrent runs sharing one agent home keep each
 * other's entries. When the file cannot be read or parsed, it is left untouched: the command
 * still runs and shows the dialog, with a warning on stderr.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const [worktree, command, ...args] = process.argv.slice(2);
if (!worktree || !command) {
  console.error('usage: node claude-trust.mjs <worktree> <command> [args…]');
  process.exit(2);
}

/** Holds `<file>.lock` while `write` runs; after 10 s of waiting the lock counts as left over. */
function locked(file, write) {
  const lock = `${file}.lock`;
  const until = Date.now() + 10_000;
  for (;;) {
    try {
      fs.writeFileSync(lock, String(process.pid), { flag: 'wx' });
      break;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      if (Date.now() > until) {
        fs.rmSync(lock, { force: true });
        continue;
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
    }
  }
  try {
    write();
  } finally {
    fs.rmSync(lock, { force: true });
  }
}

function trust() {
  if (!path.isAbsolute(worktree)) {
    throw new Error(`not an absolute path: ${worktree}`);
  }
  const file = path.join(
    process.env.CLAUDE_CONFIG_DIR || os.homedir(),
    '.claude.json',
  );
  locked(file, () => trustIn(file));
}

function trustIn(file) {
  let config = {};
  let mode = 0o600;
  try {
    config = JSON.parse(fs.readFileSync(file, 'utf8'));
    mode = fs.statSync(file).mode & 0o777;
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  if (config.projects?.[worktree]?.hasTrustDialogAccepted === true) return;
  config.projects ??= {};
  config.projects[worktree] = {
    ...config.projects[worktree],
    hasTrustDialogAccepted: true,
  };
  // shortcut: Claude Code itself does not take this lock; its own write in the same moment can be lost.
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(config, null, 2)}\n`, { mode });
  fs.chmodSync(tmp, mode);
  fs.renameSync(tmp, file);
}

try {
  trust();
} catch (err) {
  console.error(`claude-trust: ${err.message} — the trust dialog may show`);
}

const child = spawn(command, args, { stdio: 'inherit' });
// The terminal sends SIGINT to the whole process group; the child decides.
process.on('SIGINT', () => {});
for (const signal of ['SIGTERM', 'SIGHUP']) {
  process.on(signal, () => child.kill(signal));
}
child.on('error', (err) => {
  console.error(`claude-trust: ${err.message}`);
  process.exit(127);
});
child.on('exit', (code, signal) => {
  process.exit(code ?? (signal ? 128 + os.constants.signals[signal] : 1));
});
