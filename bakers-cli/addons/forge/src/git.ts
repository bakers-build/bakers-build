// Network git that trusts nothing in the run's clone. Every fetch and push
// runs in a throwaway bare repository whose object directory is the clone's
// own store, with no global, system or repository config, no hooks, and only
// the remote's protocol allowed. The token reaches git as an environment
// header, never argv, URL or file. Against the clone itself only `rev-parse`,
// `for-each-ref` and `update-ref` run, with hooks and fsmonitor disabled.

import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
          reject(new Error(`git failed: ${stderr.trim() || err.message}`));
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
    remote: (args: string[], input?: string) => Promise<string>;
  }) => Promise<T>,
): Promise<T> {
  const home = await mkdtemp(join(tmpdir(), 'bakers-forge-'));
  try {
    const env = baseEnv(home);
    const common = await commonDir(worktree, env);
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
      remote: (args, input) => run(args, remoteEnv, input),
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
