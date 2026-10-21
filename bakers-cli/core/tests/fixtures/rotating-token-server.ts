import { createServer, type ServerResponse } from 'node:http';

/**
 * A local OAuth2 server that rotates refresh tokens the way simple_oauth does:
 * every refresh token is single-use, a successful refresh revokes both the
 * presented refresh token and the access token it was paired with, and a reused
 * refresh token is answered with `400 {"error":"invalid_grant"}`.
 *
 * The grant decision is made the moment a token request ARRIVES (that is when
 * the server commits the rotation); with `hold` on, only the response is queued
 * until the test releases it. That lets a test order "who got rotated" and "who
 * learns about it first" independently.
 *
 * Tokens are synthetic JWT-shaped strings so a client can report non-secret
 * claims (`sub`, `aud`, `exp`, `scope`, `jti`) without ever exposing a token.
 */
export interface PendingTokenResponse {
  /** Whether the server granted this refresh (decided on arrival). */
  granted: boolean;
  release(): void;
}

const b64 = (value: unknown) =>
  Buffer.from(JSON.stringify(value)).toString('base64url');

export async function rotatingTokenServer() {
  const validRefresh = new Map<string, string>(); // refresh -> paired access
  const validAccess = new Set<string>();
  const counters = {
    tokenRequests: 0,
    refreshGranted: 0,
    refreshRejected: 0,
    apiOk: 0,
    apiUnauthorized: 0,
  };
  const pending: PendingTokenResponse[] = [];
  const waiters: (() => void)[] = [];
  let hold = false;
  let generation = 0;

  function issue(expiresIn = 3600) {
    generation += 1;
    const exp = Math.floor(Date.now() / 1000) + expiresIn;
    const access = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: 'fixture-user', aud: 'fixture-client', scope: 'bb:session', exp, jti: `access-${generation}` })}.fixture`;
    const refresh = `refresh-${generation}-${Math.random().toString(36).slice(2)}`;
    validRefresh.set(refresh, access);
    validAccess.add(access);
    return { access, refresh, expiresIn };
  }

  function respond(res: ServerResponse, status: number, body: unknown) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  }

  const server = createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/oauth/token') {
      let raw = '';
      req.on('data', (chunk) => {
        raw += chunk;
      });
      req.on('end', () => {
        counters.tokenRequests++;
        const params = new URLSearchParams(raw);
        const presented = params.get('refresh_token') ?? '';
        const paired = validRefresh.get(presented);
        const granted =
          params.get('grant_type') === 'refresh_token' && paired !== undefined;
        let send: () => void;
        if (granted) {
          validRefresh.delete(presented);
          validAccess.delete(paired);
          counters.refreshGranted++;
          const next = issue();
          send = () =>
            respond(res, 200, {
              token_type: 'Bearer',
              access_token: next.access,
              refresh_token: next.refresh,
              expires_in: next.expiresIn,
            });
        } else {
          counters.refreshRejected++;
          send = () =>
            respond(res, 400, {
              error: 'invalid_grant',
              error_description: 'The refresh token is invalid.',
            });
        }
        if (!hold) return send();
        let released = false;
        pending.push({
          granted,
          release: () => {
            if (released) return;
            released = true;
            send();
          },
        });
        for (const wake of waiters.splice(0)) wake();
      });
      return;
    }
    if (req.url?.startsWith('/jsonapi')) {
      const auth = req.headers.authorization ?? '';
      if (!validAccess.has(auth.replace(/^Bearer /, ''))) {
        counters.apiUnauthorized++;
        return respond(res, 401, { errors: [{ status: '401' }] });
      }
      counters.apiOk++;
      res.writeHead(200, { 'Content-Type': 'application/vnd.api+json' });
      res.end(JSON.stringify({ data: [], links: {} }));
      return;
    }
    respond(res, 404, {});
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    counters,
    pending,
    /** Mint a valid access/refresh pair, e.g. to seed a stored session. */
    issue,
    /** Revoke every outstanding token (a session nobody can renew). */
    revokeAll() {
      validRefresh.clear();
      validAccess.clear();
    },
    /** Queue token responses until released (true) or answer immediately (false). */
    setHold(value: boolean) {
      hold = value;
    },
    /** Resolve once at least `count` token responses are queued. */
    async waitForPending(count: number, timeoutMs = 10_000) {
      const deadline = Date.now() + timeoutMs;
      while (pending.length < count) {
        if (Date.now() > deadline)
          throw new Error(
            `Timed out waiting for ${count} pending token requests (have ${pending.length}).`,
          );
        await new Promise<void>((r) => {
          waiters.push(r);
          setTimeout(r, 50);
        });
      }
    },
    async close() {
      for (const p of pending.splice(0)) p.release();
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}
