/**
 * `node resize-forwarding.js <cmd> [args...]`: runs the command on this
 * terminal and passes every SIGWINCH on to all its descendants. The kernel
 * sends SIGWINCH only to the pty's foreground process group, so an agent in
 * its own session (bwrap `--new-session`) would never redraw on a resize.
 * Exits with the command's code, or 128+n when signal n ended it.
 */
import { execFileSync, spawn } from 'node:child_process';
import { constants } from 'node:os';

const [command, ...args] = process.argv.slice(2);
if (!command) {
  console.error('usage: resize-forwarding <command> [args...]');
  process.exit(2);
}

const child = spawn(command, args, { stdio: 'inherit' });

function descendants(root: number): number[] {
  const children = new Map<number, number[]>();
  // `ps -A -o pid=,ppid=` reads the same on Linux and macOS.
  for (const line of execFileSync('ps', ['-A', '-o', 'pid=,ppid='], {
    encoding: 'utf8',
  }).split('\n')) {
    const [pid, ppid] = line.trim().split(/\s+/).map(Number);
    if (pid && ppid !== undefined) {
      children.set(ppid, [...(children.get(ppid) ?? []), pid]);
    }
  }
  const found: number[] = [];
  const todo = [root];
  for (let pid = todo.pop(); pid !== undefined; pid = todo.pop()) {
    for (const kid of children.get(pid) ?? []) {
      found.push(kid);
      todo.push(kid);
    }
  }
  return found;
}

process.on('SIGWINCH', () => {
  if (child.pid === undefined) return;
  let pids = [child.pid];
  try {
    pids = [child.pid, ...descendants(child.pid)];
  } catch {
    // No usable `ps`: the child alone still hears the resize; never end the run over it.
  }
  // The foreground group already got one; a second SIGWINCH only redraws again.
  for (const pid of pids) {
    try {
      process.kill(pid, 'SIGWINCH');
    } catch {
      // Gone between `ps` and the signal.
    }
  }
});
// Like the launch wrapper: the stop key is for the agent, not for us.
process.on('SIGINT', () => {});
process.on('SIGQUIT', () => {});

child.on('error', (err) => {
  console.error(`resize-forwarding: ${command}: ${err.message}`);
  process.exit(127);
});
child.on('exit', (code, signal) => {
  process.exit(code ?? 128 + (signal ? constants.signals[signal] : 0));
});
