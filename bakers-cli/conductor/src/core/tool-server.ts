// The conductor's local MCP server, `bakers`: serves the addon
// tools to agent runs over Streamable HTTP on 127.0.0.1. A run token, issued
// at launch, binds every call to that run's worktree. The operator token
// (endpoint file, 0600) may name a worktree under the workspace root, for
// the CLI's plain JSON `POST /call`.
//
// With an endpoint file, the port and the run grants (token hash and binding,
// never the raw token) persist in `<id>.tools.json` beside it, so a running
// agent's baked-in URL and token survive a conductor restart.

import { createHash, randomBytes } from 'node:crypto';
import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
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
import type { SiteToolClient } from '../plugins/remote.js';
import type { ToolBinding, ToolRegistry } from '../plugins/tools.js';
import { SITE_TOOLS, SITE_WRITE_TOOLS, siteToolProxy } from './site-tools.js';

export interface ToolServer {
  /** The MCP endpoint. */
  url: string;
  /** A fresh token for the run; replaces the run's earlier grant. */
  issueRunToken(runUuid: string, binding: ToolBinding): string;
  revokeRunToken(runUuid: string): void;
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
  /** `<BAKERS_HOME>/conductors/<conductor_id>.json`; absent: no operator access. */
  endpointFile?: string;
  /** The operator may only name worktrees below this directory. */
  workspaceRoot?: string;
  logger?: ConductorLogger;
  /** The site's tools, served to run tokens only; absent: none. */
  siteTools?: SiteToolClient;
  /** Called after a run's successful ticket write through a site tool. */
  onSiteWrite?: (binding: ToolBinding) => void;
  /** The runs still open; persisted grants of any other run are dropped. Absent: keep all. */
  openRuns?: string[];
}

const newToken = () => randomBytes(32).toString('hex');
const hashOf = (token: string) =>
  createHash('sha256').update(token).digest('hex');

interface Grant {
  hash: string;
  binding: ToolBinding;
}

/** What `<id>.tools.json` holds: the port and the grants by run UUID. */
interface ToolServerState {
  port?: number;
  runs: Record<string, Grant>;
}

function readState(
  file: string | undefined,
  logger?: ConductorLogger,
): ToolServerState {
  if (!file) return { runs: {} };
  try {
    const saved = JSON.parse(readFileSync(file, 'utf8')) as Partial<
      Record<keyof ToolServerState, unknown>
    > | null;
    const runs = saved?.runs;
    const port = saved?.port;
    return {
      runs:
        typeof runs === 'object' && runs
          ? (runs as ToolServerState['runs'])
          : {},
      ...(Number.isInteger(port) ? { port: port as number } : {}),
    };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT')
      logger?.warn(
        { err, file },
        'tool server state unreadable, starting empty',
      );
    return { runs: {} };
  }
}

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
  const site = options.siteTools
    ? siteToolProxy(options.siteTools, logger)
    : undefined;
  if (site) {
    const clash = registry.list().find((t) => SITE_TOOLS.includes(t.name));
    if (clash)
      throw new Error(
        `addon tool ${clash.name} has the name of a bakers site tool`,
      );
  }
  const stateFile = options.endpointFile?.replace(/(\.json)?$/, '.tools.json');
  const saved = readState(stateFile, logger);
  const runs = new Map<string, Grant>(
    Object.entries(saved.runs).filter(
      ([run]) => !options.openRuns || options.openRuns.includes(run),
    ),
  );
  const operatorToken = newToken();
  let port = 0;
  const persist = () => {
    if (!stateFile) return;
    const state: ToolServerState = { port, runs: Object.fromEntries(runs) };
    writeFileSync(`${stateFile}.tmp`, JSON.stringify(state), { mode: 0o600 });
    renameSync(`${stateFile}.tmp`, stateFile);
  };
  const bindingOf = (token: string | undefined) => {
    if (!token) return undefined;
    const hash = hashOf(token);
    return [...runs.values()].find((g) => g.hash === hash)?.binding;
  };

  const mcpServer = (binding: ToolBinding): Server => {
    const server = new Server(
      { name: CONDUCTOR_TOOLS_SERVER, version: '1.0.0' },
      { capabilities: { tools: {} } },
    );
    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [...registry.list(), ...((await site?.list()) ?? [])].map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema as { type: 'object' },
      })),
    }));
    server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
      try {
        if (site && SITE_TOOLS.includes(request.params.name)) {
          const result = await site.call(
            request.params.name,
            request.params.arguments ?? {},
            binding,
          );
          if (SITE_WRITE_TOOLS.includes(request.params.name)) {
            // The write already succeeded: a failing hook must not make the agent retry it.
            try {
              options.onSiteWrite?.(binding);
            } catch (err) {
              logger?.warn({ err: String(err) }, 'site write hook failed');
            }
          }
          return result;
        }
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
      const binding = bindingOf(bearer(req));
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
  const listen = (at: number) =>
    new Promise<void>((done, fail) => {
      http.once('error', fail);
      http.listen(at, '127.0.0.1', () => {
        http.off('error', fail);
        done();
      });
    });
  try {
    await listen(saved.port ?? 0);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EADDRINUSE' || !saved.port)
      throw err;
    // shortcut: runs launched before the restart lose their tools until re-dispatched.
    logger?.warn(
      { port: saved.port },
      'tool server port taken, falling back to a random port',
    );
    await listen(0);
  }
  port = (http.address() as AddressInfo).port;
  const url = `http://127.0.0.1:${port}`;

  if (options.endpointFile) {
    mkdirSync(dirname(options.endpointFile), { recursive: true, mode: 0o700 });
    persist();
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
    issueRunToken: (runUuid, binding) => {
      const token = newToken();
      runs.set(runUuid, { hash: hashOf(token), binding });
      persist();
      return token;
    },
    revokeRunToken: (runUuid) => {
      if (runs.delete(runUuid)) persist();
    },
    stop: async () => {
      // The state file stays: the next start serves the same grants.
      if (options.endpointFile) rmSync(options.endpointFile, { force: true });
      http.closeAllConnections();
      await new Promise<void>((done) => http.close(() => done()));
    },
  };
}
