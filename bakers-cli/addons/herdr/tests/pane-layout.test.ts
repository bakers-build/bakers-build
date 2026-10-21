import { describe, expect, it } from 'vitest';
import { applyPaneLayout } from '../src/pane-layout.js';

/** Fake herdr exec recording every call (+ its opts) and answering `pane split`. */
function fakeHerdr() {
  const calls: Array<{ args: string[]; opts?: unknown }> = [];
  const exec = async (args: string[], opts?: unknown): Promise<string> => {
    calls.push({ args, opts });
    if (args[0] === 'pane' && args[1] === 'split') {
      const n = calls.filter((c) => c.args[1] === 'split').length;
      return JSON.stringify({ result: { pane: { pane_id: `split-${n}` } } });
    }
    return JSON.stringify({ result: {} });
  };
  return { calls, exec };
}

const NO_VARS: Record<string, string> = {};

describe('applyPaneLayout', () => {
  it('runs the command verbatim in the root pane', async () => {
    const { calls, exec } = fakeHerdr();
    await applyPaneLayout(
      exec,
      'root-1',
      { command: 'spiceedit' },
      '/wt',
      NO_VARS,
    );
    const run = calls.find((c) => c.args[1] === 'run');
    expect(run?.args).toEqual(['pane', 'run', 'root-1', 'spiceedit']);
    // No split issued for a command-only layout.
    expect(calls.some((c) => c.args[1] === 'split')).toBe(false);
  });

  it('splits each configured pane with its cwd + direction and runs its rendered command', async () => {
    const { calls, exec } = fakeHerdr();
    await applyPaneLayout(
      exec,
      'root-1',
      {
        panes: [
          {
            direction: 'right',
            command: 'tail -f {identifier}.log',
            focus: true,
          },
          { direction: 'down', command: 'htop' },
        ],
      },
      '/wt/checkout',
      { identifier: 'BB-139' },
    );
    const splits = calls.filter((c) => c.args[1] === 'split');
    expect(splits).toHaveLength(2);
    expect(splits[0]?.args).toEqual([
      'pane',
      'split',
      'root-1',
      '--direction',
      'right',
      '--cwd',
      '/wt/checkout',
      '--focus',
    ]);
    expect(splits[1]?.args).toEqual([
      'pane',
      'split',
      'root-1',
      '--direction',
      'down',
      '--cwd',
      '/wt/checkout',
      '--no-focus',
    ]);
    // Each split pane runs its command, with {vars} rendered.
    expect(calls).toContainEqual(
      expect.objectContaining({
        args: ['pane', 'run', 'split-1', 'tail -f BB-139.log'],
      }),
    );
    expect(calls).toContainEqual(
      expect.objectContaining({ args: ['pane', 'run', 'split-2', 'htop'] }),
    );
  });

  // BB-64: the split env is OPT-IN per caller. `applyPaneLayout` is shared by
  // the executor's agent tab and the workspace's own open pane; only the former
  // marks its panes as agent-owned, so the primitive must not decide it itself.
  it('appends opts.env as --env args on each split pane', async () => {
    const { calls, exec } = fakeHerdr();
    await applyPaneLayout(
      exec,
      'root-1',
      { panes: [{ direction: 'right', command: 'ls' }] },
      '/wt',
      NO_VARS,
      { env: { BB_AGENT_SHELL: '1' } },
    );
    const split = calls.find((c) => c.args[1] === 'split');
    expect(split?.args).toEqual([
      'pane',
      'split',
      'root-1',
      '--direction',
      'right',
      '--cwd',
      '/wt',
      '--no-focus',
      '--env',
      'BB_AGENT_SHELL=1',
    ]);
  });

  it('passes no --env on a split when the caller supplies no env', async () => {
    const { calls, exec } = fakeHerdr();
    await applyPaneLayout(
      exec,
      'root-1',
      { panes: [{ direction: 'right', command: 'ls' }] },
      '/wt',
      NO_VARS,
    );
    const split = calls.find((c) => c.args[1] === 'split');
    expect(split?.args).not.toContain('--env');
  });

  it('runs the root command then the splits (command + panes together)', async () => {
    const { calls, exec } = fakeHerdr();
    await applyPaneLayout(
      exec,
      'root-1',
      { command: 'spiceedit', panes: [{ direction: 'right', command: 'ls' }] },
      '/wt',
      NO_VARS,
    );
    const rootRun = calls.findIndex(
      (c) => c.args[1] === 'run' && c.args[2] === 'root-1',
    );
    const split = calls.findIndex((c) => c.args[1] === 'split');
    expect(rootRun).toBeGreaterThanOrEqual(0);
    expect(split).toBeGreaterThan(rootRun);
  });

  it('issues no calls for an empty layout', async () => {
    const { calls, exec } = fakeHerdr();
    await applyPaneLayout(exec, 'root-1', {}, '/wt', NO_VARS);
    expect(calls).toHaveLength(0);
  });

  it('passes a redactArgs log-scrubber when redactCommand masks the command (arg stays real)', async () => {
    const { calls, exec } = fakeHerdr();
    const real = "SECRET=$'s3cr3t' claude";
    await applyPaneLayout(exec, 'root-1', { command: real }, '/wt', NO_VARS, {
      redactCommand: () => 'SECRET=<redacted> claude',
    });
    const run = calls.find((c) => c.args[1] === 'run');
    // The typed command arg is the REAL command (herdr runs it) …
    expect(run?.args[3]).toBe(real);
    // … while a redactArgs scrubber masks it for the exec log only.
    const opts = run?.opts as
      | { redactArgs?: (a: string[]) => string[] }
      | undefined;
    expect(typeof opts?.redactArgs).toBe('function');
    expect(opts?.redactArgs?.(run?.args as string[])).toEqual([
      'pane',
      'run',
      'root-1',
      'SECRET=<redacted> claude',
    ]);
  });

  it('does not pass redactArgs when the redactor returns the command unchanged', async () => {
    const { calls, exec } = fakeHerdr();
    await applyPaneLayout(
      exec,
      'root-1',
      { command: 'claude' },
      '/wt',
      NO_VARS,
      {
        redactCommand: (c) => c,
      },
    );
    const run = calls.find((c) => c.args[1] === 'run');
    expect(run?.opts).toBeUndefined();
  });
});
