// The PM bot's one way into bakers.build, shared by the relay and the poller.
// It signs in with an API key (a service account's key: client credentials,
// scope bb:session), keeps the token until 30 seconds before it expires, and
// fetches a new one after a 401 or a failed connection, so a redeployed site
// is used again without a restart. No dependencies: Node's fetch.

const MARGIN_MS = 30_000;

/**
 * @param {{url: string, clientId: string, clientSecret: string, now?: () => number}} options
 */
export function createBakersClient({ url, clientId, clientSecret, now = Date.now }) {
  const base = url.replace(/\/$/, '');
  let token = null;

  async function accessToken() {
    if (token && now() < token.expires) return token.value;
    const res = await fetch(`${base}/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret, scope: 'bb:session' }),
    });
    if (!res.ok) throw new Error(`token request failed: ${res.status}`);
    const body = await res.json();
    token = { value: body.access_token, expires: now() + body.expires_in * 1000 - MARGIN_MS };
    return token.value;
  }

  // One authorized request. A 401 or a refused connection drops the token; a
  // 401 is repeated once with a new one. Every other failure is thrown.
  async function request(path, init = {}, retried = false) {
    let res;
    try {
      res = await fetch(`${base}${path}`, { ...init, headers: { ...init.headers, authorization: `Bearer ${await accessToken()}` } });
    } catch (error) {
      token = null;
      throw new Error(`${init.method ?? 'GET'} ${path}: ${error.cause?.code ?? error.message}`);
    }
    if (res.status === 401) {
      token = null;
      if (!retried) return request(path, init, true);
    }
    if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path} failed: ${res.status}`);
    return res;
  }

  const jsonapi = async (method, path, document) => {
    const headers = { accept: 'application/vnd.api+json' };
    if (document !== undefined) headers['content-type'] = 'application/vnd.api+json';
    const res = await request(path, { method, headers, body: document === undefined ? undefined : JSON.stringify(document) });
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  };

  // One bakers.build tool over MCP's streamable HTTP transport: initialize a
  // session, then tools/call. The answer is JSON or one server-sent event.
  async function tool(name, args) {
    let session = '';
    const rpc = async (message) => {
      const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
      if (session) headers['mcp-session-id'] = session;
      const res = await request('/mcp', { method: 'POST', headers, body: JSON.stringify(message) });
      session = res.headers.get('mcp-session-id') ?? session;
      const text = await res.text();
      if (message.id === undefined) return null;
      const json = res.headers.get('content-type')?.includes('text/event-stream')
        ? text.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5)).join('')
        : text;
      const answer = JSON.parse(json);
      if (answer.error) throw new Error(`${message.method}: ${answer.error.message}`);
      return answer.result;
    };
    await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'pm-bot', version: '1' } } });
    await rpc({ jsonrpc: '2.0', method: 'notifications/initialized' });
    const result = await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: `tool_api__${name}`, arguments: args } });
    const text = result.content?.find((c) => c.type === 'text')?.text ?? '';
    if (result.isError) throw new Error(`${name}: ${text}`);
    return result.structuredContent ?? JSON.parse(text);
  }

  return {
    get: (path) => jsonapi('GET', path),
    post: (path, document) => jsonapi('POST', path, document),
    patch: (path, document) => jsonapi('PATCH', path, document),
    tool,
  };
}
