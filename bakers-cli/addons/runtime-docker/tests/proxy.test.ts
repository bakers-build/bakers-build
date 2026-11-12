import { execFile } from 'node:child_process';
import { createServer, type IncomingHttpHeaders } from 'node:http';
import { type AddressInfo, connect, createServer as tcp } from 'node:net';
import { promisify } from 'node:util';
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

  it('refuses invalid CONNECT ports and still accepts a valid tunnel', async () => {
    // A crash must fail this check without killing the test runner.
    const { stdout } = await promisify(execFile)(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `
        import assert from 'node:assert/strict';
        import { connect, createServer } from 'node:net';
        import { startProxy } from ${JSON.stringify(new URL('../image/proxy.mjs', import.meta.url).href)};
        const server = createServer(s => s.pipe(s));
        await new Promise(r => server.listen(0, '127.0.0.1', r));
        const p = await startProxy({ host: '127.0.0.1', allow: ['127.0.0.1'] });
        const request = port => new Promise((resolve, reject) => {
          const s = connect(p.ports.egress, '127.0.0.1', () =>
            s.write('CONNECT 127.0.0.1:' + port + ' HTTP/1.1\\r\\n\\r\\n'));
          s.on('error', reject);
          s.once('data', data => { resolve(String(data)); s.destroy(); });
        });
        for (const port of [65536, -1, 0, 1.5, 'NaN'])
          assert.match(await request(port), / 403 /);
        assert.match(await request(server.address().port), / 200 /);
        await p.close();
        await new Promise(r => server.close(r));
        console.log('survived');
      `,
      ],
      { timeout: 5000 },
    );
    expect(stdout.trim()).toBe('survived');
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

  const auth = {
    TOK: {
      set: { authorization: 'Bearer {value}' },
      append: { 'x-beta': 'b2' },
    },
    KEY: { set: { 'x-key': '{value}' } },
  };

  it('swaps the placeholder for the credential that is set', async () => {
    const up = await apiUpstream();
    const p = await proxy({
      allow: [],
      apiTarget: up.url,
      auth,
      secrets: { KEY: 'real-key' },
    });
    const res = await fetch(`http://127.0.0.1:${p.ports.api}/v1/messages`, {
      method: 'POST',
      headers: { 'x-key': 'placeholder', authorization: 'Bearer placeholder' },
      body: '{}',
    });
    expect(await res.text()).toBe('ok');
    expect(up.seen[0]?.['x-key']).toBe('real-key');
    expect(up.seen[0]?.authorization).toBeUndefined();
  });

  it('prefers the first credential and appends to its headers', async () => {
    const up = await apiUpstream();
    const p = await proxy({
      allow: [],
      apiTarget: up.url,
      auth,
      secrets: { KEY: 'k', TOK: 'tok' },
    });
    await fetch(`http://127.0.0.1:${p.ports.api}/v1/messages`, {
      method: 'POST',
      headers: { 'x-key': 'placeholder', 'x-beta': 'b1' },
      body: '{}',
    });
    const h = up.seen[0] as IncomingHttpHeaders;
    expect(h.authorization).toBe('Bearer tok');
    expect(h['x-key']).toBeUndefined();
    expect(h['x-beta']).toBe('b1,b2');
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

describe('startProxy after a refused CONNECT', () => {
  it('survives a client that resets the connection after the 403', async () => {
    const p = await proxy({ allow: [] });
    const errors: unknown[] = [];
    const onError = (e: unknown) => errors.push(e);
    process.prependListener('uncaughtException', onError);
    try {
      await new Promise<void>((resolve) => {
        const s = connect(p.ports.egress, '127.0.0.1', () =>
          s.write(
            'CONNECT evil.invalid:443 HTTP/1.1\r\nHost: evil.invalid\r\n\r\n',
          ),
        );
        s.once('data', () => {
          s.resetAndDestroy();
          resolve();
        });
      });
      await new Promise((r) => setTimeout(r, 100));
      expect(await connectVia(p.ports.egress, 'evil.invalid:443')).toMatch(
        / 403 /,
      );
    } finally {
      process.off('uncaughtException', onError);
    }
    expect(errors).toEqual([]);
  });
});
