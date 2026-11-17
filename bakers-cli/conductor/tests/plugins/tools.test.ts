import { mkdtemp, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  type DiscoveredTools,
  loadTools,
  provisionRuns,
  provisionTools,
  type ToolHandler,
} from '../../src/plugins/tools.js';

function addon(
  name: string,
  handlers: Record<string, ToolHandler>,
  options?: unknown,
): DiscoveredTools {
  return {
    name,
    version: '1.0.0',
    tools: {
      contract: 1,
      tools: Object.fromEntries(
        Object.keys(handlers).map((tool) => [
          tool,
          {
            description: `${tool} tool`,
            input: {
              type: 'object',
              properties: { service: { type: 'string' } },
            },
          },
        ]),
      ),
      handlers: async (opts) => {
        expect(opts).toEqual(options);
        return handlers;
      },
    },
    ...(options !== undefined ? { options } : {}),
  };
}

const binding = { worktreePath: '/work/bb-1' };
const here = { worktreePath: tmpdir() };

describe('loadTools', () => {
  it('lets addon handlers read the loaded catalog lazily', async () => {
    let ready = false;
    const registry = await loadTools(
      [
        {
          name: 'catalog',
          version: '1',
          options: { label: 'loaded' },
          tools: {
            contract: 1,
            tools: { catalog: { description: 'catalog' } },
            handlers: async (options, host) => {
              expect(options).toEqual({ label: 'loaded' });
              return {
                catalog: async () => ({
                  text: host!.agentCatalog().default_agent,
                }),
              };
            },
          },
        },
      ],
      {
        agentCatalog: () => {
          if (!ready) throw new Error('not ready');
          return {
            agents: [],
            enabled_agents: ['loaded'],
            disabled_agents: [],
            default_agent: 'loaded',
            routes: { default: { '*': 'loaded' } },
          };
        },
      },
    );
    ready = true;
    expect(await registry.call('catalog', {}, binding)).toEqual({
      text: 'loaded',
    });
  });

  it("collects every addon's tools and calls them on the bound worktree", async () => {
    const registry = await loadTools([
      addon(
        'ports',
        {
          ports_up: async (req) => ({
            text: `${req.worktreePath} ${req.args.service}`,
          }),
        },
        { zone: 'z' },
      ),
      addon('runtime', { runtime_status: async () => ({ text: 'running' }) }),
    ]);
    expect(registry.list().map((t) => t.name)).toEqual([
      'ports_up',
      'runtime_status',
    ]);
    expect(
      await registry.call('ports_up', { service: 'web' }, binding),
    ).toEqual({ text: '/work/bb-1 web' });
  });

  it('fails on a tool name declared by two addons', async () => {
    const ping = async () => ({ text: '' });
    await expect(
      loadTools([addon('a', { ping }), addon('b', { ping })]),
    ).rejects.toThrow(/ping.*a.*b/);
  });

  it('refuses arguments outside the declared input, such as a worktree', async () => {
    const registry = await loadTools([
      addon('ports', { ports_up: async () => ({ text: 'up' }) }),
    ]);
    await expect(
      registry.call('ports_up', { service: 'web', worktree: '/x' }, binding),
    ).rejects.toThrow(/worktree|additional/);
    await expect(registry.call('nope', {}, binding)).rejects.toThrow(
      /unknown tool nope/,
    );
  });

  it('offers no provision_up tool without the hook', () => {
    expect(provisionTools(undefined)).toEqual([]);
  });

  it('runs a string provision_up hook in the bound worktree', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'bb-provision-'));
    const registry = await loadTools(provisionTools('pwd'));
    expect(registry.list().map((t) => t.name)).toEqual(['provision_up']);
    const { text } = await registry.call(
      'provision_up',
      {},
      {
        worktreePath: dir,
      },
    );
    expect(text).toBe(`exit 0\n${await realpath(dir)}\n`);
  });

  it('runs the chosen profile and refuses an unknown or missing one', async () => {
    const registry = await loadTools(
      provisionTools({ a: 'echo first', b: 'echo second' }),
    );
    expect(
      (await registry.call('provision_up', { profile: 'b' }, here)).text,
    ).toBe('exit 0\nsecond\n');
    await expect(
      registry.call('provision_up', { profile: 'c' }, here),
    ).rejects.toThrow(/profile: must be equal to one of the allowed values/);
    await expect(registry.call('provision_up', {}, here)).rejects.toThrow(
      /profile required.*a, b/,
    );
  });

  it('describes provision_up as reusing a ready environment, profiles as an enum', async () => {
    const [tool] = (
      await loadTools(provisionTools({ a: 'true', b: 'true' }))
    ).list();
    expect(tool.description).toBe(
      "Bring this worktree's environment up with a configured profile (a, b); the project's command reuses a ready environment. Returns the command's output, including the base URL. The first call on a new worktree can take minutes; the call waits until the command ends, for up to 30 minutes. On a client timeout the command keeps running: call again with the same profile to join it and receive its result, without starting a second one.",
    );
    expect(tool.inputSchema).toMatchObject({
      properties: { profile: { type: 'string', enum: ['a', 'b'] } },
    });
    const [single] = (await loadTools(provisionTools('true'))).list();
    expect(single.description).toBe(
      "Bring this worktree's environment up; the project's command reuses a ready environment. Returns the command's output, including the base URL. The first call on a new worktree can take minutes; the call waits until the command ends, for up to 30 minutes. On a client timeout the command keeps running: call again with the same profile to join it and receive its result, without starting a second one.",
    );
  });

  it('reports a failing provision_up as a tool error', async () => {
    const registry = await loadTools(provisionTools('echo broken; exit 3'));
    await expect(registry.call('provision_up', {}, here)).rejects.toThrow(
      'exit 3\nbroken\n',
    );
  });

  describe('provision_up runs, owned by the conductor', () => {
    const lines = async (file: string) =>
      (await readFile(file, 'utf8').catch(() => ''))
        .split('\n')
        .filter(Boolean);

    it('runs to completion when its caller aborts, and a later call joins it', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'bb-provision-'));
      const registry = await loadTools(
        provisionTools('sleep 0.3; echo done > marker; echo up'),
      );
      const caller = new AbortController();
      const first = registry.call(
        'provision_up',
        {},
        { worktreePath: dir },
        {
          signal: caller.signal,
        },
      );
      setTimeout(() => caller.abort(), 50);
      const joined = await registry.call(
        'provision_up',
        {},
        {
          worktreePath: dir,
        },
      );
      expect(joined.text).toBe('exit 0\nup\n');
      expect(await lines(join(dir, 'marker'))).toEqual(['done']);
      expect((await first).text).toBe('exit 0\nup\n');
    });

    it('spawns overlapping calls of one worktree and profile once, other profiles apart', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'bb-provision-'));
      const cmd = (p: string) => `echo ${p} >> count; sleep 0.2; echo ok`;
      const registry = await loadTools(
        provisionTools({ a: cmd('a'), b: cmd('b') }),
      );
      const at = { worktreePath: dir };
      const [one, two, other] = await Promise.all([
        registry.call('provision_up', { profile: 'a' }, at),
        registry.call('provision_up', { profile: 'a' }, at),
        registry.call('provision_up', { profile: 'b' }, at),
      ]);
      expect(one.text).toBe('exit 0\nok\n');
      expect(two.text).toBe(one.text);
      expect(other.text).toBe('exit 0\nok\n');
      expect((await lines(join(dir, 'count'))).sort()).toEqual(['a', 'b']);
    });

    it('starts a new run for a call after the previous one finished', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'bb-provision-'));
      const registry = await loadTools(provisionTools('echo x >> count'));
      await registry.call('provision_up', {}, { worktreePath: dir });
      await registry.call('provision_up', {}, { worktreePath: dir });
      expect(await lines(join(dir, 'count'))).toEqual(['x', 'x']);
    });

    it('kills a run at its timeout', async () => {
      const registry = await loadTools(
        provisionTools('sleep 5', provisionRuns(100)),
      );
      await expect(registry.call('provision_up', {}, here)).rejects.toThrow(
        '(killed: SIGTERM)',
      );
    });

    it('kills a run at its timeout after sh exited, while a child holds the output', async () => {
      const registry = await loadTools(
        provisionTools('sleep 5 & echo bg', provisionRuns(100)),
      );
      const started = Date.now();
      await expect(registry.call('provision_up', {}, here)).rejects.toThrow(
        'exit 124\nbg\n\n(killed: SIGTERM)',
      );
      expect(Date.now() - started).toBeLessThan(2000);
    });

    it('spawns a string hook once for overlapping calls with different profile values', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'bb-provision-'));
      const registry = await loadTools(
        provisionTools('echo x >> count; sleep 0.2'),
      );
      const at = { worktreePath: dir };
      await Promise.all([
        registry.call('provision_up', {}, at),
        registry.call('provision_up', { profile: 'x' }, at),
      ]);
      expect(await lines(join(dir, 'count'))).toEqual(['x']);
    });

    it('stop(worktree) kills that worktree only; stop() kills all', async () => {
      const [a, b] = await Promise.all([
        mkdtemp(join(tmpdir(), 'bb-provision-')),
        mkdtemp(join(tmpdir(), 'bb-provision-')),
      ]);
      const runs = provisionRuns();
      const registry = await loadTools(
        provisionTools({ slow: 'sleep 5', quick: 'sleep 0.3; echo ok' }, runs),
      );
      const call = (profile: string, worktreePath: string) =>
        registry.call('provision_up', { profile }, { worktreePath });
      const killed = (worktreePath: string) =>
        expect(call('slow', worktreePath)).rejects.toThrow('(killed: SIGTERM)');

      const killedA = killed(a);
      const quickB = call('quick', b);
      await runs.stop(a);
      await killedA;
      expect((await quickB).text).toBe('exit 0\nok\n');

      const both = Promise.all([killed(a), killed(b)]);
      await runs.stop();
      await both;
    });
  });

  it('refuses a malformed provision_up hook at load', () => {
    expect(() => provisionTools({ a: 1 } as never)).toThrow(
      /hooks.provision_up/,
    );
  });

  it("lets a tool call another addon's tool on the same worktree", async () => {
    const registry = await loadTools([
      addon('ports', {
        ports_status: async (req) => ({ text: `status ${req.worktreePath}` }),
      }),
      addon('runtime', {
        runtime_login: async (req) => req.callTool('ports_status', {}),
      }),
    ]);
    expect(await registry.call('runtime_login', {}, binding)).toEqual({
      text: 'status /work/bb-1',
    });
  });
});

describe('provision_exec', () => {
  const exec = (
    commands: Record<string, string | { command: string; args: true }>,
    isolates = false,
  ) =>
    loadTools(
      provisionTools(undefined, undefined, { exec: commands, isolates }),
    );

  it('runs the configured command with the arguments as literal argv after --', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'bb-provision-exec-'));
    await writeFile(
      join(dir, 'show.sh'),
      'for arg in "$@"; do echo "<$arg>"; done\n',
    );
    const registry = await exec({
      show: { command: 'sh show.sh', args: true },
    });
    expect(registry.list().map((t) => t.name)).toEqual(['provision_exec']);
    const { text } = await registry.call(
      'provision_exec',
      { key: 'show', args: ['$(touch planted)', '--service=db', 'a b', ';id'] },
      { worktreePath: dir },
    );
    expect(text).toBe(
      'exit 0\n<-->\n<$(touch planted)>\n<--service=db>\n<a b>\n<;id>\n',
    );
    await expect(stat(join(dir, 'planted'))).rejects.toThrow();
  });

  it('runs a plain key as its fixed command and refuses arguments for it', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'bb-provision-fixed-'));
    const registry = await exec({ fixed: 'echo "[$#]"; touch ran' });
    await expect(
      registry.call(
        'provision_exec',
        { key: 'fixed', args: ['sudo', 'id'] },
        { worktreePath: dir },
      ),
    ).rejects.toThrow(/fixed takes no arguments/);
    await expect(stat(join(dir, 'ran'))).rejects.toThrow();
    expect(
      (
        await registry.call(
          'provision_exec',
          { key: 'fixed', args: [] },
          { worktreePath: dir },
        )
      ).text,
    ).toBe('exit 0\n[0]\n');
  });

  it('refuses an unknown key and reports a failing command', async () => {
    const registry = await exec({ ok: 'true', fail: 'echo broken; exit 3' });
    await expect(
      registry.call('provision_exec', { key: 'other' }, here),
    ).rejects.toThrow(/key: must be equal to one of the allowed values/);
    await expect(
      registry.call('provision_exec', { key: 'fail' }, here),
    ).rejects.toThrow(/exit 3\nbroken/);
  });

  it('tells host commands the worktree path and whether the runtime isolates', async () => {
    const dir = await realpath(
      await mkdtemp(join(tmpdir(), 'bb-provision-env-')),
    );
    const show = 'echo "$BAKERS_WORKTREE_PATH $BAKERS_RUNTIME_ISOLATES"';
    for (const isolates of [true, false]) {
      const registry = await loadTools(
        provisionTools({ up: show }, undefined, { exec: { show }, isolates }),
      );
      const expected = `exit 0\n${dir} ${isolates ? 1 : 0}\n`;
      const binding = { worktreePath: dir };
      expect(
        (await registry.call('provision_up', { profile: 'up' }, binding)).text,
      ).toBe(expected);
      expect(
        (await registry.call('provision_exec', { key: 'show' }, binding)).text,
      ).toBe(expected);
    }
  });
});
