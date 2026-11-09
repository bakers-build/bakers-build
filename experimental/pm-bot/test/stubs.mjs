// Test stubs: a bakers.build server and the Slack Web API as real HTTP servers on
// 127.0.0.1, so the client and poller are tested through their own fetch
// calls. Each stub records every request it answered.

import { createServer } from 'node:http';

function listen(handler, port = 0) {
  const server = createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const url = new URL(req.url, 'http://stub');
    const out = await handler({ method: req.method, path: url.pathname, query: url.searchParams, headers: req.headers, raw });
    res.writeHead(out.status ?? 200, { 'content-type': out.type ?? 'application/json', ...(out.headers ?? {}) });
    res.end(out.body === undefined ? '' : typeof out.body === 'string' ? out.body : JSON.stringify(out.body));
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

/**
 * A bakers.build stub.
 *
 * - Every request must carry `Authorization: Bearer <apiKey>` (default
 *   `bb-test-key`); `revoke()` rejects it from then on with 401.
 * - `POST /mcp` speaks MCP over streamable HTTP; `tools[name](args)` answers a
 *   tools/call (throw an Error for a tool refusal). Results come as one
 *   server-sent event, as the site answers, or as plain JSON with `sse: false`.
 * - Any other path is a 404: the bot reaches bakers.build only through tools.
 * - `outage(n, status)` answers the next n requests with `status`; `down()` and
 *   `up()` close and reopen the port (connection refused).
 */
export async function bakersStub({ tools = {}, apiKey = 'bb-test-key', sse = true } = {}) {
  const requests = [];
  let valid = true;
  let failures = [];
  const handler = async (r) => {
    const body = r.raw ? JSON.parse(r.raw.startsWith('{') ? r.raw : '{}') : undefined;
    const request = { ...r, body };
    if (failures.length) {
      const status = failures.shift();
      requests.push({ ...request, failed: status });
      return { status, body: { message: 'outage' } };
    }
    requests.push(request);
    if (!valid || r.headers.authorization !== `Bearer ${apiKey}`) return { status: 401, body: { message: 'unauthorized' } };
    if (r.method === 'POST' && r.path === '/mcp') return mcp(body);
    return { status: 404, body: { message: 'not found' } };
  };
  const mcp = async (message) => {
    if (message.id === undefined) return { status: 202 };
    if (message.method === 'initialize') {
      return { headers: { 'mcp-session-id': 'session-1' }, body: { jsonrpc: '2.0', id: message.id, result: { protocolVersion: '2025-06-18', capabilities: { tools: {} } } } };
    }
    const { name, arguments: args } = message.params;
    const tool = tools[name.replace(/^tool_api__/, '')];
    if (!tool) return { body: { jsonrpc: '2.0', id: message.id, error: { code: -32602, message: `unknown tool ${name}` } } };
    try {
      const result = await tool(args);
      const answer = { jsonrpc: '2.0', id: message.id, result: { content: [{ type: 'text', text: JSON.stringify(result) }], isError: false } };
      if (!sse) return { body: answer };
      // As the site answers: one server-sent event.
      return {
        type: 'text/event-stream',
        body: `event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { content: [{ type: 'text', text: JSON.stringify(result) }], isError: false } })}\n\n`,
      };
    } catch (error) {
      return { body: { jsonrpc: '2.0', id: message.id, result: { content: [{ type: 'text', text: error.message }], isError: true } } };
    }
  };
  let server = await listen(handler);
  const port = server.address().port;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    calls: (tool) => requests.filter((r) => r.path === '/mcp' && r.body?.method === 'tools/call' && (!tool || r.body.params.name === `tool_api__${tool}`)).map((r) => r.body.params.arguments),
    outage: (n, status = 503) => {
      failures = Array(n).fill(status);
    },
    revoke: () => {
      valid = false;
    },
    down: () => new Promise((resolve) => (server.closeAllConnections(), server.close(resolve))),
    up: async () => {
      server = await listen(handler, port);
    },
    close: () => new Promise((resolve) => (server.closeAllConnections(), server.close(resolve))),
  };
}

/**
 * A Slack Web API stub at `${url}/api/<method>`: records `{method, body}` and
 * answers from `answers[method]` (a value or a function of the body).
 * `fail(method)` makes that method answer `{ok: false}` until `heal()`. Channel names are
 * unique, as in Slack: `conversations.create` and `conversations.rename` answer `name_taken`
 * for a name in use, and `take(name)` puts a name in use.
 */
export async function slackStub(answers = {}) {
  const calls = [];
  let failing = new Set();
  let ts = 0;
  let ids = 0;
  const names = new Set();
  const claim = (name, answer) => (names.has(name) ? { ok: false, error: 'name_taken' } : (names.add(name), answer()));
  const defaults = {
    'conversations.create': (body) => claim(body.name, () => ({ ok: true, channel: { id: `C9${String(++ids).padStart(9, '0')}`, name: body.name } })),
    'conversations.rename': (body) => claim(body.name, () => ({ ok: true, channel: { id: body.channel, name: body.name } })),
    'conversations.invite': { ok: true, channel: {} },
    'conversations.archive': { ok: true },
    'conversations.history': { ok: true, messages: [] },
    'chat.postMessage': () => {
      ts += 1;
      return { ok: true, ts: `1800000000.${String(ts).padStart(6, '0')}` };
    },
    'chat.getPermalink': (body) => ({ ok: true, permalink: `https://acme.slack.com/archives/${body.channel}/p${body.message_ts.replace('.', '')}` }),
  };
  const server = await listen(async (r) => {
    const method = r.path.replace(/^\/api\//, '');
    const body = r.raw ? JSON.parse(r.raw) : {};
    calls.push({ method, body });
    if (failing.has(method)) return { body: { ok: false, error: 'stubbed_failure' } };
    const answer = answers[method] ?? defaults[method];
    return { body: typeof answer === 'function' ? answer(body) : (answer ?? { ok: false, error: 'unknown_method' }) };
  });
  return {
    url: `http://127.0.0.1:${server.address().port}/api`,
    calls,
    posts: () => calls.filter((c) => c.method === 'chat.postMessage').map((c) => c.body),
    take: (name) => names.add(name),
    fail: (method) => failing.add(method),
    heal: () => (failing = new Set()),
    close: () => new Promise((resolve) => (server.closeAllConnections(), server.close(resolve))),
  };
}
