// Real-CLI contract boundary: literal argv through the checked-out bakers.build launcher against one
// disposable loopback JSON:API fixture. No shell, no PATH lookup, no tracker, no model.
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const repoRoot = realpathSync(join(here, '..', '..'));
const cliRoot = join(repoRoot, 'bakers-cli');
export const launcher = join(cliRoot, 'bin', 'bakers');
const guard = join(here, 'cli-origin-guard.cjs');
const basicToken = Buffer.from('contract-fixture:contract-fixture').toString('base64');
const sha256 = value => createHash('sha256').update(value).digest('hex');
const inside = path => !relative(repoRoot, path).startsWith('..');

const ticketType = 'bb_ticket--bb_ticket';
const commentType = 'bb_comment--bb_comment';
const labelType = 'bb_term--label';
// Synthetic jsonapi_schema resource-object documents shared with the simulator. They define this
// contract's fixture, not the live Drupal schema, whose freshness remains outside this boundary.
export const contractFixture = JSON.parse(readFileSync(join(here, 'contract-fixture.json'), 'utf8'));
const resourceSchemas = contractFixture.schemas;

/** Endpoint state for a simulator fixture: the same tickets, probe and label terms the simulator holds. */
export const endpointSeed = (simulation, faults = {}) => ({
  tickets: [simulation.ticket, simulation.prior_art, contractFixture.probe_ticket].filter(Boolean),
  terms: contractFixture.terms, faults,
});

/** Executable identity of the tested repository CLI; throws instead of falling back elsewhere. */
export function cliIdentity(launcherPath = launcher) {
  const git = args => spawnSync('git', ['-C', repoRoot, ...args], { encoding: 'utf8' });
  const commit = git(['rev-parse', 'HEAD']);
  const status = git(['status', '--porcelain']);
  if (commit.status !== 0 || status.status !== 0) throw new Error(`CLI_IDENTITY: git revision unavailable: ${commit.stderr}${status.stderr}`);
  const files = {
    launcher: launcherPath,
    host: join(cliRoot, 'host', 'dist', 'src', 'host.js'),
    addon_dropsh: join(cliRoot, 'addons', 'dropsh', 'dist', 'src', 'index.js'),
    addon_essentials: join(cliRoot, 'addons', 'essentials', 'dist', 'src', 'index.js'),
    addon_name_refs: join(cliRoot, 'addons', 'name-refs', 'dist', 'src', 'index.js'),
    addon_auth_basic: join(cliRoot, 'addons', 'auth-basic', 'dist', 'src', 'index.js'),
  };
  const packages = {};
  for (const [name, from] of [['dropsh', 'addons/dropsh'], ['@dropsh/plugin-jsonapi-schema', 'addons/essentials'],
    ['@dropsh/plugin-markdown', 'addons/essentials'], ['@bakers-build/addon-name-refs', 'addons/essentials']]) {
    const path = realpathSync(join(cliRoot, from, 'node_modules', name, 'package.json'));
    packages[name] = { path, version: JSON.parse(readFileSync(path, 'utf8')).version };
  }
  const hashes = {};
  for (const [name, path] of Object.entries(files)) {
    let real;
    try { real = realpathSync(path); }
    catch { throw new Error(`CLI_IDENTITY: missing build artifact ${path}; run cd bakers-cli && pnpm install && pnpm -r run build`); }
    hashes[name] = { path: real, sha256: sha256(readFileSync(real)) };
  }
  for (const entry of [...Object.values(hashes), ...Object.values(packages)]) {
    if (!inside(entry.path)) throw new Error(`CLI_IDENTITY: ${entry.path} resolves outside ${repoRoot}`);
  }
  return {
    repository: repoRoot, commit: commit.stdout.trim(), dirty: status.stdout.trim() !== '',
    runtime: { path: process.execPath, version: process.version },
    package_version: JSON.parse(readFileSync(join(cliRoot, 'host', 'package.json'), 'utf8')).version,
    files: hashes, packages,
  };
}

const clone = value => structuredClone(value);
const jsonapi = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/vnd.api+json' });
  res.end(body === undefined ? '' : JSON.stringify(body));
};
const resource = (type, record) => {
  const { id, relationships, ...attributes } = record;
  return { type, id, attributes, ...(relationships ? { relationships } : {}) };
};
const fieldOf = (record, path) => path.split('.').reduce((v, k) => v?.[k], record);
// The subset of Drupal filter semantics the selected skill searches use.
function matches(record, filters) {
  return filters.every(({ path, operator = '=', value }) => {
    const relation = record.relationships?.[path]?.data;
    const actual = relation ? relation.id : fieldOf(record, path);
    if (actual !== null && typeof actual === 'object') throw Object.assign(new Error(`Invalid nested filtering. The field \`${path}\` is not a filterable scalar.`), { status: 400 });
    if (operator === 'CONTAINS') return typeof actual === 'string' && actual.toLowerCase().includes(String(value).toLowerCase());
    if (operator === '=') return actual === value;
    throw new Error(`fixture endpoint does not model filter operator ${operator}`);
  });
}
function filtersFrom(query) {
  const grouped = {};
  for (const [key, value] of query) {
    // Both the short form filter[f][value|operator] and filter[id][condition][path|operator|value].
    const m = /^filter\[([^\]]+)\](?:\[(?:condition\]\[)?(path|operator|value)\])?(\[\])?$/.exec(key);
    if (!m) continue;
    const item = (grouped[m[1]] ??= { path: m[1] });
    item[m[2] ?? 'value'] = value;
  }
  return Object.values(grouped);
}

/**
 * One disposable endpoint per case. State is fixed synthetic data; faults are named and explicit.
 * Every request is recorded with raw bytes and decoded JSON; an unmodeled route fails the case.
 */
export async function startEndpoint(seed = {}) {
  const state = {
    tickets: Object.fromEntries((seed.tickets ?? []).map(t => [t.id, clone(t)])),
    comments: Object.fromEntries((seed.comments ?? []).map(c => [c.id, clone(c)])),
    terms: clone(seed.terms ?? []),
  };
  const faults = { ...seed.faults };
  const requests = [];
  const unknown = [];
  const server = createServer((req, res) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      const url = new URL(req.url, 'http://fixture.invalid');
      let decoded;
      try { decoded = raw ? JSON.parse(raw) : undefined; } catch { decoded = { unparseable: raw }; }
      const record = { method: req.method, path: url.pathname, query: [...url.searchParams], raw, json: decoded,
        authorization: req.headers.authorization === `Basic ${basicToken}` };
      requests.push(record);
      const reply = (status, body) => { record.status = status; record.response = body; jsonapi(res, status, body); };
      if (!record.authorization) return reply(401, { errors: [{ status: '401', detail: 'fixture credential required' }] });
      if (faults.redirect && url.pathname.startsWith('/jsonapi/bb_ticket/bb_ticket/')) {
        record.status = 302;
        res.writeHead(302, { Location: faults.redirect });
        return res.end();
      }
      const parts = url.pathname.replace(/^\/jsonapi\/?/, '').split('/').filter(Boolean);
      const [entity, bundle, id, schemaSuffix] = parts;
      const key = `${entity}/${bundle}`;
      if (!url.pathname.startsWith('/jsonapi/')) { unknown.push(record); return reply(404, { errors: [{ status: '404' }] }); }
      if (req.method === 'GET' && id === 'resource' && schemaSuffix === 'schema' && parts.length === 4) {
        if (faults.noSchema || !resourceSchemas[key]) return reply(404, { errors: [{ status: '404', detail: 'no schema route' }] });
        return reply(200, resourceSchemas[key]);
      }
      const store = key === 'bb_ticket/bb_ticket' ? state.tickets : key === 'bb_comment/bb_comment' ? state.comments : undefined;
      const type = key === 'bb_ticket/bb_ticket' ? ticketType : commentType;
      const search = (rows, rowType) => {
        try { return reply(200, { data: rows.filter(r => matches(r, filtersFrom(url.searchParams))).map(r => resource(rowType, r)), links: {} }); }
        catch (error) { if (error.status !== 400) throw error; return reply(400, { errors: [{ status: '400', detail: error.message }] }); }
      };
      if (key === 'bb_term/label' && req.method === 'GET' && parts.length === 2) return search(state.terms, labelType);
      if (!store) { unknown.push(record); return reply(404, { errors: [{ status: '404', detail: 'unmodeled fixture route' }] }); }
      if (req.method === 'GET' && parts.length === 2) return search(Object.values(store), type);
      if (req.method === 'GET' && parts.length === 3) {
        const stored = store[id];
        if (!stored) return reply(404, { errors: [{ status: '404', title: 'Not Found', detail: `The "${entity}" parameter was not converted for the path "/jsonapi/${key}/{entity}".` }] });
        // Like the simulator's server model, a ticket lists the comments that reference it.
        const found = type !== ticketType ? stored : { ...stored, relationships: { ...stored.relationships, comments: { data: Object.values(state.comments)
          .filter(c => c.relationships?.ticket_id?.data?.id === id).map(c => ({ type: commentType, id: c.id })) } } };
        const body = { data: resource(type, found) };
        const include = url.searchParams.get('include');
        if (include) {
          body.included = include.split(',').flatMap(name => [found.relationships?.[name]?.data ?? []].flat())
            .map(r => r.type === commentType ? state.comments[r.id] && resource(commentType, state.comments[r.id])
              : r.type === labelType ? state.terms.find(t => t.id === r.id) && resource(labelType, state.terms.find(t => t.id === r.id)) : undefined)
            .filter(Boolean);
        }
        return reply(200, body);
      }
      const document = decoded?.data;
      if (req.method === 'POST' && parts.length === 2) {
        // Server-assigned identity and defaults mirror the simulator's server model.
        const id = type === commentType ? `22222222-2222-4222-8222-${String(Object.keys(store).length + 1).padStart(12, '0')}` : '33333333-3333-4333-8333-333333333333';
        const defaults = type === ticketType ? { state: 'qualification', identifier: 'EVAL-30', changed: 'fixture-revision-1' } : {};
        const entry = { id, ...document.attributes, ...defaults, ...(document.relationships ? { relationships: document.relationships } : {}) };
        const apply = faults.lostResponse !== 'unapplied';
        if (apply) store[id] = entry;
        if (faults.lostResponse) { record.status = 'connection-closed'; record.applied = apply; return req.socket.destroy(); }
        return reply(201, { data: resource(type, entry) });
      }
      if (req.method === 'PATCH' && parts.length === 3) {
        const found = store[id];
        if (!found) return reply(404, { errors: [{ status: '404', title: 'Not Found' }] });
        if (faults.reject422 && document.attributes?.state !== undefined) return reply(422, { errors: [{ status: '422', title: 'Unprocessable Content', detail: faults.reject422 }] });
        Object.assign(found, document.attributes ?? {});
        if (document.relationships) found.relationships = { ...found.relationships, ...document.relationships };
        return reply(200, { data: resource(type, found) });
      }
      unknown.push(record);
      return reply(405, { errors: [{ status: '405' }] });
    });
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const origin = `http://127.0.0.1:${server.address().port}`;
  return {
    origin, state, requests, unknown, faults,
    close: () => new Promise(done => { server.closeAllConnections?.(); server.close(() => done()); }),
  };
}

/** Allowlisted environment; nothing from the parent process (credentials, selectors, NODE_OPTIONS) leaks. */
export function contractEnvironment(root, origin) {
  return { HOME: join(root, 'home'), TMPDIR: join(root, 'tmp'), LANG: 'C.UTF-8', NO_COLOR: '1',
    BB_CONTRACT_ALLOWED_ORIGIN: origin };
}

/**
 * Execute argv (beginning with bakers dropsh) through the absolute repository launcher, without a
 * shell. Runner-owned virtual files are materialized under the disposable root, keyed by the same
 * virtual path the simulator receives; argv references them as @<virtual path>.
 */
export async function runCli(argv, { origin, files = {}, timeoutMs = 30000 } = {}) {
  if (argv[0] !== 'bakers') throw new Error('CLI_CONTRACT: argv must begin with bakers');
  const root = mkdtempSync(join(tmpdir(), 'bakers-cli-contract-'));
  try {
    const work = join(root, 'work');
    for (const dir of ['home', 'tmp', join('work', '.bakers')]) mkdirSync(join(root, dir), { recursive: true });
    const auth = join(cliRoot, 'addons', 'auth-basic', 'dist', 'src', 'index.js');
    const essentials = join(cliRoot, 'addons', 'essentials', 'dist', 'src', 'index.js');
    writeFileSync(join(work, '.bakers', 'bakers.config.js'),
      `import basic from ${JSON.stringify(auth)};\nexport default { site: { base_url: ${JSON.stringify(origin)}, jsonapi_prefix: '/jsonapi' }, plugins: [{ plugin: ${JSON.stringify(essentials)} }, basic(${JSON.stringify(basicToken)})] };\n`);
    const materialized = argv.map(token => {
      for (const [virtual, content] of Object.entries(files)) {
        const at = token.indexOf(`@${virtual}`);
        if (at >= 0 && token.slice(at + 1) === virtual) {
          const path = join(root, 'files', virtual.replace(/^\/+/, ''));
          mkdirSync(dirname(path), { recursive: true });
          writeFileSync(path, content);
          return `${token.slice(0, at)}@${path}`;
        }
      }
      return token;
    });
    const child = spawn(process.execPath, ['--require', guard, launcher, ...materialized.slice(1)],
      { cwd: work, env: contractEnvironment(root, origin), shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    const out = [];
    const err = [];
    child.stdout.on('data', c => out.push(c));
    child.stderr.on('data', c => err.push(c));
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    const code = await new Promise(done => child.on('close', (status, signal) => done(signal ? `signal:${signal}` : status)));
    clearTimeout(timer);
    const stdout = Buffer.concat(out).toString('utf8').replaceAll(root, '<contract-root>');
    const stderr = Buffer.concat(err).toString('utf8').replaceAll(root, '<contract-root>');
    return { exit_code: code, stdout, stderr };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/** Run tool calls through the existing stdio MCP simulator and return its per-call results. */
export async function runSimulator(simulation, calls) {
  const root = mkdtempSync(join(tmpdir(), 'bakers-sim-contract-'));
  try {
    const fixture = join(root, 'fixture.json');
    writeFileSync(fixture, JSON.stringify({ simulation }));
    const requests = [{ jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2024-11-05' } },
      ...calls.map((call, i) => ({ jsonrpc: '2.0', id: i + 1, method: 'tools/call', params: call }))];
    const result = spawnSync('python3', ['-B', join(here, 'tool-server.py'), '--fixture', fixture, '--trace', join(root, 'trace.jsonl')],
      { input: `${requests.map(r => JSON.stringify(r)).join('\n')}\n`, encoding: 'utf8', timeout: 30000 });
    if (result.status !== 0) throw new Error(`SIMULATOR: exit ${result.status}: ${result.stderr}`);
    return result.stdout.trim().split('\n').slice(1).map(line => JSON.parse(JSON.parse(line).result.content[0].text));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
