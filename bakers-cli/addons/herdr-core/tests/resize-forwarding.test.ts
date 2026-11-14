import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { shellQuote } from '@bakers-build/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

const forwarder = new URL('../src/resize-forwarding.ts', import.meta.url)
  .pathname;

function has(tool: string): boolean {
  try {
    execFileSync('sh', ['-c', `command -v ${tool}`], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/** An agent like a bwrap `--new-session` one: no controlling terminal. */
const AGENT = `
d=$1; n=0
trap 'n=$((n+1)); echo $n > "$d/winch"' WINCH
[ -t 0 ] && echo yes > "$d/tty"
tty > "$d/pts"
i=0; while [ ! -e "$d/stop" ] && [ $i -lt 200 ]; do sleep 0.05; i=$((i+1)); done
exit 7
`;

const read = (file: string) => readFileSync(file, 'utf8').trim();

// `script -c` (util-linux) gives the run a real pty, the way hc does.
describe.skipIf(
  process.platform !== 'linux' || !has('script') || !has('setsid'),
)('resize forwarding', () => {
  let dir = '';
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  /** Runs `agent.sh` behind the forwarder in a pty, resizes it twice, returns the exit code. */
  async function resizeTwice(
    agent: string[],
    env: NodeJS.ProcessEnv = process.env,
  ): Promise<number | null> {
    dir = mkdtempSync(join(tmpdir(), 'hc-winch-'));
    writeFileSync(join(dir, 'agent.sh'), AGENT);
    const run = [
      process.execPath,
      forwarder,
      ...agent,
      join(dir, 'agent.sh'),
      dir,
    ]
      .map(shellQuote)
      .join(' ');
    const child = spawn('script', ['-qec', run, '/dev/null'], {
      stdio: 'ignore',
      env,
    });
    const exited = new Promise<number | null>((resolve) =>
      child.on('exit', resolve),
    );

    let pts = '';
    await vi.waitFor(() => {
      pts = read(join(dir, 'pts'));
    });
    for (const [n, size] of [
      [1, ['cols', '100', 'rows', '30']],
      [2, ['cols', '90', 'rows', '25']],
    ] as const) {
      execFileSync('stty', ['-F', pts, ...size]);
      await vi.waitFor(() => expect(read(join(dir, 'winch'))).toBe(String(n)));
    }
    writeFileSync(join(dir, 'stop'), '');
    return exited;
  }

  it('a setsid agent receives every pane resize, keeps its tty and its exit code', async () => {
    expect(await resizeTwice(['setsid', 'sh'])).toBe(7);
    expect(read(join(dir, 'tty'))).toBe('yes');
  });

  it('keeps running and still signals its child when ps fails', async () => {
    const bin = mkdtempSync(join(tmpdir(), 'hc-nops-'));
    try {
      writeFileSync(join(bin, 'ps'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
      const env = { ...process.env, PATH: `${bin}:${process.env.PATH}` };
      expect(await resizeTwice(['sh'], env)).toBe(7);
    } finally {
      rmSync(bin, { recursive: true, force: true });
    }
  });
});
