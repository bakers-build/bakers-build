import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import factory from '../src/index.js';

const SETTINGS = { project: 'acme/shop', token: 'glpat-SECRET' };
const P = '/api/v4/projects/acme%2Fshop';

type Route = (url: URL) => unknown;

function fakeFetch(routes: Record<string, Route>) {
  const calls: {
    method: string;
    path: string;
    body?: Record<string, unknown>;
    token?: string;
  }[] = [];
  const doFetch = (async (input: string, init: RequestInit = {}) => {
    const url = new URL(input);
    const method = init.method ?? 'GET';
    calls.push({
      method,
      path: url.pathname + url.search,
      ...(init.body ? { body: JSON.parse(String(init.body)) } : {}),
      token:
        new Headers(init.headers)
          .get('authorization')
          ?.replace(/^Bearer /, '') ?? undefined,
    });
    const route = routes[`${method} ${url.pathname.replace(P, '')}`];
    if (!route) return new Response('not found', { status: 404 });
    const out = route(url);
    if (out instanceof Response) return out;
    return typeof out === 'string' ? new Response(out) : Response.json(out);
  }) as typeof fetch;
  return { doFetch, calls };
}

const MR = {
  iid: 9,
  web_url: 'https://gitlab.com/acme/shop/-/merge_requests/9',
  source_branch: 'feat/bb-7-work',
  target_branch: 'develop',
  title: 'feat: x',
  sha: 'abc',
  state: 'opened',
  has_conflicts: false,
  detailed_merge_status: 'mergeable',
  force_remove_source_branch: false,
};
const PR = {
  number: 9,
  url: MR.web_url,
  head: MR.source_branch,
  base: 'develop',
  title: 'feat: x',
  headSha: 'abc',
};

describe('forge-gitlab', () => {
  it('needs a project and a token, from token or token_env', async () => {
    await expect(factory({ token: 't' }, { home: '/h' })).rejects.toThrow(
      /project/,
    );
    await expect(factory({ project: 'a/b' }, { home: '/h' })).rejects.toThrow(
      /token or token_env/,
    );
    process.env.BB_TEST_GL_TOKEN = 'glpat-ENV';
    const b = await factory(
      { project: 'a/b', token_env: 'BB_TEST_GL_TOKEN' },
      { home: '/h' },
    );
    expect(b.secrets()).toEqual([
      'glpat-ENV',
      Buffer.from('oauth2:glpat-ENV').toString('base64'),
    ]);
  });

  it('authenticates git with an oauth2 basic header on the configured project URL', async () => {
    const b = await factory(
      { ...SETTINGS, url: 'https://git.example.test/' },
      { home: '/h' },
    );
    expect(await b.gitAuth()).toEqual({
      url: 'https://git.example.test/acme/shop.git',
      header: `Authorization: Basic ${Buffer.from('oauth2:glpat-SECRET').toString('base64')}`,
    });
  });

  it("with auth 'glab' takes the conductor's glab login token for the configured host and keeps it in secrets", async () => {
    const bin = mkdtempSync(join(tmpdir(), 'fake-glab-'));
    writeFileSync(
      join(bin, 'glab'),
      '#!/bin/sh\n[ "$*" = "config get token --host git.example.test" ] && echo glab-LOGIN\n',
      { mode: 0o755 },
    );
    const path = process.env.PATH;
    process.env.PATH = `${bin}:${path}`;
    try {
      const f = fakeFetch({ 'GET /merge_requests': () => [MR] });
      const b = await factory(
        { project: 'acme/shop', url: 'https://git.example.test', auth: 'glab' },
        { home: '/h', fetch: f.doFetch },
      );
      expect((await b.findOpenPr('feat/bb-7-work'))?.number).toBe(9);
      expect(f.calls.at(-1)?.token).toBe('glab-LOGIN');
      expect((await b.gitAuth()).header).toBe(
        `Authorization: Basic ${Buffer.from('oauth2:glab-LOGIN').toString('base64')}`,
      );
      expect(b.secrets()).toContain('glab-LOGIN');
    } finally {
      process.env.PATH = path;
    }
  });

  it("rejects auth 'glab' when glab has no token for the host", async () => {
    const bin = mkdtempSync(join(tmpdir(), 'fake-glab-'));
    writeFileSync(join(bin, 'glab'), '#!/bin/sh\n', { mode: 0o755 });
    const path = process.env.PATH;
    process.env.PATH = `${bin}:${path}`;
    try {
      const b = await factory(
        { project: 'acme/shop', auth: 'glab' },
        { home: '/h', fetch: fakeFetch({}).doFetch },
      );
      await expect(b.findOpenPr('x')).rejects.toThrow(/glab auth login/);
    } finally {
      process.env.PATH = path;
    }
  });

  it('finds, creates and updates MRs with a Bearer token', async () => {
    const f = fakeFetch({
      'GET /merge_requests': (url) =>
        url.searchParams.get('source_branch') === 'feat/bb-7-work' ||
        url.searchParams.get('target_branch') === 'develop'
          ? [MR]
          : [],
      'POST /merge_requests': () => MR,
      'PUT /merge_requests/9': () => ({ ...MR, title: 'feat: y' }),
    });
    const b = await factory(SETTINGS, { home: '/h', fetch: f.doFetch });
    expect(await b.findOpenPr('feat/bb-7-work')).toEqual(PR);
    expect(await b.findOpenPr('feat/other')).toBeUndefined();
    await b.createPr({
      head: 'feat/bb-7-work',
      base: 'develop',
      title: 'feat: x',
      body: 'd',
    });
    expect(f.calls.find((c) => c.method === 'POST')?.body).toEqual({
      source_branch: 'feat/bb-7-work',
      target_branch: 'develop',
      title: 'feat: x',
      description: 'd',
    });
    expect(
      (await b.updatePr(PR, { title: 'feat: y', body: '', base: 'main' }))
        .title,
    ).toBe('feat: y');
    expect(f.calls.find((c) => c.method === 'PUT')?.body).toEqual({
      title: 'feat: y',
      description: '',
      target_branch: 'main',
    });
    expect(await b.openPrsWithBase('develop')).toHaveLength(1);
    expect(f.calls.every((c) => c.token === 'glpat-SECRET')).toBe(true);
  });

  it('requires the pipeline and every job that may not fail, and writes nothing', async () => {
    const f = fakeFetch({
      'GET /pipelines': () => [
        {
          id: 77,
          status: 'running',
          started_at: '2026-11-14T10:00:00Z',
          created_at: '2026-11-14T09:59:00Z',
        },
      ],
      'GET /pipelines/77/jobs': () => [
        { id: 1, name: 'lint', status: 'success', allow_failure: false },
        { id: 2, name: 'gate', status: 'manual', allow_failure: false },
        { id: 3, name: 'flaky', status: 'failed', allow_failure: true },
        { id: 4, name: 'e2e', status: 'canceled', allow_failure: false },
        { id: 5, name: 'docs', status: 'skipped', allow_failure: false },
      ],
    });
    const b = await factory(SETTINGS, { home: '/h', fetch: f.doFetch });
    const run = { run_id: 77, run_started_at: '2026-11-14T10:00:00Z' };
    expect(await b.checks('a'.repeat(40), 'develop')).toEqual([
      {
        name: 'pipeline',
        status: 'pending',
        required: true,
        conclusion: 'running',
        job_id: null,
        ...run,
      },
      {
        name: 'lint',
        status: 'success',
        required: true,
        conclusion: 'success',
        job_id: 1,
        ...run,
      },
      {
        name: 'gate',
        status: 'pending',
        required: true,
        conclusion: 'manual',
        job_id: 2,
        ...run,
      },
      {
        name: 'flaky',
        status: 'failure',
        required: false,
        conclusion: 'failed',
        job_id: 3,
        ...run,
      },
      {
        name: 'e2e',
        status: 'failure',
        required: true,
        conclusion: 'canceled',
        job_id: 4,
        ...run,
      },
      // overall() fails a required check whose conclusion is skipped.
      {
        name: 'docs',
        status: 'success',
        required: true,
        conclusion: 'skipped',
        job_id: 5,
        ...run,
      },
    ]);
    expect(f.calls[0]!.path).toContain(`sha=${'a'.repeat(40)}`);
    expect(f.calls.every((c) => c.method === 'GET')).toBe(true);

    const none = fakeFetch({ 'GET /pipelines': () => [] });
    const empty = await factory(SETTINGS, { home: '/h', fetch: none.doFetch });
    expect(await empty.checks('feat/bb-7-work', 'develop')).toEqual([
      {
        name: 'pipeline',
        status: 'missing',
        required: true,
        conclusion: null,
        run_id: null,
        job_id: null,
        run_started_at: null,
      },
    ]);
    expect(none.calls[0]!.path).toContain('ref=feat%2Fbb-7-work');
  });

  it('reads the tail of a job trace and refuses a job outside the project', async () => {
    const f = fakeFetch({ 'GET /jobs/9/trace': () => 'one\ntwo\n' });
    const b = await factory(SETTINGS, { home: '/h', fetch: f.doFetch });
    expect(await b.jobLog(9, 100)).toEqual({
      text: 'one\ntwo\n',
      bytes: 8,
      truncated: false,
    });
    await expect(b.jobLog(8, 100)).rejects.toThrow(
      'job 8 is not a job of acme/shop',
    );
  });

  it('blocks on conflicts, sends squash and source deletion explicitly, and blocks a stored force_remove_source_branch it must not honour', async () => {
    let mr: Record<string, unknown> = { ...MR, has_conflicts: true };
    const f = fakeFetch({
      'GET /merge_requests/9': () => mr,
      'PUT /merge_requests/9/merge': () => {
        mr = { ...mr, state: 'merged' };
        return mr;
      },
    });
    const b = await factory(SETTINGS, { home: '/h', fetch: f.doFetch });
    expect(await b.mergeBlocker(PR)).toMatch(/conflict/);
    mr = { ...MR, detailed_merge_status: 'checking' };
    expect(await b.mergeBlocker(PR)).toMatch(/not computed yet/);
    mr = { ...MR };
    expect(await b.mergeBlocker(PR)).toBeUndefined();

    await b.merge(PR, {
      method: 'squash',
      deleteSource: true,
      subject: 'feat: x',
      body: 'Merged-by: bakers.build\nref:BB-7',
    });
    expect(f.calls.find((c) => c.method === 'PUT')?.body).toEqual({
      squash: true,
      should_remove_source_branch: true,
      sha: 'abc',
      squash_commit_message: 'feat: x\n\nMerged-by: bakers.build\nref:BB-7',
    });
    expect(await b.isMerged(PR)).toBe(true);

    mr = { ...MR, force_remove_source_branch: true };
    const before = f.calls.length;
    await expect(
      b.merge(PR, {
        method: 'merge',
        deleteSource: false,
        subject: 'feat: x',
        body: 'ref:BB-7',
      }),
    ).rejects.toThrow(/force_remove_source_branch/);
    expect(f.calls.slice(before).some((c) => c.method === 'PUT')).toBe(false);
  });

  describe('origin issue', () => {
    const ISSUE = 'https://gitlab.com/acme/board/-/issues/4';
    const B = '/api/v4/projects/acme%2Fboard';
    const fail = () => new Response('boom', { status: 500 });
    const page1 = Array.from({ length: 100 }, (_, i) => ({
      name: `p${i}`,
      is_project_label: true,
    }));

    it('lists project and inherited group labels across pages, from the project in the origin URL', async () => {
      const f = fakeFetch({
        [`GET ${B}/labels`]: (url) =>
          url.searchParams.get('page') === '2'
            ? [{ name: 'doing', is_project_label: false, color: '#fff' }]
            : page1,
      });
      const b = await factory(SETTINGS, { home: '/h', fetch: f.doFetch });
      const labels = await b.issueLabels(ISSUE);
      expect(labels).toHaveLength(101);
      expect(labels.at(-1)).toEqual({ name: 'doing', is_project_label: false });
      expect(labels[0]).toEqual({ name: 'p0', is_project_label: true });
      expect(f.calls.map((c) => c.path)).toEqual([
        `${B}/labels?include_ancestor_groups=true&per_page=100&page=1`,
        `${B}/labels?include_ancestor_groups=true&per_page=100&page=2`,
      ]);
    });

    it('accepts a work_items URL and a URL without /-/', async () => {
      const f = fakeFetch({ [`GET ${B}/labels`]: () => [] });
      const b = await factory(SETTINGS, { home: '/h', fetch: f.doFetch });
      await b.issueLabels('https://gitlab.com/acme/board/-/work_items/4');
      await b.issueLabels('https://gitlab.com/acme/board/issues/4');
      expect(f.calls).toHaveLength(2);
    });

    it('refuses an origin on another host or of another shape before any request', async () => {
      const f = fakeFetch({});
      const b = await factory(SETTINGS, { home: '/h', fetch: f.doFetch });
      for (const url of [
        'https://evil.example/acme/board/-/issues/4',
        'http://gitlab.com/acme/board/-/issues/4',
        'https://gitlab.com/acme/board/-/merge_requests/4',
        'https://github.com/acme/board/issues/4',
        'not a url',
      ]) {
        await expect(b.issueLabels(url)).rejects.toThrow(/nothing was sent/);
        await expect(
          b.updateIssueLabels(url, { add: 'x', remove: [] }),
        ).rejects.toThrow(/nothing was sent/);
        await expect(b.commentIssue(url, 'x')).rejects.toThrow(
          /nothing was sent/,
        );
      }
      expect(f.calls).toEqual([]);
    });

    it('updates the labels in one PUT and returns them', async () => {
      const f = fakeFetch({
        [`PUT ${B}/issues/4`]: () => ({ iid: 4, labels: ['review', 'bug'] }),
      });
      const b = await factory(SETTINGS, { home: '/h', fetch: f.doFetch });
      expect(
        await b.updateIssueLabels(ISSUE, {
          add: 'review',
          remove: ['doing', 'plan'],
        }),
      ).toEqual(['review', 'bug']);
      expect(f.calls).toEqual([
        {
          method: 'PUT',
          path: `${B}/issues/4`,
          body: { add_labels: 'review', remove_labels: 'doing,plan' },
          token: 'glpat-SECRET',
        },
      ]);
    });

    it('a failed label list is an error', async () => {
      const f = fakeFetch({ [`GET ${B}/labels`]: fail });
      const b = await factory(SETTINGS, { home: '/h', fetch: f.doFetch });
      await expect(b.issueLabels(ISSUE)).rejects.toThrow(/500/);
    });

    it('posts one note with the body unchanged and returns its URL; a failure is one call', async () => {
      const body = '## Status\n\n**review** — `x`\n';
      const f = fakeFetch({
        [`POST ${B}/issues/4/notes`]: () => ({ id: 77, body }),
      });
      const b = await factory(SETTINGS, { home: '/h', fetch: f.doFetch });
      expect(await b.commentIssue(ISSUE, body)).toEqual({
        id: 77,
        url: `${ISSUE}#note_77`,
      });
      expect(f.calls).toEqual([
        {
          method: 'POST',
          path: `${B}/issues/4/notes`,
          body: { body },
          token: 'glpat-SECRET',
        },
      ]);

      const g = fakeFetch({ [`POST ${B}/issues/4/notes`]: fail });
      const c = await factory(SETTINGS, { home: '/h', fetch: g.doFetch });
      await expect(c.commentIssue(ISSUE, body)).rejects.toThrow(/500/);
      expect(g.calls).toHaveLength(1);
    });
  });
});
