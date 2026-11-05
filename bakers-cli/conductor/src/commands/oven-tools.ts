// `bakers oven tools`: an MCP client for the run's own conductor tool server,
// for agents that cannot load `bakers-conductor` themselves. URL and bearer
// token come from the run env; the token never reaches argv or output.

import { readFileSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  StreamableHTTPClientTransport,
  StreamableHTTPError,
} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { CONDUCTOR_TOKEN_ENV, CONDUCTOR_URL_ENV } from '../plugins/agent.js';

export interface OvenToolsOptions {
  /** JSON object, or `@<file>` holding one. */
  data?: string;
  schema?: boolean;
}

export interface OvenToolsIo {
  out(line: string): void;
  err(line: string): void;
}

const processIo: OvenToolsIo = {
  out: (line) => process.stdout.write(`${line}\n`),
  err: (line) => process.stderr.write(`${line}\n`),
};

/** Exit codes mirror `bakers tools`. */
export const EXIT = {
  ok: 0,
  toolError: 1,
  rejected: 3,
  invalid: 4,
  transport: 5,
} as const;

function parseData(data: string | undefined): Record<string, unknown> | string {
  if (data === undefined) return {};
  try {
    const text = data.startsWith('@')
      ? readFileSync(data.slice(1), 'utf8')
      : data;
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
      return parsed as Record<string, unknown>;
    return '--data must be a JSON object';
  } catch (err) {
    return `invalid --data: ${err instanceof Error ? err.message : String(err)}`;
  }
}

/** List the tools, print one's schema, or call it; returns the exit code. */
export async function ovenTools(
  name: string | undefined,
  opts: OvenToolsOptions,
  env: NodeJS.ProcessEnv = process.env,
  io: OvenToolsIo = processIo,
): Promise<number> {
  const url = env[CONDUCTOR_URL_ENV];
  const token = env[CONDUCTOR_TOKEN_ENV];
  if (!url || !token) {
    io.err(
      `no conductor tools in this shell: ${CONDUCTOR_URL_ENV} and ${CONDUCTOR_TOKEN_ENV} are set only inside a conductor run with a tool server`,
    );
    return EXIT.invalid;
  }
  if (!URL.canParse(url)) {
    io.err(`${CONDUCTOR_URL_ENV} is not a URL: ${url}`);
    return EXIT.invalid;
  }
  const args = parseData(opts.data);
  if (typeof args === 'string') {
    io.err(args);
    return EXIT.invalid;
  }

  const client = new Client({ name: 'bakers-oven-tools', version: '1.0.0' });
  try {
    const transport = new StreamableHTTPClientTransport(new URL(url), {
      requestInit: { headers: { authorization: `Bearer ${token}` } },
    });
    // The SDK's own types disagree under exactOptionalPropertyTypes.
    await client.connect(transport as Parameters<Client['connect']>[0]);
    const { tools } = await client.listTools();
    if (!name) {
      for (const t of tools) io.out(`${t.name}\t${t.description ?? ''}`);
      return EXIT.ok;
    }
    const tool = tools.find((t) => t.name === name);
    if (!tool) {
      io.err(
        `unknown conductor tool ${name}; available: ${tools.map((t) => t.name).join(', ') || '(none)'}`,
      );
      return EXIT.invalid;
    }
    if (opts.schema) {
      io.out(JSON.stringify(tool.inputSchema, null, 2));
      return EXIT.ok;
    }
    const result = await client.callTool({ name, arguments: args });
    const text = result.structuredContent
      ? JSON.stringify(result.structuredContent, null, 2)
      : ((result.content ?? []) as { type: string; text?: string }[])
          .filter((c) => c.type === 'text')
          .map((c) => c.text)
          .join('\n');
    if (result.isError) {
      io.err(text);
      return EXIT.toolError;
    }
    io.out(text);
    return EXIT.ok;
  } catch (err) {
    if (
      err instanceof StreamableHTTPError &&
      (err.code === 401 || err.code === 403)
    ) {
      io.err(`run token rejected by ${url}: ${err.message}`);
      return EXIT.rejected;
    }
    io.err(
      `conductor tool server ${url}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return EXIT.transport;
  } finally {
    await client.close().catch(() => undefined);
  }
}
