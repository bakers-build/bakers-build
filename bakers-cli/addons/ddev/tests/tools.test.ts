import { describe, expect, it } from 'vitest';
import { type DdevRun, ddevTools, OUTPUT_CAP } from '../src/tools.js';

function fake(result: { exitCode: number; output: string }) {
  const calls: { args: string[]; cwd: string; timeoutMs: number }[] = [];
  const run: DdevRun = async (args, opts) => {
    calls.push({ args, cwd: opts.cwd, timeoutMs: opts.timeoutMs });
    return result;
  };
  return { tools: ddevTools(run), calls };
}

const req = (args: Record<string, unknown> = {}) => ({
  worktreePath: '/work/bb-7',
  args,
  signal: new AbortController().signal,
});

const describeJson = JSON.stringify({
  raw: {
    name: 'bb-7',
    status: 'running',
    primary_url: 'https://bb-7.ddev.site',
    services: { web: { status: 'running' }, db: { status: 'running' } },
  },
});

describe('ddev tools', () => {
  it("ddev_status describes the worktree's project as a summary", async () => {
    const { tools, calls } = fake({ exitCode: 0, output: describeJson });
    const result = await tools.ddev_status(req());
    expect(calls).toEqual([
      { args: ['describe', '-j'], cwd: '/work/bb-7', timeoutMs: 300_000 },
    ]);
    expect(JSON.parse(result.text)).toEqual({
      name: 'bb-7',
      status: 'running',
      primary_url: 'https://bb-7.ddev.site',
      services: { web: 'running', db: 'running' },
    });
  });

  it('ddev_start starts the project in the worktree with a 10 minute timeout', async () => {
    const { tools, calls } = fake({ exitCode: 0, output: 'Started' });
    expect((await tools.ddev_start(req())).text).toBe('exit 0\nStarted');
    expect(calls).toEqual([
      { args: ['start'], cwd: '/work/bb-7', timeoutMs: 600_000 },
    ]);
  });

  it('ddev_exec runs the command in the web container', async () => {
    const { tools, calls } = fake({ exitCode: 0, output: 'http://login' });
    const result = await tools.ddev_exec(
      req({ command: 'drush uli --name north-lead' }),
    );
    expect(result.text).toBe('exit 0\nhttp://login');
    expect(calls[0]).toEqual({
      args: ['exec', 'drush uli --name north-lead'],
      cwd: '/work/bb-7',
      timeoutMs: 300_000,
    });
  });

  it('fails with the exit code and keeps only the output tail', async () => {
    const big = `${'a'.repeat(OUTPUT_CAP)}TAIL`;
    const { tools } = fake({ exitCode: 2, output: big });
    const error = await tools.ddev_exec(req({ command: 'false' })).then(
      () => undefined,
      (err: Error) => err,
    );
    expect(error?.message.startsWith('exit 2\n')).toBe(true);
    expect(error?.message.endsWith('TAIL')).toBe(true);
    expect(error?.message.length).toBeLessThanOrEqual(OUTPUT_CAP + 8);
  });
});
