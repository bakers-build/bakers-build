import { createVerify, generateKeyPairSync } from 'node:crypto';
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

    const soon = fakeFetch({}, 30_000);
    const short = await factory(SETTINGS, { home: '/h', fetch: soon.doFetch });
    await short.gitAuth();
    await short.gitAuth();
    expect(soon.mints()).toBe(2);
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
          { name: 'required', status: 'completed', conclusion: 'success' },
          { name: 'lint', status: 'in_progress', conclusion: null },
          { name: 'optional', status: 'completed', conclusion: 'failure' },
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
    });
    const b = await factory(SETTINGS, { home: '/h', fetch: f.doFetch });
    const checks = await b.checks('abc', 'next');
    expect(checks).toEqual([
      { name: 'required', status: 'success', required: true },
      { name: 'lint', status: 'pending', required: true },
      { name: 'optional', status: 'failure', required: false },
      { name: 'ci/legacy', status: 'success', required: true },
      { name: 'e2e', status: 'missing', required: true },
    ]);
    expect(
      f.calls.filter((c) => c.method !== 'GET' && !c.path.startsWith('/app/')),
    ).toEqual([]);
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
