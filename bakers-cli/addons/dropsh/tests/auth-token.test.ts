import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { rotatingTokenServer } from '../../../core/tests/fixtures/rotating-token-server.js';
import { workspaceFixture } from '../../../core/tests/fixtures/workspace-server.js';
import { authCommandPlugin, dispatchBbDropsh } from '../src/index.js';

const oauth = createRequire(import.meta.url).resolve('@dropsh/plugin-oauth2');

type Server = Awaited<ReturnType<typeof rotatingTokenServer>>;
let server: Server;
let root: string;
let config: string;
let previousExitCode: typeof process.exitCode;
const leaked: string[] = [];

function profile(id: string, isDefault: boolean) {
  return `{plugin:${JSON.stringify(oauth)},export:'oauth2Plugin',with:{id:'${id}',default:${isDefault},type:'oauth2_authcode',scope:'bb:session',client_id:'fixture-client',token_url:'${server.baseUrl}/oauth/token'}}`;
}

function writeConfig(path: string, profiles = [profile('bakers', true)]) {
  writeFileSync(
    path,
    `export default {site:{base_url:'${server.baseUrl}'},plugins:[${profiles.join(',')}]};`,
  );
}

/** Store a session per profile; returns the seeded access tokens. */
function seed(sessions: Record<string, { expires_at: number }>) {
  const access: Record<string, string> = {};
  const profiles: Record<string, unknown> = {};
  for (const [id, { expires_at }] of Object.entries(sessions)) {
    const pair = server.issue();
    access[id] = pair.access;
    leaked.push(pair.refresh);
    profiles[id] = {
      provider: id,
      session: {
        access_token: pair.access,
        refresh_token: pair.refresh,
        expires_at,
      },
    };
  }
  mkdirSync(join(root, 'xdg/dropsh'), { recursive: true });
  writeFileSync(
    join(root, 'xdg/dropsh/127.0.0.1.json'),
    JSON.stringify({ version: 2, active: 'bakers', profiles }),
  );
  return access;
}

async function token(argv: string[]) {
  let stdout = '';
  let stderr = '';
  process.exitCode = undefined;
  await dispatchBbDropsh({ resolveBases: [] }, ['auth', 'token', ...argv], {
    stdout: (s) => {
      stdout += s;
    },
    stderr: (s) => {
      stderr += s;
    },
  });
  const exitCode = process.exitCode;
  process.exitCode = undefined;
  // No refresh token, seeded or rotated, may reach either stream.
  for (const secret of leaked) expect(stdout + stderr).not.toContain(secret);
  return { stdout, stderr, exitCode };
}

function expectAuthError(result: Awaited<ReturnType<typeof token>>) {
  expect(result.stdout).toBe('');
  const { error } = JSON.parse(result.stderr);
  expect(Object.keys(error)).toEqual(['code', 'message']);
  expect(error.code).toBe('E_AUTH');
  expect(error.message).toContain('bakers auth login');
  expect(result.stderr).not.toMatch(/\beyJ/);
  expect(result.exitCode).toBe(3);
}

const expOf = (jwt: string) =>
  JSON.parse(Buffer.from(jwt.split('.')[1] as string, 'base64url').toString())
    .exp as number;

beforeEach(async () => {
  previousExitCode = process.exitCode;
  server = await rotatingTokenServer();
  root = mkdtempSync(join(tmpdir(), 'bakers-auth-token-'));
  config = join(root, 'connection.config.js');
  writeConfig(config);
  leaked.length = 0;
  vi.stubEnv('XDG_CONFIG_HOME', join(root, 'xdg'));
  vi.stubEnv('BAKERS_CONNECTION', '');
  // A conductor run would route `tool` to its own server instead of the fixture.
  vi.stubEnv('BAKERS_CONDUCTOR_URL', '');
  vi.stubEnv('BAKERS_CONDUCTOR_TOKEN', '');
});

afterEach(async () => {
  vi.unstubAllEnvs();
  process.exitCode = previousExitCode;
  await server.close();
  rmSync(root, { recursive: true, force: true });
});

describe('bakers auth token', () => {
  it('prints the contract object for a valid session', async () => {
    const { bakers } = seed({ bakers: { expires_at: Date.now() + 3_500_000 } });
    const result = await token(['--config', config]);
    expect(result.stderr).toBe('');
    expect(result.stdout.endsWith('}\n')).toBe(true);
    const out = JSON.parse(result.stdout);
    expect(Object.keys(out)).toEqual([
      'base_url',
      'token',
      'token_type',
      'expires_at',
    ]);
    expect(out).toEqual({
      base_url: server.baseUrl,
      token: bakers,
      token_type: 'Bearer',
      expires_at: new Date(expOf(bakers as string) * 1000).toISOString(),
    });
    expect(server.counters.tokenRequests).toBe(0);
  });

  for (const [name, offset] of [
    ['an expired session', -1],
    ['a session inside the refresh margin', 10_000],
  ] as const) {
    it(`refreshes ${name} before printing`, async () => {
      const { bakers } = seed({ bakers: { expires_at: Date.now() + offset } });
      const result = await token(['--config', config]);
      expect(result.stderr).toBe('');
      const out = JSON.parse(result.stdout);
      expect(out.token).not.toBe(bakers);
      expect(server.counters.refreshGranted).toBe(1);
      expect(Date.parse(out.expires_at)).toBeGreaterThan(Date.now());
    });
  }

  it('fails with E_AUTH when nobody is signed in', async () => {
    expectAuthError(await token(['--config', config]));
  });

  it('fails with E_AUTH when the refresh is rejected', async () => {
    const { bakers } = seed({ bakers: { expires_at: Date.now() - 1 } });
    server.revokeAll();
    const result = await token(['--config', config]);
    expectAuthError(result);
    expect(result.stderr).not.toContain(bakers);
  });

  it('never prints a client secret', async () => {
    const f = await workspaceFixture();
    try {
      vi.stubEnv('XDG_CONFIG_HOME', join(f.root, 'config'));
      await dispatchBbDropsh(
        { resolveBases: [] },
        ['auth', 'login', '--provider', 'bakers', '--config', f.config],
        { stdout: () => {}, stderr: () => {} },
      );
      // The fixture's token is opaque (no JWT `exp`), so this run fails; it must still not leak.
      const opaque = await token(['--config', f.config]);
      expect(opaque.stdout).toBe('');
      expect(JSON.parse(opaque.stderr).error.message).toContain(
        'access token carries no expiry',
      );
      expect(opaque.stderr).not.toContain('fixture-secret');
      expect(opaque.stderr).not.toContain('fixture-token');
      // An expired session re-mints with the configured secret; a rejection must not echo it.
      const sessions = join(f.root, 'config/dropsh/127.0.0.1.json');
      const stored = JSON.parse(readFileSync(sessions, 'utf8'));
      stored.profiles.bakers.session.expires_at = 0;
      writeFileSync(sessions, JSON.stringify(stored));
      writeFileSync(
        f.config,
        f.source().replace('fixture-secret', 'wrong-secret'),
      );
      const rejected = await token(['--config', f.config]);
      expect(rejected.stdout).toBe('');
      expect(JSON.parse(rejected.stderr).error.code).toBe('E_AUTH');
      expect(rejected.stderr).not.toContain('wrong-secret');
      expect(rejected.stderr).not.toContain('fixture-token');
    } finally {
      await f.close();
    }
  });

  it('honours --auth-profile', async () => {
    writeConfig(config, [profile('bakers', true), profile('machine', false)]);
    const { machine } = seed({
      bakers: { expires_at: Date.now() + 3_500_000 },
      machine: { expires_at: Date.now() + 3_500_000 },
    });
    const result = await token([
      '--config',
      config,
      '--auth-profile',
      'machine',
    ]);
    expect(JSON.parse(result.stdout).token).toBe(machine);
  });

  it('reports an unknown --auth-profile the way bakers tools does', async () => {
    seed({ bakers: { expires_at: Date.now() + 3_500_000 } });
    const result = await token(['--config', config, '--auth-profile', 'nope']);
    expect(result.stdout).toBe('');
    const { error } = JSON.parse(result.stderr);
    expect(error.code).toBe('E_CONFIG');
    expect(result.exitCode).toBe(2);
    let tools = '';
    process.exitCode = undefined;
    await dispatchBbDropsh(
      { resolveBases: [] },
      ['tool', '--config', config, '--auth-profile', 'nope'],
      {
        stdout: () => {},
        stderr: (s) => {
          tools += s;
        },
      },
    );
    process.exitCode = undefined;
    expect(tools).toContain(error.message);
  });

  it('honours --connection', async () => {
    const home = join(root, 'bakers-home');
    mkdirSync(join(home, 'connections'), { recursive: true });
    writeConfig(join(home, 'connections', 'fixture.js'));
    vi.stubEnv('BAKERS_HOME', home);
    const { bakers } = seed({ bakers: { expires_at: Date.now() + 3_500_000 } });
    const out = JSON.parse((await token(['--connection', 'fixture'])).stdout);
    expect(out).toMatchObject({ base_url: server.baseUrl, token: bakers });
  });

  it('lists token with its flags in the help', async () => {
    vi.stubEnv('BAKERS_HOME', join(root, 'empty-home'));
    const program = new Command().name('bakers');
    authCommandPlugin.register(program, { resolveBases: [] });
    let help = '';
    const write = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation((s: string | Uint8Array) => {
        help += String(s);
        return true;
      });
    try {
      await program.parseAsync(['auth', 'token', '--help'], { from: 'user' });
    } finally {
      write.mockRestore();
    }
    expect(help).toContain('bakers auth token');
    expect(help).toContain('--auth-profile');
    expect(help).toContain('--connection');
  });
});
