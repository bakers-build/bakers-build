import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  type ClaimContext,
  type Claimer,
  claimServices,
  discoverClaimedServices,
  type HttpProbe,
  inspectorPorts,
  publicHostname,
} from '../src/claims.js';
import { loadClaimers } from '../src/config.js';
import { serviceRules } from '../src/service-config.js';
import type { RawDiscovery, RawPort } from '../src/types.js';

const defaults = serviceRules(undefined);

function rawPort(partial: Partial<RawPort>): RawPort {
  return {
    worktree: '/work',
    listening: 'unknown',
    exposed: 'unknown',
    ...partial,
  };
}

function discovery(ports: RawPort[]): RawDiscovery {
  return { ports, diagnostics: [] };
}

function ctx(overrides: Partial<ClaimContext> = {}): ClaimContext {
  const noProbe: HttpProbe = async () => null;
  return {
    worktree: '/work',
    ticket: 'pynq-42',
    zone: 'preview.example',
    probe: noProbe,
    ...overrides,
  };
}

describe('publicHostname', () => {
  it('builds the fixed ticket-key hostname, lowercased', () => {
    expect(publicHostname('PYNQ-42', 'drupal-admin', 'preview.example')).toBe(
      'pynq-42-drupal-admin.preview.example',
    );
  });

  it('rejects a combined label over 63 bytes rather than truncating', () => {
    const longKey = 'x'.repeat(60);
    expect(() =>
      publicHostname('pynq-42', longKey, 'preview.example'),
    ).toThrow();
  });

  it('rejects a zone carrying a scheme or wildcard', () => {
    expect(() =>
      publicHostname('pynq-42', 'mailpit', 'https://*.example'),
    ).toThrow();
  });

  it('rejects an unparseable ticket identifier', () => {
    expect(() =>
      publicHostname('not-a-ticket-id-at-all-', 'mailpit', 'example.com'),
    ).toThrow();
  });
});

describe('claimServices — Storybook', () => {
  it('claims a host process naming itself in the command line', async () => {
    const raw = discovery([
      rawPort({
        hostAddress: '127.0.0.1',
        hostPort: 6006,
        cmdline: 'node storybook dev',
      }),
    ]);
    const result = await claimServices(raw, ctx(), defaults);
    expect(result.services).toHaveLength(1);
    expect(result.services[0]).toMatchObject({
      claim: 'process',
      status: 'healthy',
    });
    expect(result.services[0]!.rules[0]!.hostHeader).toBe('localhost:6006');
  });

  it('claims a static build via a v5 /index.json probe', async () => {
    const probe: HttpProbe = async (url) =>
      url.includes('6031')
        ? { ok: true, status: 200, body: JSON.stringify({ v: 5, entries: {} }) }
        : null;
    const raw = discovery([
      rawPort({ hostAddress: '127.0.0.1', hostPort: 6031 }),
    ]);
    const result = await claimServices(raw, ctx({ probe }), defaults);
    expect(result.services).toHaveLength(1);
    expect(result.services[0]!.claim).toBe('process');
  });

  it('rejects unrelated JSON from the probe', async () => {
    const probe: HttpProbe = async () => ({
      ok: true,
      status: 200,
      body: JSON.stringify({ hello: 'world' }),
    });
    const raw = discovery([
      rawPort({ hostAddress: '127.0.0.1', hostPort: 4000 }),
    ]);
    const result = await claimServices(raw, ctx({ probe }), defaults);
    expect(result.services).toHaveLength(0);
  });

  it('treats a cancelled/failed probe as not Storybook', async () => {
    const probe: HttpProbe = async () => {
      throw new Error('aborted');
    };
    const raw = discovery([
      rawPort({ hostAddress: '127.0.0.1', hostPort: 4000 }),
    ]);
    const result = await claimServices(raw, ctx({ probe }), defaults);
    expect(result.services).toHaveLength(0);
  });

  it('never probes a non-loopback host candidate', async () => {
    let called = false;
    const probe: HttpProbe = async () => {
      called = true;
      return {
        ok: true,
        status: 200,
        body: JSON.stringify({ v: 5, entries: {} }),
      };
    };
    const raw = discovery([
      rawPort({ hostAddress: '10.0.0.5', hostPort: 4000 }),
    ]);
    await claimServices(raw, ctx({ probe }), defaults);
    expect(called).toBe(false);
  });

  it('reports an unclaimed raw port as `unclaimed`, never silently dropped', async () => {
    const raw = discovery([
      rawPort({
        hostAddress: '10.0.0.5',
        hostPort: 9000,
        cmdline: 'some-other-process',
      }),
    ]);
    const result = await claimServices(raw, ctx(), defaults);
    expect(result.services).toHaveLength(0);
    expect(result.unclaimed).toHaveLength(1);
    expect(result.unclaimed[0]!.hostPort).toBe(9000);
  });

  it('C3: suffixes a second Storybook claim by port instead of colliding on the key', async () => {
    const raw = discovery([
      rawPort({
        hostAddress: '127.0.0.1',
        hostPort: 6006,
        cmdline: 'node storybook dev',
      }),
      rawPort({
        hostAddress: '127.0.0.1',
        hostPort: 6007,
        cmdline: 'node storybook dev',
      }),
    ]);
    const result = await claimServices(raw, ctx(), defaults);
    expect(result.services.map((s) => s.key).sort()).toEqual([
      'storybook',
      'storybook-6007',
    ]);
  });
});

/** A neutral claimer: every container row becomes `web`, and it reports
 *  whatever context it was handed on its claims' `local`. */
const fakeClaimer: Claimer<{ readonly label?: string }> = {
  discover: async () => ({ ports: [], diagnostics: [] }),
  claim: (raw, remaining, c) =>
    [...remaining]
      .filter((i) => raw[i]!.containerId !== undefined)
      .map((i) => {
        remaining.delete(i);
        return {
          key: 'web',
          claim: 'fake',
          status: 'healthy' as const,
          local: c.label ?? 'http://web.test',
          rawPorts: [raw[i]!],
          rules: [],
        };
      }),
};

const containerRow = rawPort({
  containerId: 'web123',
  containerPort: 80,
  exposed: true,
  listening: true,
});

describe('claimServices — orchestration with configured claimers', () => {
  it('runs Storybook before a claimer, each over what the other left unclaimed', async () => {
    const storybookRow = rawPort({
      hostAddress: '127.0.0.1',
      hostPort: 6006,
      cmdline: 'node storybook dev',
    });
    const result = await claimServices(
      discovery([storybookRow, containerRow]),
      ctx(),
      defaults,
      [fakeClaimer],
    );
    const keys = result.services.map((s) => s.key).sort();
    expect(keys).toEqual(['storybook', 'web']);
    expect(result.unclaimed).toHaveLength(0);
  });

  it('an unexposed, not-claimed listener never produces a rule', async () => {
    const result = await claimServices(
      discovery([
        rawPort({
          hostAddress: '127.0.0.1',
          hostPort: 9999,
          cmdline: 'mystery-process',
        }),
      ]),
      ctx(),
      defaults,
    );
    expect(result.services).toEqual([]);
    expect(result.unclaimed).toHaveLength(1);
  });

  it('loads a configured claimer package by name and runs it between the process claimers and the all-Node rule, over `remaining`', async () => {
    const home = await mkdtemp(join(tmpdir(), 'bakers-ports-claimer-'));
    try {
      const pkg = join(home, 'node_modules', 'fake-claimer');
      await mkdir(pkg, { recursive: true });
      await writeFile(
        join(pkg, 'package.json'),
        JSON.stringify({
          name: 'fake-claimer',
          type: 'module',
          main: 'index.js',
        }),
      );
      // Claims the 3000 listener and records which raw indices it was offered.
      await writeFile(
        join(pkg, 'index.js'),
        `export const claimer = {
          discover: async () => ({ ports: [], diagnostics: [] }),
          claim(raw, remaining) {
            globalThis.fakeClaimerSaw = [...remaining].sort();
            const i = raw.findIndex((p) => p.hostPort === 3000);
            remaining.delete(i);
            return [{ key: 'api', claim: 'fake', status: 'healthy', local: 'x', rawPorts: [raw[i]], rules: [] }];
          },
        };`,
      );
      const claimers = await loadClaimers({ claimers: ['fake-claimer'] }, home);
      const probe: HttpProbe = async () => ({
        ok: true,
        status: 200,
        body: 'hi',
      });
      const result = await claimServices(
        discovery([
          rawPort({
            hostAddress: '127.0.0.1',
            hostPort: 6006,
            cmdline: 'node storybook dev',
          }),
          rawPort({
            hostAddress: '127.0.0.1',
            hostPort: 3000,
            cmdline: 'node api.js',
          }),
          rawPort({
            hostAddress: '127.0.0.1',
            hostPort: 3001,
            cmdline: 'node other.js',
          }),
        ]),
        ctx({ probe }),
        serviceRules({ all_node: true }),
        claimers,
      );
      // Storybook (index 0) was already taken; the all-Node rule had not run.
      expect(
        (globalThis as { fakeClaimerSaw?: number[] }).fakeClaimerSaw,
      ).toEqual([1, 2]);
      expect(
        Object.fromEntries(result.services.map((s) => [s.key, s.claim])),
      ).toEqual({ storybook: 'process', api: 'fake', 'node-3001': 'node' });
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it('refuses a claimer package that does not resolve', async () => {
    const home = await mkdtemp(join(tmpdir(), 'bakers-ports-claimer-'));
    try {
      await expect(
        loadClaimers({ claimers: ['no-such-claimer'] }, home),
      ).rejects.toThrow("cannot resolve claimer package 'no-such-claimer'");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it('refuses a claimer package without a `claimer` export carrying discover and claim', async () => {
    const home = await mkdtemp(join(tmpdir(), 'bakers-ports-claimer-'));
    try {
      const pkg = join(home, 'node_modules', 'half-claimer');
      await mkdir(pkg, { recursive: true });
      await writeFile(
        join(pkg, 'package.json'),
        JSON.stringify({
          name: 'half-claimer',
          type: 'module',
          main: 'index.js',
        }),
      );
      await writeFile(
        join(pkg, 'index.js'),
        'export const claimer = { discover: async () => ({ ports: [], diagnostics: [] }) };',
      );
      await expect(
        loadClaimers({ claimers: ['half-claimer'] }, home),
      ).rejects.toThrow("ports claimer 'half-claimer' has no `claimer` export");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});

describe('discoverClaimedServices', () => {
  it("adds each claimer's own ports and diagnostics to the pass and its context to the claim", async () => {
    const deps = {
      run: async () => ({ stdout: '', ok: true }),
      processInfo: async () => null,
      readFile: async () => null,
    };
    const discovering: Claimer<{ readonly label?: string }> = {
      ...fakeClaimer,
      discover: async (worktree) => ({
        ports: [{ ...containerRow, worktree }],
        diagnostics: [
          { source: 'claimer', keyPrefix: 'web', message: 'blind' },
        ],
        context: { label: 'from-discover' },
      }),
    };
    const result = await discoverClaimedServices('/work', deps, {
      ticket: 'pynq-42',
      zone: 'preview.example',
      probe: async () => null,
      rules: defaults,
      claimers: [discovering],
    });
    expect(result.services.map((s) => s.local)).toEqual(['from-discover']);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ source: 'claimer', keyPrefix: 'web' }),
    );
  });
});

describe('claimServices — configured process rules', () => {
  const docs = serviceRules({
    services: [{ key: 'docs', match: 'vitepress' }],
  });
  const vitepress = (hostPort: number) =>
    rawPort({
      hostAddress: '127.0.0.1',
      hostPort,
      cmdline: 'node /w/node_modules/vitepress/bin/vitepress.js dev',
    });
  const nodeOn = (hostPort: number, cmdline = 'node server.js') =>
    rawPort({ hostAddress: '127.0.0.1', hostPort, cmdline });
  const answers: HttpProbe = async () => ({ ok: true, status: 200, body: '' });
  const allNode = serviceRules({ all_node: true });

  it('claims a listener whose cmdline matches a configured entry', async () => {
    const result = await claimServices(
      discovery([vitepress(5173)]),
      ctx(),
      docs,
    );
    expect(result.services).toHaveLength(1);
    expect(result.services[0]).toMatchObject({
      key: 'docs',
      claim: 'process',
      local: 'http://127.0.0.1:5173',
      rules: [
        {
          key: 'docs',
          service: 'http://127.0.0.1:5173',
          hostHeader: 'localhost:5173',
        },
      ],
    });
  });

  it('suffixes further matches of one entry by port', async () => {
    const result = await claimServices(
      discovery([vitepress(5174), vitepress(5173)]),
      ctx(),
      docs,
    );
    expect(result.services.map((s) => s.key)).toEqual(['docs', 'docs-5174']);
  });

  it('leaves an unmatched listener unclaimed without all_node', async () => {
    const result = await claimServices(
      discovery([nodeOn(4101)]),
      ctx({ probe: answers }),
      docs,
    );
    expect(result.services).toEqual([]);
    expect(result.unclaimed.map((p) => p.hostPort)).toEqual([4101]);
  });

  it('claims every remaining node listener as node-<port> with all_node', async () => {
    const result = await claimServices(
      discovery([
        nodeOn(4101),
        nodeOn(4102, '/usr/bin/nodejs app.js'),
        nodeOn(4103, 'python3 -m http.server 4103'),
      ]),
      ctx({ probe: answers }),
      allNode,
    );
    expect(result.services.map((s) => [s.key, s.claim])).toEqual([
      ['node-4101', 'node'],
      ['node-4102', 'node'],
    ]);
    expect(result.unclaimed.map((p) => p.hostPort)).toEqual([4103]);
  });

  it('all_node fails closed on a listener with no HTTP answer', async () => {
    const result = await claimServices(
      discovery([nodeOn(4101)]),
      ctx({ probe: async () => null }),
      allNode,
    );
    expect(result.services).toEqual([]);
  });

  it('excludes port 9229 from every rule', async () => {
    const result = await claimServices(
      discovery([nodeOn(9229, 'node --inspect storybook dev')]),
      ctx({ probe: answers }),
      serviceRules({ all_node: true }),
    );
    expect(result.services).toEqual([]);
    expect(result.unclaimed.map((p) => p.hostPort)).toEqual([9229]);
  });

  it('excludes the inspector port of a matched process', async () => {
    const cmdline =
      'node --inspect=127.0.0.1:9230 node_modules/.bin/storybook dev';
    const result = await claimServices(
      discovery([nodeOn(6006, cmdline), nodeOn(9230, cmdline)]),
      ctx({ probe: answers }),
      allNode,
    );
    expect(result.services.map((s) => s.key)).toEqual(['storybook']);
    expect(result.unclaimed.map((p) => p.hostPort)).toEqual([9230]);
  });

  it('excludes a probe-identified inspector with no flag', async () => {
    const probe: HttpProbe = async (url) =>
      url === 'http://127.0.0.1:9231/json/version'
        ? {
            ok: true,
            status: 200,
            body: '{"Browser":"node.js/v22.0.0","Protocol-Version":"1.1"}',
          }
        : { ok: true, status: 200, body: 'hi' };
    const result = await claimServices(
      discovery([
        nodeOn(4105, 'node vitepress dev'),
        nodeOn(9231, 'node vitepress dev'),
      ]),
      ctx({ probe }),
      serviceRules({
        services: [{ key: 'docs', match: 'vitepress' }],
        all_node: true,
      }),
    );
    expect(result.services.map((s) => s.key)).toEqual(['docs']);
    expect(result.unclaimed.map((p) => p.hostPort)).toEqual([9231]);
  });

  it('probes an IPv6 wildcard listener on [::1]', async () => {
    const urls: string[] = [];
    await claimServices(
      discovery([
        rawPort({ hostAddress: '::', hostPort: 4101, cmdline: 'node a' }),
      ]),
      ctx({
        probe: async (url) => {
          urls.push(url);
          return null;
        },
      }),
      allNode,
    );
    expect(urls).toEqual(['http://[::1]:4101/json/version']);
  });

  it('inspectorPorts parses =port, =host:port, a separate argument and --inspect-port', () => {
    expect(inspectorPorts('node --inspect=9230 a.js')).toEqual([9230]);
    expect(inspectorPorts('node --inspect-brk=0.0.0.0:9240 a.js')).toEqual([
      9240,
    ]);
    expect(inspectorPorts('node --inspect-wait 127.0.0.1:9250 a.js')).toEqual([
      9250,
    ]);
    expect(inspectorPorts('node --inspect-port 9260 a.js')).toEqual([9260]);
    expect(inspectorPorts('node --inspect a.js')).toEqual([9229]);
    expect(inspectorPorts('node server.js --port 3000')).toEqual([]);
  });

  it('renames a process claim colliding with a claimer key', async () => {
    const result = await claimServices(
      discovery([nodeOn(3000, 'node web-server.js'), containerRow]),
      ctx(),
      serviceRules({ services: [{ key: 'web', match: 'web-server' }] }),
      [fakeClaimer],
    );
    const byClaim = Object.fromEntries(
      result.services.map((s) => [s.claim, s.key]),
    );
    expect(byClaim).toEqual({ fake: 'web', process: 'web-3000' });
  });

  it('an overriding storybook entry keeps the static index.json fallback', async () => {
    const probe: HttpProbe = async (url) =>
      url.endsWith('/index.json')
        ? { ok: true, status: 200, body: JSON.stringify({ v: 5, entries: {} }) }
        : null;
    const result = await claimServices(
      discovery([rawPort({ hostAddress: '127.0.0.1', hostPort: 6031 })]),
      ctx({ probe }),
      serviceRules({ services: [{ key: 'storybook', match: 'my-sb' }] }),
    );
    expect(result.services.map((s) => s.key)).toEqual(['storybook']);
  });
});
