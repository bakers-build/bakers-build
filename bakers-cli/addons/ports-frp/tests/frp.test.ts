import type { TunnelDesiredRecord } from '@bakers-build/addon-ports/transport';
import { describe, expect, it } from 'vitest';
import {
  FrpConfigError,
  FrpUnverifiedHttpsError,
  toFrpProxy,
  validateClientConfig,
  validateSettings,
} from '../src/frp.js';
import type { FrpDeps, FrpReconcileConfig } from '../src/reconcile.js';
import { computeGeneration, reconcileFrp } from '../src/reconcile.js';

const ROUTES_PATH = '/home/.bakers/frp/routes.json';
const IDENTITY =
  '/etc/frp/frpc.json/frps.example:7000/bakers-ticket-99/preview.example';

function goodClientConfig(): Record<string, unknown> {
  return {
    serverAddr: 'frps.example',
    serverPort: 7000,
    user: 'bakers-ticket-99',
    auth: { method: 'token' },
    webServer: { addr: '127.0.0.1', port: 7400 },
    transport: { tls: { enable: true, trustedCaFile: '/etc/frp/ca.pem' } },
    includes: [ROUTES_PATH],
  };
}

function record(
  overrides: Partial<TunnelDesiredRecord> = {},
): TunnelDesiredRecord {
  return {
    worktree: 'wt-1',
    ticket: 'bb-99',
    key: 'storybook',
    service: 'http://127.0.0.1:6006',
    hostname: 'bb-99-storybook.preview.example',
    desired: 'present',
    applied: 'pending',
    ...overrides,
  };
}

describe('toFrpProxy', () => {
  it('translates a plain HTTP origin to an HTTP proxy with localIP/localPort/hostHeaderRewrite', () => {
    const proxy = toFrpProxy(
      record({
        service: 'http://127.0.0.1:6006',
        hostHeader: 'localhost:6006',
      }),
    );
    expect(proxy).toEqual({
      name: 'bb-99-storybook',
      type: 'http',
      customDomains: ['bb-99-storybook.preview.example'],
      localIP: '127.0.0.1',
      localPort: 6006,
      hostHeaderRewrite: 'localhost:6006',
    });
  });

  it('translates a DDEV mkcert HTTPS origin (insecureTls: true) to http2https', () => {
    const proxy = toFrpProxy(
      record({
        service: 'https://127.0.0.1:443',
        hostHeader: 'myproject.ddev.site',
        insecureTls: true,
      }),
    );
    expect(proxy).toEqual({
      name: 'bb-99-storybook',
      type: 'http',
      customDomains: ['bb-99-storybook.preview.example'],
      plugin: {
        type: 'http2https',
        localAddr: '127.0.0.1:443',
        hostHeaderRewrite: 'myproject.ddev.site',
      },
    });
  });

  it('rejects HTTPS with verification requested (insecureTls omitted) before any mutation', () => {
    expect(() =>
      toFrpProxy(record({ service: 'https://127.0.0.1:443' })),
    ).toThrow(FrpUnverifiedHttpsError);
  });

  it('rejects HTTPS with insecureTls explicitly false', () => {
    expect(() =>
      toFrpProxy(
        record({ service: 'https://127.0.0.1:443', insecureTls: false }),
      ),
    ).toThrow(FrpUnverifiedHttpsError);
  });
});

describe('toFrpProxy with a direct container origin', () => {
  const ddevWeb = (direct: string) =>
    record({
      ticket: 'BB-684',
      key: 'web',
      hostname: 'bb-684-web.frps.preview.bakers.build',
      service: 'https://127.0.0.1:443',
      hostHeader: 'bb-684.ddev.site',
      insecureTls: true,
      direct,
    });

  it('dials the container over plain HTTP, keeps the public Host and forces X-Forwarded-Proto', () => {
    expect(toFrpProxy(ddevWeb('http://172.18.0.19:80'))).toStrictEqual({
      name: 'BB-684-web',
      type: 'http',
      customDomains: ['bb-684-web.frps.preview.bakers.build'],
      localIP: '172.18.0.19',
      localPort: 80,
      requestHeaders: { set: { 'X-Forwarded-Proto': 'https' } },
    });
  });

  it('rejects a direct origin that is not a plain http URL', () => {
    expect(() => toFrpProxy(ddevWeb('https://172.18.0.19:443'))).toThrow(
      FrpConfigError,
    );
    expect(() => toFrpProxy(ddevWeb('not a url'))).toThrow(FrpConfigError);
    expect(() => toFrpProxy(ddevWeb('file:///etc/passwd'))).toThrow(
      FrpConfigError,
    );
  });
});

describe('validateClientConfig', () => {
  it('accepts a strictly-shaped config', () => {
    expect(validateClientConfig(goodClientConfig(), ROUTES_PATH)).toEqual({
      server: 'frps.example:7000',
      user: 'bakers-ticket-99',
    });
  });

  it('rejects a non-loopback admin bind', () => {
    const cfg = goodClientConfig();
    (cfg.webServer as Record<string, unknown>).addr = '0.0.0.0';
    expect(() => validateClientConfig(cfg, ROUTES_PATH)).toThrow(
      FrpConfigError,
    );
  });

  it('rejects missing explicit server-TLS verification', () => {
    const cfg = goodClientConfig();
    delete (cfg as { transport?: unknown }).transport;
    expect(() => validateClientConfig(cfg, ROUTES_PATH)).toThrow(
      FrpConfigError,
    );
  });

  it('rejects TLS enabled without a trustedCaFile (encryption alone is not verification)', () => {
    const cfg = goodClientConfig();
    cfg.transport = { tls: { enable: true } };
    expect(() => validateClientConfig(cfg, ROUTES_PATH)).toThrow(
      FrpConfigError,
    );
  });

  it('rejects zero or multiple includes', () => {
    const none = goodClientConfig();
    none.includes = [];
    expect(() => validateClientConfig(none, ROUTES_PATH)).toThrow(
      FrpConfigError,
    );

    const two = goodClientConfig();
    two.includes = [ROUTES_PATH, '/etc/frp/other.json'];
    expect(() => validateClientConfig(two, ROUTES_PATH)).toThrow(
      FrpConfigError,
    );
  });

  it('rejects inline proxies/visitors/store', () => {
    const withProxies = goodClientConfig();
    withProxies.proxies = [];
    expect(() => validateClientConfig(withProxies, ROUTES_PATH)).toThrow(
      FrpConfigError,
    );

    const withVisitors = goodClientConfig();
    withVisitors.visitors = [];
    expect(() => validateClientConfig(withVisitors, ROUTES_PATH)).toThrow(
      FrpConfigError,
    );

    const withStore = goodClientConfig();
    withStore.store = {};
    expect(() => validateClientConfig(withStore, ROUTES_PATH)).toThrow(
      FrpConfigError,
    );
  });
});

/** An in-memory fake world: files, a scriptable reload/status fetch, and a
 *  manually-advanced clock/delay so no test ever really sleeps. */
function fakeWorld(
  opts: {
    readonly initialFile?: string;
    readonly reload?: 'ok' | 'fail';
    readonly statusSequence?: readonly Record<string, { status: string }[]>[];
    readonly failWrite?: boolean;
    readonly reachable?: boolean;
  } = {},
) {
  const files = new Map<string, string>();
  if (opts.initialFile !== undefined) files.set(ROUTES_PATH, opts.initialFile);
  const writes: { path: string; data: string }[] = [];
  let clock = 0;
  let statusCallCount = 0;
  const statusSequence = opts.statusSequence ?? [];
  const probes: [string, number, number][] = [];

  const deps: FrpDeps = {
    readFile: async (path) => {
      const content = files.get(path);
      if (content === undefined) {
        const err = new Error('ENOENT') as NodeJS.ErrnoException;
        err.code = 'ENOENT';
        throw err;
      }
      return content;
    },
    writeFile: async (path, data) => {
      if (opts.failWrite) throw new Error('disk full');
      writes.push({ path, data });
      files.set(path, data);
    },
    rename: async (from, to) => {
      const data = files.get(from);
      if (data !== undefined) {
        files.set(to, data);
        files.delete(from);
      }
    },
    mkdir: async () => {},
    fetch: async (url: string) => {
      if (url.includes('/api/reload')) {
        if (opts.reload === 'fail') {
          return { ok: false, status: 500, json: async () => ({}) };
        }
        return { ok: true, status: 200, json: async () => ({}) };
      }
      if (url.includes('/api/status')) {
        const idx = Math.min(statusCallCount, statusSequence.length - 1);
        statusCallCount += 1;
        const body = statusSequence[idx] ?? [{}];
        return { ok: true, status: 200, json: async () => body[0] ?? {} };
      }
      throw new Error(`unexpected fetch ${url}`);
    },
    now: () => clock,
    delay: async (ms) => {
      clock += ms;
    },
    canConnect: async (host, port, timeoutMs) => {
      probes.push([host, port, timeoutMs]);
      return opts.reachable ?? true;
    },
  };
  return {
    deps,
    files,
    writes,
    probes,
    advanceStatusCallCount: () => statusCallCount,
  };
}

function baseCfg(
  overrides: Partial<FrpReconcileConfig> = {},
): FrpReconcileConfig {
  return {
    routesPath: ROUTES_PATH,
    identity: IDENTITY,
    adminBase: 'http://127.0.0.1:7400',
    adminUser: 'admin',
    adminPassword: 'secret',
    pollTimeoutMs: 2000,
    pollIntervalMs: 500,
    ...overrides,
  };
}

const noopCheckpoint = { checkpoint: async () => {} };

describe('reconcileFrp', () => {
  it('writes routes.json, reloads, and marks applied once status confirms running', async () => {
    const { deps, writes } = fakeWorld({
      statusSequence: [
        [{ http: [{ name: 'bb-99-storybook', status: 'running' }] }],
      ],
    });
    const result = await reconcileFrp(
      [record()],
      baseCfg(),
      deps,
      noopCheckpoint,
    );
    expect(result.ok).toBe(true);
    expect(result.records[0]?.applied).toBe('applied');
    expect(result.records[0]?.url).toBe(
      'https://bb-99-storybook.preview.example',
    );
    expect(writes).toHaveLength(1);
    const written = JSON.parse(writes[0]!.data);
    expect(written.proxies).toHaveLength(1);
    expect(written.proxies[0].name).toBe('bb-99-storybook');
  });

  it('leaves intent pending (not applied) when reload itself fails, preserving the file', async () => {
    const { deps, writes } = fakeWorld({ reload: 'fail' });
    const result = await reconcileFrp(
      [record()],
      baseCfg(),
      deps,
      noopCheckpoint,
    );
    expect(result.ok).toBe(false);
    expect(result.records[0]?.applied).toBe('pending');
    expect(writes).toHaveLength(1); // the file WAS written — reload is a separate step
  });

  it('reports not-applied when reload returns 200 but status never confirms the proxy running (bounded poll, then timeout)', async () => {
    const { deps } = fakeWorld({
      reload: 'ok',
      statusSequence: [
        [{ http: [{ name: 'bb-99-storybook', status: 'start error' }] }],
      ],
    });
    const result = await reconcileFrp(
      [record()],
      baseCfg({ pollTimeoutMs: 1000, pollIntervalMs: 500 }),
      deps,
      noopCheckpoint,
    );
    expect(result.ok).toBe(false);
    expect(result.records[0]?.applied).toBe('pending');
    expect(result.records[0]?.error).toMatch(/not confirmed running/);
  });

  it('refuses to overwrite a foreign routes.json (different identity/generation) and performs no write', async () => {
    const { deps, writes } = fakeWorld({
      initialFile: JSON.stringify({
        owner: 'something-else',
        identity: 'other',
        generation: 'x',
        proxies: [],
      }),
    });
    const result = await reconcileFrp(
      [record()],
      baseCfg(),
      deps,
      noopCheckpoint,
    );
    expect(result.ok).toBe(false);
    expect(result.records[0]?.applied).toBe('error');
    expect(result.records[0]?.error).toMatch(/refusing to overwrite/);
    expect(writes).toHaveLength(0);
  });

  it('takes over an empty route file left by another identity (e.g. after a zone change)', async () => {
    const { deps, writes } = fakeWorld({
      initialFile: JSON.stringify({ proxies: [] }),
      statusSequence: [
        [{ http: [{ name: 'bb-99-storybook', status: 'running' }] }],
      ],
    });
    const result = await reconcileFrp(
      [record()],
      baseCfg({ identity: 'a-new-zone-identity' }),
      deps,
      noopCheckpoint,
    );
    expect(result.records[0]?.applied).toBe('applied');
    expect(JSON.parse(writes[0]!.data).proxies).toHaveLength(1);
  });

  // BB-681 review N4: a `proxies`-less (or unparseable) file must never be
  // silently folded into "an empty proxies array", because that would hash
  // identically to a legitimately empty desired set and let a genuinely
  // foreign file get overwritten without ever being refused.
  it('refuses to overwrite a foreign routes.json with no proxies array, even though its content superficially resembles an empty desired set', async () => {
    const { deps, writes } = fakeWorld({
      initialFile: JSON.stringify({ someOtherTool: 'wrote this' }),
    });
    const result = await reconcileFrp(
      [record()],
      baseCfg(),
      deps,
      noopCheckpoint,
    );
    expect(result.ok).toBe(false);
    expect(result.records[0]?.applied).toBe('error');
    expect(result.records[0]?.error).toMatch(/refusing to overwrite/);
    expect(writes).toHaveLength(0);
  });

  // BB-681 review M5: a checkpoint failure must report a normal failed
  // record, never throw through `reconcileFrp` into an unhandled rejection
  // at the CLI/inbox entry point. The routes.json write already succeeded,
  // so only the durable ACKNOWLEDGEMENT of it failed here.
  it('reports a failed record, not a thrown exception, when the checkpoint call itself fails', async () => {
    const { deps, writes } = fakeWorld({});
    const failingCheckpoint = {
      checkpoint: async () => {
        throw new Error('disk full');
      },
    };
    const result = await reconcileFrp(
      [record()],
      baseCfg(),
      deps,
      failingCheckpoint,
    );
    expect(result.ok).toBe(false);
    expect(result.records[0]?.applied).toBe('error');
    expect(result.records[0]?.error).toMatch(/disk full/);
    expect(writes).toHaveLength(1); // the file write itself still happened
  });

  it('an interrupted write (crash mid-write) leaves old content intact and the record pending', async () => {
    const priorContent = JSON.stringify({
      owner: 'bakers-ports-frp',
      identity: IDENTITY,
      generation: 'deadbeefcafef00d',
      proxies: [
        {
          name: 'bb-99-storybook',
          type: 'http',
          customDomains: ['bb-99-storybook.preview.example'],
          localIP: '127.0.0.1',
          localPort: 6006,
        },
      ],
    });
    const { deps, files } = fakeWorld({
      initialFile: priorContent,
      failWrite: true,
    });
    const result = await reconcileFrp(
      [record({ data: { generation: 'deadbeefcafef00d' } })],
      baseCfg(),
      deps,
      noopCheckpoint,
    );
    expect(result.ok).toBe(false);
    expect(result.records[0]?.applied).toBe('pending');
    expect(files.get(ROUTES_PATH)).toBe(priorContent); // untouched
  });

  it('a validation-rejected candidate does not truncate the file — the record is excluded, siblings still written', async () => {
    const good = record({ key: 'storybook' });
    const bad = record({
      key: 'ddev',
      service: 'https://127.0.0.1:443',
      hostname: 'bb-99-ddev.preview.example',
    }); // insecureTls omitted -> rejected
    const { deps, writes } = fakeWorld({
      statusSequence: [
        [{ http: [{ name: 'bb-99-storybook', status: 'running' }] }],
      ],
    });
    const result = await reconcileFrp(
      [good, bad],
      baseCfg(),
      deps,
      noopCheckpoint,
    );
    const badResult = result.records.find((r) => r.key === 'ddev');
    const goodResult = result.records.find((r) => r.key === 'storybook');
    expect(badResult?.applied).toBe('error');
    expect(goodResult?.applied).toBe('applied');
    const written = JSON.parse(writes[0]!.data);
    expect(written.proxies).toHaveLength(1);
    expect(written.proxies[0].name).toBe('bb-99-storybook');
  });

  it('when the ONLY candidate is rejected, preserves the previously submitted file untouched', async () => {
    const priorContent = JSON.stringify({
      owner: 'bakers-ports-frp',
      identity: IDENTITY,
      generation: 'abc123',
      proxies: [],
    });
    const { deps, writes } = fakeWorld({ initialFile: priorContent });
    const bad = record({ service: 'https://127.0.0.1:443' });
    const result = await reconcileFrp([bad], baseCfg(), deps, noopCheckpoint);
    expect(result.ok).toBe(false);
    expect(writes).toHaveLength(0);
    expect(result.records[0]?.applied).toBe('error');
  });

  const directWeb = record({
    key: 'web',
    hostname: 'bb-99-web.preview.example',
    service: 'https://127.0.0.1:443',
    hostHeader: 'bb-99.ddev.site',
    insecureTls: true,
    direct: 'http://172.18.0.19:80',
  });
  const unreachable =
    'bb-99-web.preview.example: direct container routing needs a host that reaches Docker container IPs (172.18.0.19:80 is unreachable) — on macOS use OrbStack';

  it('an unreachable direct origin errors with the OrbStack hint and writes nothing', async () => {
    const { deps, writes, probes } = fakeWorld({ reachable: false });
    const result = await reconcileFrp(
      [directWeb],
      baseCfg(),
      deps,
      noopCheckpoint,
    );
    expect(probes).toEqual([['172.18.0.19', 80, 1500]]);
    expect(result.ok).toBe(false);
    expect(result.records[0]?.applied).toBe('error');
    expect(result.records[0]?.error).toBe(unreachable);
    expect(writes).toHaveLength(0);
  });

  it('an unreachable direct origin is left out while a sibling is still written', async () => {
    const { deps, writes } = fakeWorld({
      reachable: false,
      statusSequence: [
        [{ http: [{ name: 'bb-99-storybook', status: 'running' }] }],
      ],
    });
    const result = await reconcileFrp(
      [record(), directWeb],
      baseCfg(),
      deps,
      noopCheckpoint,
    );
    expect(result.records.find((r) => r.key === 'web')?.error).toBe(
      unreachable,
    );
    const written = JSON.parse(writes[0]!.data);
    expect(written.proxies.map((p: { name: string }) => p.name)).toEqual([
      'bb-99-storybook',
    ]);
  });

  it('a reachable direct origin is written as a plain proxy with the forwarded proto', async () => {
    const { deps, writes } = fakeWorld({
      statusSequence: [
        [{ http: [{ name: 'bb-99-web', status: 'running' }] }],
      ],
    });
    const result = await reconcileFrp(
      [directWeb],
      baseCfg(),
      deps,
      noopCheckpoint,
    );
    expect(result.records[0]?.applied).toBe('applied');
    const written = JSON.parse(writes[0]!.data);
    expect(written.proxies[0]).toMatchObject({
      localIP: '172.18.0.19',
      localPort: 80,
      requestHeaders: { set: { 'X-Forwarded-Proto': 'https' } },
    });
    expect(written.proxies[0]).not.toHaveProperty('plugin');
  });

  it('does not mark a route removed while /api/status still lists the proxy as present (bounded poll)', async () => {
    const existingGeneration = 'existing-gen';
    const priorContent = JSON.stringify({
      owner: 'bakers-ports-frp',
      identity: IDENTITY,
      generation: existingGeneration,
      proxies: [],
    });
    const { deps } = fakeWorld({
      initialFile: priorContent,
      statusSequence: [
        [{ http: [{ name: 'bb-99-storybook', status: 'running' }] }],
      ],
    });
    const absentRecord = record({
      desired: 'absent',
      applied: 'applied',
      data: { generation: existingGeneration },
    });
    const result = await reconcileFrp(
      [absentRecord],
      baseCfg({ pollTimeoutMs: 500, pollIntervalMs: 250 }),
      deps,
      noopCheckpoint,
    );
    expect(result.ok).toBe(false);
    const kept = result.records.find((r) => r.key === 'storybook');
    expect(kept).toBeDefined();
    expect(kept?.applied).toBe('pending');
  });

  it('confirms absence once /api/status no longer lists the proxy, clearing the tombstone', async () => {
    const existingGeneration = 'existing-gen';
    const priorContent = JSON.stringify({
      owner: 'bakers-ports-frp',
      identity: IDENTITY,
      generation: existingGeneration,
      proxies: [],
    });
    const { deps } = fakeWorld({
      initialFile: priorContent,
      statusSequence: [[{ http: [] }]],
    });
    const absentRecord = record({
      desired: 'absent',
      applied: 'applied',
      data: { generation: existingGeneration },
    });
    const result = await reconcileFrp(
      [absentRecord],
      baseCfg(),
      deps,
      noopCheckpoint,
    );
    expect(result.ok).toBe(true);
    expect(result.records.find((r) => r.key === 'storybook')).toBeUndefined();
  });

  it('a tombstone that never had a route written is dropped immediately, with no polling/foreign-file risk', async () => {
    const { deps, writes } = fakeWorld({});
    const absentRecord = record({ desired: 'absent', applied: 'pending' });
    const result = await reconcileFrp(
      [absentRecord],
      baseCfg(),
      deps,
      noopCheckpoint,
    );
    expect(result.ok).toBe(true);
    expect(result.records).toHaveLength(0);
    expect(writes).toHaveLength(0);
  });

  it('resumes safely when the on-disk generation matches the LAST acknowledged desired content, not just the current one', async () => {
    const onDiskProxies = [
      {
        name: 'bb-99-storybook',
        type: 'http',
        customDomains: ['bb-99-storybook.preview.example'],
        localIP: '127.0.0.1',
        localPort: 6006,
      },
    ];
    // The file carries no generation of its own (BB-681 review C3) — the
    // record's remembered fingerprint must equal this content's OWN hash to
    // count as "the last acknowledged generation", not an arbitrary label.
    const lastGeneration = computeGeneration(IDENTITY, onDiskProxies);
    const priorContent = JSON.stringify({ proxies: onDiskProxies });
    const { deps, writes } = fakeWorld({
      initialFile: priorContent,
      statusSequence: [
        [{ http: [{ name: 'bb-99-storybook', status: 'running' }] }],
      ],
    });
    // Desired content now differs slightly (new hostHeader) -> a DIFFERENT
    // desiredGeneration than what's on disk, but the record still carries
    // the last-acknowledged generation from before a crash — must be
    // accepted as a valid resume point, not rejected as foreign.
    const result = await reconcileFrp(
      [
        record({
          hostHeader: 'changed.example',
          data: { generation: lastGeneration },
        }),
      ],
      baseCfg(),
      deps,
      noopCheckpoint,
    );
    expect(result.ok).toBe(true);
    expect(writes).toHaveLength(1);
  });
});

describe('validateSettings', () => {
  it('names the ports addon entry, not the retired machine ports key', () => {
    expect(() => validateSettings({})).toThrow(
      "the @bakers-build/addon-ports entry's with.transport.with for 'frp' is missing: zone",
    );
  });
});
