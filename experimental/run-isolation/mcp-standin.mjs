// THROWAWAY spike stand-in for the conductor tool server: the same MCP SDK and Streamable HTTP
// transport on 127.0.0.1, a bearer token required, one tool. Run from the worktree root:
//   node experimental/run-isolation/mcp-standin.mjs <port> <token>
import { createRequire } from 'node:module';
import { createServer } from 'node:http';

// The SDK the conductor itself uses, resolved from its package.
const req = createRequire(new URL('../../bakers-cli/conductor/package.json', import.meta.url));
const sdk = (p) => import(req.resolve(`@modelcontextprotocol/sdk/${p}`));
const { Server } = await sdk('server/index.js');
const { StreamableHTTPServerTransport } = await sdk('server/streamableHttp.js');
const { CallToolRequestSchema, ListToolsRequestSchema } = await sdk('types.js');

const [port, token] = process.argv.slice(2);
createServer(async (rq, rs) => {
  if (rq.headers.authorization !== `Bearer ${token}`) {
    rs.writeHead(401).end('unauthorized');
    return;
  }
  const server = new Server({ name: 'bakers', version: '0' }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [{ name: 'bakers_ticket_read', description: 'stand-in', inputSchema: { type: 'object' } }],
  }));
  server.setRequestHandler(CallToolRequestSchema, async () => ({
    content: [{ type: 'text', text: 'standin-ok' }],
  }));
  // Stateless: a fresh transport per request, like a one-shot tool call.
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await server.connect(transport);
  await transport.handleRequest(rq, rs);
}).listen(Number(port), '127.0.0.1', () => console.log(`mcp stand-in on 127.0.0.1:${port}`));
