import { spawn } from 'node:child_process';
import { closeSync, mkdirSync, openSync } from 'node:fs';
import { dirname } from 'node:path';

export interface DetachedSpawnRequest {
  /** Executable first, then its arguments; no shell, no PATH lookup. */
  argv: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  /** Appended to by the child's stdout and stderr. */
  logPath: string;
}

export interface DetachedChild {
  pid: number;
  /** Exit code (null on a signal) — settles only if the child ends. */
  exited: Promise<number | null>;
}

/**
 * Starts `oven start --foreground` as a detached conductor: its own session
 * (no controlling terminal, untouched by the starting shell's SIGHUP), stdin
 * closed, stdout and stderr appended to the conductor log, and unref'd so the
 * starting process can exit while it runs.
 */
export async function spawnDetachedConductor(
  req: DetachedSpawnRequest,
): Promise<DetachedChild> {
  const [file, ...args] = req.argv;
  if (!file) throw new Error('spawnDetachedConductor: empty argv');
  mkdirSync(dirname(req.logPath), { recursive: true });
  const fd = openSync(req.logPath, 'a');
  try {
    const child = spawn(file, args, {
      cwd: req.cwd,
      env: req.env,
      detached: true,
      stdio: ['ignore', fd, fd],
    });
    const exited = new Promise<number | null>((resolve) =>
      child.once('exit', (code) => resolve(code)),
    );
    await new Promise<void>((resolve, reject) => {
      child.once('spawn', resolve);
      child.once('error', reject);
    });
    child.unref();
    return { pid: child.pid as number, exited };
  } finally {
    closeSync(fd);
  }
}
