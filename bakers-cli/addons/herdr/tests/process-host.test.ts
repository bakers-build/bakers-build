import {
  CommandRunner,
  type ConductorLogger,
  setDefaultCommandRunner,
} from '@bakers-build/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { herdrProcessHost } from '../src/process-host.js';

const silent: ConductorLogger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

/**
 * A stateful fake `herdr` binary behind the default command runner, so the
 * production `herdrProcessHost` runs unchanged against a workspace table. A
 * workspace whose pane command `exec`s the conductor disappears when that
 * process ends — the behaviour herdr shows for a pane whose last process exits.
 */
class FakeHerdrBinary extends CommandRunner {
  workspaces: Array<{ workspace_id: string; label: string; cmd?: string }> = [];
  failClose = false;
  private next = 1;

  constructor() {
    super(silent);
  }

  override async run(file: string, args: string[]): Promise<string> {
    if (file !== 'herdr') throw new Error(`unexpected exec ${file}`);
    const [group, verb] = args;
    if (group === 'workspace' && verb === 'list') {
      return JSON.stringify({ result: { workspaces: this.workspaces } });
    }
    if (group === 'workspace' && verb === 'create') {
      const label = args[args.indexOf('--label') + 1] ?? '';
      const workspace_id = `w${this.next++}`;
      this.workspaces.push({ workspace_id, label });
      return JSON.stringify({
        result: {
          workspace: { workspace_id },
          root_pane: { pane_id: `${workspace_id}:p1` },
        },
      });
    }
    if (group === 'workspace' && verb === 'close') {
      this.workspaces = this.workspaces.filter(
        (w) => w.workspace_id !== args[2],
      );
      if (this.failClose) throw new Error('workspace already closed');
      return '{}';
    }
    if (group === 'pane' && verb === 'run') {
      const ws = this.workspaces.find(
        (w) => `${w.workspace_id}:p1` === args[2],
      );
      if (ws) ws.cmd = args[3];
      return '{}';
    }
    throw new Error(`unexpected herdr ${args.join(' ')}`);
  }

  /** The conductor process exits (graceful stop, SIGKILL or self-exit). */
  conductorExits(label: string): void {
    this.workspaces = this.workspaces.filter(
      (w) => !(w.label === label && w.cmd?.startsWith('exec ')),
    );
  }

  labelled(label: string) {
    return this.workspaces.filter((w) => w.label === label);
  }
}

const LABEL = 'bakers-conductor:pm-minipm-test';
const CMD = 'BB_CONDUCTOR_LOG=file bakers oven start --foreground';

describe('herdrProcessHost workspace lifecycle', () => {
  let herdr: FakeHerdrBinary;

  beforeEach(() => {
    herdr = new FakeHerdrBinary();
    setDefaultCommandRunner(herdr);
  });

  afterEach(() => {
    setDefaultCommandRunner(new CommandRunner(silent));
  });

  it('leaves no workspace behind once the conductor exits', async () => {
    await herdrProcessHost.spawn(LABEL, '/checkout', CMD);
    herdr.conductorExits(LABEL);
    expect(herdr.labelled(LABEL)).toHaveLength(0);
  });

  it('keeps at most one workspace across start-after-stop', async () => {
    // A leftover idle-shell workspace from an earlier run.
    herdr.workspaces.push({ workspace_id: 'old', label: LABEL });
    await herdrProcessHost.spawn(LABEL, '/checkout', CMD);
    expect(herdr.labelled(LABEL)).toHaveLength(1);
  });

  it('clears every duplicate-labelled workspace before starting', async () => {
    herdr.workspaces.push(
      { workspace_id: 'old1', label: LABEL },
      { workspace_id: 'old2', label: LABEL },
      { workspace_id: 'other', label: 'bakers-conductor:someone-else' },
      { workspace_id: 'prefix', label: `${LABEL}-2` },
    );
    await herdrProcessHost.spawn(LABEL, '/checkout', CMD);
    expect(herdr.labelled(LABEL)).toHaveLength(1);
    expect(herdr.labelled('bakers-conductor:someone-else')).toHaveLength(1);
    expect(herdr.labelled(`${LABEL}-2`)).toHaveLength(1);
  });

  it('still starts when closing a stale workspace fails', async () => {
    herdr.workspaces.push({ workspace_id: 'stale', label: LABEL });
    herdr.failClose = true;
    await herdrProcessHost.spawn(LABEL, '/checkout', CMD);
    expect(herdr.labelled(LABEL)).toHaveLength(1);
    const [live] = herdr.labelled(LABEL);
    expect(live?.workspace_id).not.toBe('stale');
    expect(live?.cmd?.startsWith('exec ')).toBe(true);
  });
});
