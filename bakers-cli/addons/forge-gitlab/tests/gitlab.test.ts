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
    return Response.json(route(url));
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
    expect((await b.updatePr(PR, { title: 'feat: y', body: '' })).title).toBe(
      'feat: y',
    );
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
      { name: 'pipeline', status: 'pending', required: true, conclusion: 'running', job_id: null, ...run },
      { name: 'lint', status: 'success', required: true, conclusion: 'success', job_id: 1, ...run },
      { name: 'gate', status: 'pending', required: true, conclusion: 'manual', job_id: 2, ...run },
      { name: 'flaky', status: 'failure', required: false, conclusion: 'failed', job_id: 3, ...run },
      { name: 'e2e', status: 'failure', required: true, conclusion: 'canceled', job_id: 4, ...run },
      // overall() fails a required check whose conclusion is skipped.
      { name: 'docs', status: 'success', required: true, conclusion: 'skipped', job_id: 5, ...run },
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
});
