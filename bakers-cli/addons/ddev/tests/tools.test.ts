import { describe, expect, it } from 'vitest';
import * as presetModule from '../src/preset.js';
import { type DdevRun, ddevTools, OUTPUT_CAP } from '../src/tools.js';

const preset = { ...presetModule, tools: presetModule.tools.tools };

const describeJson = (approot = '/work/bb-7') =>
  JSON.stringify({
    raw: {
      name: 'bb-7',
      approot,
      status: 'running',
      primary_url: 'https://bb-7.ddev.site',
      services: { web: { status: 'running' }, db: { status: 'running' } },
    },
  });

/** `describe` answers with `described`, every other command with `result`. */
function fake(
  result: { exitCode: number; output: string },
  described = describeJson(),
) {
  const calls: { args: string[]; cwd: string; timeoutMs: number }[] = [];
  const run: DdevRun = async (args, opts) => {
    calls.push({ args, cwd: opts.cwd, timeoutMs: opts.timeoutMs });
    return args[0] === 'describe' ? { exitCode: 0, output: described } : result;
  };
  return { tools: ddevTools(run), calls };
}

const req = (args: Record<string, unknown> = {}) => ({
  worktreePath: '/work/bb-7',
  args,
  signal: new AbortController().signal,
});

const describeCall = {
  args: ['describe', '-j'],
  cwd: '/work/bb-7',
  timeoutMs: 300_000,
};

describe('ddev tools', () => {
  it("ddev_status describes the worktree's project as a summary", async () => {
    const { tools, calls } = fake({ exitCode: 0, output: '' });
    const result = await tools.ddev_status(req());
    expect(calls).toEqual([describeCall]);
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
      describeCall,
      { args: ['start'], cwd: '/work/bb-7', timeoutMs: 600_000 },
    ]);
  });

  it('serves no ddev_exec: site commands run through provision_exec', async () => {
    const { tools } = fake({ exitCode: 0, output: '' });
    expect(Object.keys(tools).sort()).toEqual(['ddev_start', 'ddev_status']);
    expect(Object.keys(preset.tools).sort()).toEqual([
      'ddev_start',
      'ddev_status',
    ]);
    // The project lists `.ddev` itself; the addon declares no protected path.
    expect(presetModule).not.toHaveProperty('runtime');
  });

  it('fails with the exit code and keeps only the output tail', async () => {
    const big = `${'a'.repeat(OUTPUT_CAP)}TAIL`;
    const { tools } = fake({ exitCode: 2, output: big }, describeJson());
    const error = await tools.ddev_start(req()).then(
      () => undefined,
      (err: Error) => err,
    );
    expect(error?.message.startsWith('exit 2\n')).toBe(true);
    expect(error?.message.endsWith('TAIL')).toBe(true);
    expect(error?.message.length).toBeLessThanOrEqual(OUTPUT_CAP + 8);
  });

  // An unregistered worktree makes DDEV resolve the registered parent checkout.
  it.each([
    ['ddev_status', {}],
    ['ddev_start', {}],
  ])('%s refuses a project other than the worktree', async (tool, args) => {
    const { tools, calls } = fake(
      { exitCode: 0, output: 'ran' },
      describeJson('/projects/main'),
    );
    await expect(tools[tool](req(args))).rejects.toThrow(
      /\/projects\/main.*\/work\/bb-7/,
    );
    expect(calls).toEqual([describeCall]);
  });
});
