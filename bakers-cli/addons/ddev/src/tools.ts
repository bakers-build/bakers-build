// The ddev addon's agent tools, served by the conductor on the worktree bound
// to the run — the worktree is the DDEV approot, so every call runs there.
// Typed structurally against the conductor's tool contract, so this addon
// needs no conductor dependency.

import { spawn } from 'node:child_process';

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
  return {
    ddev_status: async (req) => {
      const { output } = await ddev(req, ['describe', '-j']);
      try {
        const raw = JSON.parse(output.trim().split('\n').pop() ?? '').raw;
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
      } catch {
        // An unexpected describe format still answers with what ddev said.
        return { text: tail(output) };
      }
    },
    ddev_start: async (req) => ({
      text: (await ddev(req, ['start'], START_TIMEOUT_MS)).text,
    }),
    ddev_exec: async (req) => ({
      text: (await ddev(req, ['exec', String(req.args.command)])).text,
    }),
  };
}
