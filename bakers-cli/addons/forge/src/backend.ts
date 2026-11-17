// The forge backend contract. A backend package (`@bakers-build/addon-forge-
// github`, `@bakers-build/addon-forge-gitlab`) default-exports a
// `ForgeBackendFactory`; the forge tools know only this shape, never a
// service's API. Ownership, titles and merge gates stay with the tools.

import { execFile } from 'node:child_process';
import type { GitAuth } from './git.js';

export type { GitAuth };

export interface ForgePr {
  /** GitHub PR number, GitLab MR iid. */
  readonly number: number;
  readonly url: string;
  readonly head: string;
  readonly base: string;
  readonly title: string;
  readonly headSha: string;
}

export type CheckStatus = 'success' | 'pending' | 'failure' | 'missing';

export interface ForgeCheck {
  readonly name: string;
  readonly status: CheckStatus;
  /** Required by the base branch's rules (GitHub) or not allowed to fail (GitLab). */
  readonly required: boolean;
  /** The forge's own verdict (`cancelled`, `skipped`, `timed_out`, ...); null while running. */
  readonly conclusion: string | null;
  /** GitHub Actions run / GitLab pipeline; null for a commit status. */
  readonly run_id: number | null;
  /** The id `forge_job_log` reads; null when the row is no job. */
  readonly job_id: number | null;
  readonly run_started_at: string | null;
}

export interface ForgeMerge {
  readonly method: 'squash' | 'merge';
  readonly deleteSource: boolean;
  readonly subject: string;
  readonly body: string;
}

export interface ForgeBackend {
  readonly id: string;
  /** Every credential value; the tools redact them from all output. */
  secrets(): readonly string[];
  /** The configured repository URL and the header that authenticates git. */
  gitAuth(): Promise<GitAuth>;
  findOpenPr(head: string): Promise<ForgePr | undefined>;
  createPr(input: {
    head: string;
    base: string;
    title: string;
    body: string;
  }): Promise<ForgePr>;
  /** Also retargets the PR to `base`, which may have moved since it opened. */
  updatePr(
    pr: ForgePr,
    input: { title: string; body: string; base: string },
  ): Promise<ForgePr>;
  openPrsWithBase(base: string): Promise<ForgePr[]>;
  /**
   * Checks on `ref` (a SHA or branch), `required` as `base`'s rules say. Only
   * the newest run per workflow unless `allRuns`, where the forge has several.
   */
  checks(
    ref: string,
    base: string,
    opts?: { allRuns?: boolean },
  ): Promise<ForgeCheck[]>;
  /** A conflict or a not yet computed mergeability is a reason. */
  mergeBlocker(pr: ForgePr): Promise<string | undefined>;
  /** Merges with every option sent explicitly; deletes the source when asked. */
  merge(pr: ForgePr, options: ForgeMerge): Promise<void>;
  isMerged(pr: ForgePr): Promise<boolean>;
  /** The [tail] of a job's log; refuses a job outside the repository. */
  jobLog(jobId: number, maxBytes: number): Promise<LogTail>;
}

export interface LogTail {
  readonly text: string;
  /** The whole log's size. */
  readonly bytes: number;
  readonly truncated: boolean;
}

export type ForgeBackendFactory = (
  settings: unknown,
  context: { readonly home: string; readonly fetch?: typeof fetch },
) => Promise<ForgeBackend>;

const METHODS = [
  'secrets',
  'gitAuth',
  'findOpenPr',
  'createPr',
  'updatePr',
  'openPrsWithBase',
  'checks',
  'mergeBlocker',
  'merge',
  'isMerged',
  'jobLog',
] as const;

/** Reject a factory result that is not a `ForgeBackend`. */
export function assertForgeBackend(
  value: unknown,
  spec: string,
): asserts value is ForgeBackend {
  const obj = value as Record<string, unknown> | null;
  if (typeof obj !== 'object' || obj === null)
    throw new Error(`forge backend '${spec}' did not return an object`);
  if (typeof obj.id !== 'string' || obj.id === '')
    throw new Error(`forge backend '${spec}' is missing string "id"`);
  for (const m of METHODS)
    if (typeof obj[m] !== 'function')
      throw new Error(`forge backend '${spec}' is missing function "${m}"`);
}

/**
 * A token from the conductor's own CLI login (`gh`, `glab`), run outside any
 * sandbox and read again after five minutes so a new login is picked up.
 * Every value read is pushed to `seen`, for the backend's `secrets()`.
 */
export function cliToken(
  cmd: string,
  args: string[],
  seen: string[],
): () => Promise<string> {
  let cached: { value: string; until: number } | undefined;
  return async () => {
    if (cached && Date.now() < cached.until) return cached.value;
    const value = await new Promise<string>((resolve) =>
      execFile(cmd, args, { timeout: 10_000 }, (err, out) =>
        resolve(err ? '' : String(out).trim()),
      ),
    );
    if (!value)
      throw new Error(
        `${cmd} gave no token: run '${cmd} auth login' on the conductor's machine`,
      );
    seen.push(value);
    cached = { value, until: Date.now() + 300_000 };
    return value;
  };
}

/** Text over HTTP for backends: throws status and body text on failure. */
export async function requestText(
  doFetch: typeof fetch,
  url: string,
  init: RequestInit & { allow404?: boolean },
): Promise<string | undefined> {
  const res = await doFetch(url, init);
  if (res.status === 404 && init.allow404) return undefined;
  const text = await res.text();
  if (!res.ok)
    throw new Error(
      `${init.method ?? 'GET'} ${new URL(url).pathname} answered ${res.status}: ${text.slice(0, 500)}`,
    );
  return text;
}

/** JSON over HTTP for backends: throws status and body text on failure. */
export async function requestJson(
  doFetch: typeof fetch,
  url: string,
  init: RequestInit & { allow404?: boolean },
): Promise<unknown> {
  const text = await requestText(doFetch, url, init);
  return text ? JSON.parse(text) : undefined;
}

/**
 * The last `maxBytes` bytes of `log`, from the first whole line in them; when
 * the last line alone is longer, from the first whole character.
 */
export function tail(log: string, maxBytes: number): LogTail {
  const buf = Buffer.from(log);
  if (buf.length <= maxBytes)
    return { text: log, bytes: buf.length, truncated: false };
  let start = buf.length - maxBytes;
  const newline = buf.indexOf(0x0a, start - 1);
  if (newline !== -1 && newline < buf.length - 1) start = newline + 1;
  else
    while (start < buf.length && (buf.readUInt8(start) & 0xc0) === 0x80)
      start++;
  return {
    text: buf.subarray(start).toString(),
    bytes: buf.length,
    truncated: true,
  };
}
