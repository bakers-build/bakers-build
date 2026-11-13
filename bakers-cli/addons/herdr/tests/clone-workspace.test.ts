import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ConductorFileConfig } from '@bakers-build/conductor/contract';
import { loadRunClone } from '@bakers-build/core';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { HerdrExecutor } from '../src/index.js';
import { HerdrWorkspace, herdrWorkspace } from '../src/workspace.js';

let base: string;
let root: string;
let cacheHome: string | undefined;
const BRANCH = 'feat/bb-1-one';
const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'bakers-herdr-clone-'));
  root = join(base, 'repo');
  mkdirSync(join(root, '.bakers'), { recursive: true });
  git(root, 'init', '-q', '-b', 'main');
  writeFileSync(join(root, 'WORKFLOW.md'), 'rules');
  writeFileSync(join(root, '.gitignore'), '/.bakers-worktrees/\n');
  git(root, 'add', '.');
  git(root, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'b');
  git(root, 'update-ref', 'refs/remotes/origin/next', 'HEAD');
  cacheHome = process.env.XDG_CACHE_HOME;
  process.env.XDG_CACHE_HOME = join(base, 'cache');
});
afterEach(() => {
  if (cacheHome === undefined) delete process.env.XDG_CACHE_HOME;
  else process.env.XDG_CACHE_HOME = cacheHome;
  rmSync(base, { recursive: true, force: true });
});

/** A herdr that knows plain workspaces by label and no worktrees. */
function fakeHerdr(open: Array<{ id: string; label: string }> = []) {
  const calls: string[][] = [];
  const exec = async (args: string[]) => {
    calls.push(args);
    const [noun, verb] = args;
    if (noun === 'worktree' && verb === 'list')
      return JSON.stringify({ result: { worktrees: [] } });
    if (noun === 'workspace' && verb === 'list')
      return JSON.stringify({
        result: {
          workspaces: open.map(({ id, label }) => ({
            workspace_id: id,
            label,
            focused: false,
          })),
        },
      });
    if (noun === 'workspace' && verb === 'create') {
      const label = args[args.indexOf('--label') + 1] as string;
      open.push({ id: 'ws-new', label });
      return JSON.stringify({
        result: {
          workspace: { workspace_id: 'ws-new' },
          root_pane: { pane_id: 'pane-1', tab_id: 'tab-1' },
        },
      });
    }
    if (noun === 'workspace' && verb === 'close') {
      open.splice(
        open.findIndex(({ id }) => id === args[2]),
        1,
      );
      return '{}';
    }
    if (noun === 'tab' && verb === 'list')
      return JSON.stringify({ result: { tabs: [] } });
    throw new Error(`unexpected herdr ${args.join(' ')}`);
  };
  return { calls, exec, open };
}
const verbs = (calls: string[][]) => calls.map((call) => call.slice(0, 2));

it('ensures a run clone and a plain herdr workspace instead of a herdr worktree', async () => {
  const herdr = fakeHerdr();
  const workspace = new HerdrWorkspace({
    root,
    clone: true,
    execHerdr: herdr.exec,
  });

  const first = await workspace.ensure('BB-1', BRANCH, 'origin/next');

  const path = join(root, '.bakers-worktrees', BRANCH);
  expect(first).toMatchObject({ path, created: true });
  expect(first.instructions?.text).toBe('rules');
  expect(first.clone).toMatchObject({
    workspace: path,
    branch: BRANCH,
    target: 'next',
    shared: false,
  });
  expect(existsSync(join(path, '.git'))).toBe(false);
  expect(git(root, 'rev-parse', BRANCH)).toBe(
    git(root, 'rev-parse', 'origin/next'),
  );
  expect(verbs(herdr.calls)).not.toContainEqual(['worktree', 'create']);
  expect(herdr.calls).toContainEqual([
    'workspace',
    'create',
    '--cwd',
    path,
    '--label',
    BRANCH,
    '--no-focus',
  ]);

  herdr.calls.length = 0;
  const second = await workspace.ensure('BB-1', BRANCH, 'origin/next');
  expect(second.created).toBe(false);
  expect(verbs(herdr.calls)).not.toContainEqual(['workspace', 'create']);
});

it('reads shared from the herdr addon options and clones only under an isolating runtime', async () => {
  const config = (isolates: boolean) =>
    ({
      config_path: join(root, '.bakers/project.config.js'),
      runtime: { isolates },
    }) as unknown as ConductorFileConfig;
  const herdr = fakeHerdr();
  const isolated = await herdrWorkspace({
    shared: true,
    execHerdr: herdr.exec,
  }).createWorkspace(config(true));
  expect((await isolated.ensure('BB-1', BRANCH)).clone?.shared).toBe(true);

  // runtime-host keeps herdr worktrees: the first call lists them.
  const host = fakeHerdr();
  const plain = await herdrWorkspace({
    shared: true,
    execHerdr: host.exec,
  }).createWorkspace(config(false));
  await expect(plain.ensure('BB-2', 'feat/bb-2')).rejects.toThrow(
    /unexpected herdr worktree create/,
  );
});

it('closes the plain workspace and removes the clone on teardown', async () => {
  const herdr = fakeHerdr();
  const workspace = new HerdrWorkspace({
    root,
    clone: true,
    execHerdr: herdr.exec,
  });
  const ws = await workspace.ensure('BB-1', BRANCH);

  expect(await workspace.remove(BRANCH, ws.path)).toBe('removed');

  expect(herdr.calls).toContainEqual(['workspace', 'close', 'ws-new']);
  expect(existsSync(ws.path)).toBe(false);
  expect(loadRunClone(ws.path)).toBeUndefined();
});

it('the executor starts and cleans a run in the clone workspace without herdr worktree commands', async () => {
  const herdr = fakeHerdr();
  const ws = await new HerdrWorkspace({
    root,
    clone: true,
    execHerdr: herdr.exec,
  }).ensure('BB-1', BRANCH);
  herdr.calls.length = 0;
  const tabExec = async (args: string[]) => {
    if (args[0] === 'tab' && args[1] === 'create') {
      herdr.calls.push(args);
      throw new Error('stop after the workspace was resolved');
    }
    return herdr.exec(args);
  };
  const executor = new HerdrExecutor({ root, command: 'true' }, tabExec, {
    debug() {},
    info() {},
    warn() {},
    error() {},
  });

  await expect(
    executor.startRun({
      ticket: {
        uuid: 't',
        identifier: 'BB-1',
        title: 'One',
        branchName: BRANCH,
        state: 'working',
      },
      run: { uuid: 'r', id: 7, handler: 'code' },
      workspacePath: ws.path,
      instructions: null,
      command: 'true',
      env: {},
    }),
  ).rejects.toThrow(/stop after the workspace was resolved/);
  const create = herdr.calls.find(
    (call) => call[0] === 'tab' && call[1] === 'create',
  );
  expect(create?.[create.indexOf('--workspace') + 1]).toBe('ws-new');
  expect(verbs(herdr.calls)).not.toContainEqual(['worktree', 'open']);

  herdr.calls.length = 0;
  await executor.cleanupRun(BRANCH, 7);
  expect(herdr.calls).toContainEqual(['tab', 'list', '--workspace', 'ws-new']);
  expect(readFileSync(join(ws.path, 'WORKFLOW.md'), 'utf8')).toBe('rules');
});
