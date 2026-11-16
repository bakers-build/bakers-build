// Network git that trusts nothing in the run's clone. Every fetch and push
// runs in a throwaway bare repository whose object directory is the clone's
// own store, with no global, system or repository config, no hooks, and only
// the remote's protocol allowed. The token reaches git as an environment
// header, never argv, URL or file. Against the clone itself only `rev-parse`,
// `for-each-ref` and `update-ref` run, with hooks and fsmonitor disabled.

import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type PendingUpdate,
  UI_REFRESH_FILE,
  type UpdateConflict,
} from '@bakers-build/core';

export interface GitAuth {
  /** The configured repository URL, never the clone's `origin`. */
  readonly url: string;
  /** An HTTP header line (`Authorization: …`) git sends to the remote. */
  readonly header: string;
}

export interface PushLease {
  readonly forceWithLease?: boolean;
  /** The remote SHA the lease expects; default: refs/remotes/origin/<branch>. */
  readonly expectedSha?: string;
}

const HARDEN = ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false'];

function baseEnv(home: string): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH,
    HOME: home,
    LANG: 'C',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_TERMINAL_PROMPT: '0',
  };
}

function run(
  args: string[],
  env: NodeJS.ProcessEnv,
  input?: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      'git',
      args,
      { env, maxBuffer: 16 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err)
          reject(
            Object.assign(
              new Error(`git failed: ${stderr.trim() || err.message}`),
              { code: err.code, stdout },
            ),
          );
        else resolve(stdout.trim());
      },
    );
    if (input !== undefined) child.stdin?.end(input);
  });
}

/** The clone's common git dir (shared by all its worktrees). */
async function commonDir(worktree: string, env: NodeJS.ProcessEnv) {
  return run(
    [
      '-C',
      worktree,
      ...HARDEN,
      'rev-parse',
      '--path-format=absolute',
      '--git-common-dir',
    ],
    env,
  );
}

const inClone = (common: string, env: NodeJS.ProcessEnv, ...args: string[]) =>
  run([`--git-dir=${common}`, ...HARDEN, ...args], env);

async function readRef(common: string, env: NodeJS.ProcessEnv, ref: string) {
  try {
    return await inClone(
      common,
      env,
      'rev-parse',
      '--verify',
      '-q',
      `${ref}^{commit}`,
    );
  } catch {
    return undefined;
  }
}

/** Run `body` with a scratch repository on the clone's object store. */
async function withScratch<T>(
  worktree: string,
  auth: GitAuth,
  body: (ctx: {
    common: string;
    env: NodeJS.ProcessEnv;
    home: string;
    remote: (
      args: string[],
      input?: string,
      extra?: NodeJS.ProcessEnv,
    ) => Promise<string>;
  }) => Promise<T>,
): Promise<T> {
  const home = await mkdtemp(join(tmpdir(), 'bakers-forge-'));
  try {
    const env = baseEnv(home);
    const common = await commonDir(worktree, env);
    // The conductor's git would read any object store the run lists here.
    const alternates = await readFile(
      join(common, 'objects', 'info', 'alternates'),
      'utf8',
    ).catch(() => '');
    if (alternates.trim())
      throw new Error(
        'the clone lists object alternates (objects/info/alternates); forge tools refuse a borrowed object store',
      );
    const scratch = join(home, 'scratch.git');
    await run(['init', '--bare', '-q', scratch], env);
    const scheme = new URL(auth.url).protocol.slice(0, -1);
    const config: [string, string][] = [
      ['core.hooksPath', '/dev/null'],
      ['core.fsmonitor', 'false'],
      ['protocol.allow', 'never'],
      [`protocol.${scheme}.allow`, 'always'],
      ['gc.auto', '0'],
      ['maintenance.auto', 'false'],
      ['http.extraHeader', auth.header],
    ];
    const remoteEnv: NodeJS.ProcessEnv = {
      ...env,
      GIT_DIR: scratch,
      GIT_OBJECT_DIRECTORY: join(common, 'objects'),
      GIT_CONFIG_COUNT: String(config.length),
    };
    config.forEach(([key, value], i) => {
      remoteEnv[`GIT_CONFIG_KEY_${i}`] = key;
      remoteEnv[`GIT_CONFIG_VALUE_${i}`] = value;
    });
    return await body({
      common,
      env,
      home,
      remote: (args, input, extra) =>
        run(args, { ...remoteEnv, ...extra }, input),
    });
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

type Scratch = Parameters<Parameters<typeof withScratch>[2]>[0];

/**
 * Git over the run's workspace through a throwaway index at `head`, under only
 * the scratch's clean config: no filter, driver, hook or fsmonitor runs, and
 * Git itself refuses paths beyond a symlink.
 */
async function workspaceGit(
  { home, remote }: Scratch,
  path: string,
  /** A commit for status; without, read a tree into the index yourself. */
  head?: string,
) {
  await mkdir(join(home, 'scratch.git', 'info'), { recursive: true });
  await writeFile(
    join(home, 'scratch.git', 'info', 'exclude'),
    `/.bakers/${UI_REFRESH_FILE}\n`,
  );
  const tree = { GIT_WORK_TREE: path, GIT_INDEX_FILE: join(home, 'index') };
  if (head) {
    await remote(['update-ref', '--no-deref', 'HEAD', head]);
    await remote(['read-tree', 'HEAD'], undefined, tree);
  }
  return (args: string[]) => remote(args, undefined, tree);
}

const literal = (path: string) => `:(literal)${path}`;

/** Changed and untracked paths of the workspace against its head, `except` left out. */
async function dirtyPaths(
  wt: (args: string[]) => Promise<string>,
  except: readonly string[] = [],
): Promise<string[]> {
  const out = await wt([
    'status',
    '--porcelain',
    '--untracked-files=all',
    '--no-renames',
    '--',
    '.',
    ...except.map((path) => `:(exclude,literal)${path}`),
  ]);
  return out
    .split('\n')
    .filter(Boolean)
    .map((l) => l.replace(/^[ MADRCU?!]{1,2} /, ''));
}

/** The SHA of a local branch of the clone, if it exists. */
export async function localSha(
  worktree: string,
  branch: string,
): Promise<string | undefined> {
  const home = await mkdtemp(join(tmpdir(), 'bakers-forge-'));
  try {
    const env = baseEnv(home);
    return await readRef(
      await commonDir(worktree, env),
      env,
      `refs/heads/${branch}`,
    );
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

/** Remote heads of `branches` as `name → sha`; absent names are left out. */
function parseLsRemote(out: string): Map<string, string> {
  const heads = new Map<string, string>();
  for (const line of out.split('\n')) {
    const [sha, ref] = line.split('\t');
    if (sha && ref?.startsWith('refs/heads/'))
      heads.set(ref.slice('refs/heads/'.length), sha);
  }
  return heads;
}

/**
 * Fetch `branches` into the clone's `refs/remotes/origin/<name>`, no tags.
 * Branches the remote lacks are skipped. Changes nothing remote.
 */
export async function fetchBranches(
  worktree: string,
  auth: GitAuth,
  branches: readonly string[],
): Promise<{ name: string; sha: string }[]> {
  return withScratch(worktree, auth, async ({ common, env, remote }) => {
    const heads = parseLsRemote(
      await remote([
        'ls-remote',
        '--heads',
        auth.url,
        ...branches.map((b) => `refs/heads/${b}`),
      ]),
    );
    const wanted = branches.filter(
      (b, i) => heads.has(b) && branches.indexOf(b) === i,
    );
    if (wanted.length === 0) return [];
    // The clone's remote-tracking refs seed negotiation, so only new objects travel.
    const known = await inClone(
      common,
      env,
      'for-each-ref',
      '--format=create %(refname) %(objectname)',
      'refs/remotes/origin/',
    );
    // A ref to an object the store lacks only costs negotiation; ignore it.
    if (known)
      await remote(['update-ref', '--stdin'], `${known}\n`).catch(() => '');
    await remote([
      'fetch',
      '--no-tags',
      '--no-write-fetch-head',
      '-q',
      auth.url,
      ...wanted.map((b) => `+refs/heads/${b}:refs/remotes/origin/${b}`),
    ]);
    const out: { name: string; sha: string }[] = [];
    for (const name of wanted) {
      // What the fetch wrote, not ls-remote's answer: the remote may have moved since.
      const sha = await remote(['rev-parse', `refs/remotes/origin/${name}`]);
      await inClone(
        common,
        env,
        'update-ref',
        `refs/remotes/origin/${name}`,
        sha,
      );
      out.push({ name, sha });
    }
    return out;
  });
}

/**
 * Push the clone's `refs/heads/<branch>` to the remote's branch of the same
 * name. Without a lease only a fast-forward lands; with one, the remote must
 * still be at the expected SHA (absent remote-tracking ref: no branch).
 * Returns the pushed SHA and records it as refs/remotes/origin/<branch>.
 */
export async function pushBranch(
  worktree: string,
  auth: GitAuth,
  branch: string,
  lease: PushLease,
): Promise<string> {
  return withScratch(worktree, auth, async ({ common, env, remote }) => {
    const sha = await readRef(common, env, `refs/heads/${branch}`);
    if (!sha) throw new Error(`no local branch '${branch}' to push`);
    const args = ['push', '--porcelain', '--no-verify'];
    if (lease.forceWithLease) {
      const expected =
        lease.expectedSha ??
        (await readRef(common, env, `refs/remotes/origin/${branch}`)) ??
        '';
      args.push(`--force-with-lease=refs/heads/${branch}:${expected}`);
    }
    await remote([...args, auth.url, `${sha}:refs/heads/${branch}`]);
    await inClone(
      common,
      env,
      'update-ref',
      `refs/remotes/origin/${branch}`,
      sha,
    );
    return sha;
  });
}

export interface BranchUpdate {
  /** The branch tip before the update. */
  previous: string;
  /** The fetched target tip that was merged. */
  target: string;
  /** The branch tip after the update; `previous` for a no-op or a conflict. */
  resulting: string;
  noop: boolean;
  /** Set on a conflict: nothing moved, `tree` holds merge-tree's result. */
  conflicts?: UpdateConflict[];
  tree?: string;
}

/** merge-tree's `-z` conflicted file info as one entry per path, kinded by its stages. */
function parseConflicts(entries: readonly string[]): UpdateConflict[] {
  const stages = new Map<string, Set<string>>();
  for (const entry of entries) {
    const m = /^\d+ [0-9a-f]+ ([123])\t([\s\S]+)$/.exec(entry);
    if (m) stages.set(m[2]!, (stages.get(m[2]!) ?? new Set()).add(m[1]!));
  }
  return [...stages].map(([path, s]): UpdateConflict => {
    if (s.has('2') && s.has('3'))
      return { path, kind: s.has('1') ? 'content' : 'add_add' };
    if (s.has('1') && (s.has('2') || s.has('3')))
      return {
        path,
        kind: 'modify_delete',
        deleted_by: s.has('2') ? 'target' : 'branch',
      };
    return { path, kind: 'content' };
  });
}

const BOT = {
  GIT_AUTHOR_NAME: 'bakers.build',
  GIT_AUTHOR_EMAIL: 'noreply@bakers.build',
  GIT_COMMITTER_NAME: 'bakers.build',
  GIT_COMMITTER_EMAIL: 'noreply@bakers.build',
};

/** Commit `tree` as the merge of `target` into `branch`, then compare-and-swap the branch from `previous`. */
async function commitMerge(
  { common, env, remote }: Scratch,
  m: {
    branch: string;
    targetBranch: string;
    previous: string;
    target: string;
    tree: string;
  },
  beforeMove: (resulting: string) => void = () => {},
): Promise<string> {
  const resulting = await remote(
    [
      'commit-tree',
      m.tree,
      '-p',
      m.previous,
      '-p',
      m.target,
      '-m',
      `Merge ${m.targetBranch} into ${m.branch}`,
    ],
    undefined,
    BOT,
  );
  beforeMove(resulting);
  // Compare-and-swap: a branch that moved meanwhile is refused, never overwritten.
  await inClone(
    common,
    env,
    'update-ref',
    `refs/heads/${m.branch}`,
    resulting,
    m.previous,
  );
  return resulting;
}

async function refusePushedElsewhere(
  { common, env, remote }: Scratch,
  branch: string,
  previous: string,
) {
  const pushed = await readRef(common, env, `refs/remotes/origin/${branch}`);
  if (
    pushed &&
    !(await remote(['merge-base', '--is-ancestor', pushed, previous]).then(
      () => true,
      () => false,
    ))
  )
    throw new Error(
      `origin/${branch} has commits '${branch}' lacks (pushed elsewhere); integrate them first; nothing changed`,
    );
}

/**
 * Merge the clone's `origin/<target>` into `refs/heads/<branch>` without a
 * checkout: merge-tree and commit-tree in the scratch, so no partial merge,
 * hook, driver or repository config can run, then compare-and-swap the branch.
 * Refuses a branch moved past `expected`, uncommitted work in `workspace`
 * against `clean` and a remote branch the local one lacks. A conflict moves
 * nothing and returns the conflicts with merge-tree's tree. Pushes nothing.
 */
export async function updateBranch(
  worktree: string,
  auth: GitAuth,
  opts: {
    branch: string;
    target: string;
    /** The tip the caller last saw; a branch moved past it is refused. */
    expected?: string;
    workspace?: { path: string; clean: string };
  },
): Promise<BranchUpdate> {
  const { branch, target, expected, workspace } = opts;
  return withScratch(worktree, auth, async (ctx) => {
    const { common, env, remote } = ctx;
    const previous = await readRef(common, env, `refs/heads/${branch}`);
    if (!previous) throw new Error(`no local branch '${branch}' to update`);
    if (expected && previous !== expected)
      throw new Error(
        `'${branch}' moved to ${previous} since the run last synced at ${expected}; nothing changed`,
      );
    const merged = await readRef(common, env, `refs/remotes/origin/${target}`);
    if (!merged)
      throw new Error(`target '${target}' was not fetched; nothing changed`);
    if (workspace) {
      const dirty = await dirtyPaths(
        await workspaceGit(ctx, workspace.path, workspace.clean),
      );
      if (dirty.length > 0)
        throw new Error(
          `uncommitted work in the run (${dirty.join(', ')}); commit or remove it, then call forge_update_branch again; nothing changed`,
        );
    }
    await refusePushedElsewhere(ctx, branch, previous);
    if (
      await remote(['merge-base', '--is-ancestor', merged, previous]).then(
        () => true,
        () => false,
      )
    )
      return { previous, target: merged, resulting: previous, noop: true };
    let tree: string;
    try {
      tree = await remote([
        'merge-tree',
        '--write-tree',
        '-z',
        '--no-messages',
        previous,
        merged,
      ]);
    } catch (err) {
      const { code, stdout } = err as { code?: unknown; stdout?: string };
      if (code !== 1) throw err;
      const [conflictTree = '', ...entries] = String(stdout).split('\0');
      return {
        previous,
        target: merged,
        resulting: previous,
        noop: false,
        conflicts: parseConflicts(entries),
        tree: conflictTree,
      };
    }
    const resulting = await commitMerge(ctx, {
      branch,
      targetBranch: target,
      previous,
      target: merged,
      tree: tree.replace(/\0$/, ''),
    });
    return { previous, target: merged, resulting, noop: false };
  });
}

/**
 * Write `paths` as `source` has them into the workspace, through a throwaway
 * index of `index`, so a path `source` lacks is removed. Git refuses to write
 * beyond a symlink; nothing else in the workspace is touched.
 */
export async function restorePaths(
  worktree: string,
  auth: GitAuth,
  opts: {
    workspace: string;
    index: string;
    source: string;
    paths: readonly string[];
  },
): Promise<void> {
  await withScratch(worktree, auth, async (ctx) => {
    const wt = await workspaceGit(ctx, opts.workspace);
    await wt(['read-tree', opts.index]);
    await wt([
      'restore',
      `--source=${opts.source}`,
      '--worktree',
      '--no-overlay',
      '--',
      ...opts.paths.map(literal),
    ]);
  });
}

const MARKER = /^(<<<<<<<|>>>>>>>)( |$)/m;

/**
 * Commit the run's resolution of a pending update: the merge tree with each
 * kept path taken from the workspace and each deleted one removed, as one
 * merge of `previous` and `target`, then compare-and-swap the branch. Refuses
 * a moved branch or target, work outside the conflict paths, remaining
 * markers and a decision the workspace contradicts, changing nothing.
 */
export async function completeUpdate(
  worktree: string,
  auth: GitAuth,
  opts: {
    branch: string;
    workspace: string;
    pending: PendingUpdate;
    keep: readonly string[];
    beforeMove: (resulting: string) => void;
  },
): Promise<string> {
  const { branch, pending, keep } = opts;
  const refuse = (why: string) => new Error(`${why}; nothing changed`);
  return withScratch(worktree, auth, async (ctx) => {
    const { common, env } = ctx;
    const at = await readRef(common, env, `refs/heads/${branch}`);
    if (at !== pending.previous)
      throw refuse(
        `'${branch}' moved to ${at} since the conflict at ${pending.previous}`,
      );
    const target = await readRef(
      common,
      env,
      `refs/remotes/origin/${pending.targetBranch}`,
    );
    if (target !== pending.target)
      throw refuse(
        `'${pending.targetBranch}' moved to ${target} since the conflict at ${pending.target}; abort, then start again`,
      );
    await refusePushedElsewhere(ctx, branch, pending.previous);
    const paths = pending.conflicts.map((c) => c.path);
    const wt = await workspaceGit(ctx, opts.workspace, pending.previous);
    const outside = await dirtyPaths(wt, paths);
    if (outside.length > 0)
      throw refuse(
        `the run changed files outside the conflict paths (${outside.join(', ')}); undo them, keeping only the resolution`,
      );
    await wt(['read-tree', pending.tree]);
    await wt(['add', '-A', '--', ...paths.map(literal)]).catch((err: Error) => {
      throw refuse(err.message);
    });
    for (const path of paths) {
      const present = (await wt(['ls-files', '--', literal(path)])) !== '';
      const kept = keep.includes(path);
      if (kept && !present) throw refuse(`keep ${path}, but it is missing`);
      if (!kept && present) throw refuse(`delete ${path}, but it still exists`);
      if (kept && MARKER.test(await wt(['cat-file', 'blob', `:${path}`])))
        throw refuse(`conflict markers remain in ${path}`);
    }
    return commitMerge(
      ctx,
      {
        branch,
        targetBranch: pending.targetBranch,
        previous: pending.previous,
        target: pending.target,
        tree: await wt(['write-tree']),
      },
      opts.beforeMove,
    );
  });
}
