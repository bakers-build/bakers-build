// The GitHub forge backend: a GitHub App's installation token, minted with
// an RS256 app JWT, scoped to the one configured repository and cached until
// shortly before it expires. The repository comes from config, never from a
// clone's `origin`.

import { createSign } from 'node:crypto';
import {
  type CheckStatus,
  type ForgeBackend,
  type ForgeBackendFactory,
  type ForgeCheck,
  type ForgePr,
  requestJson,
} from '@bakers-build/addon-forge/backend';

const API = 'https://api.github.com';
const REFRESH_MS = 60_000;

interface Settings {
  repository: string;
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

const factory: ForgeBackendFactory = async (raw, context) => {
  const s = settingsOf(raw);
  const doFetch = context.fetch ?? fetch;
  const [owner] = s.repository.split('/');
  const repo = `${API}/repos/${s.repository}`;
  let token: { value: string; until: number } | undefined;

  const installationToken = async (): Promise<string> => {
    if (token && Date.now() < token.until) return token.value;
    const out = (await requestJson(
      doFetch,
      `${API}/app/installations/${s.installationId}/access_tokens`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${appJwt(s.appId, s.privateKey)}`,
          accept: 'application/vnd.github+json',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ repositories: [s.repository.split('/')[1]] }),
      },
    )) as { token: string; expires_at: string };
    token = {
      value: out.token,
      until: Date.parse(out.expires_at) - REFRESH_MS,
    };
    return out.token;
  };

  const api = async (
    path: string,
    init: { method?: string; body?: unknown; allow404?: boolean } = {},
  ) =>
    requestJson(doFetch, `${repo}${path}`, {
      method: init.method ?? 'GET',
      headers: {
        authorization: `Bearer ${await installationToken()}`,
        accept: 'application/vnd.github+json',
        'content-type': 'application/json',
      },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      ...(init.allow404 ? { allow404: true } : {}),
    });

  const pull = async (n: number) => (await api(`/pulls/${n}`)) as Pull;

  const backend: ForgeBackend = {
    id: 'github',
    secrets: () => [s.privateKey, ...(token ? [token.value] : [])],
    gitAuth: async () => ({
      url: `https://github.com/${s.repository}.git`,
      header: `Authorization: Basic ${Buffer.from(`x-access-token:${await installationToken()}`).toString('base64')}`,
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
    checks: async (ref, base) => {
      const at = encodeURIComponent(ref);
      const b = encodeURIComponent(base);
      const [runs, status, rules, branch] = await Promise.all([
        api(`/commits/${at}/check-runs?per_page=100`) as Promise<{
          check_runs: {
            name: string;
            status: string;
            conclusion: string | null;
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
      const rows: ForgeCheck[] = [
        ...runs.check_runs.map((r) => ({
          name: r.name,
          status: runStatus(r),
          required: required.has(r.name),
        })),
        ...status.statuses.map((st) => ({
          name: st.context,
          status: stateStatus(st.state),
          required: required.has(st.context),
        })),
      ];
      for (const name of required)
        if (!rows.some((r) => r.name === name))
          rows.push({ name, status: 'missing', required: true });
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
  };
  return backend;
};

export default factory;
