import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { SpawnRunInput } from '@bakers-build/conductor/contract';
import type { ConductorLogger } from '@bakers-build/core';
import { describe, expect, it } from 'vitest';
import orcaExecutor, { OrcaExecutor } from '../src/index.js';
import { fakeOrca } from './fakes.js';

const INSTANT_WATCH = { timeoutMs: 0, pollMs: 1 } as const;

/** The launch dir behind a typed `sh '<dir>/run.sh'` command. */
function launchDir(args: string[]): string {
  const typed = args[args.indexOf('--command') + 1] ?? '';
  return dirname(typed.slice(4, -1));
}

/** Plays the launch wrapper: the agent started, or exited at once. */
function terminalCreate(outcome: 'started' | 'exit') {
  const seen: { dir?: string; command?: string } = {};
  const handler = (args: string[]) => {
    const dir = launchDir(args);
    seen.dir = dir;
    seen.command = readFileSync(join(dir, 'command'), 'utf8');
    writeFileSync(join(dir, 'started'), 'started');
    if (outcome === 'exit') writeFileSync(join(dir, 'exit'), 'exit 1\n');
    return { terminal: { handle: 'term-1', title: 'x' } };
  };
  return { handler, seen };
}

function input(overrides: Partial<SpawnRunInput> = {}): SpawnRunInput {
  return {
    ticket: {
      uuid: 'u-1',
      identifier: 'BAKERS-1',
      title: 'My Title',
      branchName: 'feat/x',
      state: 'coding',
    },
    run: { uuid: 'run-uuid', id: 7, handler: 'claude' },
    workspacePath: '/repo/.bakers-worktrees/feat/x',
    instructions: null,
    command: 'claude --resume',
    env: { FOO: 'bar' },
    ...overrides,
  };
}

function logger(sink: { errors: unknown[] }): ConductorLogger {
  return {
    debug() {},
    info() {},
    warn() {},
    error(obj: object) {
      sink.errors.push(obj);
    },
  };
}

describe('OrcaExecutor', () => {
  it('is a persistent executor with id orca', () => {
    const ex = new OrcaExecutor({});
    expect(ex.id).toBe('orca');
    expect(ex.capabilities()).toEqual({ persistent: true });
  });
});

describe('OrcaExecutor.runHook', () => {
  it('reports an unconfigured hook as not run', async () => {
    const ex = new OrcaExecutor({});
    await expect(
      ex.runHook('after_create', '/w', { ticket: 'BAKERS-1' }),
    ).resolves.toEqual({ hook: 'after_create', ran: false, ok: true });
  });

  it('reports a failing hook without throwing or logging env values', async () => {
    const sink = { errors: [] as unknown[] };
    const ex = new OrcaExecutor(
      { hooks: { before_run: 'exit 3' } },
      fakeOrca().orca,
      logger(sink),
      async () => {
        throw new Error('hook exited 3');
      },
    );
    const result = await ex.runHook(
      'before_run',
      '/w',
      { ticket: 'BAKERS-1' },
      { SECRET: 'hunter2' },
    );
    expect(result).toMatchObject({ hook: 'before_run', ran: true, ok: false });
    expect(result.error).toContain('hook exited 3');
    expect(sink.errors).toHaveLength(1);
    expect(JSON.stringify(sink.errors)).not.toContain('hunter2');
  });
});

describe('OrcaExecutor.startRun', () => {
  it('runs the agent in an Orca terminal titled with the run token', async () => {
    const create = terminalCreate('started');
    const { orca, calls } = fakeOrca({ 'terminal create': create.handler });
    const ex = new OrcaExecutor({ launchWatch: INSTANT_WATCH }, orca);
    await expect(ex.startRun(input())).resolves.toEqual({
      sessionRef: 'feat/x',
    });
    const createCall = calls.find((c) => c[0] === 'terminal');
    expect(createCall?.slice(0, 6)).toEqual([
      'terminal',
      'create',
      '--worktree',
      'path:/repo/.bakers-worktrees/feat/x',
      '--title',
      'BAKERS-1 · coding #7',
    ]);
    expect(createCall?.[7]).toMatch(/^sh '.+\/run\.sh'$/);
    expect(create.seen.command).toBe("FOO='bar' claude --resume");
    for (const call of calls) expect(call.join(' ')).not.toContain('bar');
  });

  it('renames the terminal so the run title survives the agent', async () => {
    const create = terminalCreate('started');
    const { orca, calls } = fakeOrca({ 'terminal create': create.handler });
    const ex = new OrcaExecutor({ launchWatch: INSTANT_WATCH }, orca);
    await ex.startRun(input());
    expect(calls).toContainEqual([
      'terminal',
      'rename',
      '--terminal',
      'term-1',
      '--title',
      'BAKERS-1 · coding #7',
    ]);
  });

  it('fails the launch and closes the terminal when the title cannot be pinned', async () => {
    const create = terminalCreate('started');
    const { orca, calls } = fakeOrca({
      'terminal create': create.handler,
      'terminal rename': () => {
        throw new Error('rename refused');
      },
    });
    const ex = new OrcaExecutor({ launchWatch: INSTANT_WATCH }, orca);
    await expect(ex.startRun(input())).rejects.toThrow(/rename refused/);
    expect(calls).toContainEqual(['terminal', 'close', '--terminal', 'term-1']);
    expect(existsSync(create.seen.dir as string)).toBe(false);
  });

  it('uses a per-state tab label template', async () => {
    const create = terminalCreate('started');
    const { orca, calls } = fakeOrca({ 'terminal create': create.handler });
    const ex = new OrcaExecutor(
      {
        launchWatch: INSTANT_WATCH,
        states: { coding: { tabLabel: '{identifier} build' } },
      },
      orca,
    );
    await ex.startRun(input());
    const createCall = calls.find((c) => c[0] === 'terminal');
    expect(createCall?.[5]).toBe('BAKERS-1 build #7');
  });

  it('places the state with {state} in a per-state tab label', async () => {
    const create = terminalCreate('started');
    const { orca, calls } = fakeOrca({ 'terminal create': create.handler });
    const ex = new OrcaExecutor(
      {
        launchWatch: INSTANT_WATCH,
        states: { coding: { tabLabel: '{identifier} [{state}] {titleSlug}' } },
      },
      orca,
    );
    await ex.startRun(input());
    const createCall = calls.find((c) => c[0] === 'terminal');
    expect(createCall?.[5]).toBe('BAKERS-1 [coding] my-title #7');
  });

  it('rejects a tab label without {identifier}', async () => {
    const ex = new OrcaExecutor(
      { default: { tabLabel: '{title}' } },
      fakeOrca().orca,
    );
    await expect(ex.startRun(input())).rejects.toThrow(/\{identifier\}/);
  });

  it('fails a launch whose agent exits at once and closes its terminal', async () => {
    const create = terminalCreate('exit');
    const { orca, calls } = fakeOrca({
      'terminal create': create.handler,
      'terminal read': () => ({ terminal: { tail: ['command not found'] } }),
    });
    const ex = new OrcaExecutor({ launchWatch: INSTANT_WATCH }, orca);
    await expect(ex.startRun(input())).rejects.toThrow(
      /Launch failed: exit 1\ncommand not found/,
    );
    expect(calls).toContainEqual(['terminal', 'close', '--terminal', 'term-1']);
    expect(existsSync(create.seen.dir as string)).toBe(false);
  });

  it('fails without creating a terminal when Orca is not reachable', async () => {
    const { orca, calls } = fakeOrca({
      status: () => ({ runtime: { reachable: false, state: 'starting' } }),
    });
    const ex = new OrcaExecutor({}, orca);
    await expect(ex.startRun(input())).rejects.toThrow(
      /not reachable \(state: starting\)/,
    );
    expect(calls.some((c) => c[0] === 'terminal')).toBe(false);
  });
});

describe('OrcaExecutor.cleanupRun', () => {
  const terminals = [
    { handle: 'a', branch: 'refs/heads/b', title: 'X #7' },
    { handle: 'b', branch: 'b', title: 'X #8' },
    { handle: 'c', branch: 'c', title: 'X #7' },
    { handle: 'd', branch: 'b', title: null },
    { handle: 'e', branch: 'b', title: 'X #77' },
  ];

  it('closes only the terminal of this run on this branch', async () => {
    const { orca, calls } = fakeOrca({
      'terminal list': () => ({ terminals }),
    });
    await new OrcaExecutor({}, orca).cleanupRun('b', 7);
    expect(calls.filter((c) => c[1] === 'close')).toEqual([
      ['terminal', 'close', '--terminal', 'a'],
    ]);
  });

  it('finds the run by its tab title when the agent retitled the terminal', async () => {
    // Desktop Orca: the rename lives on the tab; the terminal reports the agent's title.
    const tab = (tabId: string, title: string) => ({ tabId, title });
    const { orca, calls } = fakeOrca({
      'terminal list': () => ({
        terminals: [
          { handle: 'a', branch: 'b', tabId: 't1', title: '✳ Claude Code' },
          { handle: 'f', branch: 'b', tabId: 't2', title: '✳ Claude Code' },
        ],
        visualLayouts: [
          {
            root: {
              type: 'split',
              first: { type: 'group', tabs: [tab('t2', 'X #8')] },
              second: { type: 'group', tabs: [tab('t1', 'X #7')] },
            },
          },
        ],
      }),
    });
    await new OrcaExecutor({}, orca).cleanupRun('b', 7);
    expect(calls.filter((c) => c[1] === 'close')).toEqual([
      ['terminal', 'close', '--terminal', 'a'],
    ]);
  });

  it("lists past Orca's default page of 200 terminals, with tab layouts", async () => {
    const { orca, calls } = fakeOrca({
      'terminal list': () => ({ terminals: [] }),
    });
    await new OrcaExecutor({}, orca).cleanupRun('b', 7);
    expect(calls).toEqual([
      ['terminal', 'list', '--include-visual-layouts', '--limit', '10000'],
    ]);
  });

  it('warns once when no terminal of this run is found', async () => {
    const warnings: unknown[] = [];
    const log = {
      ...logger({ errors: [] }),
      warn: (o: object) => warnings.push(o),
    };
    const { orca, calls } = fakeOrca({
      'terminal list': () => ({ terminals }),
    });
    await new OrcaExecutor({}, orca, log).cleanupRun('b', 9);
    expect(calls.filter((c) => c[1] === 'close')).toEqual([]);
    expect(warnings).toEqual([{ branch: 'b', runId: 9 }]);
  });

  it('swallows a failing close', async () => {
    const { orca } = fakeOrca({
      'terminal list': () => ({ terminals }),
      'terminal close': () => {
        throw new Error('terminal_stop_live');
      },
    });
    await expect(
      new OrcaExecutor({}, orca).cleanupRun('b', 7),
    ).resolves.toBeUndefined();
  });

  it('swallows an unreachable Orca', async () => {
    const { orca } = fakeOrca({
      'terminal list': () => {
        throw new Error('runtime_unavailable');
      },
    });
    await expect(
      new OrcaExecutor({}, orca).cleanupRun('b', 7),
    ).resolves.toBeUndefined();
  });
});

describe('OrcaExecutor.stopRun', () => {
  it('calls nothing, so the transcript survives until cleanupRun', async () => {
    const { orca, calls } = fakeOrca();
    await new OrcaExecutor({}, orca).stopRun('b');
    expect(calls).toEqual([]);
  });
});

describe('orcaExecutor factory', () => {
  it('builds an executor plugin with id orca', () => {
    const plugin = orcaExecutor({ root: '/repo' });
    expect(plugin.kind).toBe('executor');
    expect(plugin.id).toBe('orca');
  });
});
