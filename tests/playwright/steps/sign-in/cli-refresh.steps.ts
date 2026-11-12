// CLI device sign-in and refresh-token rotation across two CLI processes.
//
// Each CLI client is bakers-cli's shared-session worker: a forked Node process
// holding one real bakers.build connection context (the built bakers-cli core and its
// @dropsh/plugin-oauth2), so the device login, the stored session file and the
// renewals are the code a user runs. Build bakers-cli first
// (`cd bakers-cli && pnpm install && pnpm -r run build`). Workers report only
// non-secret JWT claims; the one raw token this module holds is the original
// refresh token, read from the disposable state directory for the replay check
// and never printed.
import { type ChildProcess, fork } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createBdd } from 'playwright-bdd';
import { expect, test } from '../../bdd.fixtures';
import { uidOf } from '../../support/shell';

const { Given, When, Then, After } = createBdd(test);

/** The public device client the e2e recipe seeds. */
const DEVICE_CLIENT = 'bakers-cli-device-e2e';
const PROFILE = 'bakers';
const WORKER = resolve(__dirname, '../../../../bakers-cli/core/tests/fixtures/shared-session-worker.mjs');
const REPLY_TIMEOUT_MS = 30_000;
const WORKSPACES = '/bb_workspace/bb_workspace';

type Claims = { sub?: string; aud?: string | string[]; scope?: string | string[]; jti?: string };
type Reply = { id: number; ok: boolean; ready: boolean; claims: Claims | null; ids?: string[]; error?: { code: string; reason: string | null; message: string } };

/** One CLI process: a forked worker answering one IPC reply per command. */
class CliClient {
  private readonly child: ChildProcess;
  private readonly waiting = new Map<number, {
    resolve: (reply: Reply) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();
  private readonly closed: Promise<void>;
  private closing = false;
  private nextId = 0;
  readonly urls: string[] = [];

  constructor() {
    // DDEV's certificate comes from its own CA, which the system store trusts
    // and Node's bundled store does not.
    this.child = fork(WORKER, [], {
      env: { ...process.env, NODE_OPTIONS: '--use-system-ca' },
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    });
    this.child.on('message', (message: Reply & { event?: string; url?: string }) => {
      if (message.event === 'verification_url' && message.url) {
        this.urls.push(message.url);
        return;
      }
      const pending = this.waiting.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.waiting.delete(message.id);
      pending.resolve(message);
    });
    this.child.on('error', (error) => this.rejectPending(error));
    this.closed = new Promise((done) => this.child.once('close', () => {
      this.closing = true;
      this.rejectPending(new Error('CLI client closed'));
      done();
    }));
  }

  private rejectPending(error: Error): void {
    for (const pending of this.waiting.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.waiting.clear();
  }

  send(cmd: string, args: object = {}, timeout = REPLY_TIMEOUT_MS): Promise<Reply> {
    if (this.closing || !this.child.connected) return Promise.reject(new Error('CLI client is closed'));
    const id = ++this.nextId;
    return new Promise((done, fail) => {
      const timer = setTimeout(() => {
        this.waiting.delete(id);
        fail(new Error(`CLI client '${cmd}' timed out after ${timeout}ms`));
      }, timeout);
      this.waiting.set(id, { resolve: done, reject: fail, timer });
      this.child.send({ id, cmd, ...args }, (error) => {
        if (!error) return;
        clearTimeout(timer);
        this.waiting.delete(id);
        fail(error);
      });
    });
  }

  async close(): Promise<void> {
    if (this.closing) return this.closed;
    this.closing = true;
    this.rejectPending(new Error('CLI client closing'));
    if (this.child.exitCode !== null || this.child.signalCode !== null) return this.closed;
    const escalation = setTimeout(() => this.child.kill('SIGKILL'), 5_000);
    let deadline: ReturnType<typeof setTimeout> | undefined;
    try {
      this.child.kill('SIGTERM');
      await Promise.race([
        this.closed,
        new Promise<never>((_, reject) => {
          deadline = setTimeout(() => reject(new Error('CLI client did not close after SIGKILL')), 10_000);
        }),
      ]);
    } finally {
      clearTimeout(escalation);
      clearTimeout(deadline);
    }
  }
}

let stateDir = '';
let settings: object = {};
let clients: CliClient[] = [];
let login: Promise<Reply> | undefined;
let verificationUrl = '';
let original: { access: string; refresh: string; claims: Claims | null } | undefined;
let renewed: Claims[] = [];

/** The stored session of the profile, read from the disposable state directory. */
function storedSession(): { access_token: string; refresh_token?: string } {
  const files = readdirSync(stateDir).filter((file) => file.endsWith('.json'));
  expect(files, 'one stored session file').toHaveLength(1);
  return JSON.parse(readFileSync(join(stateDir, files[0]), 'utf8')).profiles[PROFILE].session;
}

function expectOk(reply: Reply, what: string): void {
  expect(reply.ok, `${what}: ${reply.error?.code} ${reply.error?.reason ?? ''} ${reply.error?.message ?? ''}`).toBe(true);
}

async function startClient(): Promise<{ client: CliClient; reply: Reply }> {
  const client = new CliClient();
  clients.push(client);
  return { client, reply: await client.send('init', settings) };
}

Given('a CLI device sign-in is waiting for this test site', async ({ baseURL }) => {
  const base = String(baseURL).replace(/\/$/, '');
  stateDir = mkdtempSync(join(tmpdir(), 'bakers-cli-refresh-'));
  settings = {
    baseUrl: base,
    stateDir,
    oauth2: {
      id: PROFILE,
      type: 'oauth2_device_code',
      client_id: DEVICE_CLIENT,
      device_authorization_url: `${base}/oauth/device_authorization`,
      token_url: `${base}/oauth/token`,
      scope: 'bb:session',
    },
  };
  const { client, reply } = await startClient();
  expect(reply.ready, 'no session is stored before the sign-in').toBe(false);
  // The login polls until the code is decided, so it is awaited after approval.
  login = client.send('login', {}, 120_000);
  // Keep the original rejection for the approval step, but handle early teardown.
  void login.catch(() => {});
  await expect.poll(() => client.urls.find((url) => url.includes('user_code=')) ?? '', { timeout: REPLY_TIMEOUT_MS }).not.toBe('');
  verificationUrl = client.urls.find((url) => url.includes('user_code=')) ?? '';
});

When('I approve that CLI device sign-in', async ({ page }) => {
  await page.goto(verificationUrl);
  await page.getByLabel('Device code').fill(new URL(verificationUrl).searchParams.get('user_code') ?? '');
  await page.getByRole('button', { name: 'Confirm sign-in' }).click();
  await page.waitForURL('**/oauth/device?done=confirmed');
  expectOk(await login!, 'device login');
});

When('two persistent CLI clients load its saved session', async () => {
  const session = storedSession();
  expect(session.refresh_token, 'the device sign-in issued a refresh token').toBeTruthy();
  const second = await startClient();
  expectOk(second.reply, 'second client init');
  expect(second.reply.ready).toBe(true);
  // Both processes must hold the same session before the first rotation, or
  // the second one never holds a stale token.
  const first = await clients[0].send('init', settings);
  expectOk(first, 'first client init');
  expect(first.claims?.jti).toBeTruthy();
  expect(second.reply.claims?.jti).toBe(first.claims?.jti);
  original = { access: session.access_token, refresh: session.refresh_token!, claims: first.claims };
});

When('the first client renews the session', async () => {
  const reply = await clients[0].send('renew');
  expectOk(reply, 'first client renew');
  const session = storedSession();
  expect(session.access_token !== original!.access, 'the stored access token changed').toBe(true);
  expect(session.refresh_token !== original!.refresh, 'the stored refresh token rotated').toBe(true);
  renewed = [reply.claims!];
});

When('the second client renews its original in-memory session', async () => {
  const reply = await clients[1].send('renew');
  expectOk(reply, 'second client renew');
  renewed.push(reply.claims!);
});

Then('both clients can read the same permitted workspaces', async () => {
  const [first, second] = [await clients[0].send('read', { path: WORKSPACES }), await clients[1].send('read', { path: WORKSPACES })];
  expectOk(first, 'first client read');
  expectOk(second, 'second client read');
  expect(first.ids?.length, 'the account sees at least one workspace').toBeGreaterThan(0);
  expect(second.ids).toEqual(first.ids);
});

Then('the refreshed access token keeps the user {string} and the bb:session scope', async ({}, account: string) => {
  const uid = uidOf(account);
  expect(original!.claims?.sub).toBe(uid);
  for (const claims of renewed) {
    expect(claims.jti).not.toBe(original!.claims?.jti);
    expect(claims.sub).toBe(uid);
    expect([claims.aud].flat()).toContain(DEVICE_CLIENT);
    expect([claims.scope].flat()).toContain('bb:session');
  }
});

Then('the original refresh token is rejected when replayed', async ({ playwright, baseURL }) => {
  // A fresh request context: no browser cookies, like the CLI itself.
  const request = await playwright.request.newContext({ baseURL, ignoreHTTPSErrors: true });
  try {
    const response = await request.post('/oauth/token', {
      form: { grant_type: 'refresh_token', client_id: DEVICE_CLIENT, refresh_token: original!.refresh },
    });
    expect(response.status()).toBe(400);
    expect((await response.json()).error).toBe('invalid_grant');
  } finally {
    await request.dispose();
  }
});

After({ tags: '@feature:cli-refresh' }, async () => {
  const results = await Promise.allSettled(clients.map((client) => client.close()));
  const errors = results.filter((result) => result.status === 'rejected').map((result) => result.reason);
  clients = [];
  login = undefined;
  original = undefined;
  renewed = [];
  settings = {};
  verificationUrl = '';
  if (errors.length) throw new AggregateError(errors, 'CLI client cleanup failed; state retained');
  if (stateDir) rmSync(stateDir, { recursive: true, force: true });
  stateDir = '';
});
