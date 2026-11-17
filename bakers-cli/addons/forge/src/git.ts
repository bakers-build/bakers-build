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
import { UI_REFRESH_FILE } from '@bakers-build/core';

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
  /** The branch tip after the update; `previous` for a no-op. */
  resulting: string;
  noop: boolean;
}

/**
 * Merge the clone's `origin/<target>` into `refs/heads/<branch>` without a
 * checkout: merge-tree and commit-tree in the scratch, so no partial merge,
 * hook, driver or repository config can run, then compare-and-swap the branch.
 * Refuses a branch moved past `expected`, uncommitted work in `workspace`
 * against `clean`, a remote branch the local one lacks, and conflicts (naming their paths). Pushes nothing.
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
  return withScratch(worktree, auth, async ({ common, env, home, remote }) => {
    const previous = await readRef(common, env, `refs/heads/${branch}`);
    if (!previous) throw new Error(`no local branch '${branch}' to update`);
    if (expected && previous !== expected)
      throw new Error(
        `'${branch}' moved to ${previous} since the run last synced at ${expected}; nothing changed`,
      );
    const merged = await readRef(common, env, `refs/remotes/origin/${target}`);
    if (!merged)
      throw new Error(`target '${target}' was not fetched; nothing changed`);
    const isAncestor = (a: string, b: string) =>
      remote(['merge-base', '--is-ancestor', a, b]).then(
        () => true,
        () => false,
      );
    if (workspace) {
      // A throwaway index and only the scratch's clean config: status runs no filter or fsmonitor.
      await mkdir(join(home, 'scratch.git', 'info'), { recursive: true });
      await writeFile(
        join(home, 'scratch.git', 'info', 'exclude'),
        `/.bakers/${UI_REFRESH_FILE}\n`,
      );
      const tree = {
        GIT_WORK_TREE: workspace.path,
        GIT_INDEX_FILE: join(home, 'index'),
      };
      await remote(['update-ref', '--no-deref', 'HEAD', workspace.clean]);
      await remote(['read-tree', 'HEAD'], undefined, tree);
      const dirty = await remote(
        ['status', '--porcelain', '--untracked-files=all', '--no-renames'],
        undefined,
        tree,
      );
      if (dirty)
        throw new Error(
          `uncommitted work in the run (${dirty
            .split('\n')
            .map((l) => l.replace(/^[ MADRCU?!]{1,2} /, ''))
            .join(
              ', ',
            )}); commit or remove it, then call forge_update_branch again; nothing changed`,
        );
    }
    const pushed = await readRef(common, env, `refs/remotes/origin/${branch}`);
    if (pushed && !(await isAncestor(pushed, previous)))
      throw new Error(
        `origin/${branch} has commits '${branch}' lacks (pushed elsewhere); integrate them first; nothing changed`,
      );
    if (await isAncestor(merged, previous))
      return { previous, target: merged, resulting: previous, noop: true };
    let tree: string;
    try {
      tree = await remote([
        'merge-tree',
        '--write-tree',
        '--name-only',
        '--no-messages',
        previous,
        merged,
      ]);
    } catch (err) {
      const { code, stdout } = err as { code?: unknown; stdout?: string };
      if (code !== 1) throw err;
      const paths = [...new Set(String(stdout).split('\n').slice(1))].filter(
        Boolean,
      );
      throw new Error(
        `merging '${target}' into '${branch}' conflicts in ${paths.join(', ')}; nothing changed. The run cannot resolve this: stop and report it to the developers. A developer with write access merges origin/${target} into '${branch}' outside the run, resolves those paths and pushes; the next run starts there`,
      );
    }
    const resulting = await remote(
      [
        'commit-tree',
        tree,
        '-p',
        previous,
        '-p',
        merged,
        '-m',
        `Merge ${target} into ${branch}`,
      ],
      undefined,
      {
        GIT_AUTHOR_NAME: 'bakers.build',
        GIT_AUTHOR_EMAIL: 'noreply@bakers.build',
        GIT_COMMITTER_NAME: 'bakers.build',
        GIT_COMMITTER_EMAIL: 'noreply@bakers.build',
      },
    );
    // Compare-and-swap: a branch that moved meanwhile is refused, never overwritten.
    await inClone(
      common,
      env,
      'update-ref',
      `refs/heads/${branch}`,
      resulting,
      previous,
    );
    return { previous, target: merged, resulting, noop: false };
  });
}
