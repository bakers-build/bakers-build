import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { spawnDetachedConductor } from '../../src/process/detached-spawn.js';

/** `/proc/<pid>/stat` fields after the `(comm)`: state ppid pgrp session tty_nr … */
function sessionAndTty(pid: number): { sid: number; tty: number } {
  const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
  const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
  return { sid: Number(fields[3]), tty: Number(fields[4]) };
}

// A harmless child, never a conductor: it lives long enough to be inspected,
// then writes to stderr and exits with a known code.
const CHILD =
  "setTimeout(() => { console.error('child stderr line'); process.exit(3); }, 400)";

describe.skipIf(process.platform !== 'linux')('spawnDetachedConductor', () => {
  it('starts a session leader without a terminal, logs stderr to the file and reports the exit code', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bb-detached-'));
    const logPath = join(dir, '.bakers', 'log.txt');

    const child = await spawnDetachedConductor({
      argv: [process.execPath, '-e', CHILD],
      cwd: dir,
      env: process.env,
      logPath,
    });

    const { sid, tty } = sessionAndTty(child.pid);
    expect(sid).toBe(child.pid);
    expect(tty).toBe(0);

    expect(await child.exited).toBe(3);
    expect(readFileSync(logPath, 'utf8')).toContain('child stderr line');
  });

  it('rejects when the executable cannot be spawned', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bb-detached-'));
    await expect(
      spawnDetachedConductor({
        argv: [join(dir, 'no-such-binary')],
        cwd: dir,
        env: process.env,
        logPath: join(dir, '.bakers', 'log.txt'),
      }),
    ).rejects.toThrow(/ENOENT/);
  });
});
