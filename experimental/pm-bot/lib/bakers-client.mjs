// The poller's one way into bakers.build: its tools on /mcp, called with the bot's
// service-account API key as a static bearer. Hermes reaches the same tools with the
// same key from its own config. No token exchange, no JSON:API, no dependencies:
// Node's fetch. A failed call throws; the poller's next pass is the retry.

/**
 * @param {{url: string, apiKey: string}} options
 */
export function createBakersClient({ url, apiKey }) {
  const endpoint = `${url.replace(/\/$/, '')}/mcp`;

  // One bakers.build tool over MCP's streamable HTTP transport: initialize a
  // session, then tools/call. The answer is JSON or one server-sent event.
  async function tool(name, args) {
    let session = '';
    const rpc = async (message) => {
      const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${apiKey}` };
      if (session) headers['mcp-session-id'] = session;
      let res;
      try {
        res = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(message) });
      } catch (error) {
        throw new Error(`${name}: ${error.cause?.code ?? error.message}`);
      }
      if (!res.ok && res.status !== 202) throw new Error(`${name}: /mcp answered ${res.status}`);
      session = res.headers.get('mcp-session-id') ?? session;
      const text = await res.text();
      if (message.id === undefined) return null;
      const json = res.headers.get('content-type')?.includes('text/event-stream')
        ? text.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5)).join('')
        : text;
      const answer = JSON.parse(json);
      if (answer.error) throw new Error(`${name}: ${message.method}: ${answer.error.message}`);
      return answer.result;
    };
    await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'pm-bot', version: '2' } } });
    await rpc({ jsonrpc: '2.0', method: 'notifications/initialized' });
    const result = await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: `tool_api__${name}`, arguments: args } });
    const text = result.content?.find((c) => c.type === 'text')?.text ?? '';
    if (result.isError) throw new Error(`${name}: ${text}`);
    return result.structuredContent ?? JSON.parse(text);
  }

  return { tool };
}
