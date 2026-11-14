// The GitHub forge backend: a GitHub App's installation token, minted with
// an RS256 app JWT, scoped to the one configured repository and cached until
// shortly before it expires; or, with `auth: 'gh'`, the conductor's own `gh`
// login. The repository comes from config, never from a clone's `origin`.

import { createSign } from 'node:crypto';
import {
  type CheckStatus,
  cliToken,
  type ForgeBackend,
  type ForgeBackendFactory,
  type ForgeCheck,
  type ForgePr,
  requestJson,
  requestText,
  tail,
} from '@bakers-build/addon-forge/backend';

const API = 'https://api.github.com';
const REFRESH_MS = 60_000;

interface Settings {
  repository: string;
  gh: boolean;
  appId: string;
  installationId: string;
  privateKey: string;
}

function settingsOf(raw: unknown): Settings {
  const s = (raw ?? {}) as Record<string, unknown>;
  if (
    typeof s.repository !== 'string' ||
    !/^[\w.-]+\/[\w.-]+$/.test(s.repository)
  )
    throw new Error("repository must be 'owner/repo'");
  if (s.auth === 'gh')
    return {
      repository: s.repository,
      gh: true,
      appId: '',
      installationId: '',
      privateKey: '',
    };
  if (s.auth !== undefined)
    throw new Error("auth must be 'gh' or left out for a GitHub App");
  for (const k of ['app_id', 'installation_id'])
    if (typeof s[k] !== 'number' && (typeof s[k] !== 'string' || s[k] === ''))
      throw new Error(`${k} must be the App's numeric ${k.replace('_', ' ')}`);
  const fromEnv =
    typeof s.private_key_env === 'string'
      ? process.env[s.private_key_env]
      : undefined;
  const privateKey =
    typeof s.private_key === 'string' ? s.private_key : fromEnv;
  if (!privateKey)
    throw new Error(
      'private_key or private_key_env (naming a set environment variable) must give the App private key',
    );
  return {
    repository: s.repository,
    gh: false,
    appId: String(s.app_id),
    installationId: String(s.installation_id),
    privateKey,
  };
}

const b64url = (v: string | Buffer) => Buffer.from(v).toString('base64url');

function appJwt(appId: string, key: string): string {
  const now = Math.floor(Date.now() / 1000);
  const head = `${b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64url(
    JSON.stringify({ iat: now - 60, exp: now + 540, iss: appId }),
  )}`;
  return `${head}.${createSign('RSA-SHA256').update(head).sign(key, 'base64url')}`;
}

interface Pull {
  number: number;
  html_url: string;
  head: { ref: string; sha: string };
  base: { ref: string };
  title: string;
  merged?: boolean;
  mergeable?: boolean | null;
}

const prOf = (p: Pull): ForgePr => ({
  number: p.number,
  url: p.html_url,
  head: p.head.ref,
  base: p.base.ref,
  title: p.title,
  headSha: p.head.sha,
});

function runStatus(r: {
  status: string;
  conclusion: string | null;
}): CheckStatus {
  if (r.status !== 'completed') return 'pending';
  return ['success', 'neutral', 'skipped'].includes(r.conclusion ?? '')
    ? 'success'
    : 'failure';
}

function stateStatus(state: string): CheckStatus {
  if (state === 'success') return 'success';
  return state === 'pending' ? 'pending' : 'failure';
}

interface WorkflowRun {
  id: number;
  workflow_id: number;
  check_suite_id: number;
  run_started_at: string;
}

const NO_RUN = { run_id: null, job_id: null, run_started_at: null } as const;

const basic = (token: string) =>
  Buffer.from(`x-access-token:${token}`).toString('base64');

const factory: ForgeBackendFactory = async (raw, context) => {
  const s = settingsOf(raw);
  const doFetch = context.fetch ?? fetch;
  const [owner] = s.repository.split('/');
  const repo = `${API}/repos/${s.repository}`;
  let token: { value: string; until: number } | undefined;
  // Every JWT and token ever minted: a value replaced by a refresh may still be echoed.
  const minted: string[] = [];
  const ghToken = cliToken(
    'gh',
    ['auth', 'token', '--hostname', 'github.com'],
    minted,
  );

  const accessToken = async (): Promise<string> => {
    if (s.gh) {
      const value = await ghToken();
      if (!minted.includes(basic(value))) minted.push(basic(value));
      return value;
    }
    if (token && Date.now() < token.until) return token.value;
    const jwt = appJwt(s.appId, s.privateKey);
    minted.push(jwt);
    const out = (await requestJson(
      doFetch,
      `${API}/app/installations/${s.installationId}/access_tokens`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${jwt}`,
          accept: 'application/vnd.github+json',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ repositories: [s.repository.split('/')[1]] }),
      },
    )) as { token: string; expires_at: string };
    minted.push(out.token, basic(out.token));
    token = {
      value: out.token,
      until: Date.parse(out.expires_at) - REFRESH_MS,
    };
    return out.token;
  };

  const api = async (
    path: string,
    init: {
      method?: string;
      body?: unknown;
      allow404?: boolean;
      text?: boolean;
    } = {},
  ) =>
    (init.text ? requestText : requestJson)(doFetch, `${repo}${path}`, {
      method: init.method ?? 'GET',
      headers: {
        authorization: `Bearer ${await accessToken()}`,
        accept: 'application/vnd.github+json',
        'content-type': 'application/json',
      },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      ...(init.allow404 ? { allow404: true } : {}),
    });

  const pull = async (n: number) => (await api(`/pulls/${n}`)) as Pull;

  const backend: ForgeBackend = {
    id: 'github',
    secrets: () => [...(s.privateKey ? [s.privateKey] : []), ...minted],
    gitAuth: async () => ({
      url: `https://github.com/${s.repository}.git`,
      header: `Authorization: Basic ${basic(await accessToken())}`,
    }),
    findOpenPr: async (head) => {
      const list = (await api(
        `/pulls?state=open&head=${encodeURIComponent(`${owner}:${head}`)}`,
      )) as Pull[];
      const found = list.find((p) => p.head.ref === head);
      return found && prOf(found);
    },
    createPr: async ({ head, base, title, body }) =>
      prOf(
        (await api('/pulls', {
          method: 'POST',
          body: { head, base, title, body },
        })) as Pull,
      ),
    updatePr: async (pr, { title, body }) =>
      prOf(
        (await api(`/pulls/${pr.number}`, {
          method: 'PATCH',
          body: { title, body },
        })) as Pull,
      ),
    openPrsWithBase: async (base) =>
      (
        (await api(
          `/pulls?state=open&base=${encodeURIComponent(base)}&per_page=100`,
        )) as Pull[]
      )
        .filter((p) => p.base.ref === base)
        .map(prOf),
    checks: async (ref, base, opts = {}) => {
      const at = encodeURIComponent(ref);
      const b = encodeURIComponent(base);
      const [runs, status, rules, branch] = await Promise.all([
        api(`/commits/${at}/check-runs?filter=all&per_page=100`) as Promise<{
          check_runs: {
            id: number;
            name: string;
            status: string;
            conclusion: string | null;
            head_sha: string;
            check_suite?: { id: number } | null;
          }[];
        }>,
        api(`/commits/${at}/status`) as Promise<{
          statuses: { context: string; state: string }[];
        }>,
        api(`/rules/branches/${b}`, { allow404: true }) as Promise<
          | {
              type: string;
              parameters?: { required_status_checks?: { context: string }[] };
            }[]
          | undefined
        >,
        api(`/branches/${b}`, { allow404: true }) as Promise<
          | {
              protection?: { required_status_checks?: { contexts?: string[] } };
            }
          | undefined
        >,
      ]);
      const required = new Set<string>([
        ...(rules ?? [])
          .filter((r) => r.type === 'required_status_checks')
          .flatMap((r) => r.parameters?.required_status_checks ?? [])
          .map((c) => c.context),
        ...(branch?.protection?.required_status_checks?.contexts ?? []),
      ]);
      // `ref` may be a branch: the runs lookup needs the commit the check runs report.
      const sha = runs.check_runs[0]?.head_sha;
      const workflowRuns = sha
        ? (
            (await api(
              `/actions/runs?head_sha=${encodeURIComponent(sha)}&per_page=100`,
            )) as { workflow_runs: WorkflowRun[] }
          ).workflow_runs
        : [];
      const bySuite = new Map(workflowRuns.map((w) => [w.check_suite_id, w]));
      const newest = new Map<number, WorkflowRun>();
      for (const w of workflowRuns) {
        const kept = newest.get(w.workflow_id);
        if (
          !kept ||
          w.run_started_at > kept.run_started_at ||
          (w.run_started_at === kept.run_started_at && w.id > kept.id)
        )
          newest.set(w.workflow_id, w);
      }
      let jobs = runs.check_runs.map((r) => ({
        r,
        w: r.check_suite ? bySuite.get(r.check_suite.id) : undefined,
      }));
      if (!opts.allRuns) {
        jobs = jobs.filter(({ w }) => !w || newest.get(w.workflow_id) === w);
        // A re-run attempt is a newer check run of the same name in the same run.
        const latest = new Map<string, number>();
        const key = (j: (typeof jobs)[number]) =>
          `${j.w?.id ?? ''}\0${j.r.name}`;
        for (const j of jobs)
          latest.set(key(j), Math.max(latest.get(key(j)) ?? 0, j.r.id));
        jobs = jobs.filter((j) => latest.get(key(j)) === j.r.id);
      }
      const rows: ForgeCheck[] = [
        ...jobs.map(({ r, w }) => ({
          name: r.name,
          status: runStatus(r),
          required: required.has(r.name),
          conclusion: r.conclusion,
          run_id: w?.id ?? null,
          // An Actions job's id is its check run's id.
          job_id: w ? r.id : null,
          run_started_at: w?.run_started_at ?? null,
        })),
        ...status.statuses.map((st) => ({
          name: st.context,
          status: stateStatus(st.state),
          required: required.has(st.context),
          conclusion: st.state,
          ...NO_RUN,
        })),
      ];
      for (const name of required)
        if (!rows.some((r) => r.name === name))
          rows.push({
            name,
            status: 'missing',
            required: true,
            conclusion: null,
            ...NO_RUN,
          });
      return rows;
    },
    mergeBlocker: async (pr) => {
      const p = await pull(pr.number);
      if (p.mergeable === null || p.mergeable === undefined)
        return 'mergeability is not computed yet; call again shortly';
      return p.mergeable ? undefined : 'merge conflict with its base';
    },
    merge: async (pr, o) => {
      await api(`/pulls/${pr.number}/merge`, {
        method: 'PUT',
        body: {
          merge_method: o.method,
          commit_title: o.subject,
          commit_message: o.body,
          sha: pr.headSha,
        },
      });
      if (o.deleteSource)
        await api(
          `/git/refs/heads/${pr.head.split('/').map(encodeURIComponent).join('/')}`,
          {
            method: 'DELETE',
          },
        );
    },
    isMerged: async (pr) => (await pull(pr.number)).merged === true,
    // The API redirects to a signed download URL; fetch follows it.
    jobLog: async (jobId, maxBytes) => {
      const log = (await api(`/actions/jobs/${jobId}/logs`, {
        allow404: true,
        text: true,
      })) as string | undefined;
      if (log === undefined)
        throw new Error(`job ${jobId} is not a job of ${s.repository}`);
      return tail(log, maxBytes);
    },
  };
  return backend;
};

export default factory;
