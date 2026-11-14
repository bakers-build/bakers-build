import { createVerify, generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import factory from '../src/index.js';

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
});
const PEM = privateKey.export({ type: 'pkcs1', format: 'pem' }).toString();
const SETTINGS = {
  repository: 'acme/shop',
  app_id: 123,
  installation_id: 456,
  private_key: PEM,
};

type Route = (url: URL, init: RequestInit) => unknown;

function fakeFetch(routes: Record<string, Route>, expiresInMs = 3_600_000) {
  const calls: {
    method: string;
    path: string;
    body?: unknown;
    auth?: string;
  }[] = [];
  let mint = 0;
  const doFetch = (async (input: string, init: RequestInit = {}) => {
    const url = new URL(input);
    const method = init.method ?? 'GET';
    const headers = new Headers(init.headers);
    calls.push({
      method,
      path: url.pathname + url.search,
      ...(init.body ? { body: JSON.parse(String(init.body)) } : {}),
      auth: headers.get('authorization') ?? undefined,
    });
    if (url.pathname === '/app/installations/456/access_tokens') {
      mint++;
      return Response.json({
        token: `ghs_TOKEN${mint}`,
        expires_at: new Date(Date.now() + expiresInMs).toISOString(),
      });
    }
    const route = routes[`${method} ${url.pathname}`];
    if (!route) return new Response('not found', { status: 404 });
    const out = route(url, init);
    return out === undefined
      ? new Response(null, { status: 204 })
      : Response.json(out);
  }) as typeof fetch;
  return { doFetch, calls, mints: () => mint };
}

const PULL = {
  number: 5,
  html_url: 'https://github.com/acme/shop/pull/5',
  head: { ref: 'feat/bb-7-work', sha: 'abc' },
  base: { ref: 'next' },
  title: 'feat: x',
  state: 'open',
  merged: false,
  mergeable: true,
};

const NO_RUN = { run_id: null, job_id: null, run_started_at: null };

/** A check run of suite `suite` on commit `abc`. */
const cr = (
  id: number,
  name: string,
  status: string,
  conclusion: string | null,
  suite = 100,
) => ({ id, name, status, conclusion, head_sha: 'abc', check_suite: { id: suite } });

/** A workflow run owning check suite `suite`. */
const run = (id: number, workflow: number, suite: number, started: string) => ({
  id,
  workflow_id: workflow,
  check_suite_id: suite,
  run_started_at: started,
});

describe('forge-github', () => {
  it('rejects incomplete settings without echoing a key', async () => {
    await expect(
      factory({ repository: 'acme' }, { home: '/h' }),
    ).rejects.toThrow(/repository/);
    await expect(
      factory({ ...SETTINGS, private_key: undefined }, { home: '/h' }),
    ).rejects.toThrow(/private_key or private_key_env/);
  });

  it('reads the key from private_key_env', async () => {
    process.env.BB_TEST_GH_KEY = PEM;
    const { doFetch } = fakeFetch({});
    const b = await factory(
      {
        ...SETTINGS,
        private_key: undefined,
        private_key_env: 'BB_TEST_GH_KEY',
      },
      { home: '/h', fetch: doFetch },
    );
    expect(b.secrets()).toContain(PEM);
  });

  it('mints a repository-scoped installation token with an RS256 app JWT, caches it until shortly before expiry', async () => {
    const f = fakeFetch({ 'GET /repos/acme/shop/pulls': () => [] });
    const b = await factory(SETTINGS, { home: '/h', fetch: f.doFetch });
    const auth = await b.gitAuth();
    expect(auth.url).toBe('https://github.com/acme/shop.git');
    expect(auth.header).toBe(
      `Authorization: Basic ${Buffer.from('x-access-token:ghs_TOKEN1').toString('base64')}`,
    );
    await b.findOpenPr('feat/bb-7-work');
    expect(f.mints()).toBe(1);
    const mint = f.calls[0]!;
    expect(mint.body).toEqual({ repositories: ['shop'] });
    const jwt = mint.auth!.replace('Bearer ', '');
    const [h, p, s] = jwt.split('.');
    const verify = createVerify('RSA-SHA256');
    verify.update(`${h}.${p}`);
    expect(verify.verify(publicKey, Buffer.from(s!, 'base64url'))).toBe(true);
    expect(JSON.parse(Buffer.from(p!, 'base64url').toString()).iss).toBe('123');
    expect(f.calls[1]!.auth).toBe('Bearer ghs_TOKEN1');
    expect(b.secrets()).toContain('ghs_TOKEN1');
    expect(b.secrets()).toContain(
      auth.header.replace('Authorization: Basic ', ''),
    );

    const soon = fakeFetch({}, 30_000);
    const short = await factory(SETTINGS, { home: '/h', fetch: soon.doFetch });
    await short.gitAuth();
    await short.gitAuth();
    expect(soon.mints()).toBe(2);
  });

  it('keeps every token and app JWT it minted in secrets after a refresh', async () => {
    const f = fakeFetch({}, 30_000);
    const b = await factory(SETTINGS, { home: '/h', fetch: f.doFetch });
    const first = await b.gitAuth();
    await b.gitAuth();
    expect(f.mints()).toBe(2);
    const secrets = b.secrets();
    expect(secrets).toContain('ghs_TOKEN1');
    expect(secrets).toContain('ghs_TOKEN2');
    expect(secrets).toContain(
      first.header.replace('Authorization: Basic ', ''),
    );
    for (const mint of f.calls.filter((c) => c.path.startsWith('/app/')))
      expect(secrets).toContain(mint.auth!.replace('Bearer ', ''));
  });

  it("with auth 'gh' takes the conductor's gh login token, keeps it in secrets, and mints nothing", async () => {
    const bin = mkdtempSync(join(tmpdir(), 'fake-gh-'));
    writeFileSync(
      join(bin, 'gh'),
      '#!/bin/sh\n[ "$1 $2" = "auth token" ] && echo gho_LOGIN\n',
      { mode: 0o755 },
    );
    const path = process.env.PATH;
    process.env.PATH = `${bin}:${path}`;
    try {
      const f = fakeFetch({ 'GET /repos/acme/shop/pulls': () => [PULL] });
      const b = await factory(
        { repository: 'acme/shop', auth: 'gh' },
        { home: '/h', fetch: f.doFetch },
      );
      expect((await b.findOpenPr('feat/bb-7-work'))?.number).toBe(5);
      expect(f.calls.at(-1)?.auth).toBe('Bearer gho_LOGIN');
      expect(f.mints()).toBe(0);
      expect((await b.gitAuth()).header).toBe(
        `Authorization: Basic ${Buffer.from('x-access-token:gho_LOGIN').toString('base64')}`,
      );
      expect(b.secrets()).toContain('gho_LOGIN');
    } finally {
      process.env.PATH = path;
    }
  });

  it("rejects auth 'gh' when gh prints no token", async () => {
    const bin = mkdtempSync(join(tmpdir(), 'fake-gh-'));
    writeFileSync(join(bin, 'gh'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
    const path = process.env.PATH;
    process.env.PATH = `${bin}:${path}`;
    try {
      const b = await factory(
        { repository: 'acme/shop', auth: 'gh' },
        { home: '/h', fetch: fakeFetch({}).doFetch },
      );
      await expect(b.findOpenPr('x')).rejects.toThrow(/gh auth login/);
    } finally {
      process.env.PATH = path;
    }
  });

  it('finds, creates and updates PRs', async () => {
    const f = fakeFetch({
      'GET /repos/acme/shop/pulls': (url) =>
        url.searchParams.get('head') === 'acme:feat/bb-7-work' ||
        url.searchParams.get('base') === 'next'
          ? [PULL]
          : [],
      'POST /repos/acme/shop/pulls': () => PULL,
      'PATCH /repos/acme/shop/pulls/5': () => ({ ...PULL, title: 'feat: y' }),
    });
    const b = await factory(SETTINGS, { home: '/h', fetch: f.doFetch });
    const pr = await b.findOpenPr('feat/bb-7-work');
    expect(pr).toEqual({
      number: 5,
      url: PULL.html_url,
      head: 'feat/bb-7-work',
      base: 'next',
      title: 'feat: x',
      headSha: 'abc',
    });
    expect(await b.findOpenPr('feat/other')).toBeUndefined();
    await b.createPr({
      head: 'feat/bb-7-work',
      base: 'next',
      title: 'feat: x',
      body: 'b',
    });
    expect(
      f.calls.find((c) => c.method === 'POST' && c.path.endsWith('/pulls'))
        ?.body,
    ).toEqual({
      head: 'feat/bb-7-work',
      base: 'next',
      title: 'feat: x',
      body: 'b',
    });
    expect((await b.updatePr(pr!, { title: 'feat: y', body: '' })).title).toBe(
      'feat: y',
    );
    expect(await b.openPrsWithBase('next')).toHaveLength(1);
  });

  it('marks required checks from rulesets and branch protection, a missing required one as missing, and writes nothing', async () => {
    const f = fakeFetch({
      'GET /repos/acme/shop/commits/abc/check-runs': () => ({
        check_runs: [
          cr(11, 'required', 'completed', 'success'),
          cr(12, 'lint', 'in_progress', null),
          cr(13, 'optional', 'completed', 'cancelled'),
        ],
      }),
      'GET /repos/acme/shop/commits/abc/status': () => ({
        statuses: [{ context: 'ci/legacy', state: 'success' }],
      }),
      'GET /repos/acme/shop/rules/branches/next': () => [
        {
          type: 'required_status_checks',
          parameters: {
            required_status_checks: [
              { context: 'required' },
              { context: 'e2e' },
            ],
          },
        },
        { type: 'pull_request', parameters: {} },
      ],
      'GET /repos/acme/shop/branches/next': () => ({
        protection: {
          required_status_checks: { contexts: ['lint', 'ci/legacy'] },
        },
      }),
      'GET /repos/acme/shop/actions/runs': () => ({
        workflow_runs: [run(900, 1, 100, '2026-11-14T10:00:00Z')],
      }),
    });
    const b = await factory(SETTINGS, { home: '/h', fetch: f.doFetch });
    const checks = await b.checks('abc', 'next');
    const inRun = { run_id: 900, run_started_at: '2026-11-14T10:00:00Z' };
    expect(checks).toEqual([
      { name: 'required', status: 'success', required: true, conclusion: 'success', job_id: 11, ...inRun },
      { name: 'lint', status: 'pending', required: true, conclusion: null, job_id: 12, ...inRun },
      { name: 'optional', status: 'failure', required: false, conclusion: 'cancelled', job_id: 13, ...inRun },
      { name: 'ci/legacy', status: 'success', required: true, conclusion: 'success', ...NO_RUN },
      { name: 'e2e', status: 'missing', required: true, conclusion: null, ...NO_RUN },
    ]);
    expect(
      f.calls.filter((c) => c.method !== 'GET' && !c.path.startsWith('/app/')),
    ).toEqual([]);
  });

  it('keeps only the newest run per workflow and the newest attempt per job, unless all runs are asked for', async () => {
    const f = fakeFetch({
      'GET /repos/acme/shop/commits/feat%2Fbb-7-work/check-runs': () => ({
        check_runs: [
          cr(21, 'build', 'completed', 'cancelled', 100),
          cr(22, 'required', 'completed', 'cancelled', 100),
          cr(31, 'build', 'completed', 'failure', 200),
          cr(32, 'required', 'completed', 'failure', 200),
          cr(33, 'build', 'completed', 'success', 200),
          cr(41, 'docs', 'completed', 'success', 300),
          cr(51, 'external', 'completed', 'success', 999),
        ],
      }),
      'GET /repos/acme/shop/commits/feat%2Fbb-7-work/status': () => ({
        statuses: [],
      }),
      'GET /repos/acme/shop/actions/runs': (url) => {
        expect(url.searchParams.get('head_sha')).toBe('abc');
        return {
          workflow_runs: [
            run(1, 7, 100, '2026-11-14T10:00:00Z'),
            run(2, 7, 200, '2026-11-14T10:05:00Z'),
            run(3, 8, 300, '2026-11-14T09:00:00Z'),
          ],
        };
      },
    });
    const b = await factory(SETTINGS, { home: '/h', fetch: f.doFetch });
    const pick = (rows: Awaited<ReturnType<typeof b.checks>>) =>
      rows.map((r) => [r.name, r.run_id, r.job_id, r.conclusion]);

    expect(pick(await b.checks('feat/bb-7-work', 'next'))).toEqual([
      ['required', 2, 32, 'failure'],
      ['build', 2, 33, 'success'],
      ['docs', 3, 41, 'success'],
      ['external', null, null, 'success'],
    ]);
    expect(
      pick(await b.checks('feat/bb-7-work', 'next', { allRuns: true })),
    ).toEqual([
      ['build', 1, 21, 'cancelled'],
      ['required', 1, 22, 'cancelled'],
      ['build', 2, 31, 'failure'],
      ['required', 2, 32, 'failure'],
      ['build', 2, 33, 'success'],
      ['docs', 3, 41, 'success'],
      ['external', null, null, 'success'],
    ]);
  });

  it('asks for no workflow runs when the commit has no check runs', async () => {
    const f = fakeFetch({
      'GET /repos/acme/shop/commits/abc/check-runs': () => ({ check_runs: [] }),
      'GET /repos/acme/shop/commits/abc/status': () => ({
        statuses: [{ context: 'ci/legacy', state: 'failure' }],
      }),
    });
    const b = await factory(SETTINGS, { home: '/h', fetch: f.doFetch });
    expect(await b.checks('abc', 'next')).toEqual([
      { name: 'ci/legacy', status: 'failure', required: false, conclusion: 'failure', ...NO_RUN },
    ]);
    expect(f.calls.some((c) => c.path.includes('/actions/runs'))).toBe(false);
  });

  it('reports conflicts and uncomputed mergeability, merges with the method sent explicitly and deletes only when asked', async () => {
    let merged = false;
    let mergeable: boolean | null = false;
    const f = fakeFetch({
      'GET /repos/acme/shop/pulls/5': () => ({ ...PULL, mergeable, merged }),
      'PUT /repos/acme/shop/pulls/5/merge': () => {
        merged = true;
        return { merged: true };
      },
      'DELETE /repos/acme/shop/git/refs/heads/feat/bb-7-work': () => undefined,
    });
    const b = await factory(SETTINGS, { home: '/h', fetch: f.doFetch });
    const pr = {
      number: 5,
      url: PULL.html_url,
      head: 'feat/bb-7-work',
      base: 'next',
      title: 'feat: x',
      headSha: 'abc',
    };
    expect(await b.mergeBlocker(pr)).toMatch(/conflict/);
    mergeable = null;
    expect(await b.mergeBlocker(pr)).toMatch(/not computed yet/);
    mergeable = true;
    expect(await b.mergeBlocker(pr)).toBeUndefined();

    await b.merge(pr, {
      method: 'squash',
      deleteSource: false,
      subject: 'feat: x',
      body: 'Merged-by: bakers.build\nref:BB-7',
    });
    expect(f.calls.find((c) => c.method === 'PUT')?.body).toEqual({
      merge_method: 'squash',
      commit_title: 'feat: x',
      commit_message: 'Merged-by: bakers.build\nref:BB-7',
      sha: 'abc',
    });
    expect(f.calls.some((c) => c.method === 'DELETE')).toBe(false);
    expect(await b.isMerged(pr)).toBe(true);

    await b.merge(pr, {
      method: 'merge',
      deleteSource: true,
      subject: 'feat: x',
      body: 'ref:BB-7',
    });
    expect(f.calls.some((c) => c.method === 'DELETE')).toBe(true);
  });
});
