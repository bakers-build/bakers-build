/**
 * agent-proxy — see what Claude Code actually sends the model.
 *
 * Based on Matt Pocock, https://gist.github.com/mattpocock/5b3d76ea21f5f698aefded47a9cea3b1
 * revision e142f08fd2d1de0adc914355112d6f2b56386959 (updated 2026-09-23), fetched 2026-09-28.
 *
 * A zero-dependency logging proxy for Claude Code. It sits between the CLI and
 * the Anthropic API, forwards every request untouched (auth header and all),
 * streams the response straight back so the CLI is unaffected, and for each
 * request writes a readable Markdown document — led by a ranked table of what
 * is eating your context.
 *
 * Run:   BAKERS_TICKET_IDENTIFIER=BB-569 node measure/agent-proxy.mjs
 * Point Claude Code at it:
 *   ANTHROPIC_BASE_URL=http://127.0.0.1:8787 claude
 *
 * Measurement only. Zero runtime dependencies — Node built-ins only. Requires Node 18+.
 */

import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const DEFAULT_PORT = 8787;
const LISTEN_HOST = '127.0.0.1';
const UPSTREAM = {
  hostname: 'api.anthropic.com',
  port: 443,
  protocol: 'https',
};
const TICKET_ID = /^[A-Z][A-Z0-9]*-\d+$/;
const USAGE_KEYS = [
  'input_tokens',
  'cache_read_input_tokens',
  'cache_creation_input_tokens',
];
const REDACT = new Set(['authorization', 'x-api-key', 'api-key']);

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Rough token estimate for display. Real input tokens come from the response
 * usage; this is only for ranking the request before the reply arrives. */
const estTokens = (bytes) => Math.round(bytes / 4);

/** count_tokens calls send content but get back only a number, never a reply.
 * A single turn fires many as housekeeping — pure noise here, so skip them. */
const isTokenCount = (reqPath) => reqPath.includes('count_tokens');

/** Strip hop-by-hop and encoding headers so the captured response is readable,
 * recompute content-length, and pass auth through untouched so the real request
 * still authenticates. */
function forwardHeaders(headers, body) {
  const out = { ...headers };
  delete out.host;
  delete out.connection;
  delete out['accept-encoding']; // force identity so we can read the stream
  delete out['transfer-encoding'];
  delete out['content-length'];
  if (body.length > 0) out['content-length'] = String(body.length);
  return out;
}

export function createLogBasename() {
  const stamp = new Date()
    .toISOString()
    .replace(/:/g, '-')
    .replace('.', '-')
    .replace('Z', '');
  return `${stamp}_${randomUUID()}_anthropic`;
}

export function resolveLogDirectory({
  cwd = process.cwd(),
  ticketIdentifier,
  subdir,
} = {}) {
  const id = ticketIdentifier ?? process.env.BAKERS_TICKET_IDENTIFIER;
  if (typeof id !== 'string' || !TICKET_ID.test(id)) {
    throw new Error(
      '[agent-proxy] BAKERS_TICKET_IDENTIFIER is required (ticket identifier such as BB-569, not a UUID)',
    );
  }
  const root = path.resolve(cwd, 'assets-ai', id, 'node');
  if (subdir == null || subdir === '') return root;
  if (path.isAbsolute(subdir)) {
    throw new Error(
      '[agent-proxy] log subdir must be a relative path within the ticket node directory',
    );
  }
  const resolved = path.resolve(root, subdir);
  const rel = path.relative(root, resolved);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(
      '[agent-proxy] log subdir must stay within the ticket node directory',
    );
  }
  return resolved;
}

function parsePort(value, { allowEphemeral = false } = {}) {
  const port = typeof value === 'number' ? value : Number(value);
  if (allowEphemeral && port === 0) return 0;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`[agent-proxy] invalid port: ${value}`);
  }
  return port;
}

function firstUserMessage(reqJson) {
  if (!Array.isArray(reqJson?.messages)) return undefined;
  return reqJson.messages.find((m) => m?.role === 'user');
}

function threeUsage(usage) {
  if (!usage || typeof usage !== 'object') return null;
  const present = USAGE_KEYS.some(
    (key) => Object.hasOwn(usage, key) && usage[key] != null,
  );
  if (!present) return null;
  const out = {};
  for (const key of USAGE_KEYS) {
    out[key] =
      Object.hasOwn(usage, key) && usage[key] != null ? usage[key] : null;
  }
  return out;
}

function mergeUsage(current, incoming) {
  if (!incoming) return current;
  const next = { ...(current ?? {}) };
  for (const key of USAGE_KEYS) {
    if (Object.hasOwn(incoming, key) && incoming[key] != null) {
      next[key] = incoming[key];
    }
  }
  return next;
}

// ---------------------------------------------------------------------------
// The audit: rank what's in the request
// ---------------------------------------------------------------------------

/** Measure every removable region of the request and rank the tools by size.
 * This is the whole point of the proxy — the numbers you cut against. */
export function auditRequest(reqJson, usage = null) {
  const tools = Array.isArray(reqJson?.tools) ? reqJson.tools : [];
  const toolRows = tools
    .map((t) => {
      const bytes = Buffer.byteLength(JSON.stringify(t));
      return { name: t?.name ?? '(unnamed)', bytes, tokens: estTokens(bytes) };
    })
    .sort((a, b) => b.bytes - a.bytes);

  const toolsBytes = toolRows.reduce((n, r) => n + r.bytes, 0);
  const systemBytes = reqJson?.system
    ? Buffer.byteLength(JSON.stringify(reqJson.system))
    : 0;
  const firstUser = firstUserMessage(reqJson);
  const firstUserBytes = firstUser
    ? Buffer.byteLength(JSON.stringify(firstUser))
    : 0;
  const totalBytes = Buffer.byteLength(JSON.stringify(reqJson ?? {}));

  return {
    toolRows,
    toolCount: toolRows.length,
    toolsBytes,
    systemBytes,
    firstUserBytes,
    totalBytes,
    usage: threeUsage(usage),
  };
}

/** The ranked table, as Markdown. The hero of the whole document. */
function renderAudit(a) {
  const pct = (b) =>
    a.totalBytes ? ((b / a.totalBytes) * 100).toFixed(1) : '0.0';
  const rows = a.toolRows
    .map(
      (r) =>
        `| ${r.name} | ${r.bytes.toLocaleString()} | ~${r.tokens.toLocaleString()} | ${pct(r.bytes)}% |`,
    )
    .join('\n');
  const usageLines = a.usage
    ? [
        `- **input_tokens**: ${a.usage.input_tokens}`,
        `- **cache_read_input_tokens**: ${a.usage.cache_read_input_tokens}`,
        `- **cache_creation_input_tokens**: ${a.usage.cache_creation_input_tokens}`,
      ]
    : ['- **usage**: unknown'];

  return [
    '<audit>',
    '',
    ...usageLines,
    '',
    `- **tools**: ${a.toolCount} definitions, ${a.toolsBytes.toLocaleString()} bytes (~${estTokens(a.toolsBytes).toLocaleString()} tokens)`,
    `- **system prompt**: ${a.systemBytes.toLocaleString()} bytes (~${estTokens(a.systemBytes).toLocaleString()} tokens)`,
    `- **first user message**: ${a.firstUserBytes.toLocaleString()} bytes (~${estTokens(a.firstUserBytes).toLocaleString()} tokens)`,
    `- **total request**: ${a.totalBytes.toLocaleString()} bytes`,
    '',
    '**Tools, ranked by size — this is your cut list:**',
    '',
    '| tool | bytes | ~tokens | % of request |',
    '| --- | --: | --: | --: |',
    rows,
    '',
    '</audit>',
  ].join('\n');
}

/** The same ranking, compact, for the terminal — so you see the bloat live. */
function printAudit(a, base, logDir) {
  const top = a.toolRows.slice(0, 12);
  const w = Math.max(4, ...top.map((r) => r.name.length));
  const usage = a.usage
    ? ` · in ${a.usage.input_tokens} / cache-read ${a.usage.cache_read_input_tokens} / cache-create ${a.usage.cache_creation_input_tokens}`
    : '';
  console.log(
    `\n[agent-proxy] ${a.toolCount} tools · ${a.toolsBytes.toLocaleString()} tool bytes · first user ${a.firstUserBytes.toLocaleString()} B${usage}`,
  );
  for (const r of top) {
    console.log(
      `  ${r.name.padEnd(w)}  ${String(r.bytes).padStart(7)} B  ~${r.tokens} tok`,
    );
  }
  if (a.toolRows.length > top.length)
    console.log(`  … ${a.toolRows.length - top.length} more`);
  console.log(`  ${path.join(logDir, `${base}.md`)}\n`);
}

// ---------------------------------------------------------------------------
// Readable Markdown render (Anthropic /messages only)
// ---------------------------------------------------------------------------

const fenceJson = (v) => `\`\`\`json\n${JSON.stringify(v, null, 2)}\n\`\`\``;
const fence = (t, lang = '') => `\`\`\`${lang}\n${t}\n\`\`\``;

function blockText(b) {
  if (typeof b === 'string') return b;
  if (b?.type === 'text' && typeof b.text === 'string') return b.text;
  return '';
}

function renderSystem(system) {
  if (typeof system === 'string') return system;
  if (Array.isArray(system)) {
    return system
      .map(
        (b) =>
          blockText(b) +
          (b?.cache_control ? '\n\n<!-- cache_control breakpoint -->' : ''),
      )
      .join('\n\n');
  }
  return fenceJson(system);
}

function renderTools(tools) {
  const rendered = tools.map((t) => {
    const lines = [`### ${t.name ?? '(unnamed tool)'}`, ''];
    if (t.description) lines.push(t.description, '');
    if (t.input_schema) lines.push(fenceJson(t.input_schema));
    return lines.join('\n');
  });
  return ['<tools>', '', rendered.join('\n\n'), '', '</tools>'].join('\n');
}

function imagePlaceholder(b) {
  const src = b.source ?? {};
  const bytes = typeof src.data === 'string' ? src.data.length : 0;
  return `\`[image: ${src.media_type ?? 'unknown'}, ${bytes} base64 chars — full data in .request.txt]\``;
}

function renderContent(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return fenceJson(content);
  return content
    .map((b) => {
      switch (b?.type) {
        case 'text':
          return b.text ?? '';
        case 'tool_use':
          return [
            `<tool-use name="${b.name}" id="${b.id ?? ''}">`,
            '',
            fenceJson(b.input ?? {}),
            '',
            '</tool-use>',
          ].join('\n');
        case 'tool_result': {
          const inner =
            typeof b.content === 'string'
              ? b.content
              : Array.isArray(b.content)
                ? b.content
                    .map((x) =>
                      x?.type === 'image'
                        ? imagePlaceholder(x)
                        : blockText(x) || fenceJson(x),
                    )
                    .join('\n\n')
                : fenceJson(b.content);
          return [
            `<tool-result tool-use-id="${b.tool_use_id ?? ''}" is-error="${!!b.is_error}">`,
            '',
            inner,
            '',
            '</tool-result>',
          ].join('\n');
        }
        case 'image':
          return imagePlaceholder(b);
        case 'thinking':
          return ['<thinking>', '', b.thinking ?? '', '', '</thinking>'].join(
            '\n',
          );
        default:
          return fenceJson(b);
      }
    })
    .join('\n\n');
}

function renderMessages(messages) {
  if (!Array.isArray(messages)) return '<messages></messages>';
  const rendered = messages.map((m, i) =>
    [
      `<message index="${i + 1}" role="${m.role ?? 'unknown'}">`,
      '',
      renderContent(m.content),
      '',
      '</message>',
    ].join('\n'),
  );
  return ['<messages>', '', rendered.join('\n\n'), '', '</messages>'].join(
    '\n',
  );
}

function decodeSse(raw) {
  const events = [];
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^data:\s?(.*)$/);
    if (!m || m[1] === '[DONE]' || m[1].trim() === '') continue;
    try {
      events.push(JSON.parse(m[1]));
    } catch {
      /* skip */
    }
  }
  const blocks = {};
  let stopReason;
  let usage;
  for (const ev of events) {
    if (ev.type === 'content_block_start') {
      blocks[ev.index] = {
        type: ev.content_block?.type ?? 'text',
        text: '',
        name: ev.content_block?.name,
        id: ev.content_block?.id,
      };
    } else if (ev.type === 'content_block_delta' && blocks[ev.index]) {
      const d = ev.delta ?? {};
      blocks[ev.index].text += d.text ?? d.partial_json ?? d.thinking ?? '';
    } else if (ev.type === 'message_start' && ev.message?.usage) {
      usage = mergeUsage(usage, ev.message.usage);
    } else if (ev.type === 'message_delta') {
      if (ev.delta?.stop_reason) stopReason = ev.delta.stop_reason;
      if (ev.usage) usage = mergeUsage(usage, ev.usage);
    }
  }
  const parts = [];
  if (stopReason) parts.push(`- **stop reason**: ${stopReason}`);
  if (usage) {
    const fields = threeUsage(usage);
    if (fields) parts.push(`- **usage**: ${JSON.stringify(fields)}`, '');
  }
  for (const i of Object.keys(blocks)
    .map(Number)
    .sort((a, b) => a - b)) {
    const b = blocks[i];
    if (b.type === 'text')
      parts.push(
        ['<assistant-text>', '', b.text, '', '</assistant-text>'].join('\n'),
      );
    else if (b.type === 'thinking')
      parts.push(['<thinking>', '', b.text, '', '</thinking>'].join('\n'));
    else if (b.type === 'tool_use')
      parts.push(
        [
          `<tool-use name="${b.name}" id="${b.id ?? ''}">`,
          '',
          fence(b.text || '{}', 'json'),
          '',
          '</tool-use>',
        ].join('\n'),
      );
  }
  return {
    markdown: parts.length ? parts.join('\n\n') : fence(raw),
    usage: threeUsage(usage),
  };
}

function decodeJsonMessage(raw) {
  const json = JSON.parse(raw.trim());
  const text = Array.isArray(json.content)
    ? json.content
        .map((b) => (b?.type === 'text' ? (b.text ?? '') : ''))
        .join('')
    : '';
  const markdown = text
    ? ['<assistant-text>', '', text, '', '</assistant-text>'].join('\n')
    : fenceJson(json);
  return { markdown, usage: threeUsage(json.usage) };
}

/** Reassemble the streamed SSE response, or a non-streaming JSON body, and
 * report the three usage fields independently. Missing usage stays unknown. */
export function decodeResponse(raw) {
  const trimmed = String(raw ?? '').trim();
  if (trimmed.startsWith('{')) {
    try {
      return decodeJsonMessage(trimmed);
    } catch {
      // fall through to SSE
    }
  }
  return decodeSse(raw);
}

function renderMarkdown(c, audit, responseMd) {
  const headers = Object.entries(c.headers).map(
    ([k, v]) =>
      `${k}: ${REDACT.has(k.toLowerCase()) ? '[REDACTED]' : Array.isArray(v) ? v.join(', ') : (v ?? '')}`,
  );
  const req = c.reqJson;
  const parts = [
    [
      '<meta>',
      '',
      `- **timestamp**: ${c.timestamp}`,
      `- **model**: ${req?.model ?? 'unknown'}`,
      `- **endpoint**: ${c.method} ${c.path}`,
      `- **upstream status**: ${c.statusCode}`,
      '',
      '</meta>',
    ].join('\n'),
    renderAudit(audit),
    ['<headers>', '', '```', ...headers, '```', '', '</headers>'].join('\n'),
  ];
  if (req?.system != null)
    parts.push(
      [
        '<system-prompt>',
        '',
        renderSystem(req.system),
        '',
        '</system-prompt>',
      ].join('\n'),
    );
  if (Array.isArray(req?.tools) && req.tools.length)
    parts.push(renderTools(req.tools));
  parts.push(renderMessages(req?.messages));
  parts.push(`<response>\n\n${responseMd}\n\n</response>`);
  return `${parts.join('\n\n')}\n`;
}

function writeExclusiveLogs(logDir, requestText, markdown) {
  fs.mkdirSync(logDir, { recursive: true });
  // A UUID basename opened with `wx`: a collision throws instead of overwriting.
  const base = createLogBasename();
  const mdPath = path.join(logDir, `${base}.md`);
  const mdFd = fs.openSync(mdPath, 'wx');
  try {
    fs.writeFileSync(path.join(logDir, `${base}.request.txt`), requestText, {
      flag: 'wx',
    });
    fs.writeFileSync(mdFd, markdown);
  } catch (err) {
    fs.unlinkSync(mdPath);
    throw err;
  } finally {
    fs.closeSync(mdFd);
  }
  return base;
}

/** Errors go to stderr, or — quiet, inside a terminal UI — to a file beside the logs. */
function report(options, logDir, message) {
  if (!options.quiet) {
    console.error(message);
    return;
  }
  try {
    fs.mkdirSync(logDir, { recursive: true });
    fs.appendFileSync(
      path.join(logDir, 'agent-proxy.errors.log'),
      `${new Date().toISOString()} ${message}\n`,
    );
  } catch {
    /* nowhere left to report */
  }
}

/** Full conversations must never be committable: refuse a log root git would track. */
function assertIgnored(logDirectory, cwd) {
  const probe = spawnSync(
    'git',
    ['check-ignore', '-q', path.join(logDirectory, 'probe.md')],
    { cwd },
  );
  if (probe.status !== 0) {
    throw new Error(
      `[agent-proxy] log directory is not ignored by git: ${logDirectory}`,
    );
  }
}

function handle(req, res, options) {
  const reqPath = req.url ?? '/';
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    const timestamp = new Date().toISOString();
    const logDir = options.logDirectory;
    const upstream = options.upstream ?? UPSTREAM;
    const transport = upstream.protocol === 'http' ? http : https;

    const upReq = transport.request(
      {
        hostname: upstream.hostname,
        port: upstream.port,
        path: reqPath,
        method: req.method,
        headers: forwardHeaders(req.headers, body),
      },
      (up) => {
        res.writeHead(up.statusCode ?? 502, up.headers);
        const respChunks = [];
        let failed = false;
        up.on('error', () => {
          failed = true;
        });
        up.on('aborted', () => {
          failed = true;
        });
        up.on('data', (c) => {
          respChunks.push(c);
          res.write(c);
        });
        // `close` fires after `end` and after an aborted stream, so the client
        // response always ends; only a completed stream is logged.
        let completed = false;
        up.on('end', () => {
          completed = !failed;
        });
        up.on('close', () => {
          if (!res.writableEnded) res.end();
          // Body-less requests (model lists, GETs) carry no payload to measure.
          if (!completed || isTokenCount(reqPath) || body.length === 0) return;
          try {
            const reqJson = JSON.parse(body.toString('utf8'));
            const decoded = decodeResponse(
              Buffer.concat(respChunks).toString('utf8'),
            );
            const audit = auditRequest(reqJson, decoded.usage);
            const base = writeExclusiveLogs(
              logDir,
              body.toString('utf8'),
              renderMarkdown(
                {
                  reqJson,
                  timestamp,
                  method: req.method ?? 'POST',
                  path: reqPath,
                  statusCode: up.statusCode ?? 0,
                  headers: req.headers,
                },
                audit,
                decoded.markdown,
              ),
            );
            if (!options.quiet) printAudit(audit, base, logDir);
          } catch (err) {
            report(
              options,
              logDir,
              `[agent-proxy] log write failed: ${err.message}`,
            );
          }
        });
      },
    );
    res.on('close', () => {
      if (!res.writableFinished) upReq.destroy();
    });
    upReq.on('error', (err) => {
      report(options, logDir, `[agent-proxy] upstream error: ${err.message}`);
      if (!res.headersSent)
        res.writeHead(502, { 'content-type': 'application/json' });
      if (!res.writableEnded)
        res.end(
          JSON.stringify({
            error: `agent-proxy upstream error: ${err.message}`,
          }),
        );
    });
    if (body.length > 0) upReq.write(body);
    upReq.end();
  });
}

export function startServer(options = {}) {
  return new Promise((resolve, reject) => {
    let port;
    let logDirectory;
    try {
      port = parsePort(options.port ?? process.env.PORT ?? DEFAULT_PORT, {
        allowEphemeral: options.port === 0,
      });
      logDirectory =
        options.logDirectory ??
        resolveLogDirectory({
          cwd: options.cwd,
          ticketIdentifier: options.ticketIdentifier,
          subdir: options.logSubdir ?? process.env.BB_PROXY_LOG_SUBDIR,
        });
      if (!options.logDirectory)
        assertIgnored(logDirectory, options.cwd ?? process.cwd());
      if (
        path.resolve(logDirectory).startsWith(path.resolve(HERE) + path.sep) ||
        path.resolve(logDirectory) === path.resolve(HERE)
      ) {
        throw new Error(
          '[agent-proxy] refusing to log beside the installed script',
        );
      }
    } catch (err) {
      reject(err);
      return;
    }
    const server = http.createServer((req, res) =>
      handle(req, res, { ...options, logDirectory }),
    );
    server.on('error', reject);
    server.listen(port, LISTEN_HOST, () => {
      resolve({
        server,
        address: server.address(),
        logDirectory,
        close: () =>
          new Promise((done, fail) => {
            server.close((err) => (err ? fail(err) : done()));
            server.closeAllConnections();
          }),
      });
    });
  });
}

const isMain =
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  startServer()
    .then((started) => {
      const { port } = started.address;
      console.log(`[agent-proxy] listening on http://${LISTEN_HOST}:${port}`);
      console.log(`[agent-proxy] logs: ${started.logDirectory}`);
      console.log(
        `[agent-proxy] point Claude Code at it:  ANTHROPIC_BASE_URL=http://${LISTEN_HOST}:${port} claude`,
      );
    })
    .catch((err) => {
      console.error(err.message);
      process.exit(1);
    });
}
