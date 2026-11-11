import { createServer, type IncomingHttpHeaders } from 'node:http';
import { type AddressInfo, connect, createServer as tcp } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
// @ts-expect-error -- plain JS shipped in the image, no declarations
import { allowed, startProxy } from '../image/proxy.mjs';

type Proxy = { ports: Record<string, number>; close(): Promise<void> };
const closers: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const c of closers.splice(0)) await c();
});

describe('allowed', () => {
  it('matches exact hosts and *.suffix, ignoring case', () => {
    expect(allowed('api.github.com', ['*.github.com'])).toBe(true);
    expect(allowed('API.GitHub.com', ['*.github.com'])).toBe(true);
    expect(allowed('github.com', ['*.github.com'])).toBe(false);
    expect(allowed('registry.npmjs.org', ['registry.npmjs.org'])).toBe(true);
    expect(allowed('evil.com', [])).toBe(false);
  });
});

async function echoServer(): Promise<number> {
  const server = tcp((s) => s.pipe(s));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  closers.push(() => new Promise<void>((r) => server.close(() => r())));
  return (server.address() as AddressInfo).port;
}

async function proxy(opts: Record<string, unknown>): Promise<Proxy> {
  const p: Proxy = await startProxy({ host: '127.0.0.1', ...opts });
  closers.push(() => p.close());
  return p;
}

function connectVia(port: number, target: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const s = connect(port, '127.0.0.1', () =>
      s.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n`),
    );
    s.once('data', (d) => {
      resolve(d.toString().split('\r\n')[0] as string);
      s.destroy();
    });
    s.on('error', reject);
  });
}

describe('startProxy', () => {
  it('tunnels CONNECT to an allowed host and refuses any other', async () => {
    const echo = await echoServer();
    const p = await proxy({ allow: ['127.0.0.1'] });
    expect(await connectVia(p.ports.egress, `127.0.0.1:${echo}`)).toMatch(
      / 200 /,
    );
    expect(await connectVia(p.ports.egress, `localhost:${echo}`)).toMatch(
      / 403 /,
    );
  });

  async function apiUpstream(): Promise<{
    url: string;
    seen: IncomingHttpHeaders[];
  }> {
    const seen: IncomingHttpHeaders[] = [];
    const server = createServer((req, res) => {
      seen.push(req.headers);
      res.end('ok');
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    closers.push(() => new Promise<void>((r) => server.close(() => r())));
    return {
      url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
      seen,
    };
  }

  it('swaps the placeholder API key for the real one', async () => {
    const up = await apiUpstream();
    const p = await proxy({
      allow: [],
      apiTarget: up.url,
      credential: { name: 'ANTHROPIC_API_KEY', value: 'real-key' },
    });
    const res = await fetch(`http://127.0.0.1:${p.ports.api}/v1/messages`, {
      method: 'POST',
      headers: { 'x-api-key': 'bb-runtime-placeholder' },
      body: '{}',
    });
    expect(await res.text()).toBe('ok');
    expect(up.seen[0]?.['x-api-key']).toBe('real-key');
  });

  it('sends an OAuth token as a bearer with the OAuth beta', async () => {
    const up = await apiUpstream();
    const p = await proxy({
      allow: [],
      apiTarget: up.url,
      credential: { name: 'CLAUDE_CODE_OAUTH_TOKEN', value: 'tok' },
    });
    await fetch(`http://127.0.0.1:${p.ports.api}/v1/messages`, {
      method: 'POST',
      headers: {
        'x-api-key': 'bb-runtime-placeholder',
        'anthropic-beta': 'other-1',
      },
      body: '{}',
    });
    const h = up.seen[0] as IncomingHttpHeaders;
    expect(h.authorization).toBe('Bearer tok');
    expect(h['x-api-key']).toBeUndefined();
    expect(h['anthropic-beta']).toContain('oauth-2025-04-20');
    expect(h['anthropic-beta']).toContain('other-1');
  });

  it('relays the tool port in both directions', async () => {
    const echo = await echoServer();
    const p = await proxy({ allow: [], tools: `127.0.0.1:${echo}` });
    const reply = await new Promise<string>((resolve) => {
      const s = connect(p.ports.tools, '127.0.0.1', () => s.write('ping'));
      s.once('data', (d) => {
        resolve(d.toString());
        s.destroy();
      });
    });
    expect(reply).toBe('ping');
  });
});
