import { promisify } from 'node:util';
import { gzip } from 'node:zlib';
import type { HttpClient, HttpRequest } from 'dropsh/plugin';
import { createHttpClient, HttpError } from 'dropsh/plugin';

const gzipAsync = promisify(gzip);

/** Expanded UTF-8 JSON ceiling checked before compression. */
const MAX_EXPANDED_JSON_BYTES = 64 * 1024 * 1024;

const PHP_SIZE_WARNING =
  /POST Content-Length of \d+ bytes exceeds the limit of \d+ bytes/;

/**
 * 413 for a locally oversize run-log JSON body, a recognized PHP size
 * warning, or an HTTP 413 on a matching run POST/PATCH.
 */
export class RunLogSizeError extends HttpError {
  constructor(message: string, body: unknown = null) {
    super(413, message, body);
    this.name = 'RunLogSizeError';
  }
}

/**
 * HTTP client that gzips JSON:API POST/PATCH bodies with a nonempty log or
 * error_log, using dropsh's GET retries and no-retry writes.
 */
export function createRunLogHttp(
  baseUrl: string,
  jsonapiPrefix: string,
): HttpClient {
  const reads = createHttpClient();
  const writes = createHttpClient({ maxRetries: 0 });
  return {
    async send(request: HttpRequest) {
      const transport = request.method === 'GET' ? reads : writes;
      const outgoing = await maybeCompress(request, baseUrl, jsonapiPrefix);
      try {
        const res = await transport.send(outgoing);
        throwIfPhpSizeWarning(request.method, res.body);
        return res;
      } catch (err) {
        if (err instanceof RunLogSizeError) throw err;
        if (err instanceof HttpError) {
          throwIfPhpSizeWarning(
            request.method,
            typeof err.body === 'string' ? err.body : '',
          );
          if (
            err.status === 413 &&
            (request.method === 'POST' || request.method === 'PATCH') &&
            isRunWriteUrl(request.url, baseUrl, jsonapiPrefix, request.method)
          ) {
            throw new RunLogSizeError(
              'Run log upload exceeded the server body size limit',
              err.body,
            );
          }
        }
        throw err;
      }
    },
  };
}

async function maybeCompress(
  request: HttpRequest,
  baseUrl: string,
  jsonapiPrefix: string,
): Promise<HttpRequest> {
  if (request.method !== 'POST' && request.method !== 'PATCH') {
    return request;
  }
  if (!isRunWriteUrl(request.url, baseUrl, jsonapiPrefix, request.method)) {
    return request;
  }
  if (typeof request.body !== 'string') {
    return request;
  }
  if (hasContentEncoding(request.headers)) {
    return request;
  }
  if (!hasNonemptyRunLog(request.body)) {
    return request;
  }
  if (Buffer.byteLength(request.body, 'utf8') > MAX_EXPANDED_JSON_BYTES) {
    throw new RunLogSizeError(
      'Run log JSON exceeds the 64 MiB expanded size limit',
    );
  }
  const compressed = await gzipAsync(Buffer.from(request.body, 'utf8'), {
    level: 6,
  });
  const headers = new Headers(request.headers);
  headers.set('Content-Encoding', 'gzip');
  headers.delete('Content-Length');
  return {
    ...request,
    headers: Object.fromEntries(headers),
    body: compressed,
  };
}

function isRunWriteUrl(
  url: string,
  baseUrl: string,
  jsonapiPrefix: string,
  method: 'POST' | 'PATCH',
): boolean {
  let parsed: URL;
  let base: URL;
  try {
    parsed = new URL(url);
    base = new URL(baseUrl);
  } catch {
    return false;
  }
  if (parsed.origin !== base.origin) return false;
  const prefix = jsonapiPrefix.startsWith('/')
    ? jsonapiPrefix
    : `/${jsonapiPrefix}`;
  const collection = `${base.pathname.replace(/\/+$/, '')}${prefix.replace(/\/+$/, '')}/bb_run/bb_run`;
  const path = parsed.pathname.replace(/\/+$/, '') || '/';
  if (method === 'POST') {
    return path === collection;
  }
  if (!path.startsWith(`${collection}/`)) return false;
  const id = path.slice(collection.length + 1);
  return id.length > 0 && !id.includes('/');
}

function hasContentEncoding(
  headers: Record<string, string> | undefined,
): boolean {
  if (!headers) return false;
  const encoding = new Headers(headers).get('content-encoding');
  return encoding !== null && encoding.trim() !== '';
}

function hasNonemptyRunLog(body: string): boolean {
  try {
    const parsed: unknown = JSON.parse(body);
    if (!parsed || typeof parsed !== 'object') return false;
    const data = (parsed as { data?: unknown }).data;
    if (!data || typeof data !== 'object') return false;
    const attributes = (data as { attributes?: unknown }).attributes;
    if (!attributes || typeof attributes !== 'object') return false;
    const attrs = attributes as { log?: unknown; error_log?: unknown };
    return isNonemptyString(attrs.log) || isNonemptyString(attrs.error_log);
  } catch {
    return false;
  }
}

function isNonemptyString(value: unknown): boolean {
  return typeof value === 'string' && value.length > 0;
}

function throwIfPhpSizeWarning(method: string, raw: string): void {
  if (method !== 'POST' && method !== 'PATCH') {
    return;
  }
  if (PHP_SIZE_WARNING.test(raw)) {
    throw new RunLogSizeError(
      'Run log upload exceeded the server body size limit',
    );
  }
}
