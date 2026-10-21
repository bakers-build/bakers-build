import { type ChildProcess, fork } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { rotatingTokenServer } from '../fixtures/rotating-token-server.js';

// Several bakers.build processes share one stored OAuth2 session slot while the server
// rotates the refresh token on every use. Each process here is a real OS process
// (core/tests/fixtures/shared-session-worker.mjs) holding one connection context
// built by the built core, so the installed dropsh + @dropsh/plugin-oauth2 decide.

const workerPath = new URL(
  '../fixtures/shared-session-worker.mjs',
  import.meta.url,
);
const IPC_TIMEOUT_MS = 10_000;

interface Reply {
  id: number;
  ok: boolean;
  ready: boolean;
  claims: { jti?: string } | null;
  error?: { code: string; reason: string | null; message: string };
}

function spawnWorker() {
  const child: ChildProcess = fork(workerPath, [], {
    stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
  });
  const waiting = new Map<number, (reply: Reply) => void>();
  let next = 0;
  child.on('message', (msg: Reply) => waiting.get(msg.id)?.(msg));
  return {
    child,
    send(cmd: string, args: Record<string, unknown> = {}) {
      const id = ++next;
      return new Promise<Reply>((resolve, reject) => {
        const timer = setTimeout(() => {
          waiting.delete(id);
          reject(
            new Error(`Worker '${cmd}' timed out after ${IPC_TIMEOUT_MS}ms`),
          );
        }, IPC_TIMEOUT_MS);
        waiting.set(id, (reply) => {
          clearTimeout(timer);
          waiting.delete(id);
          resolve(reply);
        });
        child.send({ id, cmd, ...args });
      });
    },
  };
}

type Server = Awaited<ReturnType<typeof rotatingTokenServer>>;
type Worker = ReturnType<typeof spawnWorker>;

let server: Server;
let stateDir: string;
let workers: Worker[];
let profileFile: string;
let siblingFile: string;
const siblingSlot = {
  provider: 'pm',
  session: { access_token: 'unrelated', expires_at: 1 },
};
const siblingFileContent = '{"version":2,"profiles":{}}';

function storedFile() {
  return JSON.parse(readFileSync(profileFile, 'utf8'));
}

async function start(options: { omitLoad?: boolean } = {}) {
  const worker = spawnWorker();
  workers.push(worker);
  const reply = await worker.send('init', {
    baseUrl: server.baseUrl,
    stateDir,
    oauth2: {
      id: 'bakers',
      type: 'oauth2_authcode',
      client_id: 'fixture-client',
      scope: 'bb:session',
      token_url: `${server.baseUrl}/oauth/token`,
    },
    ...options,
  });
  expect(reply).toMatchObject({ ok: true, ready: true });
  return { worker, reply };
}

beforeEach(async () => {
  server = await rotatingTokenServer();
  stateDir = mkdtempSync(join(tmpdir(), 'bakers-shared-session-'));
  workers = [];
  profileFile = join(stateDir, '127.0.0.1.json');
  siblingFile = join(stateDir, 'other.example.json');
  const seed = server.issue();
  writeFileSync(
    profileFile,
    JSON.stringify({
      version: 2,
      active: 'bakers',
      profiles: {
        bakers: {
          provider: 'bakers',
          session: {
            access_token: seed.access,
            refresh_token: seed.refresh,
            expires_at: Date.now() + 3_595_000,
          },
        },
        pm: siblingSlot,
      },
    }),
  );
  writeFileSync(siblingFile, siblingFileContent);
});

afterEach(async () => {
  try {
    for (const { child } of workers) child.kill();
  } finally {
    await server.close();
    rmSync(stateDir, { recursive: true, force: true });
  }
});

describe('a session shared by several processes under refresh-token rotation', () => {
  it('lets a stale process adopt the session another process already renewed', async () => {
    const original = storedFile().profiles.bakers.session;
    const a = await start();
    const b = await start();
    expect(a.reply.claims?.jti).toBe('access-1');
    expect(b.reply.claims?.jti).toBe('access-1');

    const renewedA = await a.worker.send('renew');
    expect(renewedA).toMatchObject({ ok: true });
    const saved = storedFile().profiles.bakers.session;
    expect(saved.access_token).not.toBe(original.access_token);
    expect(saved.refresh_token).not.toBe(original.refresh_token);

    const renewedB = await b.worker.send('renew');
    expect(renewedB).toMatchObject({ ok: true });
    expect(renewedB.claims?.jti).toBe(renewedA.claims?.jti);

    expect(
      await a.worker.send('read', { path: '/bb_workspace/bb_workspace' }),
    ).toMatchObject({ ok: true });
    expect(
      await b.worker.send('read', { path: '/bb_workspace/bb_workspace' }),
    ).toMatchObject({ ok: true });
    expect(server.counters).toMatchObject({
      tokenRequests: 1,
      refreshGranted: 1,
      refreshRejected: 0,
      apiOk: 2,
      apiUnauthorized: 0,
    });
    expect(storedFile().profiles.pm).toEqual(siblingSlot);
    expect(readFileSync(siblingFile, 'utf8')).toBe(siblingFileContent);
  });

  it('recovers the process that lost an overlapping refresh once the winner has persisted', async () => {
    const a = await start();
    const b = await start();
    server.setHold(true);
    const renewA = a.worker.send('renew');
    await server.waitForPending(1);
    const renewB = b.worker.send('renew');
    await server.waitForPending(2);
    const [winner, loser] = server.pending;
    expect([winner.granted, loser.granted]).toEqual([true, false]);

    winner.release();
    const renewedA = await renewA;
    expect(renewedA).toMatchObject({ ok: true });
    loser.release();
    const renewedB = await renewB;
    expect(renewedB).toMatchObject({ ok: true });
    expect(renewedB.claims?.jti).toBe(renewedA.claims?.jti);

    server.setHold(false);
    expect(
      await a.worker.send('read', { path: '/bb_workspace/bb_workspace' }),
    ).toMatchObject({ ok: true });
    expect(
      await b.worker.send('read', { path: '/bb_workspace/bb_workspace' }),
    ).toMatchObject({ ok: true });
    expect(server.counters).toMatchObject({
      refreshGranted: 1,
      refreshRejected: 1,
      apiOk: 2,
      apiUnauthorized: 0,
    });
  });

  it('still fails when the refresh is rejected and no newer session was persisted', async () => {
    const before = readFileSync(profileFile, 'utf8');
    const a = await start();
    server.revokeAll();

    const renewed = await a.worker.send('renew');
    expect(renewed).toMatchObject({
      ok: false,
      error: { code: 'E_AUTH', reason: 'credentials_rejected' },
    });
    expect(
      await a.worker.send('read', { path: '/bb_workspace/bb_workspace' }),
    ).toMatchObject({
      ok: false,
      error: { reason: 'credentials_rejected' },
    });
    expect(readFileSync(profileFile, 'utf8')).toBe(before);
  });

  // Characterization, not a requirement: the plugin re-reads the stored slot once,
  // right after its refresh is rejected, and takes no lock. When the rejection
  // reaches the loser BEFORE the winner has persisted the rotated session, that
  // single reload finds nothing newer and the renewal fails. The adapter keeps
  // its old session, so the loser's NEXT 401 renews again and adopts the session
  // the winner persisted meanwhile — the failure costs one call, not the process.
  it('characterizes a loser rejected before the winner persisted', async () => {
    const a = await start();
    const b = await start();
    server.setHold(true);
    const renewA = a.worker.send('renew');
    await server.waitForPending(1);
    const renewB = b.worker.send('renew');
    await server.waitForPending(2);
    const [winner, loser] = server.pending;

    loser.release();
    expect(await renewB).toMatchObject({
      ok: false,
      error: { code: 'E_AUTH', reason: 'credentials_rejected' },
    });
    winner.release();
    const renewedA = await renewA;
    expect(renewedA).toMatchObject({ ok: true });

    server.setHold(false);
    const readB = await b.worker.send('read', {
      path: '/bb_workspace/bb_workspace',
    });
    expect(readB).toMatchObject({ ok: true });
    expect(readB.claims?.jti).toBe(renewedA.claims?.jti);
    expect(server.counters).toMatchObject({
      refreshGranted: 1,
      refreshRejected: 1,
      apiOk: 1,
      apiUnauthorized: 1,
    });
  });

  it('fails the stale process when the adapter runtime cannot reload the stored session', async () => {
    const a = await start();
    const b = await start({ omitLoad: true });

    expect(await a.worker.send('renew')).toMatchObject({ ok: true });
    expect(await b.worker.send('renew')).toMatchObject({
      ok: false,
      error: { code: 'E_AUTH', reason: 'credentials_rejected' },
    });
    expect(
      await b.worker.send('read', { path: '/bb_workspace/bb_workspace' }),
    ).toMatchObject({
      ok: false,
      error: { reason: 'credentials_rejected' },
    });
    expect(server.counters).toMatchObject({
      refreshGranted: 1,
      refreshRejected: 2,
    });
  });
});
