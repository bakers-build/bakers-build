import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  auditRequest,
  decodeResponse,
  resolveLogDirectory,
  startServer,
} from './agent-proxy.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const tmpRoots = [];

after(() => {
  for (const dir of tmpRoots) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function tmpDir(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `bb-569-${name}-`));
  tmpRoots.push(dir);
  return dir;
}

function sampleRequest(overrides = {}) {
  return {
    model: 'claude-opus-4',
    system: 'You are a helpful assistant.',
    tools: [
      {
        name: 'AskUserQuestion',
        description: 'ask',
        input_schema: { type: 'object' },
      },
      {
        name: 'Bash',
        description: 'run a command',
        input_schema: {
          type: 'object',
          properties: { command: { type: 'string' } },
        },
      },
    ],
    messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
    ...overrides,
  };
}

function sseMessage({
  input_tokens = 11,
  cache_read_input_tokens = 23,
  cache_creation_input_tokens = 7,
  text = 'ok',
} = {}) {
  return [
    'event: message_start',
    `data: ${JSON.stringify({
      type: 'message_start',
      message: {
        usage: {
          input_tokens,
          cache_read_input_tokens,
          cache_creation_input_tokens,
          output_tokens: 0,
        },
      },
    })}`,
    '',
    'event: content_block_start',
    `data: ${JSON.stringify({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })}`,
    '',
    'event: content_block_delta',
    `data: ${JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } })}`,
    '',
    'event: message_delta',
    `data: ${JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 1 } })}`,
    '',
    'event: message_stop',
    'data: {"type":"message_stop"}',
    '',
  ].join('\n');
}

function jsonMessage(usage, text = 'ok') {
  return JSON.stringify({
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    content: [{ type: 'text', text }],
    usage,
  });
}

function startStub(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      resolve({
        server,
        port: server.address().port,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

async function post(
  port,
  { path: reqPath = '/v1/messages', body, headers = {} },
) {
  const payload = Buffer.isBuffer(body) ? body : Buffer.from(body);
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: reqPath,
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': String(payload.length),
          ...headers,
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks),
          });
        });
      },
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function withProxy(t, options, fn) {
  const logDirectory =
    options.logDirectory ?? path.join(tmpDir('logs'), 'node');
  const stub = await startStub(options.stub);
  const proxy = await startServer({
    port: 0,
    ticketIdentifier: 'BB-569',
    logDirectory,
    upstream: { hostname: '127.0.0.1', port: stub.port, protocol: 'http' },
    ...options.proxy,
  });
  t.after(async () => {
    await proxy.close();
    await stub.close();
  });
  return fn({ proxy, stub, logDirectory });
}

test('auditRequest reports first-user bytes as the serialized first user message', () => {
  const request = sampleRequest();
  const firstUser = request.messages.find((m) => m.role === 'user');
  const audit = auditRequest(request);
  assert.equal(
    audit.firstUserBytes,
    Buffer.byteLength(JSON.stringify(firstUser)),
  );
});

test('auditRequest reports zero first-user bytes when no user message exists, without throwing', () => {
  const request = sampleRequest({
    messages: [{ role: 'assistant', content: 'hi' }],
  });
  const audit = auditRequest(request);
  assert.equal(audit.firstUserBytes, 0);
});

test('auditRequest measures non-ASCII first-user text in UTF-8 bytes', () => {
  const request = sampleRequest({
    messages: [
      { role: 'user', content: [{ type: 'text', text: 'Größe — サイズ' }] },
    ],
  });
  const firstUser = request.messages.find((m) => m.role === 'user');
  const audit = auditRequest(request);
  assert.equal(
    audit.firstUserBytes,
    Buffer.byteLength(JSON.stringify(firstUser)),
  );
  assert.notEqual(audit.firstUserBytes, JSON.stringify(firstUser).length);
});

test('auditRequest ranks tools by serialized UTF-8 bytes', () => {
  const audit = auditRequest(sampleRequest());
  assert.ok(audit.toolRows.length >= 2);
  for (let i = 1; i < audit.toolRows.length; i += 1) {
    assert.ok(audit.toolRows[i - 1].bytes >= audit.toolRows[i].bytes);
  }
});

test('decodeResponse reports the three usage fields independently from SSE', () => {
  const decoded = decodeResponse(sseMessage());
  assert.deepEqual(decoded.usage, {
    input_tokens: 11,
    cache_read_input_tokens: 23,
    cache_creation_input_tokens: 7,
  });
});

test('decodeResponse keeps a supplied numeric zero and does not fabricate missing usage', () => {
  const zero = decodeResponse(
    sseMessage({
      input_tokens: 0,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    }),
  );
  assert.deepEqual(zero.usage, {
    input_tokens: 0,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
  });

  const missing = decodeResponse(
    'event: message_stop\ndata: {"type":"message_stop"}\n',
  );
  assert.equal(missing.usage, null);
});

test('decodeResponse does not double-count overlapping SSE usage updates', () => {
  const raw = [
    'event: message_start',
    'data: {"type":"message_start","message":{"usage":{"input_tokens":11,"cache_read_input_tokens":23,"cache_creation_input_tokens":7,"output_tokens":0}}}',
    '',
    'event: message_delta',
    'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"input_tokens":11,"output_tokens":4}}',
    '',
  ].join('\n');
  const decoded = decodeResponse(raw);
  assert.equal(decoded.usage.input_tokens, 11);
  assert.equal(decoded.usage.cache_read_input_tokens, 23);
  assert.equal(decoded.usage.cache_creation_input_tokens, 7);
});

test('decodeResponse reads usage from a non-streaming JSON body', () => {
  const decoded = decodeResponse(
    jsonMessage({
      input_tokens: 11,
      cache_read_input_tokens: 23,
      cache_creation_input_tokens: 7,
      output_tokens: 2,
    }),
  );
  assert.deepEqual(decoded.usage, {
    input_tokens: 11,
    cache_read_input_tokens: 23,
    cache_creation_input_tokens: 7,
  });
});

test('startServer refuses a default log directory that git does not ignore', async () => {
  const cwd = tmpDir('unignored');
  spawnSync('git', ['init', '-q'], { cwd });
  await assert.rejects(
    () => startServer({ port: 0, cwd, ticketIdentifier: 'BB-569' }),
    /not ignored by git/,
  );
  fs.writeFileSync(path.join(cwd, '.gitignore'), '/assets-ai/\n');
  const proxy = await startServer({
    port: 0,
    cwd,
    ticketIdentifier: 'BB-569',
  });
  await proxy.close();
});

test('resolveLogDirectory requires a ticket identifier, not a UUID, and rejects traversal', () => {
  const cwd = tmpDir('cwd');
  assert.throws(() => resolveLogDirectory({ cwd }), /BAKERS_TICKET_IDENTIFIER/);
  assert.throws(
    () =>
      resolveLogDirectory({
        cwd,
        ticketIdentifier: '22868b42-459a-4fc4-9f51-2ebc82ab3029',
      }),
    /BAKERS_TICKET_IDENTIFIER/,
  );
  assert.throws(
    () =>
      resolveLogDirectory({
        cwd,
        ticketIdentifier: 'BB-569',
        subdir: '../escape',
      }),
    /escape|subdir|within/i,
  );
  const resolved = resolveLogDirectory({
    cwd,
    ticketIdentifier: 'BB-569',
    subdir: 'baseline/qualification',
  });
  assert.equal(
    resolved,
    path.join(cwd, 'assets-ai', 'BB-569', 'node', 'baseline', 'qualification'),
  );
});

test('startServer listens on 127.0.0.1 only and rejects an invalid port', async (t) => {
  await withProxy(t, { stub: (_req, res) => res.end('{}') }, ({ proxy }) => {
    assert.equal(proxy.server.address().address, '127.0.0.1');
  });
  await assert.rejects(
    () =>
      startServer({
        port: 99999,
        ticketIdentifier: 'BB-569',
        logDirectory: tmpDir('p'),
      }),
    /port/i,
  );
  await assert.rejects(
    () =>
      startServer({
        port: 'abc',
        ticketIdentifier: 'BB-569',
        logDirectory: tmpDir('p'),
      }),
    /port/i,
  );
});

test('the proxy forwards request bytes and status unchanged', async (t) => {
  const originalBody = Buffer.from(JSON.stringify(sampleRequest()), 'utf8');
  const upstreamResponseBody = Buffer.from(sseMessage(), 'utf8');
  let upstreamBody;
  await withProxy(
    t,
    {
      stub: (req, res) => {
        const chunks = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => {
          upstreamBody = Buffer.concat(chunks);
          res.writeHead(200, { 'content-type': 'text/event-stream' });
          res.end(upstreamResponseBody);
        });
      },
    },
    async ({ proxy }) => {
      const client = await post(proxy.address.port, { body: originalBody });
      assert.deepEqual(upstreamBody, originalBody);
      assert.deepEqual(client.body, upstreamResponseBody);
      assert.equal(client.statusCode, 200);
    },
  );
});

test('concurrent requests get exclusive, unique log files', async (t) => {
  await withProxy(
    t,
    {
      stub: (_req, res) => {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.end(sseMessage());
      },
    },
    async ({ proxy, logDirectory }) => {
      const concurrentRequests = 8;
      const body = JSON.stringify(sampleRequest());
      await Promise.all(
        Array.from({ length: concurrentRequests }, () =>
          post(proxy.address.port, { body }),
        ),
      );
      const logNames = fs
        .readdirSync(logDirectory)
        .filter((name) => name.endsWith('.md'));
      assert.equal(new Set(logNames).size, concurrentRequests);
      assert.equal(logNames.length, concurrentRequests);
      for (const name of logNames) {
        assert.match(
          name,
          /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}/i,
        );
      }
    },
  );
});

test('count_tokens forwards without writing logs', async (t) => {
  await withProxy(
    t,
    {
      stub: (_req, res) => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{"input_tokens":4}');
      },
    },
    async ({ proxy, logDirectory }) => {
      const client = await post(proxy.address.port, {
        path: '/v1/messages/count_tokens',
        body: JSON.stringify(sampleRequest()),
      });
      assert.equal(client.statusCode, 200);
      const names = fs.existsSync(logDirectory)
        ? fs.readdirSync(logDirectory)
        : [];
      assert.equal(names.length, 0);
    },
  );
});

test('a request without a body forwards without a log or an error', async (t) => {
  await withProxy(
    t,
    {
      proxy: { quiet: true },
      stub: (_req, res) => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{"data":[]}');
      },
    },
    async ({ proxy, logDirectory }) => {
      const client = await post(proxy.address.port, {
        path: '/v1/models',
        body: '',
      });
      assert.equal(client.statusCode, 200);
      const names = fs.existsSync(logDirectory)
        ? fs.readdirSync(logDirectory)
        : [];
      assert.deepEqual(names, []);
    },
  );
});

test('Markdown logs redact credential headers', async (t) => {
  await withProxy(
    t,
    {
      stub: (_req, res) => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          jsonMessage({
            input_tokens: 11,
            cache_read_input_tokens: 23,
            cache_creation_input_tokens: 7,
          }),
        );
      },
    },
    async ({ proxy, logDirectory }) => {
      await post(proxy.address.port, {
        body: JSON.stringify(sampleRequest()),
        headers: {
          authorization: 'Bearer secret-token',
          'x-api-key': 'sk-secret',
        },
      });
      const mdName = fs
        .readdirSync(logDirectory)
        .find((name) => name.endsWith('.md'));
      const md = fs.readFileSync(path.join(logDirectory, mdName), 'utf8');
      assert.match(md, /\[REDACTED\]/);
      assert.doesNotMatch(md, /secret-token/);
      assert.doesNotMatch(md, /sk-secret/);
      assert.match(md, /first user/i);
      assert.match(md, /input_tokens/);
      assert.match(md, /cache_read_input_tokens/);
      assert.match(md, /cache_creation_input_tokens/);
    },
  );
});

test('a log-write failure does not corrupt a successful upstream response', async (t) => {
  const blocked = path.join(tmpDir('blocked'), 'not-a-dir');
  fs.writeFileSync(blocked, 'file');
  await withProxy(
    t,
    {
      proxy: { logDirectory: blocked },
      stub: (_req, res) => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          jsonMessage({
            input_tokens: 1,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
          }),
        );
      },
    },
    async ({ proxy }) => {
      const client = await post(proxy.address.port, {
        body: JSON.stringify(sampleRequest()),
      });
      assert.equal(client.statusCode, 200);
      assert.ok(client.body.length > 0);
    },
  );
});

test('an upstream interruption terminates the client response without a successful measurement log', async (t) => {
  await withProxy(
    t,
    {
      stub: (req, res) => {
        req.resume();
        req.on('end', () => {
          res.writeHead(200, { 'content-type': 'text/event-stream' });
          res.write('event: message_start\n');
          res.destroy();
        });
      },
    },
    async ({ proxy, logDirectory }) => {
      const client = await post(proxy.address.port, {
        body: JSON.stringify(sampleRequest()),
      }).catch((err) => err);
      assert.ok(client instanceof Error || client.statusCode !== undefined);
      const mdFiles = fs.existsSync(logDirectory)
        ? fs.readdirSync(logDirectory).filter((name) => name.endsWith('.md'))
        : [];
      assert.equal(mdFiles.length, 0);
    },
  );
});

test('importing the module does not listen', async () => {
  const child = spawn(
    process.execPath,
    [
      '-e',
      `import(${JSON.stringify(pathToFileURL(path.join(HERE, 'agent-proxy.mjs')).href)}).then(() => setTimeout(() => process.exit(0), 200))`,
    ],
    { stdio: 'ignore' },
  );
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('import hung, possible listen-on-import'));
    }, 3000);
    child.on('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`import child exited ${code}`));
    });
  });
});
