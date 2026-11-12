// The ddev addon's agent tools, served by the conductor on the worktree bound
// to the run. Every call runs in the worktree and first checks that DDEV
// resolves the worktree's own project: an unregistered worktree makes DDEV fall
// back to the registered parent checkout, whose containers no run may touch.
// Typed structurally against the conductor's tool contract, so this addon
// needs no conductor dependency.

import { spawn } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';

/** Output beyond this many characters is cut from the front. */
export const OUTPUT_CAP = 64 * 1024;
const START_TIMEOUT_MS = 10 * 60_000;
const TIMEOUT_MS = 5 * 60_000;

export type DdevRun = (
  args: string[],
  opts: { cwd: string; timeoutMs: number; signal: AbortSignal },
) => Promise<{ exitCode: number; output: string }>;

export interface Request {
  worktreePath: string;
  args: Record<string, unknown>;
  signal: AbortSignal;
}
export type Handler = (req: Request) => Promise<{ text: string }>;

const tail = (s: string) => (s.length > OUTPUT_CAP ? s.slice(-OUTPUT_CAP) : s);
const real = (path: string) => {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
};

/** `ddev` with stdout and stderr interleaved, killed at the timeout. */
export const nodeDdevRun: DdevRun = (args, { cwd, timeoutMs, signal }) =>
  new Promise((done, fail) => {
    const child = spawn('ddev', args, {
      cwd,
      signal,
      timeout: timeoutMs,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    const collect = (chunk: Buffer) => {
      output = tail(output + chunk.toString('utf8'));
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    child.on('error', fail);
    child.on('close', (code, sig) =>
      done({
        exitCode: code ?? 124,
        output: sig ? `${output}\n(killed: ${sig})` : output,
      }),
    );
  });

export function ddevTools(run: DdevRun): Record<string, Handler> {
  const ddev = async (req: Request, args: string[], timeoutMs = TIMEOUT_MS) => {
    const { exitCode, output } = await run(args, {
      cwd: req.worktreePath,
      timeoutMs,
      signal: req.signal,
    });
    const text = `exit ${exitCode}\n${tail(output)}`;
    if (exitCode !== 0) throw new Error(text);
    return { exitCode, output, text };
  };
  /** The described project, refused unless its approot is the worktree. */
  const ownProject = async (req: Request) => {
    const { output } = await ddev(req, ['describe', '-j']);
    let raw: Record<string, unknown> | undefined;
    try {
      raw = JSON.parse(output.trim().split('\n').pop() ?? '').raw;
    } catch {}
    const approot = typeof raw?.approot === 'string' ? raw.approot : undefined;
    if (!raw || !approot || real(approot) !== real(req.worktreePath)) {
      throw new Error(
        `DDEV resolves the project at ${approot ?? '(unknown)'}, not this worktree (${req.worktreePath}); run bash .ddev/worktree-post.sh in the worktree to register it.\n${tail(output)}`,
      );
    }
    return raw;
  };
  return {
    ddev_status: async (req) => {
      const raw = await ownProject(req);
      return {
        text: JSON.stringify({
          name: raw.name,
          status: raw.status,
          primary_url: raw.primary_url,
          services: Object.fromEntries(
            Object.entries(
              (raw.services ?? {}) as Record<string, { status?: string }>,
            ).map(([name, s]) => [name, s.status]),
          ),
        }),
      };
    },
    ddev_start: async (req) => {
      await ownProject(req);
      return { text: (await ddev(req, ['start'], START_TIMEOUT_MS)).text };
    },
    ddev_exec: async (req) => {
      await ownProject(req);
      return {
        text: (await ddev(req, ['exec', String(req.args.command)])).text,
      };
    },
  };
}
