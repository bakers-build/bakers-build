// The conductor's local MCP server, `bakers-conductor`: serves the addon
// tools to agent runs over Streamable HTTP on 127.0.0.1. A run token, issued
// at launch, binds every call to that run's worktree. The operator token
// (endpoint file, 0600) may name a worktree under the workspace root, for
// the CLI's plain JSON `POST /call`.

import { randomBytes } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import { dirname, relative, resolve } from 'node:path';
import type { ConductorLogger } from '@bakers-build/core';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { CONDUCTOR_TOOLS_SERVER } from '../plugins/agent.js';
import type { ToolBinding, ToolRegistry } from '../plugins/tools.js';

export interface ToolServer {
  /** The MCP endpoint. */
  url: string;
  issueRunToken(binding: ToolBinding): string;
  revokeRunToken(token: string): void;
  stop(): Promise<void>;
}

/** What the conductor publishes for the CLI in the endpoint file. */
export interface ToolServerEndpoint {
  url: string;
  operatorToken: string;
  workspaceRoot: string;
  pid: number;
}

export interface ToolServerOptions {
  registry: ToolRegistry;
  /** `<BB_HOME>/conductors/<conductor_id>.json`; absent: no operator access. */
  endpointFile?: string;
  /** The operator may only name worktrees below this directory. */
  workspaceRoot?: string;
  logger?: ConductorLogger;
}

const newToken = () => randomBytes(32).toString('hex');

function bearer(req: IncomingMessage): string | undefined {
  const m = /^Bearer (.+)$/.exec(req.headers.authorization ?? '');
  return m?.[1];
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

function isInside(root: string, path: string): boolean {
  const rel = relative(resolve(root), resolve(path));
  return !rel.startsWith('..') && !rel.startsWith('/');
}

export async function startToolServer(
  options: ToolServerOptions,
): Promise<ToolServer> {
  const { registry, logger } = options;
  const runs = new Map<string, ToolBinding>();
  const operatorToken = newToken();

  const mcpServer = (binding: ToolBinding): Server => {
    const server = new Server(
      { name: CONDUCTOR_TOOLS_SERVER, version: '1.0.0' },
      { capabilities: { tools: {} } },
    );
    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: registry.list().map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema as { type: 'object' },
      })),
    }));
    server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
      try {
        const result = await registry.call(
          request.params.name,
          request.params.arguments,
          binding,
          { signal: extra.signal, ...(logger ? { logger } : {}) },
        );
        return { content: [{ type: 'text', text: result.text }] };
      } catch (err) {
        const text = err instanceof Error ? err.message : String(err);
        return { isError: true, content: [{ type: 'text', text }] };
      }
    });
    return server;
  };

  const operatorCall = async (
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> => {
    if (bearer(req) !== operatorToken)
      return send(res, 401, { error: 'operator token required' });
    const body = (await readJson(req)) as {
      tool?: unknown;
      args?: unknown;
      worktree?: unknown;
      ticket?: unknown;
    };
    if (typeof body.tool !== 'string' || typeof body.worktree !== 'string')
      return send(res, 400, { error: 'tool and worktree are required' });
    if (
      !options.workspaceRoot ||
      !isInside(options.workspaceRoot, body.worktree)
    )
      return send(res, 403, {
        error: `${body.worktree} is not under the conductor's workspace root ${options.workspaceRoot ?? '(none)'}`,
      });
    try {
      const result = await registry.call(
        body.tool,
        body.args as Record<string, unknown> | undefined,
        {
          worktreePath: resolve(body.worktree),
          ...(typeof body.ticket === 'string'
            ? { ticket: { identifier: body.ticket } }
            : {}),
        },
        logger ? { logger } : {},
      );
      send(res, 200, result);
    } catch (err) {
      send(res, 422, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const http = createServer((req, res) => {
    const handle = async () => {
      if (req.method === 'POST' && req.url === '/call')
        return operatorCall(req, res);
      const binding = runs.get(bearer(req) ?? '');
      if (!binding)
        return send(res, 401, {
          error: 'unknown run token — conductor restarted?',
        });
      // Stateless (no session id generator): one server and transport per request.
      const server = mcpServer(binding);
      const transport = new StreamableHTTPServerTransport({
        enableJsonResponse: true,
      });
      res.on('close', () => {
        void transport.close();
        void server.close();
      });
      // The SDK's own types disagree under exactOptionalPropertyTypes.
      await server.connect(transport as Parameters<Server['connect']>[0]);
      await transport.handleRequest(req, res);
    };
    handle().catch((err) => {
      logger?.error({ err }, 'tool server request failed');
      if (!res.headersSent) send(res, 500, { error: 'internal error' });
    });
  });
  await new Promise<void>((done) => http.listen(0, '127.0.0.1', done));
  const { port } = http.address() as AddressInfo;
  const url = `http://127.0.0.1:${port}`;

  if (options.endpointFile) {
    mkdirSync(dirname(options.endpointFile), { recursive: true, mode: 0o700 });
    const endpoint: ToolServerEndpoint = {
      url,
      operatorToken,
      workspaceRoot: options.workspaceRoot ?? '',
      pid: process.pid,
    };
    writeFileSync(options.endpointFile, JSON.stringify(endpoint), {
      mode: 0o600,
    });
  }

  return {
    url,
    issueRunToken: (binding) => {
      const token = newToken();
      runs.set(token, binding);
      return token;
    },
    revokeRunToken: (token) => {
      runs.delete(token);
    },
    stop: async () => {
      if (options.endpointFile) rmSync(options.endpointFile, { force: true });
      runs.clear();
      http.closeAllConnections();
      await new Promise<void>((done) => http.close(() => done()));
    },
  };
}
