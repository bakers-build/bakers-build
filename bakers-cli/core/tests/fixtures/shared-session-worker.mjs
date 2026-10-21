/**
 * Shared-session worker: ONE long-lived bakers.build connection context in its own OS
 * process, driven over Node IPC. Start it with `child_process.fork()`; several
 * workers pointed at the same `stateDir` reproduce several bakers.build processes
 * (conductor, ui, agent CLI calls) sharing one stored OAuth2 session slot.
 *
 * The context is built by the BUILT core's `createBbConnectionContext`
 * (core/dist — run `pnpm -r run build` first) with the `@dropsh/plugin-oauth2`
 * copy core itself resolves, so it exercises the code a user runs.
 *
 * Protocol — parent → worker, one JSON message per command:
 *   { id, cmd: 'init', baseUrl, stateDir, oauth2, jsonapiPrefix?, omitLoad? }
 *       `oauth2` is the `with` block of `oauth2Plugin(...)` (id, type,
 *       client_id, token_url, scope, redirect_port, ...). The stored profile is
 *       `oauth2.id`. Builds the context from the stored session; replies
 *       ready:false (with the auth error) when nothing is stored yet.
 *       `omitLoad: true` is a test seam: the adapter is created directly from
 *       the provider with a runtime that lacks `load` (dropsh < 0.7.5 shape).
 *   { id, cmd: 'login' }   runs `dropsh auth login` for the profile, then
 *       (re)builds the context. Any URL the provider prints or would open is
 *       forwarded as an event; nothing else of the login output is.
 *   { id, cmd: 'renew' }   forces the adapter's reactive renewal (`auth.renew()`).
 *   { id, cmd: 'read', path }  GET a JSON:API path (relative to the prefix);
 *       the reply adds `ids`, the ids of the returned resources.
 *   { id, cmd: 'close' }   replies, then exits.
 *
 * Worker → parent:
 *   reply: { id, ok: true|false, ready, claims, error? }
 *     claims: non-secret JWT claims of the access token this process currently
 *       holds — { sub, aud, exp, scope, jti } — after a successful command
 *       (init: of the stored session it loaded); null after a failure or when
 *       the token is not JWT-shaped.
 *     error:  { code, reason, status, message } with token-like strings redacted.
 *   event: { event: 'verification_url', url }
 *
 * Raw access or refresh tokens never cross the IPC channel.
 */
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const require = createRequire(new URL('../../package.json', import.meta.url));
const dropshDir = dirname(require.resolve('dropsh'));
const fromDropsh = (rel) => import(pathToFileURL(join(dropshDir, rel)).href);

const [core, { oauth2Plugin }, { createHttpClient }, store, authCommands] =
  await Promise.all([
    import(new URL('../../dist/src/index.js', import.meta.url).href),
    import(pathToFileURL(require.resolve('@dropsh/plugin-oauth2')).href),
    import('dropsh/plugin'),
    fromDropsh('core/auth/session-store.js'),
    fromDropsh('commands/auth.js'),
  ]);

let settings;
let context;
let initClaims = null;

function claimsOf(token) {
  if (typeof token !== 'string') return null;
  const part = token.split('.')[1];
  if (!part) return null;
  try {
    const { sub, aud, exp, scope, scopes, jti } = JSON.parse(
      Buffer.from(part, 'base64url').toString('utf8'),
    );
    return { sub, aud, exp, scope: scope ?? scopes, jti };
  } catch {
    return null;
  }
}

// After a successful command the held token is valid, so `apply` only attaches
// it and sends nothing; init reports the stored session instead, because an
// expired one would make `apply` renew as a side effect.
async function currentClaims(cmd) {
  if (cmd === 'init' || !context) return initClaims;
  const req = await context.auth.apply({
    method: 'GET',
    url: settings.baseUrl,
  });
  return claimsOf(req.headers?.Authorization?.replace(/^Bearer /, ''));
}

const redact = (text) =>
  String(text).replace(/[A-Za-z0-9._~+/=-]{40,}/g, '[redacted]');

function describe(error) {
  return {
    code: error?.code ?? 'E_UNKNOWN',
    reason: error?.details?.reason ?? null,
    status: error?.status ?? error?.details?.status ?? null,
    message: redact(error?.message ?? error),
  };
}

function plugin() {
  return oauth2Plugin({ default: true, ...settings.oauth2 });
}

async function storedSession() {
  const name = settings.oauth2.id;
  return (await store.readProfiles(settings.baseUrl, settings.stateDir))
    ?.profiles[name]?.session;
}

async function build() {
  const connection = {
    site: {
      base_url: settings.baseUrl,
      jsonapi_prefix: settings.jsonapiPrefix ?? '/jsonapi',
    },
    plugins: [plugin()],
  };
  const http = createHttpClient();
  const session = await storedSession();
  initClaims = claimsOf(session?.access_token);
  let auth;
  if (settings.omitLoad) {
    if (!session) throw new Error('No stored session for the profile.');
    const provider = connection.plugins[0].authProvider;
    auth = provider.createAdapter(session, {
      http,
      now: Date.now,
      save: (next) =>
        store.writeProfile(
          settings.baseUrl,
          settings.oauth2.id,
          provider.id,
          next,
          settings.stateDir,
        ),
    });
  }
  context = await core.createBbConnectionContext(connection, {
    stateDir: settings.stateDir,
    profile: settings.oauth2.id,
    http,
    ...(auth ? { auth } : {}),
  });
}

const emitUrls = (text) => {
  for (const url of String(text).match(/https?:\/\/\S+/g) ?? [])
    process.send({ event: 'verification_url', url });
};

const commands = {
  async init(msg) {
    settings = msg;
    context = undefined;
    try {
      await build();
    } catch (error) {
      return { ok: false, error: describe(error) };
    }
  },
  async login() {
    await authCommands.runAuthLogin(
      { provider: settings.oauth2.id },
      {
        baseUrl: settings.baseUrl,
        providers: [plugin().authProvider],
        http: createHttpClient(),
        now: Date.now,
        stateDir: settings.stateDir,
        isTTY: false,
        stdout: emitUrls,
        stderr: () => {},
        prompt: async () => {
          throw new Error('The shared-session worker cannot prompt.');
        },
        openBrowser: async (url) => emitUrls(url),
      },
    );
    await build();
  },
  async renew() {
    const outcome = await context.auth.renew();
    if (!outcome.ok) return { ok: false, error: describe(outcome.cause) };
  },
  async read(msg) {
    const document = await context.client.get(msg.path);
    const data = document?.data;
    const resources = Array.isArray(data) ? data : data ? [data] : [];
    return { ok: true, ids: resources.map((resource) => resource.id) };
  },
  async close() {
    setImmediate(() => process.exit(0));
  },
};

process.on('message', async (msg) => {
  let reply;
  try {
    const run = commands[msg.cmd];
    if (!run) throw new Error(`Unknown command '${msg.cmd}'.`);
    reply = (await run(msg)) ?? { ok: true };
  } catch (error) {
    reply = { ok: false, error: describe(error) };
  }
  let claims = null;
  if (reply.ok) claims = await currentClaims(msg.cmd).catch(() => null);
  process.send({ id: msg.id, ...reply, ready: Boolean(context), claims });
});
process.on('disconnect', () => process.exit(0));
