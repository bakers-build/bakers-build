import { existsSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { herdrAgentHost } from '../src/agents.js';
import type { HerdrExec } from '../src/pane-layout.js';

const leftoverDirs: string[] = [];
afterEach(() => {
  for (const dir of leftoverDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  leftoverDirs.length = 0;
});

const flush = () => new Promise((r) => setTimeout(r, 0));
const arg = (args: string[], flag: string) => args[args.indexOf(flag) + 1];

/** A small stateful fake herdr: tracks tabs + panes so launch/split/list behave. */
function fakeHerdr() {
  const calls: string[][] = [];
  const tabs = new Map<string, string>(); // tabId -> label
  const panes = new Map<string, { tabId: string; label: string }>();
  let seq = 0;
  const exec: HerdrExec = async (args) => {
    calls.push(args);
    const [a, b] = args;
    if (a === 'pane' && b === 'run') {
      const typed = args[3] ?? '';
      if (typed.startsWith("sh '") && typed.endsWith("'")) {
        leftoverDirs.push(dirname(typed.slice("sh '".length, -1)));
      }
    }
    if (a === 'pane' && b === 'current')
      return JSON.stringify({
        result: { pane: { pane_id: 'home:p', tab_id: 'home:t' } },
      });
    if (a === 'tab' && b === 'list')
      return JSON.stringify({
        result: {
          tabs: [...tabs].map(([tab_id, label]) => ({ tab_id, label })),
        },
      });
    if (a === 'pane' && b === 'list')
      return JSON.stringify({
        result: {
          panes: [...panes].map(([pane_id, v]) => ({
            pane_id,
            tab_id: v.tabId,
            label: v.label,
          })),
        },
      });
    if (a === 'tab' && b === 'create') {
      const tabId = `t${++seq}`;
      const paneId = `p${++seq}`;
      tabs.set(tabId, arg(args, '--label') ?? '');
      panes.set(paneId, { tabId, label: '' });
      return JSON.stringify({
        result: { root_pane: { pane_id: paneId }, tab: { tab_id: tabId } },
      });
    }
    if (a === 'pane' && b === 'split') {
      const src = panes.get(args[2] ?? '');
      if (!src) throw new Error('pane_not_found');
      const paneId = `p${++seq}`;
      panes.set(paneId, { tabId: src.tabId, label: '' });
      return JSON.stringify({
        result: { pane: { pane_id: paneId, tab_id: src.tabId } },
      });
    }
    if (a === 'pane' && b === 'rename') {
      const p = panes.get(args[2] ?? '');
      if (p) p.label = args[3] ?? '';
    }
    if (a === 'pane' && b === 'close') panes.delete(args[2] ?? '');
    return '{}';
  };
  return { exec, calls, tabs, panes };
}

describe('herdrAgentHost', () => {
  it('first agent of a group creates its tab, runs, labels + zooms it', async () => {
    const h = fakeHerdr();
    await flush(); // home-tab capture
    const host = herdrAgentHost(h.exec);
    const agent = await host.launch({
      group: 'bakers',
      cwd: '/repo',
      command: 'claude go',
      env: { BB_PROJECT: 'bakers' },
      label: 'New feature',
    });
    expect(agent).toMatchObject({ group: 'bakers', label: 'New feature' });
    // created the group's tab, ran the command, renamed + zoomed the pane.
    expect(
      h.calls.some(
        (c) => c[0] === 'tab' && arg(c, '--label') === 'bakers-agents:bakers',
      ),
    ).toBe(true);
    const run = h.calls.find(
      (c) => c[0] === 'pane' && c[1] === 'run' && c[2] === agent.id,
    );
    expect(run?.[3]).toMatch(/^sh '.+\/run\.sh'$/);
    const wrapPath = (run?.[3] ?? '').slice("sh '".length, -1);
    expect(readFileSync(join(dirname(wrapPath), 'command'), 'utf8')).toBe(
      'claude go',
    );
    expect(h.calls).toContainEqual(['pane', 'rename', agent.id, 'New feature']);
    expect(h.calls).toContainEqual(['pane', 'zoom', agent.id, '--on']);
  });

  it('removes the launch directory when pane run fails', async () => {
    const h = fakeHerdr();
    await flush();
    let typed = '';
    const exec: HerdrExec = async (args) => {
      if (args[0] === 'pane' && args[1] === 'run') {
        typed = args[3] ?? '';
        await h.exec(args);
        throw new Error('pane_not_found');
      }
      return h.exec(args);
    };
    const host = herdrAgentHost(exec);
    await expect(
      host.launch({ group: 'bakers', cwd: '/repo', command: 'claude go' }),
    ).rejects.toThrow('pane_not_found');
    expect(existsSync(dirname(typed.slice("sh '".length, -1)))).toBe(false);
  });

  it('a second agent of the same group splits off the existing pane (no new tab)', async () => {
    const h = fakeHerdr();
    const host = herdrAgentHost(h.exec);
    await host.launch({ group: 'bakers', cwd: '/repo', command: 'a' });
    const tabsBefore = h.tabs.size;
    const second = await host.launch({
      group: 'bakers',
      cwd: '/repo',
      command: 'b',
    });
    expect(h.tabs.size).toBe(tabsBefore); // no new tab
    expect(h.calls.some((c) => c[0] === 'pane' && c[1] === 'split')).toBe(true);
    expect(second.group).toBe('bakers');
  });

  it('different groups get separate tabs', async () => {
    const h = fakeHerdr();
    const host = herdrAgentHost(h.exec);
    await host.launch({ group: 'bakers', cwd: '/repo', command: 'a' });
    await host.launch({ group: 'shop', cwd: '/repo', command: 'b' });
    expect([...h.tabs.values()]).toEqual(
      expect.arrayContaining(['bakers-agents:bakers', 'bakers-agents:shop']),
    );
    expect(
      h.calls.filter((c) => c[0] === 'tab' && c[1] === 'create'),
    ).toHaveLength(2);
  });

  // BB-64: the TUI-launched agents are agent panes too — the marker cannot be
  // an executor-only concern, or the panes a user actually attaches to (`bakers ui`
  // → `n`) would keep writing agent-authored commands into the shared history.
  it('marks every launched agent pane with BB_AGENT_SHELL, tab and split alike', async () => {
    const h = fakeHerdr();
    const host = herdrAgentHost(h.exec);
    // First launch creates the group tab; the second splits off its pane.
    await host.launch({ group: 'bakers', cwd: '/repo', command: 'a' });
    await host.launch({ group: 'bakers', cwd: '/repo', command: 'b' });

    const create = h.calls.find(
      (c) => c[0] === 'tab' && c[1] === 'create',
    ) as string[];
    const split = h.calls.find(
      (c) => c[0] === 'pane' && c[1] === 'split',
    ) as string[];
    expect(arg(create, '--env')).toBe('BB_AGENT_SHELL=1');
    expect(arg(split, '--env')).toBe('BB_AGENT_SHELL=1');
  });

  it('keeps the caller env alongside the agent-shell marker', async () => {
    const h = fakeHerdr();
    const host = herdrAgentHost(h.exec);
    await host.launch({
      group: 'bakers',
      cwd: '/repo',
      command: 'a',
      env: { BB_PROJECT: 'bakers' },
    });
    const create = h.calls.find(
      (c) => c[0] === 'tab' && c[1] === 'create',
    ) as string[];
    expect(create).toContain('BB_PROJECT=bakers');
    expect(create).toContain('BB_AGENT_SHELL=1');
  });

  it('list(group) returns the group tab panes as hosted agents', async () => {
    const h = fakeHerdr();
    const host = herdrAgentHost(h.exec);
    const a1 = await host.launch({
      group: 'bakers',
      cwd: '/repo',
      command: 'a',
      label: 'one',
    });
    const rows = await host.list('bakers');
    expect(rows).toContainEqual({ id: a1.id, group: 'bakers', label: 'one' });
    expect(await host.list('nope')).toEqual([]);
  });

  it('focus / kill / sendText issue the matching herdr calls', async () => {
    const h = fakeHerdr();
    const host = herdrAgentHost(h.exec);
    await host.focus('pX');
    await host.kill('pY');
    await host.sendText('pZ', 'hi');
    expect(h.calls).toContainEqual(['pane', 'zoom', 'pX', '--on']);
    expect(h.calls).toContainEqual(['pane', 'close', 'pY']);
    expect(h.calls).toContainEqual(['pane', 'send-text', 'pZ', 'hi']);
  });

  it('hide(group) un-zooms the group panes and returns to the home tab', async () => {
    const h = fakeHerdr();
    await flush(); // home capture
    const host = herdrAgentHost(h.exec);
    const a1 = await host.launch({
      group: 'bakers',
      cwd: '/repo',
      command: 'a',
    });
    h.calls.length = 0;
    await host.hide('bakers');
    expect(h.calls).toContainEqual(['pane', 'zoom', a1.id, '--off']);
    expect(h.calls).toContainEqual(['tab', 'focus', 'home:t']);
  });

  it('a stale pane is skipped: split retries a live one before recreating', async () => {
    const calls: string[][] = [];
    let listed = false;
    const exec: HerdrExec = async (args) => {
      calls.push(args);
      const [a, b] = args;
      if (a === 'pane' && b === 'current')
        return JSON.stringify({
          result: { pane: { pane_id: 'home:p', tab_id: 'home:t' } },
        });
      if (a === 'tab' && b === 'list')
        return JSON.stringify({
          result: { tabs: [{ tab_id: 'gt', label: 'bakers-agents:bakers' }] },
        });
      if (a === 'pane' && b === 'list') {
        listed = true;
        return JSON.stringify({
          result: {
            panes: [
              { pane_id: 'live', tab_id: 'gt', label: 'x' },
              { pane_id: 'dead', tab_id: 'gt', label: 'y' }, // newest → tried first
            ],
          },
        });
      }
      if (a === 'pane' && b === 'split') {
        if (args[2] === 'dead') throw new Error('pane_not_found');
        return JSON.stringify({
          result: { pane: { pane_id: 'new', tab_id: 'gt' } },
        });
      }
      return '{}';
    };
    const host = herdrAgentHost(exec);
    const agent = await host.launch({
      group: 'bakers',
      cwd: '/repo',
      command: 'a',
    });
    expect(listed).toBe(true);
    expect(calls).toContainEqual([
      'pane',
      'split',
      'dead',
      '--direction',
      'right',
      '--no-focus',
      '--cwd',
      '/repo',
      '--env',
      'BB_AGENT_SHELL=1',
    ]);
    expect(calls).toContainEqual([
      'pane',
      'split',
      'live',
      '--direction',
      'right',
      '--no-focus',
      '--cwd',
      '/repo',
      '--env',
      'BB_AGENT_SHELL=1',
    ]);
    expect(calls.some((c) => c[0] === 'tab' && c[1] === 'create')).toBe(false);
    expect(agent.id).toBe('new');
  });
});
