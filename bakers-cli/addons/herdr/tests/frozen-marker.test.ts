import type { HookListenerContext } from '@bakers-build/conductor/contract';
import {
  CommandRunner,
  type ConductorLogger,
  setDefaultCommandRunner,
} from '@bakers-build/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { herdrFrozenMarker } from '../src/frozen-marker.js';

const silent: ConductorLogger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

const WORKTREE = '/repo/.bakers-worktrees/feat/shop-42-checkout';

/** A `herdr` binary that lists one ticket workspace and records the rest. */
class FakeHerdr extends CommandRunner {
  readonly calls: string[][] = [];
  workspaces = [
    { workspace_id: 'w1', label: 'shop', worktree: { checkout_path: '/repo' } },
    {
      workspace_id: 'w2',
      label: 'feat/shop-42-checkout',
      worktree: { checkout_path: WORKTREE, is_linked_worktree: true },
    },
  ];
  constructor() {
    super(silent);
  }
  override async run(file: string, args: string[]): Promise<string> {
    if (file !== 'herdr') throw new Error(`unexpected exec ${file}`);
    if (args[0] === 'workspace' && args[1] === 'list') {
      return JSON.stringify({ result: { workspaces: this.workspaces } });
    }
    this.calls.push(args);
    return '{}';
  }
}

function ctx(worktreePath: string): HookListenerContext {
  return {
    worktreePath,
    state: 'coding',
    env: {},
    ticket: {
      uuid: 't-42',
      identifier: 'SHOP-42',
      title: 'Checkout',
      state: 'coding',
      branchName: 'feat/shop-42-checkout',
      labels: [],
      environments: [],
    },
  };
}

describe('herdr frozen marker', () => {
  let herdr: FakeHerdr;

  beforeEach(() => {
    herdr = new FakeHerdr();
    setDefaultCommandRunner(herdr);
  });

  afterEach(() => {
    setDefaultCommandRunner(new CommandRunner(silent));
  });

  it('reports a display-only token on the workspace that holds the worktree', async () => {
    await herdrFrozenMarker.on_freeze?.(ctx(WORKTREE));

    expect(herdr.calls).toEqual([
      [
        'workspace',
        'report-metadata',
        'w2',
        '--source',
        'bakers',
        '--token',
        'bb_frozen=frozen',
      ],
    ]);
  });

  it('clears the token on unfreeze', async () => {
    await herdrFrozenMarker.on_resume?.(ctx(WORKTREE));

    expect(herdr.calls).toEqual([
      [
        'workspace',
        'report-metadata',
        'w2',
        '--source',
        'bakers',
        '--clear-token',
        'bb_frozen',
      ],
    ]);
  });

  it('does nothing when no herdr workspace holds the worktree', async () => {
    await herdrFrozenMarker.on_freeze?.(ctx('/elsewhere'));

    expect(herdr.calls).toEqual([]);
  });
});
