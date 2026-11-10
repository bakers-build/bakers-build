// A run's guard refusals reach its run log, and the ticket when the run did
// not deliver (AC-6, AC-7).
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { claudeAgent } from '@bakers-build/addon-claude';
import {
  FakeBbRemote,
  FakeExecutor,
  FakeWorkspace,
  fakeExecutor,
  fakeRemote,
  fakeWorkspace,
} from '@bakers-build/addon-fake';
import type {
  BbAgent,
  ConductorFileConfig,
} from '@bakers-build/conductor/contract';
import { emptyAgentFootprint } from '@bakers-build/conductor/contract';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_AGENT_PROMPT } from '../../src/config.js';
import { Conductor } from '../../src/core/conductor.js';

const BRANCH = 'feat/bb-1-one';
const agent: BbAgent = {
  id: 'claude',
  launchCommand: () => 'claude',
  getRunLog: async () => '',
  parseFootprint: () => emptyAgentFootprint(),
};
const quiet = { debug() {}, info() {}, warn() {}, error() {} };

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, stdio: 'pipe' });

/** A worktree whose origin has the run branch only when `pushed`. */
function worktree(root: string, pushed: boolean): string {
  const bare = join(root, 'origin.git');
  const wt = join(root, 'wt');
  git(root, 'init', '-q', '--bare', bare);
  git(root, 'clone', '-q', bare, wt);
  git(
    wt,
    '-c',
    'user.name=t',
    '-c',
    'user.email=t@t',
    'commit',
    '-q',
    '--allow-empty',
    '-m',
    'x',
  );
  git(wt, 'checkout', '-q', '-b', BRANCH);
  if (pushed) git(wt, 'push', '-q', 'origin', BRANCH);
  return wt;
}

let root: string;
let previousHome: string | undefined;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'bb-guard-finalize-'));
  previousHome = process.env.BAKERS_HOME;
  process.env.BAKERS_HOME = join(root, 'bakers');
});
afterEach(() => {
  if (previousHome === undefined) delete process.env.BAKERS_HOME;
  else process.env.BAKERS_HOME = previousHome;
});

async function finalize(
  pushed: boolean,
  refusals: number,
  { state = 'done', removed = false } = {} as {
    state?: 'done' | 'cancelled';
    removed?: boolean;
  },
) {
  const checkout = worktree(root, pushed);
  // The run's own worktree beside the checkout; finalize may find it removed.
  const wt = join(root, 'run-wt');
  if (!removed) git(checkout, 'worktree', 'add', '-q', wt, 'HEAD');
  mkdirSync(join(root, 'bakers', 'runs'), { recursive: true });
  const line = (i: number) =>
    JSON.stringify({
      at: '2026-11-10T10:00:00Z',
      command: `git push --force #${i}`,
      cwd: wt,
      rule: 'git-push',
      reason: 'git push --force would force-push',
      alternative: `git push origin HEAD:${BRANCH}`,
    });
  if (refusals > 0)
    writeFileSync(
      join(root, 'bakers', 'runs', 'r-1.guard.jsonl'),
      `${Array.from({ length: refusals }, (_, i) => line(i)).join('\n')}\n`,
    );
  const remote = new FakeBbRemote({
    tickets: {
      't-1': {
        identifier: 'BB-1',
        title: 'One',
        state: 'working',
        branchName: BRANCH,
      },
    },
    runs: [{ runUuid: 'r-1', ticketUuid: 't-1', state, worktreePath: wt }],
  });
  const published: Record<string, unknown>[] = [];
  remote.siteTools = {
    list: async () => [],
    call: async (name, args) => {
      published.push({ name, ...args });
      return { content: [] };
    },
    close: async () => {},
  };
  const config = {
    site: { base_url: 'http://web', jsonapi_prefix: '/jsonapi' },
    remote: fakeRemote(),
    executor: fakeExecutor(),
    agent: [{ agent: claudeAgent() }],
    workspace: fakeWorkspace(),
    label: 'test',
    conductor_id: 'c',
    project: 'bakers',
    states: ['working'],
    prompt: DEFAULT_AGENT_PROMPT,
    max_parallel: 1,
    poll_interval_ms: 5000,
    lease_seconds: 300,
    config_path: join(root, 'conductor.config.js'),
  } as ConductorFileConfig;
  const conductor = new Conductor(
    config,
    remote,
    new FakeExecutor(),
    new FakeWorkspace(),
    [{ id: agent.id, agent }],
    quiet,
    checkout,
  );
  await conductor.start();
  await conductor.tick();
  return { remote, published };
}

describe('guard refusals at finalize', () => {
  it('writes one run note per refusal, with the rule and the alternative', async () => {
    const { remote } = await finalize(true, 2);
    const notes = remote.calls.appendRunNote.filter((n) =>
      n.note.includes('run guard'),
    );
    expect(notes).toHaveLength(2);
    expect(notes[0]?.note).toContain('git push --force #0');
    expect(notes[0]?.note).toContain('git-push');
    expect(notes[0]?.note).toContain(`git push origin HEAD:${BRANCH}`);
  });

  it('comments on the ticket once when the run did not deliver', async () => {
    const { published } = await finalize(false, 2);
    expect(published).toHaveLength(1);
    expect(published[0]).toMatchObject({
      name: 'tool_api__bakers_comment_publish',
      ticket: 't-1',
      type: 'comment',
    });
    expect(String(published[0]?.body)).toContain('git push --force #1');
    expect(String(published[0]?.body)).toContain('force-push');
  });

  it('leaves the ticket alone when the run delivered its branch', async () => {
    const { published } = await finalize(true, 1);
    expect(published).toHaveLength(0);
  });

  it('reads delivery from the checkout when the run worktree is gone', async () => {
    const { published } = await finalize(true, 1, { removed: true });
    expect(published).toHaveLength(0);
  });

  it('comments on a cancelled run even when its branch is on origin', async () => {
    const { published } = await finalize(true, 1, { state: 'cancelled' });
    expect(published).toHaveLength(1);
  });

  it('writes nothing for a run without refusals', async () => {
    const { remote, published } = await finalize(false, 0);
    expect(
      remote.calls.appendRunNote.filter((n) => n.note.includes('run guard')),
    ).toHaveLength(0);
    expect(published).toHaveLength(0);
  });
});
