import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import http, {
  type IncomingHttpHeaders,
  type IncomingMessage,
  type OutgoingHttpHeaders,
} from 'node:http';
import https from 'node:https';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { basicAuthProvider } from '@bakers-build/addon-auth-basic';
import { withBakersClientHeader } from '@bakers-build/core';
import type { JsonApiClient } from 'dropsh/plugin';
import { createHttpClient, createJsonApiClient } from 'dropsh/plugin';

/** Uncompressed JSONL size the live gzip round trip must measure. */
export const FORTY_MIB = 40 * 1024 * 1024;

/** Incoming-byte cap the counting proxy enforces on the successful path. */
export const PROXY_INCOMING_CAP = 32 * 1024 * 1024;

/** Exact Drupal warning appended when a size rejection omits the transcript. */
export const LOG_UPLOAD_OMITTED_WARNING =
  'Transcript upload omitted because the run-log upload exceeded a size limit.';

export interface E2EContext {
  api: JsonApiClient;
}

export interface JsonApiResource {
  id: string;
  type: string;
  attributes?: Record<string, unknown>;
  relationships?: Record<
    string,
    { data: JsonApiResourceIdentifier | JsonApiResourceIdentifier[] | null }
  >;
}

export interface JsonApiResourceIdentifier {
  id: string;
  type: string;
}

export interface JsonApiDocument<T extends JsonApiResource = JsonApiResource> {
  data: T;
}

export interface JsonApiCollection<
  T extends JsonApiResource = JsonApiResource,
> {
  data: T[];
}

export function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`missing env ${name} - run 'ddev init --test' first`);
  }
  return value;
}

export async function createContext(): Promise<E2EContext> {
  const baseUrl = requiredEnv('BB_E2E_BASE_URL');
  // Claims require the client-version header, as from the real CLI.
  const http = withBakersClientHeader(createHttpClient());
  const provider = basicAuthProvider(requiredEnv('BB_E2E_BASIC'))
    .authProvider as {
    createAdapter(): { apply(req: unknown): Promise<unknown> };
  };
  const auth = provider.createAdapter();
  return {
    api: createJsonApiClient({
      baseUrl,
      prefix: '/jsonapi',
      http,
      auth: auth as never,
    }),
  };
}

/**
 * Same wiring as {@link createContext}, but authenticated as an explicit
 * `account:password` pair instead of `BB_E2E_BASIC`. Used by suites that
 * need more than one identity against the SAME seeded world — e.g. the
 * cross-tenant read-isolation check, which authenticates as two different
 * workspace members. The recipe-test accounts this is meant for
 * (see `recipes/bb_e2e/content/user/*.yml`) are public,
 * recipe-test-only credentials already committed in clear text by
 * `tests/playwright/support/api-client.ts`.
 */
export async function createContextForAccount(
  account: string,
  password: string,
): Promise<E2EContext> {
  const baseUrl = requiredEnv('BB_E2E_BASE_URL');
  const http = withBakersClientHeader(createHttpClient());
  const token = Buffer.from(`${account}:${password}`).toString('base64');
  const provider = basicAuthProvider(token).authProvider as {
    createAdapter(): { apply(req: unknown): Promise<unknown> };
  };
  const auth = provider.createAdapter();
  return {
    api: createJsonApiClient({
      baseUrl,
      prefix: '/jsonapi',
      http,
      auth: auth as never,
    }),
  };
}

/** One captured hop through {@link startCountingProxy}. */
export interface ProxyCapture {
  method: string;
  url: string;
  requestHeaders: IncomingMessage['headers'];
  requestBytes: number;
  requestBody: Buffer;
  status: number;
  responseHeaders: IncomingHttpHeaders;
  responseBytes: number;
  responseBody: Buffer;
  rejected: boolean;
}

export interface CountingProxy {
  base: string;
  captured: ProxyCapture[];
  cap: number;
  setCap(bytes: number): void;
  close(): Promise<void>;
}

/**
 * Loopback proxy that counts actual incoming bytes, rejects over `cap` with
 * the PHP post-size warning `RunLogSizeError` recognizes, and records raw
 * request/response bodies (including gzip) without decoding them.
 */
export async function startCountingProxy(
  targetBaseUrl: string,
  initialCap: number,
): Promise<CountingProxy> {
  const target = new URL(targetBaseUrl);
  const transport = target.protocol === 'https:' ? https : http;
  let cap = initialCap;
  const captured: ProxyCapture[] = [];

  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });
    req.on('end', () => {
      const requestBody = Buffer.concat(chunks);
      const requestBytes = requestBody.byteLength;
      if (requestBytes > cap) {
        const responseBody = Buffer.from(
          '<html>\r\n<head><title>413 Request Entity Too Large</title></head>\r\n<body>\r\n<center><h1>413 Request Entity Too Large</h1></center>\r\n<hr><center>nginx</center>\r\n</body>\r\n</html>\r\n',
          'utf8',
        );
        captured.push({
          method: req.method ?? '',
          url: req.url ?? '',
          requestHeaders: req.headers,
          requestBytes,
          requestBody,
          status: 413,
          responseHeaders: { 'content-type': 'text/html' },
          responseBytes: responseBody.byteLength,
          responseBody,
          rejected: true,
        });
        res.writeHead(413, {
          'Content-Type': 'text/html',
          'Content-Length': String(responseBody.byteLength),
        });
        res.end(responseBody);
        return;
      }

      const headers: OutgoingHttpHeaders = { ...req.headers };
      headers.host = target.host;
      delete headers.connection;
      delete headers['keep-alive'];
      delete headers['proxy-connection'];
      delete headers['transfer-encoding'];
      headers['content-length'] = requestBytes;

      const upstream = transport.request(
        {
          protocol: target.protocol,
          hostname: target.hostname,
          port: target.port || (target.protocol === 'https:' ? 443 : 80),
          method: req.method,
          path: req.url,
          headers,
          rejectUnauthorized: target.protocol === 'https:' ? false : undefined,
        },
        (upstreamRes) => {
          const responseChunks: Buffer[] = [];
          upstreamRes.on('data', (chunk: Buffer) => {
            responseChunks.push(chunk);
          });
          upstreamRes.on('end', () => {
            const responseBody = Buffer.concat(responseChunks);
            const responseHeaders: OutgoingHttpHeaders = {
              ...upstreamRes.headers,
            };
            delete responseHeaders.connection;
            delete responseHeaders['transfer-encoding'];
            responseHeaders['content-length'] = responseBody.byteLength;
            captured.push({
              method: req.method ?? '',
              url: req.url ?? '',
              requestHeaders: req.headers,
              requestBytes,
              requestBody,
              status: upstreamRes.statusCode ?? 502,
              responseHeaders: upstreamRes.headers,
              responseBytes: responseBody.byteLength,
              responseBody,
              rejected: false,
            });
            res.writeHead(upstreamRes.statusCode ?? 502, responseHeaders);
            res.end(responseBody);
          });
        },
      );
      upstream.on('error', (err) => {
        const responseBody = Buffer.from(String(err), 'utf8');
        captured.push({
          method: req.method ?? '',
          url: req.url ?? '',
          requestHeaders: req.headers,
          requestBytes,
          requestBody,
          status: 502,
          responseHeaders: {},
          responseBytes: responseBody.byteLength,
          responseBody,
          rejected: false,
        });
        res.writeHead(502, {
          'Content-Type': 'text/plain',
          'Content-Length': String(responseBody.byteLength),
        });
        res.end(responseBody);
      });
      upstream.end(requestBody);
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return {
    base: `http://127.0.0.1:${port}`,
    captured,
    get cap() {
      return cap;
    },
    setCap(bytes: number) {
      cap = bytes;
    },
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

/**
 * Deterministic 40 MiB JSONL: several event forms, paths, timestamps,
 * escaped characters and Unicode. Size is {@link Buffer.byteLength}, not
 * a character count.
 */
export function buildFortyMibJsonl(): string {
  const forms = [
    (i: number) =>
      JSON.stringify({
        type: 'user',
        timestamp: `2026-03-01T12:00:${String(i % 60).padStart(2, '0')}.000Z`,
        path: `/workspace/src/file-${i}.ts`,
        message: {
          role: 'user',
          content: `prompt ${i} with "quotes" and \\escapes\\ and 日本語`,
        },
      }),
    (i: number) =>
      JSON.stringify({
        type: 'assistant',
        timestamp: `2026-03-01T12:01:${String(i % 60).padStart(2, '0')}.000Z`,
        message: { role: 'assistant', content: `reply ${i}` },
      }),
    (i: number) =>
      JSON.stringify({
        type: 'tool_use',
        timestamp: `2026-03-01T12:02:${String(i % 60).padStart(2, '0')}.000Z`,
        path: `/workspace/out/${i}.json`,
        name: 'Read',
        input: { file_path: `/workspace/src/file-${i}.ts` },
      }),
    (i: number) =>
      JSON.stringify({
        type: 'tool_result',
        timestamp: `2026-03-01T12:03:${String(i % 60).padStart(2, '0')}.000Z`,
        content: `ok ${i}`,
      }),
  ];
  const lines: string[] = [];
  let bytes = 0;
  for (let i = 0; ; i++) {
    const line = forms[i % forms.length]!(i);
    const size = Buffer.byteLength(line, 'utf8') + 1;
    if (bytes + size > FORTY_MIB - 128) {
      break;
    }
    lines.push(line);
    bytes += size;
  }
  const head = `${lines.join('\n')}\n`;
  const headBytes = Buffer.byteLength(head, 'utf8');
  const prefix = '{"type":"pad","data":"';
  const suffix = '"}\n';
  const padBytes =
    FORTY_MIB -
    headBytes -
    Buffer.byteLength(prefix, 'utf8') -
    Buffer.byteLength(suffix, 'utf8');
  if (padBytes < 0) {
    throw new Error('40 MiB JSONL overflowed the pad budget');
  }
  const jsonl = `${head}${prefix}${'x'.repeat(padBytes)}${suffix}`;
  if (Buffer.byteLength(jsonl, 'utf8') !== FORTY_MIB) {
    throw new Error(
      `40 MiB JSONL measured ${Buffer.byteLength(jsonl, 'utf8')} bytes`,
    );
  }
  return jsonl;
}

export async function rawHttpRequest(
  baseUrl: string,
  path: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: Buffer | string;
  } = {},
): Promise<{
  status: number;
  headers: IncomingHttpHeaders;
  body: Buffer;
}> {
  const target = new URL(path, `${baseUrl.replace(/\/+$/, '')}/`);
  const transport = target.protocol === 'https:' ? https : http;
  const body =
    options.body === undefined
      ? undefined
      : typeof options.body === 'string'
        ? Buffer.from(options.body, 'utf8')
        : options.body;
  const headers: OutgoingHttpHeaders = { ...(options.headers ?? {}) };
  if (body) {
    headers['content-length'] = body.byteLength;
  }
  return new Promise((resolve, reject) => {
    const req = transport.request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || (target.protocol === 'https:' ? 443 : 80),
        method: options.method ?? 'GET',
        path: `${target.pathname}${target.search}`,
        headers,
        rejectUnauthorized: target.protocol === 'https:' ? false : undefined,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => {
          chunks.push(chunk);
        });
        res.on('end', () => {
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks),
          });
        });
      },
    );
    req.on('error', reject);
    req.end(body);
  });
}

function repoRootFromHelpers(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, 'WORKFLOW.md'))) return dir;
    dir = dirname(dir);
  }
  throw new Error('WORKFLOW.md not found walking up from helpers.ts');
}

/** Privileged Drupal eval; uses in-container `drush` or host `ddev drush`. */
export function drushEv(php: string): string {
  const root = repoRootFromHelpers();
  const args = ['ev', php];
  if (process.env.DDEV_PROJECT) {
    return execFileSync('drush', args, {
      encoding: 'utf8',
      cwd: root,
      maxBuffer: 10 * 1024 * 1024,
    });
  }
  return execFileSync('ddev', ['drush', ...args], {
    encoding: 'utf8',
    cwd: root,
    maxBuffer: 10 * 1024 * 1024,
  });
}
