// The GitLab forge backend: a Project Access Token (role Developer, with an
// expiry date) for the one configured project. Every merge sends `squash`
// and `should_remove_source_branch` explicitly, so nothing stored on the MR
// or the project decides them.

import {
  type CheckStatus,
  type ForgeBackend,
  type ForgeBackendFactory,
  type ForgePr,
  requestJson,
} from '@bakers-build/addon-forge/backend';

interface Mr {
  iid: number;
  web_url: string;
  source_branch: string;
  target_branch: string;
  title: string;
  sha: string;
  state: string;
  has_conflicts?: boolean;
  detailed_merge_status?: string;
  force_remove_source_branch?: boolean | null;
}

const prOf = (m: Mr): ForgePr => ({
  number: m.iid,
  url: m.web_url,
  head: m.source_branch,
  base: m.target_branch,
  title: m.title,
  headSha: m.sha,
});

function statusOf(status: string): CheckStatus {
  if (status === 'success' || status === 'skipped') return 'success';
  if (status === 'failed' || status === 'canceled') return 'failure';
  return 'pending';
}

const factory: ForgeBackendFactory = async (raw, context) => {
  const s = (raw ?? {}) as Record<string, unknown>;
  if (typeof s.project !== 'string' || !s.project.includes('/'))
    throw new Error("project must be the project path, e.g. 'group/repo'");
  const base = (
    typeof s.url === 'string' ? s.url : 'https://gitlab.com'
  ).replace(/\/+$/, '');
  const token =
    typeof s.token === 'string'
      ? s.token
      : typeof s.token_env === 'string'
        ? process.env[s.token_env]
        : undefined;
  if (!token)
    throw new Error(
      'token or token_env (naming a set environment variable) must give the Project Access Token',
    );
  const doFetch = context.fetch ?? fetch;
  const project = `${base}/api/v4/projects/${encodeURIComponent(s.project)}`;
  const api = (path: string, init: { method?: string; body?: unknown } = {}) =>
    requestJson(doFetch, `${project}${path}`, {
      method: init.method ?? 'GET',
      headers: { 'private-token': token, 'content-type': 'application/json' },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    });
  const mr = async (iid: number) => (await api(`/merge_requests/${iid}`)) as Mr;
  const q = encodeURIComponent;

  const backend: ForgeBackend = {
    id: 'gitlab',
    secrets: () => [token],
    gitAuth: async () => ({
      url: `${base}/${s.project}.git`,
      header: `Authorization: Basic ${Buffer.from(`oauth2:${token}`).toString('base64')}`,
    }),
    findOpenPr: async (head) => {
      const list = (await api(
        `/merge_requests?state=opened&source_branch=${q(head)}`,
      )) as Mr[];
      const found = list.find((m) => m.source_branch === head);
      return found && prOf(found);
    },
    createPr: async ({ head, base: target, title, body }) =>
      prOf(
        (await api('/merge_requests', {
          method: 'POST',
          body: {
            source_branch: head,
            target_branch: target,
            title,
            description: body,
          },
        })) as Mr,
      ),
    updatePr: async (pr, { title, body }) =>
      prOf(
        (await api(`/merge_requests/${pr.number}`, {
          method: 'PUT',
          body: { title, description: body },
        })) as Mr,
      ),
    openPrsWithBase: async (target) =>
      (
        (await api(
          `/merge_requests?state=opened&target_branch=${q(target)}&per_page=100`,
        )) as Mr[]
      )
        .filter((m) => m.target_branch === target)
        .map(prOf),
    checks: async (ref) => {
      const by = /^[0-9a-f]{40}$/.test(ref) ? `sha=${ref}` : `ref=${q(ref)}`;
      const [pipeline] = (await api(
        `/pipelines?${by}&order_by=id&sort=desc&per_page=1`,
      )) as {
        id: number;
        status: string;
      }[];
      if (!pipeline)
        return [{ name: 'pipeline', status: 'missing', required: true }];
      const jobs = (await api(
        `/pipelines/${pipeline.id}/jobs?per_page=100`,
      )) as {
        name: string;
        status: string;
        allow_failure: boolean;
      }[];
      return [
        { name: 'pipeline', status: statusOf(pipeline.status), required: true },
        ...jobs.map((j) => ({
          name: j.name,
          status: statusOf(j.status),
          required: !j.allow_failure,
        })),
      ];
    },
    mergeBlocker: async (pr) => {
      const m = await mr(pr.number);
      if (m.has_conflicts) return 'merge conflict with its target';
      if (
        m.detailed_merge_status === 'checking' ||
        m.detailed_merge_status === 'unchecked'
      )
        return 'mergeability is not computed yet; call again shortly';
      return undefined;
    },
    merge: async (pr, o) => {
      if (!o.deleteSource && (await mr(pr.number)).force_remove_source_branch)
        throw new Error(
          `MR ${pr.url} stores force_remove_source_branch: true, but its source must be kept; the branch owner clears it before the merge`,
        );
      const message = `${o.subject}\n\n${o.body}`;
      await api(`/merge_requests/${pr.number}/merge`, {
        method: 'PUT',
        body: {
          squash: o.method === 'squash',
          should_remove_source_branch: o.deleteSource,
          sha: pr.headSha,
          [o.method === 'squash'
            ? 'squash_commit_message'
            : 'merge_commit_message']: message,
        },
      });
    },
    isMerged: async (pr) => (await mr(pr.number)).state === 'merged',
  };
  return backend;
};

export default factory;
