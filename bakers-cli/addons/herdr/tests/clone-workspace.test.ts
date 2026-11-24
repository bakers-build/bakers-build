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
import { ensureRunClone } from '@bakers-build/addon-workspace-git';
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

/**
 * A herdr that knows workspaces by label and the worktrees it opened; it
 * opens a worktree only for a path the parent's `git worktree list` knows.
 */
function fakeHerdr(
  open: Array<{ id: string; label: string }> = [],
  focused?: string,
) {
  const calls: string[][] = [];
  const worktrees: Array<{ path: string; branch: string; id: string }> = [];
  const exec = async (args: string[]) => {
    calls.push(args);
    const [noun, verb] = args;
    const arg = (flag: string) => args[args.indexOf(flag) + 1] as string;
    if (noun === 'worktree' && verb === 'list') {
      // Mirrors git: a path git no longer lists drops out.
      const listed = git(arg('--cwd'), 'worktree', 'list', '--porcelain');
      return JSON.stringify({
        result: {
          worktrees: worktrees
            .filter(({ path }) => listed.includes(`worktree ${path}\n`))
            .map(({ path, branch, id }) => ({
              path,
              branch,
              open_workspace_id: open.some((w) => w.id === id) ? id : null,
            })),
        },
      });
    }
    if (noun === 'worktree' && verb === 'create') {
      const [cwd, path, branch] = [
        arg('--cwd'),
        arg('--path'),
        arg('--branch'),
      ];
      const exists = git(cwd, 'branch', '--list', branch) !== '';
      git(
        cwd,
        'worktree',
        'add',
        '-q',
        ...(exists
          ? [path, branch]
          : [
              '-b',
              branch,
              path,
              ...(args.includes('--base') ? [arg('--base')] : []),
            ]),
      );
      open.push({ id: 'ws-created', label: arg('--label') });
      // One entry per path, as in git.
      worktrees.splice(
        0,
        Infinity,
        ...worktrees.filter((w) => w.path !== path),
      );
      worktrees.push({ path, branch, id: 'ws-created' });
      return JSON.stringify({ result: { worktree: { path } } });
    }
    if (noun === 'worktree' && verb === 'open') {
      const path = arg('--path');
      if (!git(arg('--cwd'), 'worktree', 'list').includes(path))
        throw new Error(`worktree path not found: ${path}`);
      open.push({ id: 'ws-new', label: arg('--label') });
      worktrees.push({ path, branch: arg('--label'), id: 'ws-new' });
      return JSON.stringify({
        result: {
          workspace: { workspace_id: 'ws-new' },
          root_pane: { pane_id: 'pane-1', tab_id: 'tab-1' },
        },
      });
    }
    if (noun === 'workspace' && verb === 'list')
      return JSON.stringify({
        result: {
          workspaces: open.map(({ id, label }) => ({
            workspace_id: id,
            label,
            focused: id === focused,
          })),
        },
      });
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

it('ensures a run clone and opens it as a herdr worktree of the parent, once per branch', async () => {
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
  expect(git(root, 'rev-parse', BRANCH)).toBe(
    git(root, 'rev-parse', 'origin/next'),
  );
  expect(git(root, 'worktree', 'list', '--porcelain')).toContain(
    `worktree ${path}\n`,
  );
  expect(verbs(herdr.calls)).not.toContainEqual(['worktree', 'create']);
  expect(verbs(herdr.calls)).not.toContainEqual(['workspace', 'create']);
  expect(herdr.calls).toContainEqual([
    'worktree',
    'open',
    '--cwd',
    root,
    '--path',
    path,
    '--label',
    BRANCH,
    '--no-focus',
    '--json',
  ]);

  herdr.calls.length = 0;
  const second = await workspace.ensure('BB-1', BRANCH, 'origin/next');
  expect(second.created).toBe(false);
  expect(verbs(herdr.calls)).not.toContainEqual(['worktree', 'open']);
  expect(herdr.open).toHaveLength(1);
});

it('reuses a plain workspace a run opened before the clone was a worktree', async () => {
  const herdr = fakeHerdr([{ id: 'ws-old', label: BRANCH }]);
  const workspace = new HerdrWorkspace({
    root,
    clone: true,
    execHerdr: herdr.exec,
  });

  await workspace.ensure('BB-1', BRANCH);

  expect(verbs(herdr.calls)).not.toContainEqual(['worktree', 'open']);
  expect(herdr.open).toEqual([{ id: 'ws-old', label: BRANCH }]);
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

  // runtime-host keeps herdr worktrees.
  const host = fakeHerdr();
  const plain = await herdrWorkspace({
    shared: true,
    execHerdr: host.exec,
  }).createWorkspace(config(false));
  expect((await plain.ensure('BB-2', 'feat/bb-2')).clone).toBeUndefined();
  expect(verbs(host.calls)).toContainEqual(['worktree', 'create']);
});

it('takes shared from the isolating runtime, the workspace option as fallback', async () => {
  const cases: [boolean | undefined, boolean | undefined, boolean][] = [
    [true, undefined, true],
    [undefined, true, true],
    [false, true, false],
    [undefined, undefined, false],
  ];
  for (const [i, [runtime, workspace, expected]] of cases.entries()) {
    const config = {
      config_path: join(root, '.bakers/project.config.js'),
      runtime: {
        isolates: true,
        ...(runtime === undefined ? {} : { shared: runtime }),
      },
    } as unknown as ConductorFileConfig;
    const ws = await herdrWorkspace({
      ...(workspace === undefined ? {} : { shared: workspace }),
      execHerdr: fakeHerdr().exec,
    }).createWorkspace(config);
    expect(
      (await ws.ensure(`BB-${10 + i}`, `feat/bb-${10 + i}`)).clone?.shared,
    ).toBe(expected);
  }
});

it('marks the workspace shared option deprecated in favor of the runtime', () => {
  const schema = JSON.parse(
    readFileSync(new URL('../options.schema.json', import.meta.url), 'utf8'),
  );
  expect(schema.properties.shared.deprecated).toBe(true);
  expect(schema.properties.shared.description).toMatch(
    /runtime-bwrap.*runtime-docker/,
  );
});

it('closes the workspace and removes the clone and its worktree entry on teardown', async () => {
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
  expect(git(root, 'worktree', 'list', '--porcelain')).not.toContain(ws.path);
});

/** An executor whose `startRun` stops at the tab, once the workspace is resolved. */
function executorOn(herdr: ReturnType<typeof fakeHerdr>) {
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
  const start = (workspacePath: string) =>
    expect(
      executor.startRun({
        ticket: {
          uuid: 't',
          identifier: 'BB-1',
          title: 'One',
          branchName: BRANCH,
          state: 'working',
        },
        run: { uuid: 'r', id: 7, handler: 'code' },
        workspacePath,
        instructions: null,
        command: 'true',
        env: {},
      }),
    ).rejects.toThrow(/stop after the workspace was resolved/);
  return { executor, start };
}

it('the executor starts and cleans a run in the open clone workspace without opening it again', async () => {
  const herdr = fakeHerdr();
  const ws = await new HerdrWorkspace({
    root,
    clone: true,
    execHerdr: herdr.exec,
  }).ensure('BB-1', BRANCH);
  herdr.calls.length = 0;
  const { executor, start } = executorOn(herdr);

  await start(ws.path);
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

it('the executor opens a clone another workspace addon made', async () => {
  const herdr = fakeHerdr();
  const path = join(root, '.bakers-worktrees', BRANCH);
  git(root, 'branch', BRANCH);
  ensureRunClone({ parent: root, workspace: path, branch: BRANCH });

  await executorOn(herdr).start(path);

  expect(herdr.open).toEqual([{ id: 'ws-new', label: BRANCH }]);
});

const commit = (cwd: string, file: string) => {
  writeFileSync(join(cwd, file), file);
  git(cwd, 'add', file);
  git(cwd, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', file);
};

it('switches an isolating workspace to a host worktree for a host run, keeping the clone commits', async () => {
  const herdr = fakeHerdr();
  const workspace = new HerdrWorkspace({
    root,
    clone: true,
    execHerdr: herdr.exec,
  });
  const { path } = await workspace.ensure('BB-1', BRANCH, 'origin/next');
  commit(path, 'isolated.txt');

  const host = await workspace.ensure('BB-1', BRANCH, 'origin/next', {
    clone: false,
  });

  expect(host).toMatchObject({ path, created: true });
  expect(host.clone).toBeUndefined();
  expect(loadRunClone(path)).toBeUndefined();
  expect(git(path, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe(BRANCH);
  expect(git(root, 'log', '--format=%s', BRANCH)).toContain('isolated.txt');
  expect(herdr.open).toEqual([{ id: 'ws-created', label: BRANCH }]);
});

it('switches a host worktree back to a run clone for an isolated run, keeping the worktree commits', async () => {
  const herdr = fakeHerdr();
  const workspace = new HerdrWorkspace({ root, execHerdr: herdr.exec });
  const { path } = await workspace.ensure('BB-1', BRANCH, 'origin/next');
  commit(path, 'host.txt');

  const isolated = await workspace.ensure('BB-1', BRANCH, 'origin/next', {
    clone: true,
  });

  expect(isolated.clone).toMatchObject({ workspace: path, branch: BRANCH });
  expect(loadRunClone(path)).toBeDefined();
  expect(git(path, 'log', '--format=%s')).toContain('host.txt');
  expect(herdr.open.filter((w) => w.label === BRANCH)).toHaveLength(1);
});

it('refuses to leave a run clone with uncommitted work and keeps it', async () => {
  const herdr = fakeHerdr();
  const workspace = new HerdrWorkspace({
    root,
    clone: true,
    execHerdr: herdr.exec,
  });
  const { path } = await workspace.ensure('BB-1', BRANCH, 'origin/next');
  writeFileSync(join(path, 'draft.txt'), 'wip');

  await expect(
    workspace.ensure('BB-1', BRANCH, 'origin/next', { clone: false }),
  ).rejects.toThrow(`run clone: ${path} has uncommitted work`);

  expect(readFileSync(join(path, 'draft.txt'), 'utf8')).toBe('wip');
  expect(loadRunClone(path)).toBeDefined();
  expect(verbs(herdr.calls)).not.toContainEqual(['worktree', 'create']);
  expect(herdr.open.filter((w) => w.label === BRANCH)).toHaveLength(1);
});

it('refuses to leave a focused run clone no parent workspace can take focus from', async () => {
  const herdr = fakeHerdr([], 'ws-new');
  const workspace = new HerdrWorkspace({
    root,
    clone: true,
    execHerdr: herdr.exec,
  });
  const { path } = await workspace.ensure('BB-1', BRANCH, 'origin/next');

  await expect(
    workspace.ensure('BB-1', BRANCH, 'origin/next', { clone: false }),
  ).rejects.toThrow(
    `herdr workspace: ${path} is focused and no parent workspace can take focus`,
  );

  expect(loadRunClone(path)).toBeDefined();
  expect(herdr.open.filter((w) => w.label === BRANCH)).toHaveLength(1);
});

it('refuses to turn a worktree with uncommitted work into a run clone and keeps it', async () => {
  const herdr = fakeHerdr();
  const workspace = new HerdrWorkspace({ root, execHerdr: herdr.exec });
  const { path } = await workspace.ensure('BB-1', BRANCH, 'origin/next');
  writeFileSync(join(path, 'draft.txt'), 'wip');

  await expect(
    workspace.ensure('BB-1', BRANCH, 'origin/next', { clone: true }),
  ).rejects.toThrow(
    `run clone: ${path} is a linked worktree with uncommitted work`,
  );

  expect(readFileSync(join(path, 'draft.txt'), 'utf8')).toBe('wip');
  expect(loadRunClone(path)).toBeUndefined();
});

it('tears down whichever mode the last switch left', async () => {
  const herdr = fakeHerdr();
  const workspace = new HerdrWorkspace({
    root,
    clone: true,
    execHerdr: herdr.exec,
  });
  const { path } = await workspace.ensure('BB-1', BRANCH, 'origin/next');
  await workspace.ensure('BB-1', BRANCH, 'origin/next', { clone: false });
  await workspace.ensure('BB-1', BRANCH, 'origin/next', { clone: true });

  expect(await workspace.remove(BRANCH, path)).toBe('removed');
  expect(existsSync(path)).toBe(false);
  expect(loadRunClone(path)).toBeUndefined();
  expect(git(root, 'worktree', 'list', '--porcelain')).not.toContain(path);
});

it('tears down a host worktree an isolating workspace switched to', async () => {
  const herdr = fakeHerdr();
  const removeExec = async (args: string[]) => {
    if (args[0] === 'worktree' && args[1] === 'remove') {
      herdr.calls.push(args);
      git(
        root,
        'worktree',
        'remove',
        '--force',
        join(root, '.bakers-worktrees', BRANCH),
      );
      return '{}';
    }
    return herdr.exec(args);
  };
  const workspace = new HerdrWorkspace({
    root,
    clone: true,
    execHerdr: removeExec,
  });
  const { path } = await workspace.ensure('BB-1', BRANCH, 'origin/next');
  await workspace.ensure('BB-1', BRANCH, 'origin/next', { clone: false });

  expect(await workspace.remove(BRANCH, path)).toBe('removed');
  expect(herdr.calls).toContainEqual([
    'worktree',
    'remove',
    '--workspace',
    'ws-created',
    '--force',
    '--json',
  ]);
  expect(existsSync(path)).toBe(false);
});
