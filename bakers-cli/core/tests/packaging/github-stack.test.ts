import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';

const commit = 'a'.repeat(40);
const imageId = `sha256:${'b'.repeat(64)}`;
const script = new URL(
  '../../../../scripts/deploy/github-stack.mjs',
  import.meta.url,
).pathname;

it('syncs versioned configuration before pinning the tested commit, and fails closed on sync or runtime mismatch', async () => {
  const calls: string[] = [];
  const syncRequests: unknown[] = [];
  let failSync = false;
  let wrongRuntime = false;
  const server = createServer(async (req, res) => {
    let text = '';
    for await (const chunk of req) text += chunk;
    const { type, params } = JSON.parse(text);
    calls.push(type);
    expect(req.headers['x-api-key']).toBe('fixture-key');
    let result: unknown;
    if (type === 'GetResourceSync')
      result = {
        config: {
          git_provider: 'github.com',
          repo: 'bakers-build/bakers-build',
          branch: 'next',
        },
      };
    else if (type === 'RunSync') {
      syncRequests.push(params);
      result = { id: 'update1' };
    } else if (type === 'GetUpdate')
      result = { status: 'Complete', success: !failSync };
    else if (type === 'GetStack')
      result = {
        id: 'stack1',
        config: {
          git_provider: 'github.com',
          repo: 'bakers-build/bakers-build',
          branch: 'next',
          commit,
        },
        info: { deployed_hash: commit.slice(0, 8) },
      };
    else if (type === 'UpdateStack') {
      expect(params).toEqual({ id: 'stack1', config: { commit } });
      result = {};
    } else if (type === 'ListStackServices')
      result = ['php', 'nginx', 'docs'].map((service) => ({
        service,
        container: { image_id: wrongRuntime ? 'wrong' : imageId },
      }));
    else throw new Error(`Unexpected request ${type}`);
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(result));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('No server port');
  const dir = mkdtempSync(join(tmpdir(), 'github-stack-'));
  mkdirSync(join(dir, 'gate-reports'));
  writeFileSync(
    join(dir, 'gate-reports/registry.txt'),
    ['php', 'nginx', 'docs']
      .map(
        (image) =>
          `${image} ghcr.io/bakers-build/bakers-build/${image}@${imageId} ${imageId}\n`,
      )
      .join(''),
  );
  const run = (mode: string) =>
    new Promise<number | null>((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [script, mode, 'bakers-develop', commit],
        {
          cwd: dir,
          env: {
            ...process.env,
            KOMODO_URL: `http://127.0.0.1:${address.port}`,
            KOMODO_API_KEY: 'fixture-key',
            KOMODO_API_SECRET: 'fixture-secret',
          },
          stdio: 'ignore',
        },
      );
      child.on('error', reject);
      child.on('close', resolve);
    });
  try {
    expect(await run('prepare')).toBe(0);
    expect(syncRequests[0]).toEqual({
      sync: 'bakers',
      resource_type: 'Stack',
      resources: ['bakers-develop'],
    });
    expect(calls.indexOf('RunSync')).toBeLessThan(calls.indexOf('UpdateStack'));
    failSync = true;
    calls.length = 0;
    expect(await run('prepare')).not.toBe(0);
    expect(calls).not.toContain('UpdateStack');
    expect(await run('verify')).toBe(0);
    wrongRuntime = true;
    expect(await run('verify')).not.toBe(0);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    rmSync(dir, { recursive: true, force: true });
  }
});
