import { createServer, type IncomingMessage, type Server } from 'node:http';
import { gunzipSync } from 'node:zlib';
import type { HttpRequest } from 'dropsh/plugin';
import { HttpError } from 'dropsh/plugin';
import { afterEach, describe, expect, it } from 'vitest';
import { drupalRemote } from '../src/index.js';
import { createRunLogHttp, RunLogSizeError } from '../src/run-log-http.js';

const RUN_UUID = '11111111-1111-4111-8111-111111111111';
const LOG = 'x'.repeat(8000);
const PHP_SIZE_WARNING =
  'POST Content-Length of 99999999 bytes exceeds the limit of 8388608 bytes';
const NGINX_413 =
  '<html>\r\n<head><title>413 Request Entity Too Large</title></head>\r\n<body>\r\n<center><h1>413 Request Entity Too Large</h1></center>\r\n<hr><center>nginx</center>\r\n</body>\r\n</html>\r\n';

interface Captured {
  method?: string;
  url?: string;
  headers: IncomingMessage['headers'];
  body: Buffer;
}

interface Harness {
  base: string;
  captured: Captured[];
  close: () => Promise<void>;
}

type Reply = { status: number; body: string } | 'drop';

let harness: Harness | undefined;

afterEach(async () => {
  await harness?.close();
  harness = undefined;
});

function jsonApiDoc(
  attributes: Record<string, unknown>,
  id = RUN_UUID,
): string {
  return JSON.stringify({
    data: { type: 'bb_run--bb_run', id, attributes },
  });
}

async function listen(
  reply: (req: IncomingMessage, body: Buffer) => Reply,
): Promise<Harness> {
  const captured: Captured[] = [];
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      captured.push({
        method: req.method,
        url: req.url,
        headers: req.headers,
        body,
      });
      const result = reply(req, body);
      if (result === 'drop') {
        req.socket.destroy();
        return;
      }
      res.writeHead(result.status, {
        'Content-Type': 'application/vnd.api+json',
      });
      res.end(result.body);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return {
    base: `http://127.0.0.1:${port}`,
    captured,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      ),
  };
}

function okRunDoc(id = RUN_UUID): string {
  return JSON.stringify({
    data: {
      type: 'bb_run--bb_run',
      id,
      attributes: { log: null },
    },
  });
}

function okCollection(id = RUN_UUID): string {
  return JSON.stringify({
    data: [
      {
        type: 'bb_run--bb_run',
        id,
        // A server that permits transcript storage for this run.
        attributes: { run_log_storage_allowed: true },
      },
    ],
  });
}

const passthroughPlugin = {
  id: 'passthrough',
  requiredModules: [],
  authProvider: {
    id: 'passthrough',
    default: true,
    capabilities: { login: false, logout: false, status: true },
    createAdapter() {
      return { apply: async (req: HttpRequest) => req };
    },
  },
};

describe('createRunLogHttp', () => {
  it('gzips a log-bearing PATCH and gunzip equals the original JSON', async () => {
    harness = await listen(() => ({ status: 200, body: okRunDoc() }));
    const originalJson = jsonApiDoc({ log: LOG });
    const http = createRunLogHttp(harness.base, '/jsonapi');
    await http.send({
      method: 'PATCH',
      url: `${harness.base}/jsonapi/bb_run/bb_run/${RUN_UUID}`,
      headers: { 'Content-Type': 'application/vnd.api+json' },
      body: originalJson,
    });
    expect(harness.captured).toHaveLength(1);
    const received = harness.captured[0];
    expect(received?.headers['content-encoding']).toBe('gzip');
    const receivedBytes = received?.body ?? Buffer.alloc(0);
    expect(gunzipSync(receivedBytes).toString('utf8')).toBe(originalJson);
    expect(receivedBytes.byteLength).toBeLessThanOrEqual(
      Buffer.byteLength(originalJson) / 2,
    );
    expect(receivedBytes[0]).toBe(0x1f);
    expect(receivedBytes[1]).toBe(0x8b);
  });

  it('gzips a nonempty error_log POST on a custom prefix', async () => {
    harness = await listen(() => ({ status: 200, body: okRunDoc() }));
    const originalJson = JSON.stringify({
      data: {
        type: 'bb_run--bb_run',
        attributes: { error_log: LOG },
      },
    });
    const http = createRunLogHttp(harness.base, '/api/jsonapi');
    await http.send({
      method: 'POST',
      url: `${harness.base}/api/jsonapi/bb_run/bb_run`,
      headers: { 'Content-Type': 'application/vnd.api+json' },
      body: originalJson,
    });
    const received = harness.captured[0];
    expect(received?.headers['content-encoding']).toBe('gzip');
    const receivedBytes = received?.body ?? Buffer.alloc(0);
    expect(gunzipSync(receivedBytes).toString('utf8')).toBe(originalJson);
    expect(receivedBytes.byteLength).toBeLessThanOrEqual(
      Buffer.byteLength(originalJson) / 2,
    );
  });

  it('forwards identity writes, other entities, GET, binary and already-encoded bodies', async () => {
    harness = await listen(() => ({ status: 200, body: '{"data":[]}' }));
    const http = createRunLogHttp(harness.base, '/jsonapi');
    const identity = jsonApiDoc({ closed: true });
    await http.send({
      method: 'PATCH',
      url: `${harness.base}/jsonapi/bb_run/bb_run/${RUN_UUID}`,
      headers: { 'Content-Type': 'application/vnd.api+json' },
      body: identity,
    });
    const ticket = JSON.stringify({
      data: {
        type: 'bb_ticket--bb_ticket',
        id: RUN_UUID,
        attributes: { log: LOG },
      },
    });
    await http.send({
      method: 'PATCH',
      url: `${harness.base}/jsonapi/bb_ticket/bb_ticket/${RUN_UUID}`,
      headers: { 'Content-Type': 'application/vnd.api+json' },
      body: ticket,
    });
    await http.send({
      method: 'GET',
      url: `${harness.base}/jsonapi/bb_run/bb_run/${RUN_UUID}`,
    });
    const binary = new Uint8Array([1, 2, 3, 4]);
    await http.send({
      method: 'POST',
      url: `${harness.base}/jsonapi/bb_run/bb_run`,
      body: binary,
    });
    const already = jsonApiDoc({ log: LOG });
    await http.send({
      method: 'PATCH',
      url: `${harness.base}/jsonapi/bb_run/bb_run/${RUN_UUID}`,
      headers: {
        'Content-Type': 'application/vnd.api+json',
        'Content-Encoding': 'gzip',
      },
      body: already,
    });
    expect(harness.captured).toHaveLength(5);
    expect(harness.captured[0]?.headers['content-encoding']).toBeUndefined();
    expect(harness.captured[0]?.body.toString('utf8')).toBe(identity);
    expect(harness.captured[1]?.headers['content-encoding']).toBeUndefined();
    expect(harness.captured[1]?.body.toString('utf8')).toBe(ticket);
    expect(harness.captured[2]?.method).toBe('GET');
    expect(harness.captured[2]?.body.byteLength).toBe(0);
    expect(Buffer.from(harness.captured[3]?.body ?? [])).toEqual(
      Buffer.from(binary),
    );
    expect(harness.captured[4]?.headers['content-encoding']).toBe('gzip');
    expect(harness.captured[4]?.body.toString('utf8')).toBe(already);
  });

  it('throws RunLogSizeError before sending when expanded JSON exceeds 64 MiB', async () => {
    harness = await listen(() => ({ status: 200, body: okRunDoc() }));
    const http = createRunLogHttp(harness.base, '/jsonapi');
    const huge = jsonApiDoc({ log: 'a'.repeat(64 * 1024 * 1024 + 1) });
    await expect(
      http.send({
        method: 'PATCH',
        url: `${harness.base}/jsonapi/bb_run/bb_run/${RUN_UUID}`,
        body: huge,
      }),
    ).rejects.toBeInstanceOf(RunLogSizeError);
    expect(harness.captured).toHaveLength(0);
  });

  it('throws RunLogSizeError for the PHP size warning even on HTTP 200', async () => {
    harness = await listen(() => ({
      status: 200,
      body: `<br />\n<b>Warning</b>: ${PHP_SIZE_WARNING} in Unknown on line 0`,
    }));
    const http = createRunLogHttp(harness.base, '/jsonapi');
    await expect(
      http.send({
        method: 'PATCH',
        url: `${harness.base}/jsonapi/bb_run/bb_run/${RUN_UUID}`,
        body: jsonApiDoc({ log: LOG }),
      }),
    ).rejects.toBeInstanceOf(RunLogSizeError);
  });

  it('throws RunLogSizeError for a plain nginx HTTP 413 on a run log write', async () => {
    harness = await listen(() => ({
      status: 413,
      body: NGINX_413,
    }));
    const http = createRunLogHttp(harness.base, '/jsonapi');
    await expect(
      http.send({
        method: 'PATCH',
        url: `${harness.base}/jsonapi/bb_run/bb_run/${RUN_UUID}`,
        body: jsonApiDoc({ log: LOG }),
      }),
    ).rejects.toBeInstanceOf(RunLogSizeError);
  });

  it('keeps an HTTP 413 on a non-run write as HttpError', async () => {
    harness = await listen(() => ({
      status: 413,
      body: NGINX_413,
    }));
    const http = createRunLogHttp(harness.base, '/jsonapi');
    const err = await http
      .send({
        method: 'PATCH',
        url: `${harness.base}/jsonapi/bb_ticket/bb_ticket/${RUN_UUID}`,
        body: jsonApiDoc({ title: 'x' }),
      })
      .then(
        () => null,
        (cause: unknown) => cause,
      );
    expect(err).toBeInstanceOf(HttpError);
    expect(err).not.toBeInstanceOf(RunLogSizeError);
    expect((err as HttpError).status).toBe(413);
  });

  it('does not treat generic HTML 400/403/415/422/500 as size errors', async () => {
    for (const status of [400, 403, 415, 422, 500]) {
      await harness?.close();
      harness = await listen(() => ({
        status,
        body: '<html>nope</html>',
      }));
      const http = createRunLogHttp(harness.base, '/jsonapi');
      const err = await http
        .send({
          method: 'PATCH',
          url: `${harness.base}/jsonapi/bb_run/bb_run/${RUN_UUID}`,
          body: jsonApiDoc({ log: LOG }),
        })
        .then(
          () => null,
          (cause: unknown) => cause,
        );
      expect(err).toBeInstanceOf(HttpError);
      expect(err).not.toBeInstanceOf(RunLogSizeError);
      expect((err as HttpError).status).toBe(status);
    }
  });

  it('throws RunLogSizeError when a 413 body is the PHP size warning', async () => {
    harness = await listen(() => ({ status: 413, body: PHP_SIZE_WARNING }));
    const http = createRunLogHttp(harness.base, '/jsonapi');
    await expect(
      http.send({
        method: 'PATCH',
        url: `${harness.base}/jsonapi/bb_run/bb_run/${RUN_UUID}`,
        body: jsonApiDoc({ log: LOG }),
      }),
    ).rejects.toBeInstanceOf(RunLogSizeError);
  });
});

describe('drupalRemote.createRemote gzip wiring', () => {
  it('finalizeRun, appendRunNote and markFailed gzip log-bearing PATCHes', async () => {
    harness = await listen((req) => {
      if (req.method === 'GET' && req.url?.startsWith('/_bakers-api/run/')) {
        return { status: 204, body: '' };
      }
      if (req.method === 'GET') {
        return { status: 200, body: okCollection() };
      }
      return { status: 200, body: okRunDoc() };
    });
    const remote = await drupalRemote().createRemote({
      site: { base_url: harness.base, jsonapi_prefix: '/jsonapi' },
      plugins: [passthroughPlugin],
    } as never);

    await remote.finalizeRun(RUN_UUID, LOG);
    assertGzippedLogPatch(harness.captured.at(-1), 'log', LOG);

    harness.captured.length = 0;
    await remote.appendRunNote(RUN_UUID, LOG);
    assertGzippedLogPatch(
      harness.captured.filter((row) => row.method === 'PATCH').at(-1),
      'log',
      LOG,
    );

    harness.captured.length = 0;
    await remote.markFailed(RUN_UUID, LOG);
    assertGzippedLogPatch(harness.captured.at(-1), 'error_log', LOG);
  });
});

const METRICS = {
  tokens: 12,
  duration_s: 3,
  agent_turns: 1,
  tool_calls: 2,
  user_prompts: 1,
  user_prompt_words: 4,
  harness: 'claude',
};

function patches(rows: Captured[]): Captured[] {
  return rows.filter((row) => row.method === 'PATCH');
}

function decodePatch(received: Captured | undefined): {
  attributes: Record<string, unknown>;
  encoding: string | undefined;
} {
  expect(received?.method).toBe('PATCH');
  const encoding = received?.headers['content-encoding'];
  const raw = received?.body ?? Buffer.alloc(0);
  const json =
    encoding === 'gzip'
      ? gunzipSync(raw).toString('utf8')
      : raw.toString('utf8');
  return {
    attributes: JSON.parse(json).data.attributes as Record<string, unknown>,
    encoding,
  };
}

function assertOmissionFallback(received: Captured | undefined): void {
  const fallback = decodePatch(received);
  expect(fallback.encoding).toBeUndefined();
  expect(fallback.attributes).toMatchObject({
    closed: true,
    log_upload_omitted: true,
  });
  expect(fallback.attributes).not.toHaveProperty('log');
  expect(fallback.attributes).not.toHaveProperty('error_log');
}

async function liveRemote() {
  return drupalRemote().createRemote({
    site: { base_url: harness!.base, jsonapi_prefix: '/jsonapi' },
    plugins: [passthroughPlugin],
  } as never);
}

describe('finalizeRun omission close', () => {
  it('falls back on a plain nginx HTTP 413 with two writes and no log in the fallback', async () => {
    harness = await listen((req) => {
      if (
        req.method === 'PATCH' &&
        req.headers['content-encoding'] === 'gzip'
      ) {
        return { status: 413, body: NGINX_413 };
      }
      return { status: 200, body: okRunDoc() };
    });
    const remote = await liveRemote();
    await remote.finalizeRun(RUN_UUID, LOG, METRICS);
    const sent = patches(harness.captured);
    expect(sent).toHaveLength(2);
    const original = decodePatch(sent[0]);
    expect(original.encoding).toBe('gzip');
    expect(original.attributes.log).toBe(LOG);
    assertOmissionFallback(sent[1]);
    expect(decodePatch(sent[1]).attributes).toMatchObject({
      closed: true,
      closed_date: original.attributes.closed_date,
      ...METRICS,
    });
  });

  it('falls back on a 413 PHP size warning with two writes and no log in the fallback', async () => {
    harness = await listen((req) => {
      if (
        req.method === 'PATCH' &&
        req.headers['content-encoding'] === 'gzip'
      ) {
        return { status: 413, body: PHP_SIZE_WARNING };
      }
      return { status: 200, body: okRunDoc() };
    });
    const remote = await liveRemote();
    await remote.finalizeRun(RUN_UUID, LOG, METRICS);
    const sent = patches(harness.captured);
    expect(sent).toHaveLength(2);
    const original = decodePatch(sent[0]);
    expect(original.encoding).toBe('gzip');
    expect(original.attributes.log).toBe(LOG);
    expect(original.attributes).toMatchObject({
      closed: true,
      ...METRICS,
    });
    assertOmissionFallback(sent[1]);
    const fallback = decodePatch(sent[1]);
    expect(fallback.attributes).toMatchObject({
      closed: true,
      closed_date: original.attributes.closed_date,
      ...METRICS,
    });
  });

  it('falls back on the exact PHP warning even when the status is 200', async () => {
    harness = await listen((req) => {
      if (
        req.method === 'PATCH' &&
        req.headers['content-encoding'] === 'gzip'
      ) {
        return {
          status: 200,
          body: `<br />\n<b>Warning</b>: ${PHP_SIZE_WARNING} in Unknown on line 0`,
        };
      }
      return { status: 200, body: okRunDoc() };
    });
    const remote = await liveRemote();
    await remote.finalizeRun(RUN_UUID, LOG, METRICS);
    expect(patches(harness.captured)).toHaveLength(2);
    assertOmissionFallback(patches(harness.captured)[1]);
  });

  it('falls back on the local 64 MiB ceiling without sending the original log', async () => {
    harness = await listen(() => ({ status: 200, body: okRunDoc() }));
    const remote = await liveRemote();
    await remote.finalizeRun(
      RUN_UUID,
      'a'.repeat(64 * 1024 * 1024 + 1),
      METRICS,
    );
    const sent = patches(harness.captured);
    expect(sent).toHaveLength(1);
    assertOmissionFallback(sent[0]);
    expect(decodePatch(sent[0]).attributes).toMatchObject(METRICS);
  });

  it('never omits for timeout, generic HTML, 403, 415 or disk-related 500', async () => {
    const cases: Array<{
      name: string;
      reply: Reply;
    }> = [
      { name: 'timeout', reply: 'drop' },
      {
        name: 'generic HTML',
        reply: { status: 200, body: '<html>upstream error</html>' },
      },
      { name: '403', reply: { status: 403, body: '<html>forbidden</html>' } },
      { name: '415', reply: { status: 415, body: '<html>unsupported</html>' } },
      {
        name: 'disk 500',
        reply: { status: 500, body: 'No space left on device' },
      },
    ];
    for (const { reply } of cases) {
      await harness?.close();
      harness = await listen(() => reply);
      const remote = await liveRemote();
      await expect(
        remote.finalizeRun(RUN_UUID, LOG, METRICS),
      ).rejects.toThrow();
      expect(patches(harness.captured)).toHaveLength(1);
      expect(
        harness.captured.filter((row) => row.method === 'GET'),
      ).toHaveLength(0);
    }
  });

  it('reconciles a lost fallback by reading closed status and does not write again', async () => {
    harness = await listen((req) => {
      if (
        req.method === 'PATCH' &&
        req.headers['content-encoding'] === 'gzip'
      ) {
        return { status: 413, body: PHP_SIZE_WARNING };
      }
      if (req.method === 'PATCH') {
        return 'drop';
      }
      return { status: 200, body: jsonApiDoc({ closed: true }) };
    });
    const remote = await liveRemote();
    await remote.finalizeRun(RUN_UUID, LOG, METRICS);
    expect(patches(harness.captured)).toHaveLength(2);
    assertOmissionFallback(patches(harness.captured)[1]);
    const gets = harness.captured.filter((row) => row.method === 'GET');
    expect(gets).toHaveLength(1);
    expect(gets[0]?.url).toContain(`/bb_run/bb_run/${RUN_UUID}`);
  });

  it('does not send another PATCH when a lost fallback left the run unclosed', async () => {
    harness = await listen((req) => {
      if (
        req.method === 'PATCH' &&
        req.headers['content-encoding'] === 'gzip'
      ) {
        return { status: 413, body: PHP_SIZE_WARNING };
      }
      if (req.method === 'PATCH') {
        return 'drop';
      }
      return { status: 200, body: jsonApiDoc({ closed: false }) };
    });
    const remote = await liveRemote();
    await expect(remote.finalizeRun(RUN_UUID, LOG, METRICS)).rejects.toThrow();
    expect(patches(harness.captured)).toHaveLength(2);
    expect(harness.captured.filter((row) => row.method === 'GET')).toHaveLength(
      1,
    );
  });
});

function assertGzippedLogPatch(
  received: Captured | undefined,
  field: 'log' | 'error_log',
  value: string,
): void {
  expect(received?.method).toBe('PATCH');
  expect(received?.headers['content-encoding']).toBe('gzip');
  const receivedBytes = received?.body ?? Buffer.alloc(0);
  const originalJson = gunzipSync(receivedBytes).toString('utf8');
  expect(originalJson).toBe(
    JSON.stringify({
      data: {
        type: 'bb_run--bb_run',
        id: RUN_UUID,
        attributes: JSON.parse(originalJson).data.attributes,
      },
    }),
  );
  expect(JSON.parse(originalJson).data.attributes[field]).toBe(value);
  expect(receivedBytes.byteLength).toBeLessThanOrEqual(
    Buffer.byteLength(originalJson) / 2,
  );
}
